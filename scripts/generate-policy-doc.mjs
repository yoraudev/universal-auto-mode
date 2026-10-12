import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULTS } from '../daemon/config.mjs';
import { CRITICAL, HIGH, READ_ONLY, READ_ONLY_GIT } from '../daemon/risk.mjs';

const root = join(import.meta.dirname, '..');
const cell = (text) => String(text).replace(/\|/g, '\\|');
const rules = (list) => ['| Reason | Pattern |', '| --- | --- |', ...list.map(([pattern, reason]) => `| ${cell(reason)} | \`${cell(pattern.source)}\` |`)];
const names = (set) => [...set].map((name) => `\`${name}\``).join(', ');

const lines = [
  '# Policy',
  '',
  'This file is generated from `daemon/risk.mjs` and `daemon/config.mjs` by `npm run docs:policy`. Do not edit it by hand.',
  '',
  'Every permission request gets a risk tier from its content alone. With the detection setting on `warn`, the default, only `critical` requests are sent to the user. With `ask`, the tier is combined with the highest injection score seen in the session:',
  '',
  '| Tier | Sent to the user when |',
  '| --- | --- |',
  '| `low` | never |',
  `| \`medium\` | the session score is at least ${DEFAULTS.strong} |`,
  `| \`high\` | the session score is at least ${DEFAULTS.weak} |`,
  '| `critical` | always |',
  '',
  'A `deny` from the harness is never changed.',
  '',
  `A flagged tool output the user answered with "continue" counts as ${Math.max(DEFAULTS.weak, DEFAULTS.strong - 0.01)} at most, so it keeps \`high\` actions with the user and lets \`medium\` ones through. One the user stopped was withheld from the model and does not count.`,
  '',
  '## Shell commands',
  '',
  'Rules are checked in the order below; the first match decides.',
  '',
  '### Critical',
  '',
  ...rules(CRITICAL),
  '',
  'A recursive or forced `rm` whose target is `/`, `~`, `..`, `.` or `*` is also critical.',
  '',
  '### High',
  '',
  ...rules(HIGH),
  '',
  'A command is also high when one of its arguments is a path outside the project: `~`, a `..` segment, or an absolute path that does not resolve inside the working directory.',
  '',
  '### Low',
  '',
  'A command is low when it has no output redirection and every segment between `&&`, `||`, `;` and `|` is read-only:',
  '',
  `- one of ${names(READ_ONLY)}`,
  `- \`git\` followed by one of ${names(READ_ONLY_GIT)}`,
  '- `find` without `-exec`, `-ok` or `-delete`',
  '- `sed -n` without `-i`',
  '- any program called with only `--version`, `-v`, `-V` or `--help`',
  '',
  '### Medium',
  '',
  'Every other command.',
  '',
  '## File access',
  '',
  '| Request | Tier |',
  '| --- | --- |',
  '| Any path matching the credential pattern (the first critical rule above) | `critical` |',
  '| Writing under `.git/` or `.github/workflows/` | `critical` |',
  '| Writing outside the project | `high` |',
  '| Writing inside the project | `medium` |',
  '| Reading outside the project | `medium` |',
  '| Reading inside the project | `low` |',
  '',
  '## Other requests',
  '',
  'Network fetches and anything an adapter cannot map to a shell command or a file path are `medium`. That includes every MCP tool call, whatever the tool is called.',
  '',
  'A request with no effect outside the conversation, such as the agent asking the user a question, is `low`.',
];

writeFileSync(join(root, 'docs', 'policy.md'), `${lines.join('\n')}\n`);
console.log(`Wrote docs/policy.md with ${CRITICAL.length} critical and ${HIGH.length} high rules`);
