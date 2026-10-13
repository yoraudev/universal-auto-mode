import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { breakawayLine, createClient, rotate } from '../adapters/shared/client.js';
import { DEFAULTS, loadConfig, loadTrusted, saveConfig, saveTrusted, trustPath } from '../daemon/config.mjs';
import { MODELS, download } from '../daemon/models.mjs';
import { decide } from '../daemon/policy.mjs';

const scratch = () => mkdtempSync(join(tmpdir(), 'uam-test-'));
const envWith = (content) => {
  const file = join(scratch(), 'config.json');
  if (content !== undefined) writeFileSync(file, content);
  return { UAM_CONFIG: file };
};

test('a config file with bad values keeps the good ones and falls back for the rest', () => {
  const warnings = [];
  const config = loadConfig(envWith(JSON.stringify({ model: 'small', detection: 'maybe', port: 'x', window: 100.5, unknown: 1, enabled: false })), (line) => warnings.push(line));
  assert.equal(config.model, 'small');
  assert.equal(config.enabled, false);
  assert.equal(config.detection, DEFAULTS.detection);
  assert.equal(config.port, DEFAULTS.port);
  assert.equal(config.window, DEFAULTS.window);
  assert.equal(config.unknown, undefined);
  assert.equal(warnings.length, 3);
});

test('thresholds that contradict each other fall back together', () => {
  const config = loadConfig(envWith(JSON.stringify({ weak: 0.95, overlap: 32 })));
  assert.equal(config.weak, DEFAULTS.weak);
  assert.equal(config.strong, DEFAULTS.strong);
  assert.equal(config.overlap, 32);
});

test('a config file that is not JSON is ignored and can be saved over', () => {
  const env = envWith('{ "model": ');
  const warnings = [];
  assert.deepEqual(loadConfig(env, (line) => warnings.push(line)), DEFAULTS);
  assert.match(warnings[0], /not valid JSON/);
  saveConfig({ model: 'small' }, env);
  assert.deepEqual(JSON.parse(readFileSync(env.UAM_CONFIG, 'utf8')), { model: 'small' });
  assert.equal(existsSync(`${env.UAM_CONFIG}.tmp`), false);
});

test('a port from the environment is used only when it is a port', () => {
  assert.equal(loadConfig({ ...envWith(), UAM_PORT: '7800' }).port, 7800);
  assert.equal(loadConfig({ ...envWith(), UAM_PORT: 'abc' }).port, DEFAULTS.port);
});

test('trusted content is stored next to the config file', () => {
  const env = envWith();
  assert.equal(loadTrusted(env).size, 0);
  saveTrusted(new Map([['abc', { source: 'read', at: 5 }]]), env);
  assert.deepEqual([...loadTrusted(env)], [['abc', { source: 'read', at: 5 }]]);
  writeFileSync(trustPath(env), '{"not":"a list"}');
  assert.equal(loadTrusted(env).size, 0);
});

test('a download is kept only when its checksum matches', async () => {
  const body = 'model bytes';
  const sha256 = createHash('sha256').update(body).digest('hex');
  const request = async () => new Response(body, { headers: { 'content-length': String(body.length) } });
  const target = join(scratch(), 'model.onnx');
  await download('https://example.test/model', target, sha256, () => {}, request);
  assert.equal(readFileSync(target, 'utf8'), body);
  const other = join(scratch(), 'model.onnx');
  await assert.rejects(download('https://example.test/model', other, '0'.repeat(64), () => {}, request), /checksum mismatch/);
  assert.equal(existsSync(other), false);
  assert.equal(existsSync(`${other}.part`), false);
});

test('every model file is pinned to a revision and a checksum', () => {
  for (const model of Object.values(MODELS)) {
    assert.match(model.revision, /^[0-9a-f]{40}$/);
    for (const [, , sha256] of model.files) assert.match(sha256, /^[0-9a-f]{64}$/);
  }
});

test('a session with unscanned output keeps high-risk actions with the user when asked to', () => {
  const thresholds = { weak: 0.3, strong: 0.9 };
  const session = (blind) => ({ score: 0, flags: [], blind });
  assert.equal(decide({ risk: 'high', reason: 'uses a network tool' }, session(true), thresholds).effect, 'ask');
  assert.match(decide({ risk: 'high', reason: 'uses a network tool' }, session(true), thresholds).reason, /could not be scanned/);
  assert.equal(decide({ risk: 'high' }, session(false), thresholds).effect, 'allow');
  assert.equal(decide({ risk: 'medium' }, session(true), thresholds).effect, 'allow');
});

