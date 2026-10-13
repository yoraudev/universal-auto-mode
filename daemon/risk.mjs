import { isAbsolute, relative, resolve } from 'node:path';

const BEFORE = String.raw`(^|[\\/\s"'=])`;
const AFTER = String.raw`(?=$|[\\/\s"';|&)])`;

const CREDENTIALS = new RegExp(`${BEFORE}(\\.ssh|\\.aws|\\.azure|\\.gnupg|\\.kube|\\.docker[\\\\/]config|\\.config[\\\\/](gh|gcloud)|id_(rsa|ed25519|ecdsa)|\\.npmrc|\\.pypirc|\\.netrc|\\.git-credentials|\\.env(\\.[\\w.-]+)?|credentials(\\.(json|toml|ya?ml|ini|db))?|auth\\.json|secrets?\\.(json|ya?ml|toml)|[\\w.-]+\\.(pem|key|pfx|p12))${AFTER}`, 'i');

export const CREDENTIAL_NAMES = ['.ssh', '.aws', '.azure', '.gnupg', '.kube', '.env', '.env.local', '.npmrc', '.pypirc', '.netrc', '.git-credentials', 'id_rsa', 'id_ed25519', 'id_ecdsa', 'credentials', 'secrets', 'x.pem', 'x.key', 'x.pfx', 'x.p12'];

const STARTUP = new RegExp(`${BEFORE}(\\.(bash|zsh)rc|\\.(bash_|z)?profile|\\.zshenv|\\.bash_login|\\.gitconfig|authorized_keys|[\\w.]*profile\\.ps1)${AFTER}|\\$profile\\b|[\\\\/]\\.git[\\\\/]hooks|${BEFORE}\\.husky[\\\\/]|start menu[\\\\/]programs[\\\\/]startup|[\\\\/]launch(agents|daemons)[\\\\/]|\\.config[\\\\/](autostart|systemd)[\\\\/]|[\\\\/]etc[\\\\/]cron`, 'i');
const HARNESS = new RegExp(`${BEFORE}(opencode\\.jsonc?${AFTER}|\\.opencode[\\\\/]|\\.pi[\\\\/]|\\.config[\\\\/]opencode[\\\\/])`, 'i');
const OWN_DATA = /[\\/]\.(config|cache)[\\/]universal-auto-mode([\\/]|$)/i;
const OWN_ROOT = resolve(import.meta.dirname, '..');

const INTERPRETER = String.raw`((ba|z|da|k)?sh|python\d?|node|perl|ruby|pwsh|powershell)`;
const FETCHER = String.raw`(curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)`;

