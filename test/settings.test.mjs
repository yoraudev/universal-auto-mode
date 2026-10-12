import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openSettings } from '../adapters/opencode2/settings.js';
import { DEFAULTS, validate } from '../daemon/config.mjs';

function harness({ selects = [], prompts = [], config = { ...DEFAULTS }, session, statuses = [] }) {
  const calls = [];
  const toasts = [];
  const seen = [];
  let release;
  const dialog = {
    select: (options) => {
      seen.push(options);
      const next = selects.shift();
      if (next !== 'wait') return Promise.resolve(next);
      return new Promise((resolve) => {
        release = resolve;
      });
    },
    prompt: async () => prompts.shift(),
    clear: () => release?.(undefined),
  };
  const call = async (path, body) => {
    calls.push([path, body]);
    if (path === 'config' && !body) return { ...config, provider: 'cpu', status: statuses.shift() ?? { state: 'ready' } };
    if (path === 'config') {
      const problem = validate(body, config);
      if (problem) return { error: problem };
      Object.assign(config, body);
      return { ...config };
    }
    if (path === 'session') return session;
    if (path === 'clear') return { score: 0, flags: [] };
    throw new Error(path);
  };
  return { dialog, toast: { show: (toast) => toasts.push(toast) }, call, calls, toasts, seen, config, retryMs: 5 };
}

test('changing the model sends it to the daemon and reports when it is ready', async () => {
  const h = harness({ selects: ['model', 'small', undefined] });
  await openSettings(h);
  assert.equal(h.config.model, 'small');
  assert.deepEqual(h.calls.find(([path, body]) => path === 'config' && body), ['config', { model: 'small' }]);
  assert.match(h.toasts.at(-1).message, /ready: small on cpu/);
  assert.ok(h.seen.at(-1).options.some((option) => option.title === 'Model: small'));
});

test('numbers are parsed and rejected values are reported', async () => {
  const h = harness({ selects: ['weak', 'strong', undefined], prompts: ['0.2', '0.1'] });
  await openSettings(h);
  assert.equal(h.config.weak, 0.2);
  assert.equal(h.config.strong, 0.9);
  assert.equal(h.toasts.at(-1).variant, 'error');
});

test('cancelling a value changes nothing', async () => {
  const h = harness({ selects: ['device', undefined, 'window', undefined], prompts: [undefined] });
  await openSettings(h);
  assert.equal(h.calls.filter(([path, body]) => path === 'config' && body).length, 0);
});

test('clearing flags is offered only inside a flagged session', async () => {
  const clean = harness({ selects: [undefined] });
  await openSettings(clean);
  assert.ok(!clean.seen[0].options.some((option) => option.value === 'clear'));

  const flagged = harness({ selects: ['clear', undefined], session: { score: 0.97, flags: [{ source: 'read', score: 0.97 }], unscanned: false } });
  await openSettings({ ...flagged, sessionID: 'ses_1' });
  assert.deepEqual(flagged.calls.find(([path]) => path === 'clear'), ['clear', { session: 'ses_1' }]);
});

test('a download opens the progress view, then the list once it is done', async () => {
  const downloading = { state: 'downloading', model: 'base', file: 'model.onnx', received: 64000000, total: 641000000, percent: 9 };
  const watched = [];
  const h = harness({ selects: [undefined], statuses: [downloading, { state: 'ready' }] });
  await openSettings({ ...h, watch: async (status) => watched.push(status) });
  assert.deepEqual(watched, [downloading]);
  assert.equal(h.seen.length, 1);
  assert.equal(h.seen[0].options[1].title, 'Model: base');
  assert.match(h.toasts.at(-1).message, /ready/);
});

test('leaving the progress view early shows the list with a status line that reopens it', async () => {
  const downloading = { state: 'downloading', model: 'base', file: 'model.onnx', received: 500000000, total: 641000000, percent: 78 };
  let watches = 0;
  const h = harness({ selects: ['status', undefined], statuses: [downloading, downloading, downloading, downloading] });
  await openSettings({ ...h, watch: async () => { watches++; } });
  assert.equal(watches, 2);
  assert.equal(h.seen[0].options[1].title, 'Downloading base: 78% (500 of 641 MB)');
  assert.equal(h.seen[0].options[1].description, 'Select to watch the progress');
});

test('changing the model opens the progress view while it loads', async () => {
  let watches = 0;
  const h = harness({ selects: ['model', 'small', undefined], statuses: [{ state: 'ready' }, { state: 'loading', model: 'small' }, { state: 'ready' }] });
  await openSettings({ ...h, watch: async () => { watches++; } });
  assert.equal(watches, 1);
  assert.match(h.toasts.at(-1).message, /ready: small on cpu/);
});

test('the switch is the first entry and toggles auto mode without a second dialog', async () => {
  const h = harness({ selects: ['enabled', 'enabled', undefined] });
  await openSettings(h);
  assert.deepEqual(h.seen.map((dialog) => dialog.options[0].title), ['Auto mode: on', 'Auto mode: off', 'Auto mode: on']);
  assert.deepEqual(h.calls.filter(([path, body]) => path === 'config' && body).map(([, body]) => body), [{ enabled: false }, { enabled: true }]);
  assert.deepEqual(h.toasts.map((toast) => toast.variant), ['warning', 'success']);
  assert.equal(h.config.model, 'base');
});

test('a load error is shown in the list', async () => {
  const h = harness({ selects: [undefined], statuses: [{ state: 'error', message: 'download failed (503)' }] });
  await openSettings(h);
  assert.equal(h.seen[0].options[1].description, 'download failed (503)');
});

test('a stopped daemon is started, and reported if it does not come up', async () => {
  let up = false;
  let starts = 0;
  const h = harness({ selects: [undefined] });
  const call = (path, body) => (up ? h.call(path, body) : Promise.reject(new Error('down')));
  await openSettings({ ...h, call, start: () => { starts++; up = true; } });
  assert.equal(starts, 1);
  assert.equal(h.seen.length, 1);

  const toasts = [];
  await openSettings({ dialog: {}, toast: { show: (toast) => toasts.push(toast) }, call: () => Promise.reject(new Error('down')), start: () => {}, retryMs: 1 });
  assert.equal(toasts.at(-1).variant, 'error');
});

test('validate rejects unknown keys and inconsistent values', () => {
  assert.match(validate({ port: 1 }, DEFAULTS), /cannot be changed/);
  assert.match(validate({ model: 'huge' }, DEFAULTS), /one of/);
  assert.match(validate({ overlap: 600 }, DEFAULTS), /smaller than/);
  assert.match(validate({ window: 100.5 }, DEFAULTS), /whole number/);
  assert.match(validate({ enabled: 'no' }, DEFAULTS), /true or false/);
  assert.equal(validate({ model: 'small', weak: 0.2 }, DEFAULTS), undefined);
});

test('the detection type is one of the choices and defaults to warn', async () => {
  const h = harness({ selects: ['detection', 'ask', undefined] });
  await openSettings(h);
  assert.ok(h.seen[0].options.some((option) => option.title === 'On detection: warn'));
  assert.deepEqual(h.seen[1].options.map((option) => option.value), ['warn', 'ask']);
  assert.equal(h.config.detection, 'ask');
});
