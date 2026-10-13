import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { RELOAD_KEYS, SETTINGS, TRUSTED_KEPT, loadConfig, loadTrusted, saveConfig, saveTrusted, validate } from './config.mjs';
import { ensureModel } from './models.mjs';
import { decide, effectiveScore, level } from './policy.mjs';
import { classify } from './risk.mjs';
import { createScanner } from './scanner.mjs';

const UI_ALIVE_MS = 4000;
const REVIEW_POLL_MS = 20000;
const NOTICES_KEPT = 50;
const SESSIONS_KEPT = 500;
const MAX_BODY_BYTES = 64 * 1024 * 1024;
const IDLE_CHECK_MS = 5000;

const log = (...args) => {
  const line = `${new Date().toISOString()} ${args.join(' ')}\n`;
  if (process.env.UAM_LOG) appendFileSync(process.env.UAM_LOG, line);
  else process.stderr.write(line);
};
process.on('uncaughtException', (error) => {
  log(error.stack ?? error.message);
  process.exit(1);
});
const config = loadConfig(process.env, log);
const trusted = loadTrusted(process.env, log);

let sequence = 0;
const watched = new Map();
const notices = [];
const reviews = new Map();
const settled = new Map();
const uiWatching = (session) => Date.now() - (watched.get(session) ?? 0) < UI_ALIVE_MS;

const sessions = new Map();
const emptySession = () => ({ flags: [], pending: new Set(), seen: new Map(), unscanned: false, answer: undefined });
const sessionOf = (id) => {
  const session = sessions.get(id) ?? emptySession();
  sessions.delete(id);
  sessions.set(id, session);
  for (const [oldest, old] of sessions) {
    if (sessions.size <= SESSIONS_KEPT) break;
    if (old.pending.size) continue;
    for (const flag of old.flags) settle(flag, 'unanswered');
    sessions.delete(oldest);
  }
  return session;
};
const scoreOf = (session) => effectiveScore(session.flags, config);
const view = (session) => ({ score: scoreOf(session), level: level(scoreOf(session), config), flags: session.flags.map(({ digest, ...flag }) => flag), pending: session.pending.size, unscanned: session.unscanned });

function settle(flag, decision) {
  const review = reviews.get(flag.id);
  if (!review) return;
  reviews.delete(flag.id);
  if (decision === 'continue') flag.state = 'acknowledged';
  if (decision === 'stop') flag.state = 'withheld';
  flag.decision = decision;
  settled.set(flag.id, decision);
  if (settled.size > NOTICES_KEPT) settled.delete(settled.keys().next().value);
  log(`review ${flag.id} ${flag.source} -> ${decision}`);
  for (const waiter of review.waiters) waiter(decision);
  if (decision === 'unanswered') return;
  sessions.get(review.session).answer = decision;
  for (const other of [...reviews.values()]) if (other.session === review.session) settle(other.flag, decision);
}

const reset = (session) => {
  for (const flag of session.flags) settle(flag, 'unanswered');
  Object.assign(session, { flags: [], seen: new Map(), unscanned: false, answer: undefined });
};

let status = { state: 'loading', model: config.model };

const open = async (settings) => {
  status = { state: 'loading', model: settings.model };
  const dir = await ensureModel(settings.model, settings.modelsDir, log, (progress) => {
    status = { state: 'downloading', model: settings.model, ...progress };
  });
  status = { state: 'loading', model: settings.model };
  const opened = await createScanner({ dir, ...settings }, log);
  log(`model "${settings.model}" ready on ${opened.provider}`);
  return opened;
};

const failed = (error) => {
  const message = String(error.message).split(/\r?\n/)[0];
  log('failed to load model:', message);
  status = { state: 'error', message };
};

let scanner;
let ready;
let provider;
let running = 0;
let lastScan = Date.now();

const load = () => {
  ready = open(config).then((opened) => {
    scanner = opened;
    provider = opened.provider;
    status = { state: 'ready' };
  });
  ready.catch(failed);
};
load();

const busy = () => status.state === 'loading' || status.state === 'downloading';
const settingsView = () => ({ ...Object.fromEntries(Object.keys(SETTINGS).map((key) => [key, config[key]])), provider, trusted: trusted.size, status });

