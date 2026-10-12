import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(root, p), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const samples = new Map(read('data/dataset.jsonl').map((s) => [s.id, s]));
const rows = read('results/' + (process.env.OUT || 'scores.jsonl'));
const models = [...new Set(rows.map((r) => r.model))];
const scores = Object.fromEntries(models.map((m) => [m, new Map(rows.filter((r) => r.model === m).map((r) => [r.id, r.score]))]));
const ids = [...samples.keys()].filter((id) => models.every((m) => scores[m].has(id)));
const benign = ids.filter((id) => !samples.get(id).label);
const attack = ids.filter((id) => samples.get(id).label);
const pct = (n, d) => (d ? ((100 * n) / d).toFixed(1).padStart(5) + '%' : '    -');
const rate = (set, fn) => pct(set.filter(fn).length, set.length);

function auc(get) {
  let wins = 0;
  for (const a of attack) for (const b of benign) wins += get(a) > get(b) ? 1 : get(a) === get(b) ? 0.5 : 0;
  return (wins / (attack.length * benign.length)).toFixed(3);
}

console.log(`samples: ${benign.length} benign, ${attack.length} injected\n`);
console.log('model            AUC    FPR@.5 rec@.5  FPR@.9 rec@.9  FPR@.3 rec@.3   median ms  p95 ms');
for (const m of models) {
  const g = (id) => scores[m].get(id);
  const ms = rows.filter((r) => r.model === m).map((r) => r.ms).sort((a, b) => a - b);
  const cols = [0.5, 0.9, 0.3].map((t) => `${rate(benign, (id) => g(id) >= t)} ${rate(attack, (id) => g(id) >= t)}`);
  console.log(`${m.padEnd(15)} ${auc(g)}  ${cols.join('  ')}   ${String(ms[ms.length >> 1]).padStart(7)}  ${String(ms[Math.floor(ms.length * 0.95)]).padStart(6)}`);
}

const group = (set, key) => {
  const out = {};
  for (const id of set) (out[samples.get(id)[key]] ||= []).push(id);
  return out;
};
const table = (title, groups) => {
  console.log(`\n${title.padEnd(16)} n   ${models.map((m) => m.padStart(13)).join(' ')}`);
  for (const [k, set] of Object.entries(groups))
    console.log(`${k.padEnd(15)} ${String(set.length).padStart(3)} ${models.map((m) => rate(set, (id) => scores[m].get(id) >= 0.5).padStart(13)).join(' ')}`);
};
table('FPR@.5 by source', group(benign, 'category'));
table('recall@.5 by kind', group(attack, 'kind'));
table('recall@.5 by src', group(attack, 'category'));

console.log('\ncombinations at 0.5       FPR    recall');
for (let i = 0; i < models.length; i++)
  for (let j = i + 1; j < models.length; j++) {
    const [a, b] = [models[i], models[j]];
    const hit = (id, m) => scores[m].get(id) >= 0.5;
    console.log(`${(a + ' AND ' + b).padEnd(30)} ${rate(benign, (id) => hit(id, a) && hit(id, b))} ${rate(attack, (id) => hit(id, a) && hit(id, b))}`);
    console.log(`${(a + ' OR ' + b).padEnd(30)} ${rate(benign, (id) => hit(id, a) || hit(id, b))} ${rate(attack, (id) => hit(id, a) || hit(id, b))}`);
  }
