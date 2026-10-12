import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createReviewer } from '../adapters/opencode2/review.js';
import { decide, effectiveScore } from '../daemon/policy.mjs';

function harness(states, choice) {
  const calls = [];
  const toasts = [];
  const dialogs = [];
  const call = async (path, body) => {
    calls.push([path, body]);
    if (path === 'ui') return states.shift() ?? { seq: 9, notices: [], reviews: [] };
    return { ok: true };
  };
  const dialog = { select: async (options) => { dialogs.push(options); return choice; } };
  return { poll: createReviewer({ dialog, toast: { show: (toast) => toasts.push(toast) }, call, sessions: () => ['ses_1'] }), calls, toasts, dialogs };
}

const review = { id: 4, session: 'ses_1', source: 'browser_page_text', score: 1 };

test('a flagged result that needs no answer is shown as a notice', async () => {
  const h = harness([{ seq: 3, notices: [], reviews: [] }, { seq: 5, notices: [{ seq: 5, session: 'ses_1', source: 'read', score: 0.42, level: 'weak', review: false }], reviews: [] }]);
  await h.poll();
  await h.poll();
  assert.deepEqual(h.calls.map(([, body]) => body), [{ after: undefined, sessions: ['ses_1'] }, { after: 3, sessions: ['ses_1'] }]);
  assert.match(h.toasts[0].message, /output of read \(score 0.42\) as a possible prompt injection/);
  assert.equal(h.dialogs.length, 0);
});

test('a review asks the user and sends the answer', async () => {
  const h = harness([{ seq: 4, notices: [{ seq: 4, session: 'ses_1', source: 'browser_page_text', score: 1, level: 'strong', review: true }], reviews: [review] }], 'continue');
  await h.poll();
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(h.dialogs[0].title, /browser_page_text \(score 1.00\)\.$/);
  assert.deepEqual(h.dialogs[0].options.map((option) => option.value), ['continue', 'stop']);
  assert.deepEqual(h.calls.at(-1), ['review/answer', { id: 4, decision: 'continue' }]);
  assert.equal(h.toasts.length, 1);
});

test('closing the question without choosing stops the agent', async () => {
  const h = harness([{ seq: 4, notices: [], reviews: [review] }], undefined);
  await h.poll();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(h.calls.at(-1), ['review/answer', { id: 4, decision: 'stop' }]);
});

test('an acknowledged flag only keeps high-risk actions with the user, a withheld one counts for nothing', () => {
  const thresholds = { weak: 0.3, strong: 0.9 };
  const flag = (state) => [{ source: 'read', score: 1, state }];
  assert.equal(effectiveScore(flag('open'), thresholds), 1);
  assert.equal(effectiveScore(flag('acknowledged'), thresholds), 0.89);
  assert.equal(effectiveScore(flag('withheld'), thresholds), 0);
  const session = (state) => ({ score: effectiveScore(flag(state), thresholds), flags: flag(state), unscanned: false });
  assert.equal(decide({ risk: 'medium' }, session('open'), thresholds).effect, 'ask');
  assert.equal(decide({ risk: 'medium' }, session('acknowledged'), thresholds).effect, 'allow');
  assert.equal(decide({ risk: 'high' }, session('acknowledged'), thresholds).effect, 'ask');
  assert.equal(decide({ risk: 'high' }, session('withheld'), thresholds).effect, 'allow');
});

test('reviews that are open at the same time become one question, and nothing is asked twice', async () => {
  const second = { id: 5, session: 'ses_1', source: 'browser_page_snapshot', score: 0.97 };
  const both = { seq: 5, notices: [], reviews: [review, second] };
  const h = harness([both, both, { seq: 6, notices: [{ seq: 6, session: 'ses_1', source: 'execute', score: 1, level: 'strong', review: false, covered: true }], reviews: [] }], 'continue');
  await h.poll();
  await new Promise((resolve) => setImmediate(resolve));
  await h.poll();
  await h.poll();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.dialogs.length, 1);
  assert.equal(h.dialogs[0].title, 'Possible prompt injection in 2 outputs (score 1.00): browser_page_text, browser_page_snapshot.');
  assert.equal(h.calls.filter(([path]) => path === 'review/answer').length, 1);
  assert.equal(h.toasts.length, 1);
});

test('stopping interrupts the session, and a late review says the agent already has the output', async () => {
  const interrupted = [];
  const calls = [];
  const dialogs = [];
  const poll = createReviewer({
    dialog: { select: async (options) => { dialogs.push(options); return 'stop'; } },
    toast: { show: () => {} },
    call: async (path, body) => { calls.push([path, body]); return path === 'ui' ? { seq: 4, notices: [], reviews: [{ ...review, late: true }] } : { ok: true }; },
    sessions: () => ['ses_1'],
    interrupt: async (session) => interrupted.push(session),
  });
  await poll();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(dialogs[0].title, /The agent already has it\.$/);
  assert.deepEqual(interrupted, ['ses_1']);
});

test('an output that could not be scanned in full is reported', async () => {
  const h = harness([{ seq: 1, notices: [] , reviews: [] }, { seq: 2, notices: [{ seq: 2, session: 'ses_1', source: 'read', unscanned: 'truncated' }], reviews: [] }]);
  await h.poll();
  await h.poll();
  assert.match(h.toasts[0].message, /too long to scan in full/);
});
