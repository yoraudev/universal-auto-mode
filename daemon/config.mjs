import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const configPath = (env = process.env) => env.UAM_CONFIG || join(homedir(), '.config', 'universal-auto-mode', 'config.json');

export const DEFAULTS = {
  port: 7717,
  enabled: true,
  detection: 'warn',
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
};

export const SETTINGS = {
  enabled: { boolean: true },
  detection: { values: ['warn', 'ask'] },
  model: { values: ['base', 'small'] },
  device: { values: ['cpu', 'gpu', 'dml', 'webgpu', 'cuda', 'coreml'] },
  weak: { min: 0, max: 1 },
  strong: { min: 0, max: 1 },
  window: { min: 64, max: 8192, integer: true },
  overlap: { min: 0, max: 4096, integer: true },
  scanBudgetMs: { min: 0, max: 600000, integer: true },
  decideWaitMs: { min: 0, max: 600000, integer: true },
  maxChars: { min: 1000, max: 100000000, integer: true },
};

export const RELOAD_KEYS = ['model', 'device', 'window', 'overlap', 'maxChars'];

const readFile = (env) => (existsSync(configPath(env)) ? JSON.parse(readFileSync(configPath(env), 'utf8')) : {});

export function loadConfig(env = process.env) {
  const config = { ...DEFAULTS, ...readFile(env) };
  if (env.UAM_MODEL) config.model = env.UAM_MODEL;
  if (env.UAM_DEVICE) config.device = env.UAM_DEVICE;
  if (env.UAM_PORT) config.port = Number(env.UAM_PORT);
  if (env.UAM_MODELS_DIR) config.modelsDir = env.UAM_MODELS_DIR;
  return config;
}

export function validate(patch, current) {
  for (const [key, value] of Object.entries(patch)) {
    const rule = SETTINGS[key];
    if (!rule) return `"${key}" cannot be changed here`;
    if (rule.boolean) {
      if (typeof value !== 'boolean') return `"${key}" must be true or false`;
      continue;
    }
    if (rule.values) {
      if (!rule.values.includes(value)) return `"${key}" must be one of ${rule.values.join(', ')}`;
      continue;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) return `"${key}" must be a number`;
    if (rule.integer && !Number.isInteger(value)) return `"${key}" must be a whole number`;
    if (value < rule.min || value > rule.max) return `"${key}" must be between ${rule.min} and ${rule.max}`;
  }
  const next = { ...current, ...patch };
  if (next.weak > next.strong) return '"weak" cannot be higher than "strong"';
  if (next.overlap >= next.window) return '"overlap" must be smaller than "window"';
  return undefined;
}

export function saveConfig(patch, env = process.env) {
  const path = configPath(env);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ ...readFile(env), ...patch }, null, 2)}\n`);
}
