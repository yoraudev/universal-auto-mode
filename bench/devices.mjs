import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createScanner } from '../daemon/scanner.mjs';

const root = join(import.meta.dirname, '..');
const rawDir = join(root, 'data', 'raw');
const corpus = readdirSync(rawDir).sort().map((file) => readFileSync(join(rawDir, file), 'utf8')).join('\n\n');
const models = (process.env.MODELS || 'horizon-base,horizon-small').split(',');
const devices = (process.env.DEVICES || 'cpu,dml,webgpu').split(',');
const sizes = (process.env.CHARS || '8000,40000,160000,600000').split(',').map(Number);

for (const model of models) {
  for (const device of devices) {
    const scanner = await createScanner({ dir: join(root, 'models', model), window: 512, overlap: 64, maxChars: Infinity, device });
    await scanner.scan(corpus.slice(0, 4000));
    for (const chars of sizes) {
      const result = await scanner.scan(corpus.slice(0, chars));
      console.log(`${model.padEnd(14)} ${device.padEnd(7)} ${String(result.tokens).padStart(7)} tokens ${String(result.windows).padStart(4)} windows ${String(result.ms).padStart(7)} ms  ${(result.ms / result.windows).toFixed(0).padStart(4)} ms/window  score ${result.score.toFixed(4)}`);
    }
  }
}
