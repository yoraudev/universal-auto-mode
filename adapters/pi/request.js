const SHELL = new Set(["bash", "powershell"])
const READ = new Set(["read", "grep", "find", "ls"])
const WRITE = new Set(["edit", "write"])

const pathsOf = (input) => [typeof input.path === "string" && input.path ? input.path : "."]

export function toRequest({ toolName, input = {} }, cwd) {
  if (SHELL.has(toolName)) return { kind: "shell", command: typeof input.command === "string" ? input.command : "", cwd }
  if (READ.has(toolName)) return { kind: "read", paths: pathsOf(input), cwd }
  if (WRITE.has(toolName)) return { kind: "write", paths: pathsOf(input), cwd }
  return { kind: "other", cwd }
}

export function describe({ toolName, input = {} }, limit = 400) {
  const text = SHELL.has(toolName) ? String(input.command ?? "") : READ.has(toolName) || WRITE.has(toolName) ? pathsOf(input)[0] : JSON.stringify(input)
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}
