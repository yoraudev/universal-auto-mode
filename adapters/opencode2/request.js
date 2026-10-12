const READ = new Set(["read", "grep", "glob"])
const WRITE = new Set(["edit"])
const NETWORK = new Set(["webfetch", "websearch"])
const HARMLESS = new Set(["question"])

export const REASON_PREFIX = "universal-auto-mode: "

export function toRequest(evaluation, cwd) {
  const { action, resources, metadata = {} } = evaluation
  if (action === "shell") return { kind: "shell", command: typeof metadata.command === "string" ? metadata.command : resources.join(" "), cwd }
  if (READ.has(action)) return { kind: "read", paths: [...resources], cwd }
  if (WRITE.has(action)) return { kind: "write", paths: [...resources], cwd }
  if (NETWORK.has(action)) return { kind: "network", cwd }
  if (HARMLESS.has(action)) return { kind: "none", cwd }
  return { kind: "other", cwd }
}
