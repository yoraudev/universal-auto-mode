import { createWriteStream, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const FILES = [
  ['onnx/model_quantized.onnx', 'model.onnx'],
  ['tokenizer.json', 'tokenizer.json'],
  ['tokenizer_config.json', 'tokenizer_config.json'],
  ['config.json', 'config.json'],
];

export const MODELS = {
  base: { dir: 'horizon-base', repo: 'Horizon-Labs/prompt-injection-guard-base' },
  small: { dir: 'horizon-small', repo: 'Horizon-Labs/prompt-injection-guard-small' },
};

const PROGRESS_INTERVAL_MS = 200;
const ATTEMPTS = 4;
const RETRY_DELAY_MS = 3000;

async function download(url, target, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed (${res.status}): ${url}`);
  const total = Number(res.headers.get('content-length')) || 0;
  let received = 0;
  let reported = 0;
  const report = () => onProgress({ received, total, percent: total ? Math.floor((100 * received) / total) : undefined });
  const counter = new Transform({
    transform(chunk, _encoding, done) {
      received += chunk.length;
      if (Date.now() - reported >= PROGRESS_INTERVAL_MS) {
        reported = Date.now();
        report();
      }
      done(null, chunk);
    },
  });
  report();
  await pipeline(Readable.fromWeb(res.body), counter, createWriteStream(`${target}.part`));
  renameSync(`${target}.part`, target);
}

export async function ensureModel(name, modelsDir, log = () => {}, onProgress = () => {}) {
  const model = MODELS[name];
  if (!model) throw new Error(`unknown model "${name}" (expected ${Object.keys(MODELS).join(' or ')})`);
  const dir = join(modelsDir, model.dir);
  mkdirSync(dir, { recursive: true });
  for (const [remote, local] of FILES) {
    const target = join(dir, local);
    if (existsSync(target)) continue;
    const url = `https://huggingface.co/${model.repo}/resolve/main/${remote}`;
    for (let attempt = 1; ; attempt++) {
      log(`downloading ${model.repo}/${remote}${attempt > 1 ? ` (attempt ${attempt})` : ''}`);
      try {
        await download(url, target, (progress) => onProgress({ file: local, ...progress }));
        break;
      } catch (error) {
        if (attempt === ATTEMPTS) throw new Error(`could not download ${local}: ${error.cause?.code ?? error.message}`);
        log(`download of ${local} failed: ${error.cause?.code ?? error.message}`);
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }
  return dir;
}
