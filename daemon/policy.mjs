export const level = (score, { weak, strong }) => (score >= strong ? 'strong' : score >= weak ? 'weak' : 'none');

export function effectiveScore(flags, { weak, strong }) {
  const ceiling = Math.max(weak, strong - 0.01);
  return flags.reduce((highest, flag) => {
    if (flag.state === 'withheld') return highest;
    return Math.max(highest, flag.state === 'acknowledged' ? Math.min(flag.score, ceiling) : flag.score);
  }, 0);
}

export function decide({ risk, reason }, session, { weak, strong }) {
  const score = session.score;
  const sources = session.flags.filter((flag) => flag.state !== 'withheld').map((flag) => flag.source);
  const flagged = sources.length ? ` (flagged: ${sources.slice(-3).join(', ')})` : '';
  if (risk === 'critical') return { effect: 'ask', reason: `${reason}; always confirmed` };
  if (risk === 'high' && score >= weak) return { effect: 'ask', reason: `${reason}; possible prompt injection earlier in this session, score ${score.toFixed(2)}${flagged}` };
  if (risk === 'medium' && score >= strong) return { effect: 'ask', reason: `${reason}; likely prompt injection earlier in this session, score ${score.toFixed(2)}${flagged}` };
  return { effect: 'allow', reason };
}
