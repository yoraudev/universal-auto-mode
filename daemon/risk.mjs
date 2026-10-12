import { isAbsolute, relative, resolve } from 'node:path';

const CREDENTIALS = /(^|[\\/\s"'=])(\.ssh|\.aws|\.gnupg|\.kube|\.docker[\\/]config|id_(rsa|ed25519|ecdsa)|\.npmrc|\.pypirc|\.netrc|\.git-credentials|\.env(\.[\w.-]+)?|credentials(\.json)?|auth\.json|secrets?\.(json|ya?ml|toml)|[\w.-]+\.(pem|key|pfx|p12))(?=$|[\\/\s"';|&)])/i;

export const CRITICAL = [
  [CREDENTIALS, 'touches credential files'],
  [/\|\s*(sudo\s+)?((ba|z|da|k)?sh|python\d?|node|perl|ruby|pwsh|powershell)\b/i, 'pipes output into an interpreter'],
  [/\b(iex|invoke-expression)\b|\b(ba)?sh\s+<\(|\beval\s/i, 'evaluates dynamically built code'],
  [/\bgit\s+push\b.*(--force|\s-f\b|--force-with-lease|--mirror)|\bgit\s+reset\s+--hard|\bgit\s+clean\s+-\w*f/i, 'rewrites or discards git history'],
  [/\b(mkfs|fdisk|diskpart|shutdown|reboot)\b|\bdd\s+.*\bof=|\bformat\s+[a-z]:/i, 'modifies disks or system state'],
  [/\b(npm|pnpm|yarn|bun|cargo)\s+publish\b|\btwine\s+upload\b|\bgh\s+release\b|\bdocker\s+push\b/i, 'publishes to a registry'],
  [/\b(sudo|doas|runas)\b|\bchmod\s+\S*[+]s|\b(crontab|schtasks|launchctl|systemctl)\b|\breg(\.exe)?\s+add\b|\bsetx\b/i, 'changes privileges or persistence'],
  [/\bgit\s+config\s+.*(--global|--system)|core\.hookspath|[\\/]\.git[\\/]hooks|authorized_keys|\.(bash|zsh)rc\b|\.(bash_)?profile\b|\$profile\b/i, 'modifies git hooks, shell startup files or global config'],
  [/universal-auto-mode|\buam\b|:7717\b/i, 'targets the auto-mode daemon itself'],
];

export const HIGH = [
  [/\b(curl|wget|ssh|scp|sftp|rsync|nc|ncat|netcat|telnet|ftp|invoke-webrequest|iwr|invoke-restmethod|irm|start-bitstransfer|certutil|bitsadmin)\b/i, 'uses a network tool'],
  [/\bhttps?:\/\//i, 'references a URL'],
  [/\bgit\s+(push|clone|fetch|pull|remote|submodule)\b|\bgh\s/i, 'talks to a git remote'],
  [/\b(npm|pnpm|yarn|bun)\s+(i|install|add|create|dlx|x)\b|\b(npx|bunx|uvx|pipx)\b|\b(pip|pip3|uv)\s+(install|add)\b|\bcargo\s+(install|add)\b|\bgo\s+(get|install)\b|\b(brew|apt|apt-get|choco|winget|scoop)\s+install\b/i, 'installs packages'],
  [/\bdocker\s+(run|pull|build|exec)\b/i, 'runs containers'],
  [/\b(rm|rmdir|del|erase|rd|remove-item|unlink|shred|truncate)\b/i, 'deletes files'],
  [/\b(kill|pkill|taskkill|stop-process)\b/i, 'stops processes'],
];

export const READ_ONLY = new Set(['ls', 'dir', 'cat', 'type', 'head', 'tail', 'grep', 'rg', 'fd', 'wc', 'pwd', 'echo', 'which', 'where', 'tree', 'stat', 'file', 'du', 'df', 'date', 'sort', 'uniq', 'cut', 'jq', 'cd', 'true', 'test', 'get-childitem', 'get-content', 'select-string', 'get-location']);
export const READ_ONLY_GIT = new Set(['status', 'diff', 'log', 'show', 'branch', 'rev-parse', 'ls-files', 'blame', 'describe', 'shortlog']);

const outside = (cwd, target) => {
  const rel = relative(cwd, resolve(cwd, target));
  return rel.startsWith('..') || isAbsolute(rel);
};

function shellRisk(command, cwd) {
  for (const [pattern, reason] of CRITICAL) if (pattern.test(command)) return { risk: 'critical', reason };
  if (/\brm\b.*\s-\w*[rf]/i.test(command) && /(\s|^)(\/|~|\.\.|\*|\.)(\s|$|\/)/.test(command)) return { risk: 'critical', reason: 'recursively deletes a broad path' };
  for (const [pattern, reason] of HIGH) if (pattern.test(command)) return { risk: 'high', reason };
  const escapes = command.split(/[\s"'|;&<>()=]+/).some((token) => {
    if (/^~([\\/]|$)/.test(token) || /(^|[\\/])\.\.([\\/]|$)/.test(token)) return true;
    const absolute = /^[a-z]:[\\/]/i.test(token) || (token.startsWith('/') && !/^\/[a-z?]{1,2}$/i.test(token));
    const native = process.platform === 'win32' ? token.replace(/^\/([a-z])\//i, '$1:/') : token;
    return absolute && outside(cwd, native);
  });
  if (escapes) return { risk: 'high', reason: 'reaches outside the project' };

  const segments = command.split(/&&|\|\||[;|\n]/).map((s) => s.trim()).filter(Boolean);
  const readOnly = segments.every((segment) => {
    const [name, sub] = segment.replace(/^(\w+=\S+\s+)+/, '').split(/\s+/);
    if (/\bfind\b/.test(name)) return !/-(exec|delete|ok)\b/.test(segment);
    if (name === 'git') return READ_ONLY_GIT.has(sub);
    if (name === 'sed') return /\s-n\b/.test(segment) && !/\s-i/.test(segment);
    return READ_ONLY.has(name.toLowerCase()) || /^(--version|-v|-V|--help)$/.test(sub || '');
  });
  if (readOnly && !/>/.test(command)) return { risk: 'low', reason: 'read-only command' };
  return { risk: 'medium', reason: 'runs a command inside the project' };
}

function pathRisk(kind, paths, cwd) {
  if (paths.some((p) => CREDENTIALS.test(p))) return { risk: 'critical', reason: 'touches credential files' };
  const out = paths.some((p) => outside(cwd, p));
  if (kind === 'read') return out ? { risk: 'medium', reason: 'reads outside the project' } : { risk: 'low', reason: 'reads inside the project' };
  if (paths.some((p) => /(^|[\\/])\.git[\\/]|(^|[\\/])\.github[\\/]workflows[\\/]/i.test(p))) return { risk: 'critical', reason: 'modifies git internals or CI workflows' };
  return out ? { risk: 'high', reason: 'writes outside the project' } : { risk: 'medium', reason: 'writes inside the project' };
}

export function classify({ kind, command = '', paths = [], cwd = process.cwd() }) {
  if (kind === 'shell') return shellRisk(command, cwd);
  if (kind === 'read' || kind === 'write') return pathRisk(kind, paths, cwd);
  if (kind === 'network') return { risk: 'medium', reason: 'fetches from the network' };
  if (kind === 'none') return { risk: 'low', reason: 'has no effect outside the conversation' };
  return { risk: 'medium', reason: 'calls a tool that cannot be rated' };
}