const freePort = () =>
  new Promise((resolve) => {
    const probe = createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

test('a call that finds no daemon starts it, waits for it and is then delivered', async () => {
  const port = await freePort();
  const bodies = [];
  const daemon = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    bodies.push([req.url, JSON.parse(body)]);
    res.setHeader('connection', 'close');
    res.end(JSON.stringify({ pending: false, score: 0.01, level: 'none' }));
  });
  let launches = 0;
  const client = createClient({ port, waitMs: 5000, launch: () => (launches++, setTimeout(() => daemon.listen(port, '127.0.0.1'), 300)) });
  try {
    assert.equal(await client.callOrStart('health', undefined, { wait: false }), undefined);
    assert.equal((await client.scan({ session: 's1', source: 'read', text: 'x' })).level, 'none');
    assert.equal(launches, 1);
    assert.deepEqual(bodies, [['/scan', { session: 's1', source: 'read', text: 'x' }]]);
  } finally {
    daemon.close();
  }
});

test('output missed while the daemon was away is reported with the next scan', async () => {
  const port = await freePort();
  const bodies = [];
  const daemon = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    bodies.push(JSON.parse(body));
    res.setHeader('connection', 'close');
    res.end(JSON.stringify({ pending: false, score: 0.01, level: 'none' }));
  });
  const client = createClient({ port, waitMs: 20, launch: () => {} });
  assert.equal(await client.scan({ session: 's1', source: 'read', text: 'first' }), undefined);
  await new Promise((resolve) => daemon.listen(port, '127.0.0.1', resolve));
  try {
    await client.scan({ session: 's2', source: 'read', text: 'other' });
    await client.scan({ session: 's1', source: 'read', text: 'second' });
    await client.scan({ session: 's1', source: 'read', text: 'third' });
    assert.deepEqual(bodies.map((body) => body.missed), [undefined, true, undefined]);
  } finally {
    daemon.close();
  }
});

test('without a daemon, risky actions are asked about only when unscanned output is set to ask', async () => {
  const port = await freePort();
  const cwd = process.cwd();
  const strict = createClient({ port, waitMs: 20, launch: () => {}, env: envWith(JSON.stringify({ detection: 'ask', unscanned: 'ask' })) });
  const network = await strict.decide('s1', { kind: 'shell', command: 'curl https://example.com', cwd });
  assert.equal(network.effect, 'ask');
  assert.equal(network.risk, 'high');
  assert.match(network.reason, /uses a network tool; the auto mode daemon is not running/);
  assert.equal((await strict.decide('s1', { kind: 'shell', command: 'cat .env', cwd })).effect, 'ask');
  assert.equal(await strict.decide('s1', { kind: 'shell', command: 'npm test', cwd }), undefined);
  assert.equal(await strict.decide('s1', { kind: 'read', paths: ['src/a.js'], cwd }), undefined);
  for (const settings of [{}, { detection: 'ask' }, { unscanned: 'ask' }, { detection: 'ask', unscanned: 'ask', enabled: false }]) {
    const lenient = createClient({ port, waitMs: 20, launch: () => {}, env: envWith(JSON.stringify(settings)) });
    assert.equal(await lenient.decide('s1', { kind: 'shell', command: 'curl https://example.com', cwd }), undefined);
  }
});

test('after a start that did not work, later calls do not wait again', async () => {
  const port = await freePort();
  const client = createClient({ port, waitMs: 300, launch: () => {} });
  await client.callOrStart('health');
  const started = Date.now();
  await client.callOrStart('health');
  assert.ok(Date.now() - started < 250);
});

test('the command that starts the daemon outside the caller carries only the auto mode settings', () => {
  const line = breakawayLine({ PATH: 'C:\\bin', UAM_PORT: '7717', UAM_LOG: 'C:\\Users\\u\\.cache\\universal-auto-mode\\daemon.log', UAM_LAUNCH: 'x', UAM_MODEL: undefined }, 'C:\\Program Files\\nodejs\\node.exe', 'E:\\uam\\daemon\\server.mjs');
  assert.equal(line, 'cmd.exe /d /s /c "set "UAM_PORT=7717"&& set "UAM_LOG=C:\\Users\\u\\.cache\\universal-auto-mode\\daemon.log"&& "C:\\Program Files\\nodejs\\node.exe" "E:\\uam\\daemon\\server.mjs""');
});

test('a log file is set aside once it has grown past the limit', () => {
  const file = join(scratch(), 'daemon.log');
  writeFileSync(file, 'x'.repeat(100));
  rotate(file, 1000);
  assert.equal(statSync(file).size, 100);
  rotate(file, 50);
  assert.equal(existsSync(file), false);
  assert.equal(statSync(`${file}.1`).size, 100);
  rotate(file, 50);
});
