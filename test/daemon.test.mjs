import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { rotate } from '../adapters/shared/client.js';
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
