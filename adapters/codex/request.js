import { createHash } from "node:crypto"

const HARMLESS = new Set(["update_plan", "request_user_input"])
const PATCH_PATH = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm

export const SKIP_SCAN = new Set(["apply_patch", "update_plan", "request_user_input"])

const patchPaths = (patch) => [...patch.matchAll(PATCH_PATH)].map((match) => match[1].trim())

export function toRequest({ tool_name: tool, tool_input: input, cwd }) {
  const command = typeof input?.command === "string" ? input.command : ""
  if (tool === "Bash") return { kind: "shell", command, cwd }
  if (tool === "apply_patch") {
    const paths = patchPaths(command)
    return paths.length ? { kind: "write", paths, cwd } : { kind: "other", cwd }
  }
  if (HARMLESS.has(tool)) return { kind: "none", cwd }
  return { kind: "other", cwd }
}

export const keyOf = (request) => createHash("sha256").update(JSON.stringify([request.kind, request.command ?? "", request.paths ?? []])).digest("hex")

export function describe({ tool_name: tool, tool_input: input }, limit = 400) {
  const request = toRequest({ tool_name: tool, tool_input: input })
  const text = request.kind === "shell" ? request.command : request.kind === "write" ? request.paths.join(", ") : JSON.stringify(input ?? {})
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

export function textOf(response) {
  if (typeof response === "string") return response
  if (response === null || response === undefined) return ""
  if (Array.isArray(response.content)) return response.content.map((part) => (typeof part?.text === "string" ? part.text : "")).join("\n")
  return JSON.stringify(response)
}
