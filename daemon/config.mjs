import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const configPath = (env = process.env) => env.UAM_CONFIG || join(homedir(), '.config', 'universal-auto-mode', 'config.json');
export const trustPath = (env = process.env) => join(dirname(configPath(env)), 'trusted.json');

export const DEFAULTS = {
  port: 7717,
  enabled: true,
  detection: 'warn',
  notifications: 'on',
  unscanned: 'allow',
  model: 'base',
  device: 'cpu',
  modelsDir: join(homedir(), '.cache', 'universal-auto-mode', 'models'),
  window: 512,
  overlap: 64,
  strong: 0.9,
  weak: 0.3,
  scanBudgetMs: 60000,
  decideWaitMs: 30000,
  maxChars: 200000,
  unloadMinutes: 30,
};

export const SETTINGS = {
  enabled: { boolean: true },
  detection: { values: ['warn', 'ask'] },
  notifications: { values: ['on', 'off'] },
  unscanned: { values: ['allow', 'ask'] },
  model: { values: ['base', 'small'] },
  device: { values: ['cpu', 'gpu', 'dml', 'webgpu', 'cuda', 'coreml'] },
  weak: { min: 0, max: 1 },
  strong: { min: 0, max: 1 },
  window: { min: 64, max: 8192, integer: true },
  overlap: { min: 0, max: 4096, integer: true },
  scanBudgetMs: { min: 0, max: 600000, integer: true },
  decideWaitMs: { min: 0, max: 600000, integer: true },
  maxChars: { min: 1000, max: 100000000, integer: true },
  unloadMinutes: { min: 0, max: 10080 },
};

const FILE_ONLY = {
  port: { min: 1, max: 65535, integer: true },
  modelsDir: { text: true },
};

export const RELOAD_KEYS = ['model', 'device', 'window', 'overlap', 'maxChars'];
export const TRUSTED_KEPT = 1000;

const PAIRS = [['weak', 'strong'], ['overlap', 'window']];

function readJson(path, warn) {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    warn(`${path} is not valid JSON and was ignored: ${error.message}`);
    return undefined;
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(`${path}.tmp`, path);
}

const readFile = (env, warn = () => {}) => {
  const stored = readJson(configPath(env), warn);
  return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
};

function problemWith(key, value, rule) {
  if (!rule) return `"${key}" cannot be changed here`;
  if (rule.boolean) return typeof value === 'boolean' ? undefined : `"${key}" must be true or false`;
  if (rule.text) return typeof value === 'string' && value ? undefined : `"${key}" must be a path`;
  if (rule.values) return rule.values.includes(value) ? undefined : `"${key}" must be one of ${rule.values.join(', ')}`;
  if (typeof value !== 'number' || !Number.isFinite(value)) return `"${key}" must be a number`;
  if (rule.integer && !Number.isInteger(value)) return `"${key}" must be a whole number`;
  if (value < rule.min || value > rule.max) return `"${key}" must be between ${rule.min} and ${rule.max}`;
  return undefined;
}

const inconsistent = (config) => {
  if (config.weak > config.strong) return '"weak" cannot be higher than "strong"';
  if (config.overlap >= config.window) return '"overlap" must be smaller than "window"';
  return undefined;
};

export function loadConfig(env = process.env, warn = () => {}) {
  const config = { ...DEFAULTS };
  for (const [key, value] of Object.entries(readFile(env, warn))) {
    const rule = SETTINGS[key] ?? FILE_ONLY[key];
    if (!rule) continue;
    const problem = problemWith(key, value, rule);
    if (problem) warn(`${configPath(env)}: ${problem}; using ${JSON.stringify(DEFAULTS[key])}`);
    else config[key] = value;
  }
  const problem = inconsistent(config);
  if (problem) {
    warn(`${configPath(env)}: ${problem}; using the defaults for both`);
    for (const pair of PAIRS) if (problem.includes(`"${pair[0]}"`)) for (const key of pair) config[key] = DEFAULTS[key];
  }
  if (env.UAM_MODEL) config.model = env.UAM_MODEL;
  if (env.UAM_DEVICE) config.device = env.UAM_DEVICE;
  if (env.UAM_PORT && problemWith('port', Number(env.UAM_PORT), FILE_ONLY.port)) warn(`UAM_PORT is not a port number; using ${config.port}`);
  else if (env.UAM_PORT) config.port = Number(env.UAM_PORT);
  if (env.UAM_MODELS_DIR) config.modelsDir = env.UAM_MODELS_DIR;
  return config;
}

export function validate(patch, current) {
  for (const [key, value] of Object.entries(patch)) {
    const problem = problemWith(key, value, SETTINGS[key]);
    if (problem) return problem;
  }
  return inconsistent({ ...current, ...patch });
}

export function saveConfig(patch, env = process.env) {
  writeJson(configPath(env), { ...readFile(env), ...patch });
}

export function loadTrusted(env = process.env, warn = () => {}) {
  const stored = readJson(trustPath(env), warn);
  const entries = Array.isArray(stored) ? stored.filter((entry) => entry && typeof entry.digest === 'string') : [];
  return new Map(entries.map((entry) => [entry.digest, { source: String(entry.source ?? ''), at: Number(entry.at) || 0 }]));
}

export function saveTrusted(trusted, env = process.env) {
  writeJson(trustPath(env), [...trusted].map(([digest, entry]) => ({ digest, ...entry })));
}
