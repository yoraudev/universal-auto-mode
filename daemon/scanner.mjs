import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { AutoTokenizer, env } from '@huggingface/transformers';
import * as ort from 'onnxruntime-node';

const GPU_PROVIDERS = ['dml', 'webgpu', 'cuda', 'coreml'];
const EXCERPT_TOKENS = 48;
const EXCERPT_CHARS = 240;

const feeds = (tokens) => {
  const dims = [1, tokens.length];
  return {
    input_ids: new ort.Tensor('int64', BigInt64Array.from(tokens, BigInt), dims),
    attention_mask: new ort.Tensor('int64', new BigInt64Array(tokens.length).fill(1n), dims),
  };
};

async function openSession(path, device, sample, log) {
  if (device !== 'gpu') return { session: await ort.InferenceSession.create(path, { executionProviders: [device] }), provider: device };
  const supported = ort.listSupportedBackends().map((backend) => backend.name);
  let best;
  for (const provider of GPU_PROVIDERS.filter((name) => supported.includes(name))) {
    try {
      const session = await ort.InferenceSession.create(path, { executionProviders: [provider] });
      await session.run(feeds(sample));
      const started = performance.now();
      await session.run(feeds(sample));
      const ms = performance.now() - started;
      log(`gpu provider "${provider}" takes ${Math.round(ms)} ms per window`);
      if (best && best.ms <= ms) {
        await session.release();
        continue;
      }
      await best?.session.release();
      best = { session, provider, ms };
    } catch (error) {
      log(`gpu provider "${provider}" is not usable: ${String(error.message).split(/\r?\n/)[0]}`);
    }
  }
  if (best) return best;
  log('no gpu provider is usable, falling back to cpu');
  return openSession(path, 'cpu', sample, log);
}

export async function createScanner({ dir, window, overlap, maxChars, device = 'cpu' }, log = () => {}) {
  const config = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'));
  if (!/inject/i.test(config.id2label['1'])) throw new Error(`label 1 of ${dir} is "${config.id2label['1']}"`);
  env.localModelPath = dirname(dir);
  env.allowRemoteModels = false;
  const tokenizer = await AutoTokenizer.from_pretrained(basename(dir));
  const ids = (text, special) => Array.from(tokenizer(text, { add_special_tokens: special }).input_ids.data);
  const probe = ids('a', true);
  const body = ids('a', false);
  const at = probe.findIndex((_, i) => body.every((b, j) => probe[i + j] === b));
  const prefix = probe.slice(0, at);
  const suffix = probe.slice(at + body.length);
  const room = window - prefix.length - suffix.length;
  const sample = [...prefix, ...Array(room).fill(body[0]), ...suffix];
  const { session, provider } = await openSession(join(dir, 'model.onnx'), device, sample, log);

  async function scoreWindow(tokens) {
    const out = await session.run(feeds([...prefix, ...tokens, ...suffix]));
    const [safe, injection] = Array.from(out.logits.data, Number);
    return 1 / (1 + Math.exp(safe - injection));
  }

  async function excerptOf(tokens) {
    let best = { score: -1, piece: tokens };
    for (let i = 0; tokens.length > EXCERPT_TOKENS && i < tokens.length; i += EXCERPT_TOKENS / 2) {
      const piece = tokens.slice(Math.min(i, tokens.length - EXCERPT_TOKENS), Math.min(i, tokens.length - EXCERPT_TOKENS) + EXCERPT_TOKENS);
      const score = await scoreWindow(piece);
      if (score > best.score) best = { score, piece };
    }
    const text = tokenizer.decode(best.piece, { skip_special_tokens: true }).replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim();
    return text.length > EXCERPT_CHARS ? `${text.slice(0, EXCERPT_CHARS)}…` : text;
  }

  let queue = Promise.resolve();

  function scan(text, { locate = Infinity } = {}) {
    const run = async () => {
      const started = performance.now();
      const truncated = text.length > maxChars;
      const tail = Math.floor(maxChars / 2);
      const parts = truncated ? [text.slice(0, maxChars - tail), text.slice(-tail)] : [text];
      let top = { score: 0, tokens: [] };
      let windows = 0;
      let count = 0;
      for (const part of parts) {
        const tokens = ids(part, false);
        count += tokens.length;
        for (let i = 0; i === 0 || i < tokens.length - overlap; i += room - overlap) {
          const slice = tokens.slice(i, i + room);
          const score = await scoreWindow(slice);
          if (score > top.score) top = { score, tokens: slice };
          windows++;
        }
      }
      const excerpt = top.score >= locate ? await excerptOf(top.tokens) : undefined;
      return { score: top.score, windows, tokens: count, truncated, excerpt, ms: Math.round(performance.now() - started) };
    };
    const result = queue.then(run);
    queue = result.catch(() => {});
    return result;
  }

  const exclusive = (task) => {
    const result = queue.then(task);
    queue = result.catch(() => {});
    return result;
  };
  const close = () => exclusive(() => session.release());

  return { scan, close, exclusive, provider };
}