setInterval(() => {
  if (!scanner || busy() || running || !config.unloadMinutes || Date.now() - lastScan < config.unloadMinutes * 60000) return;
  const idle = scanner;
  scanner = undefined;
  status = { state: 'idle' };
  log('classifier unloaded after being idle');
  idle.close().catch((error) => log('could not release the classifier:', error.message));
}, IDLE_CHECK_MS).unref();

const timeout = (ms) => new Promise((resolve) => setTimeout(resolve, ms, undefined));

const answer = (flag, score, ms) => ({ pending: false, score, level: level(score, config), ms, excerpt: flag?.excerpt, review: reviews.has(flag?.id) ? flag.id : undefined, decision: flag?.decision, quiet: config.notifications === 'off' });

const routes = {
  'GET /health': () => ({ ok: true, enabled: config.enabled, ready: Boolean(scanner) || status.state === 'idle', model: config.model, device: provider, status }),

  'POST /scan': async ({ session: id, source = 'tool', text = '', budgetMs = config.scanBudgetMs, ui = false, missed = false }) => {
    if (!config.enabled) return { disabled: true };
    const session = sessionOf(id);
    if (missed) {
      session.unscanned = true;
      notices.push({ seq: ++sequence, session: id, source, unscanned: 'missed' });
      log(`scan ${id} earlier output was not scanned`);
    }
    const digest = createHash('sha256').update(text).digest('base64');
    if (trusted.has(digest)) return { pending: false, score: 0, level: 'none', ms: 0, trusted: true, quiet: config.notifications === 'off' };
    const earlier = session.seen.get(digest);
    if (earlier) return answer(earlier.flag, earlier.score, 0);
    let inTime = true;
    running++;
    lastScan = Date.now();
    if (status.state === 'idle') load();
    const job = ready
      .then(() => scanner.scan(text, { locate: config.weak }))
      .then((result) => {
        log(`scan ${id} ${source} score=${result.score.toFixed(3)} tokens=${result.tokens} ${result.ms}ms`);
        if (result.truncated) {
          session.unscanned = true;
          notices.push({ seq: ++sequence, session: id, source, unscanned: 'truncated' });
        }
        if (result.score < config.weak) {
          if (!result.truncated) session.seen.set(digest, { score: result.score });
          return { result };
        }
        const flag = { id: ++sequence, source, score: +result.score.toFixed(3), excerpt: result.excerpt, digest, at: Date.now(), state: 'open' };
        session.flags.push(flag);
        if (!result.truncated) session.seen.set(digest, { score: result.score, flag });
        const strong = result.score >= config.strong;
        const covered = config.detection === 'ask' && strong && session.answer !== undefined;
        const reviewed = config.detection === 'ask' && strong && !covered && (uiWatching(id) || (ui && inTime));
        if (covered) Object.assign(flag, { state: session.answer === 'stop' ? 'withheld' : 'acknowledged', decision: session.answer });
        if (reviewed) reviews.set(flag.id, { flag, session: id, waiters: [], late: !inTime });
        if (config.notifications === 'on') notices.push({ seq: flag.id, session: id, source, score: flag.score, level: level(flag.score, config), excerpt: flag.excerpt, review: reviewed, covered, late: !inTime });
        if (notices.length > NOTICES_KEPT) notices.shift();
        return { result, flag };
      })
      .catch((error) => {
        session.unscanned = true;
        notices.push({ seq: ++sequence, session: id, source, unscanned: 'failed' });
        log(`scan ${id} ${source} failed:`, error.message);
      })
      .finally(() => {
        running--;
        lastScan = Date.now();
        session.pending.delete(job);
      });
    session.pending.add(job);
    const done = await Promise.race([job, timeout(budgetMs)]);
    if (!done) {
      inTime = false;
      return { pending: true };
    }
    return { ...answer(done.flag, done.result.score, done.result.ms), truncated: done.result.truncated };
  },

  'POST /review': async ({ id }) => {
    const review = reviews.get(id);
    if (!review) return { decision: settled.get(id) ?? 'unanswered' };
    const decision = await Promise.race([new Promise((resolve) => review.waiters.push(resolve)), timeout(REVIEW_POLL_MS)]);
    if (decision) return { decision };
    if (uiWatching(review.session)) return { pending: true };
    settle(review.flag, 'unanswered');
    return { decision: 'unanswered' };
  },

  'POST /review/answer': ({ id, decision }) => {
    const review = reviews.get(id);
    if (!review) return { error: 'This was already answered.' };
    if (decision !== 'continue' && decision !== 'stop') return { error: 'decision must be "continue" or "stop"' };
    settle(review.flag, decision);
    return { ok: true };
  },

  'POST /ui': ({ after, sessions: shown = [] }) => {
    const now = Date.now();
    for (const [session, at] of watched) if (now - at >= UI_ALIVE_MS) watched.delete(session);
    for (const session of shown) watched.set(session, now);
    return {
      seq: sequence,
      notices: after === undefined ? [] : notices.filter((notice) => notice.seq > after),
      reviews: [...reviews.values()].filter((review) => shown.includes(review.session)).map(({ flag, session, late }) => ({ id: flag.id, session, source: flag.source, score: flag.score, excerpt: flag.excerpt, late })),
    };
  },

  'POST /turn': ({ session: id }) => {
    const session = sessions.get(id);
    if (session) session.answer = undefined;
    return { ok: true };
  },

  'POST /decide': async ({ session: id, request }) => {
    if (!config.enabled) return { disabled: true };
    const session = sessionOf(id);
    const assessed = classify(request);
    const asking = config.detection === 'ask';
    if (asking && assessed.risk !== 'low' && assessed.risk !== 'critical' && session.pending.size) {
      await Promise.race([Promise.all(session.pending), timeout(config.decideWaitMs)]);
    }
    const score = asking ? scoreOf(session) : 0;
    const blind = asking && config.unscanned === 'ask' && (session.unscanned || session.pending.size > 0);
    const decision = decide(assessed, { score, flags: session.flags, blind }, config);
    log(`decide ${id} ${request.kind} risk=${assessed.risk} score=${score.toFixed(3)} -> ${decision.effect}: ${decision.reason}`);
    return { ...decision, risk: assessed.risk, score };
  },

  'POST /session': ({ session: id }) => view(sessions.get(id) ?? emptySession()),

  'GET /config': () => settingsView(),

  'POST /config': (patch) => {
    const problem = validate(patch, config);
    if (problem) return { error: problem };
    const apply = () => {
      Object.assign(config, patch);
      saveConfig(patch);
      log(`settings changed: ${JSON.stringify(patch)}`);
    };
    if (!RELOAD_KEYS.some((key) => key in patch && patch[key] !== config[key]) && status.state !== 'error') {
      apply();
      return settingsView();
    }
    if (busy()) return { error: 'The classifier is still loading. Try again when it is ready.' };
    const previous = scanner;
    const loading = open({ ...config, ...patch }).then(async (opened) => {
      scanner = opened;
      provider = opened.provider;
      apply();
      await opened.exclusive(() => previous?.close());
      status = { state: 'ready' };
    });
    loading.catch(failed);
    if (!previous) ready = loading;
    return settingsView();
  },

  'POST /clear': ({ session: id }) => {
    const session = sessionOf(id);
    reset(session);
    log(`clear ${id}`);
    return view(session);
  },

  'POST /trust': ({ session: id }) => {
    const session = sessionOf(id);
    const flags = session.flags.filter((flag) => flag.state !== 'withheld');
    for (const flag of flags) {
      trusted.delete(flag.digest);
      trusted.set(flag.digest, { source: flag.source, at: Date.now() });
    }
    while (trusted.size > TRUSTED_KEPT) trusted.delete(trusted.keys().next().value);
    if (flags.length) saveTrusted(trusted);
    reset(session);
    log(`trust ${id} ${flags.length} outputs`);
    return { ...view(session), added: flags.length, trusted: trusted.size };
  },

  'POST /trust/reset': () => {
    trusted.clear();
    saveTrusted(trusted);
    log('trusted content forgotten');
    return { trusted: 0 };
  },
};

async function read(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) return undefined;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const server = createServer(async (req, res) => {
  res.setHeader('connection', 'close');
  const route = routes[`${req.method} ${req.url}`];
  if (!route) return res.writeHead(404).end();
  if (req.headers.origin || !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host ?? '')) return res.writeHead(403).end();
  try {
    const body = await read(req);
    if (body === undefined) return res.writeHead(413, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'request body is too large' }));
    const result = await route(body ? JSON.parse(body) : {});
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result));
  } catch (error) {
    res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: error.message }));
  }
});

server.on('error', (error) => {
  log(error.code === 'EADDRINUSE' ? `port ${config.port} is already in use` : error.message);
  process.exit(1);
});
server.listen(config.port, '127.0.0.1', () => log(`listening on 127.0.0.1:${config.port}`));
