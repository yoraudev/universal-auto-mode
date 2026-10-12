import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { AutoTokenizer, env } from '@huggingface/transformers';
import * as ort from 'onnxruntime-node';

const root = join(import.meta.dirname, '..');
env.localModelPath = join(root, 'models');
env.allowRemoteModels = false;

const WINDOW = Number(process.env.WINDOW || 2048);
const OVERLAP = Number(process.env.OVERLAP || 256);
const SPECS = {
  'horizon-small': ['horizon-small', 'model.onnx'],
  'horizon-base': ['horizon-base', 'model.onnx'],
};
const ALL = Object.keys(SPECS);
const models = process.argv.length > 2 ? process.argv.slice(2) : ALL;
const limit = Number(process.env.LIMIT || 0);
const device = process.env.DEVICE || 'cpu';

let samples = readFileSync(join(root, 'data', 'dataset.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
if (limit) samples = samples.slice(0, limit);

const outPath = join(root, 'results', process.env.OUT || 'scores.jsonl');
const rows = existsSync(outPath) && !limit
  ? readFileSync(outPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => !models.includes(r.model))
  : [];

const softmax1 = ([a, b]) => 1 / (1 + Math.exp(a - b));

for (const name of models) {
  const [dirName, file] = SPECS[name];
  const dir = join(root, 'models', dirName);
  const config = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'));
  if (!/inject/i.test(config.id2label['1'])) throw new Error(`${name}: label 1 is ${config.id2label['1']}`);
  const tokenizer = await AutoTokenizer.from_pretrained(dirName);
  const t0 = performance.now();
  const session = await ort.InferenceSession.create(join(dir, file), { executionProviders: [device] });
  console.log(`${name}: loaded in ${Math.round(performance.now() - t0)} ms, inputs ${session.inputNames}`);

  const probe = Array.from(tokenizer('a').input_ids.data);
  const body = Array.from(tokenizer('a', { add_special_tokens: false }).input_ids.data);
  const at = probe.findIndex((v, i) => body.every((b, j) => probe[i + j] === b));
  const prefix = probe.slice(0, at);
  const suffix = probe.slice(at + body.length);
  const room = WINDOW - prefix.length - suffix.length;

  async function score(ids) {
    const full = [...prefix, ...ids, ...suffix];
    const dims = [1, full.length];
    const feeds = { input_ids: new ort.Tensor('int64', BigInt64Array.from(full), dims) };
    if (session.inputNames.includes('attention_mask')) feeds.attention_mask = new ort.Tensor('int64', new BigInt64Array(full.length).fill(1n), dims);
    if (session.inputNames.includes('token_type_ids')) feeds.token_type_ids = new ort.Tensor('int64', new BigInt64Array(full.length), dims);
    const out = await session.run(feeds);
    return softmax1(Array.from(out[session.outputNames[0]].data, Number));
  }

  let done = 0;
  for (const s of samples) {
    const ids = Array.from(tokenizer(s.text, { add_special_tokens: false }).input_ids.data);
    const t = performance.now();
    let max = 0;
    let windows = 0;
    for (let i = 0; i === 0 || i < ids.length - OVERLAP; i += room - OVERLAP) {
      max = Math.max(max, await score(ids.slice(i, i + room)));
      windows++;
    }
    rows.push({ model: name, id: s.id, score: +max.toFixed(5), ms: Math.round(performance.now() - t), tokens: ids.length, windows });
    if (++done % 40 === 0) console.log(`${name}: ${done}/${samples.length}`);
  }
  await session.release();
  if (!limit) writeFileSync(outPath, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  else console.log(rows.filter((r) => r.model === name).map((r) => `${r.id} ${r.score} ${r.ms}ms ${r.tokens}tok`).join('\n'));
}
