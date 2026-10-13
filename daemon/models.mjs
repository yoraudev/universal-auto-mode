import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const TOKENIZER = '47834a7dbbb0c4324fe9569fe47955241594a9ee539c9e478755d6fbc51e5f46';

export const MODELS = {
  base: {
    dir: 'horizon-base',
    repo: 'Horizon-Labs/prompt-injection-guard-base',
    revision: 'e4fbfc6f603e24c675cdf310c3b8d7abaa825666',
    files: [
      ['onnx/model_quantized.onnx', 'model.onnx', '682d805f93f823d5a1ac73bd55808719c5489f14846faf20b97fd40dfc28b4be'],
      ['tokenizer.json', 'tokenizer.json', TOKENIZER],
      ['tokenizer_config.json', 'tokenizer_config.json', '1d2f82c1341a79748e00efe82e67690f99d00b3c2a894f2b23128fd9d3519da3'],
      ['config.json', 'config.json', '34fbf08b5c26d800bb55d6f1de0d3a39c35eb8b5d4208c681361a20f93923f54'],
    ],
  },
  small: {
    dir: 'horizon-small',
    repo: 'Horizon-Labs/prompt-injection-guard-small',
    revision: 'e0e88c4e940ee7e1b52bdf943d501ec696b83b9b',
    files: [
      ['onnx/model_quantized.onnx', 'model.onnx', '61cd0741cdbfcc229e32e1de1392f352736d87d1e8b3c2b67ad9836bb7910d5d'],
      ['tokenizer.json', 'tokenizer.json', TOKENIZER],
      ['tokenizer_config.json', 'tokenizer_config.json', 'ea349495764b24570b4560fe2e4a557e5c0a47e6bce782c2409b1d6445cf8633'],
      ['config.json', 'config.json', 'd6264037c9aa4b3d821c1c9a0329572033adbdb622788ecca91c3636066d9622'],
    ],
  },
};

const PROGRESS_INTERVAL_MS = 200;
const ATTEMPTS = 4;
const RETRY_DELAY_MS = 3000;

export async function download(url, target, sha256, onProgress = () => {}, request = fetch) {
  const res = await request(url);
  if (!res.ok) throw new Error(`download failed (${res.status}): ${url}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const hash = createHash('sha256');
  let received = 0;
  let reported = 0;
  const report = () => onProgress({ received, total, percent: total ? Math.floor((100 * received) / total) : undefined });
  const counter = new Transform({
    transform(chunk, _encoding, done) {
      received += chunk.length;
      hash.update(chunk);
      if (Date.now() - reported >= PROGRESS_INTERVAL_MS) {
        reported = Date.now();
        report();
      }
      done(null, chunk);
    },
  });
  report();
  await pipeline(Readable.fromWeb(res.body), counter, createWriteStream(`${target}.part`));
  const actual = hash.digest('hex');
  if (actual !== sha256) {
    rmSync(`${target}.part`, { force: true });
    throw new Error(`checksum mismatch for ${url}: expected ${sha256}, got ${actual}`);
  }
  renameSync(`${target}.part`, target);
}

export async function ensureModel(name, modelsDir, log = () => {}, onProgress = () => {}) {
  const model = MODELS[name];
  if (!model) throw new Error(`unknown model "${name}" (expected ${Object.keys(MODELS).join(' or ')})`);
  const dir = join(modelsDir, model.dir);
  mkdirSync(dir, { recursive: true });
  for (const [remote, local, sha256] of model.files) {
    const target = join(dir, local);
    if (existsSync(target)) continue;
    const url = `https://huggingface.co/${model.repo}/resolve/${model.revision}/${remote}`;
    for (let attempt = 1; ; attempt++) {
      log(`downloading ${model.repo}/${remote}${attempt > 1 ? ` (attempt ${attempt})` : ''}`);
      try {
        await download(url, target, sha256, (progress) => onProgress({ file: local, ...progress }));
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
