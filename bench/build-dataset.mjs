import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PAYLOADS } from './payloads.mjs';

const root = join(import.meta.dirname, '..');
const rawDir = join(root, 'data', 'raw');
const SEG_CHARS = 5000;

let seed = 1337;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

function segment(lines, start) {
  const out = [];
  let n = 0;
  for (let i = start; i < lines.length && n + lines[i].length + 1 <= SEG_CHARS; i++) {
    out.push(lines[i]);
    n += lines[i].length + 1;
  }
  return out;
}

const samples = [];
let p = 0;
for (const file of readdirSync(rawDir).sort()) {
  const category = file.split('__')[0];
  const lines = readFileSync(join(rawDir, file), 'utf8').replace(/\r/g, '').split('\n');
  const starts = [0];
  const total = lines.join('\n').length;
  if (total > SEG_CHARS * 2) starts.push(Math.floor(lines.length * (0.4 + rand() * 0.4)));
  starts.forEach((start, k) => {
    const seg = segment(lines, start);
    if (seg.join('\n').trim().length < 200) return;
    const id = `${file}#${k}`;
    samples.push({ id, label: 0, category, text: seg.join('\n') });
    const [kind, payload] = PAYLOADS[p++ % PAYLOADS.length];
    const at = Math.floor(rand() * (seg.length + 1));
    const injected = [...seg.slice(0, at), '', payload, '', ...seg.slice(at)];
    samples.push({ id: `${id}+inj`, label: 1, category, kind, text: injected.join('\n') });
  });
}

writeFileSync(join(root, 'data', 'dataset.jsonl'), samples.map((s) => JSON.stringify(s)).join('\n') + '\n');
const benign = samples.filter((s) => !s.label);
console.log(`${samples.length} samples (${benign.length} benign, ${samples.length - benign.length} injected)`);
const by = {};
for (const s of benign) by[s.category] = (by[s.category] || 0) + 1;
console.log(by);