export const CRITICAL = [
  [CREDENTIALS, 'touches credential files'],
  [new RegExp(String.raw`\|\s*(sudo\s+)?${INTERPRETER}\b`, 'i'), 'pipes output into an interpreter'],
  [new RegExp(String.raw`\b(${INTERPRETER}|source)\b[^|;&\n]*(\$\(|\x60|<\()\s*${FETCHER}\b`, 'i'), 'runs downloaded code in an interpreter'],
  [/\b(iex|invoke-expression)\b|\b(ba)?sh\s+<\(|\beval\s/i, 'evaluates dynamically built code'],
  [/\bgit\s+push\b.*(--force|\s-f\b|--force-with-lease|--mirror|--delete|\s-d\b|\s\+\S|\s:\S)|\bgit\s+reset\s+--hard|\bgit\s+clean\s+-\w*f|\bgit\s+(filter-branch|filter-repo)\b|\bgit\s+reflog\s+expire\b/i, 'rewrites or discards git history'],
  [/\bgit\s+checkout\b.*\s(--|\.|-f|--force)(\s|$)|\bgit\s+switch\b.*\s(-f|--force|--discard-changes)(\s|$)|\bgit\s+restore\b(?!.*--staged\b)|\bgit\s+restore\b.*--worktree\b|\bgit\s+stash\s+(drop|clear)\b/i, 'discards uncommitted work'],
  [/\b(mkfs|fdisk|diskpart|shutdown|reboot)\b|\bdd\s+.*\bof=|\bformat\s+[a-z]:/i, 'modifies disks or system state'],
  [/\b(npm|pnpm|yarn|bun|cargo)\s+publish\b|\btwine\s+upload\b|\bgh\s+release\b|\bdocker\s+push\b/i, 'publishes to a registry'],
  [/\b(sudo|doas|runas)\b|\bchmod\s+\S*[+]s|\b(crontab|schtasks|launchctl|systemctl)\b|\breg(\.exe)?\s+add\b|\bsetx\b/i, 'changes privileges or persistence'],
  [new RegExp(String.raw`\bgit\s+config\s+.*(--global|--system)|core\.hookspath|${STARTUP.source}`, 'i'), 'modifies git hooks, shell startup files or global config'],
  [/universal-auto-mode|\buam\b|:7717\b/i, 'targets the auto-mode daemon itself'],
];

export const HIGH = [
  [/\b(curl|wget|ssh|scp|sftp|rsync|nc|ncat|netcat|telnet|ftp|invoke-webrequest|iwr|invoke-restmethod|irm|start-bitstransfer|certutil|bitsadmin)\b/i, 'uses a network tool'],
  [/\bhttps?:\/\//i, 'references a URL'],
  [/\bgit\s+(push|clone|fetch|pull|remote|submodule)\b|\bgh\s/i, 'talks to a git remote'],
  [/\b(npm|pnpm|yarn|bun)\s+(i|install|add|create|dlx|x)\b|\b(npx|bunx|uvx|pipx)\b|\b(pip|pip3|uv)\s+(install|add)\b|\bcargo\s+(install|add)\b|\bgo\s+(get|install)\b|\b(brew|apt|apt-get|choco|winget|scoop)\s+install\b/i, 'installs packages'],
  [/\bdocker\s+(run|pull|build|exec)\b/i, 'runs containers'],
  [/\b(rm|rmdir|del|erase|rd|ri|remove-item|clear-content|unlink|shred|truncate)\b|\bfind\b.*\s-delete\b|\bgit\s+(branch|tag)\b.*\s-\w*d\b/i, 'deletes files'],
  [/\b(kill|pkill|taskkill|stop-process)\b/i, 'stops processes'],
];

export const READ_ONLY = new Set(['ls', 'dir', 'cat', 'type', 'head', 'tail', 'grep', 'rg', 'fd', 'wc', 'pwd', 'echo', 'which', 'where', 'tree', 'stat', 'file', 'du', 'df', 'date', 'sort', 'uniq', 'cut', 'jq', 'cd', 'true', 'test', 'get-childitem', 'get-content', 'select-string', 'get-location']);
export const READ_ONLY_GIT = new Set(['status', 'diff', 'log', 'show', 'branch', 'rev-parse', 'ls-files', 'blame', 'describe', 'shortlog']);

export const UNSAFE_FLAGS = {
  sort: /\s(-\w*o|--output)\b/,
  fd: /\s(-x|-X|--exec|--exec-batch)\b/,
  rg: /\s--(pre|hostname-bin)\b/,
  tree: /\s-o\b/,
  date: /\s(-s|--set)\b/,
  git: /\s(--output|--ext-diff)\b/,
};

const HOME_VARIABLE = /\$\{?(HOME|USERPROFILE|APPDATA|LOCALAPPDATA|TMPDIR|TEMP|TMP|XDG_\w+)\b/;
const HOME_VARIABLE_WINDOWS = /(\$\{?env:|%)(home|userprofile|homepath|appdata|localappdata|programdata|temp|tmp)\b/i;
const VARIABLE_PATH = /^(\$\{?(env:)?(\w+)\}?|%(\w+)%)[\\/]/i;
const SUBSTITUTION = /\$\(|`|[<>]\(/;
const GLOB = /[*?[{]/;

const outside = (cwd, target) => {
  const rel = relative(cwd, resolve(cwd, target));
  return rel.startsWith('..') || isAbsolute(rel);
};

const plain = (text) => text.replace(/["'`^\\]/g, '');

function globPattern(segment) {
  const source = segment.replace(/[.+^$()|\\]/g, '\\$&').replace(/\*+/g, '.*').replace(/\?/g, '.').replace(/\[!/g, '[^').replace(/\{([^{}]*)\}/g, (_, list) => `(?:${list.split(',').join('|')})`);
  try {
    return new RegExp(`^${source}$`, 'i');
  } catch {
    return undefined;
  }
}

function globsCredential(text) {
  return text.replace(/["'`^]/g, '').split(/[\s|;&<>()=\\/]+/).some((segment) => {
    if (!GLOB.test(segment) || segment.replace(/[*?{},]|\[[^\]]*\]/g, '').length < 2) return false;
    const pattern = globPattern(segment);
    return Boolean(pattern) && CREDENTIAL_NAMES.some((name) => pattern.test(name));
  });
}

function readOnlySegment(segment) {
  const words = segment.replace(/^(\w+=\S+\s+)+/, '').split(/\s+/);
  const [first, sub] = words;
  const name = first.toLowerCase();
  if (UNSAFE_FLAGS[name]?.test(segment)) return false;
  if (name === 'find') return !/\s-(exec\w*|ok\w*|delete|fprint\w*|fls)\b/.test(segment);
  if (name === 'git' && sub === 'branch') return words.slice(2).every((word) => word.startsWith('-') && !/^(-[a-zA-Z]*[dDmMcCfu]|--(delete|move|copy|force|set-upstream-to|unset-upstream|edit-description|track|no-track))/.test(word));
  if (name === 'git') return READ_ONLY_GIT.has(sub);
  if (name === 'sed') return /^sed\s+-n\s+["']?\d+(,\d+)?p["']?(\s|$)/.test(segment) && !/\s-i/.test(segment);
  if (name === 'uniq') return words.slice(1).filter((word) => !word.startsWith('-')).length < 2;
  return READ_ONLY.has(name) || (words.length === 2 && /^(--version|-V|--help)$/.test(sub));
}

function shellRisk(command, cwd) {
  const variants = [command, plain(command)];
  const segments = command.split(/&&|\|\||[;|&\n]/).map((s) => s.trim()).filter(Boolean);
  const readOnly = !SUBSTITUTION.test(command) && !/>/.test(command) && segments.every(readOnlySegment);
  for (const [pattern, reason] of CRITICAL) if (variants.some((text) => pattern.test(text))) return { risk: 'critical', reason };
  if (globsCredential(command)) return { risk: 'critical', reason: 'touches credential files' };
  if (!readOnly && variants.some((text) => HARNESS.test(text))) return { risk: 'critical', reason: 'modifies the harness configuration' };
  if (/\brm\b.*\s-\w*[rf]/i.test(command) && /(\s|^)(\/|~|\.\.|\*|\.)(\s|$|\/)/.test(command)) return { risk: 'critical', reason: 'recursively deletes a broad path' };
  for (const [pattern, reason] of HIGH) if (variants.some((text) => pattern.test(text))) return { risk: 'high', reason };
  const escapes = command.split(/[\s"'|;&<>()=]+/).some((token) => {
    if (/^~([\\/]|$)/.test(token) || /(^|[\\/])\.\.([\\/]|$)/.test(token)) return true;
    if (HOME_VARIABLE.test(token) || HOME_VARIABLE_WINDOWS.test(token)) return true;
    const variable = VARIABLE_PATH.exec(token);
    if (variable && (variable[3] ?? variable[4]).toLowerCase() !== 'pwd') return true;
    const absolute = /^[a-z]:[\\/]/i.test(token) || (token.startsWith('/') && !/^\/[a-z?]{1,2}$/i.test(token));
    const native = process.platform === 'win32' ? token.replace(/^\/([a-z])\//i, '$1:/') : token;
    return absolute && outside(cwd, native);
  });
  if (escapes) return { risk: 'high', reason: 'reaches outside the project' };

  if (readOnly) return { risk: 'low', reason: 'read-only command' };
  return { risk: 'medium', reason: 'runs a command inside the project' };
}

function pathRisk(kind, paths, cwd) {
  if (paths.some((p) => CREDENTIALS.test(p) || globsCredential(p))) return { risk: 'critical', reason: 'touches credential files' };
  const out = paths.some((p) => outside(cwd, p));
  if (kind === 'read') return out ? { risk: 'medium', reason: 'reads outside the project' } : { risk: 'low', reason: 'reads inside the project' };
  const targets = paths.flatMap((p) => [p, resolve(cwd, p)]);
  if (targets.some((p) => /(^|[\\/])\.git[\\/]|(^|[\\/])\.github[\\/]workflows[\\/]/i.test(p))) return { risk: 'critical', reason: 'modifies git internals or CI workflows' };
  if (targets.some((p) => STARTUP.test(p))) return { risk: 'critical', reason: 'modifies git hooks, shell startup files or global config' };
  const own = outside(OWN_ROOT, cwd) && paths.some((p) => !outside(OWN_ROOT, resolve(cwd, p)));
  if (own || targets.some((p) => HARNESS.test(p) || OWN_DATA.test(p))) return { risk: 'critical', reason: 'modifies auto mode or the harness configuration' };
  return out ? { risk: 'high', reason: 'writes outside the project' } : { risk: 'medium', reason: 'writes inside the project' };
}

export function classify({ kind, command = '', paths = [], cwd = process.cwd() }) {
  if (kind === 'shell') return shellRisk(command, cwd);
  if (kind === 'read' || kind === 'write') return pathRisk(kind, paths, cwd);
  if (kind === 'network') return { risk: 'medium', reason: 'fetches from the network' };
  if (kind === 'none') return { risk: 'low', reason: 'has no effect outside the conversation' };
  return { risk: 'medium', reason: 'calls a tool that cannot be rated' };
}
