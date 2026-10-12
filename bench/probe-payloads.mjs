import { join } from 'node:path';
import { AutoTokenizer, env } from '@huggingface/transformers';
import * as ort from 'onnxruntime-node';
import { PAYLOADS } from './payloads.mjs';
const root = join(import.meta.dirname, '..');
env.localModelPath = join(root, 'models');
env.allowRemoteModels = false;
const [name, file] = process.argv.slice(2);
const tokenizer = await AutoTokenizer.from_pretrained(name);
const session = await ort.InferenceSession.create(join(root, 'models', name, file));
let hits = 0;
const line = [];
for (const [kind, text] of PAYLOADS) {
  const ids = BigInt64Array.from(tokenizer(text).input_ids.data);
  const out = await session.run({ input_ids: new ort.Tensor('int64', ids, [1, ids.length]), attention_mask: new ort.Tensor('int64', new BigInt64Array(ids.length).fill(1n), [1, ids.length]) });
  const [a, b] = Array.from(out.logits.data, Number);
  const p = 1 / (1 + Math.exp(a - b));
  if (p >= 0.5) hits++;
  line.push(`${kind}:${p.toFixed(2)}`);
}
console.log(`${name}/${file}: ${hits}/${PAYLOADS.length} flagged alone\n  ${line.join(' ')}`);
