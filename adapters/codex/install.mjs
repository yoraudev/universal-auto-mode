import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

export const EVENTS = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PermissionRequest", "PostToolUse"]
const MARKER = "adapters/codex/hook.mjs"
const TIMEOUT_SECONDS = 180

const hookPath = fileURLToPath(new URL("./hook.mjs", import.meta.url)).replace(/\\/g, "/")
const ours = (group) => (group.hooks ?? []).some((hook) => String(hook.command ?? "").replace(/\\/g, "/").includes(MARKER))

export function merge(existing, { remove = false, node = "node", path = hookPath } = {}) {
  const hooks = { ...(existing?.hooks ?? {}) }
  for (const event of Object.keys(hooks)) {
    hooks[event] = hooks[event].filter((group) => !ours(group))
    if (!hooks[event].length) delete hooks[event]
  }
  if (!remove) for (const event of EVENTS) hooks[event] = [...(hooks[event] ?? []), { hooks: [{ type: "command", command: `${node} "${path}"`, timeout: TIMEOUT_SECONDS, statusMessage: "Auto mode" }] }]
  return { ...existing, hooks }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const remove = process.argv.includes("--remove")
  const home = process.env.CODEX_HOME || join(homedir(), ".codex")
  const file = join(home, "hooks.json")
  const existing = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {}
  mkdirSync(home, { recursive: true })
  writeFileSync(file, `${JSON.stringify(merge(existing, { remove }), null, 2)}\n`)
  console.log(remove ? `Removed the auto mode hooks from ${file}.` : `Added the auto mode hooks to ${file}.\nOpen Codex, run /hooks and trust them. Codex does not run a hook you have not reviewed.`)
}
