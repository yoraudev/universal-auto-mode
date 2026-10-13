import { warningAfter, withheldNote } from "../shared/notices.js"
import { MIN_SCAN_CHARS, quoted } from "../shared/scan.js"
import { CHOICES, NUMBERS, statusLine } from "../shared/settings.js"
import { SKIP_SCAN, describe, keyOf, textOf, toRequest } from "./request.js"

export const COMMAND = "auto-mode"

const USAGE = [
  `${COMMAND} status: show the settings and this session's flags`,
  `${COMMAND} allow: allow the calls auto mode is holding, and give a withheld output to the agent with a warning`,
  `${COMMAND} clear: clear this session's flags`,
  `${COMMAND} trust: clear the flags and never flag this exact content again`,
  `${COMMAND} forget: forget trusted content`,
  `${COMMAND} on | off: turn auto mode on or off`,
  `${COMMAND} set <setting> <value>: change a setting (${[...Object.keys(CHOICES), ...Object.keys(NUMBERS)].join(", ")})`,
].join("\n")

const block = (reason) => ({ decision: "block", reason })
const context = (event, text) => ({ hookSpecificOutput: { hookEventName: event, additionalContext: text } })
const deny = (reason, systemMessage) => ({ systemMessage, hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } })

const parseValue = (key, text) => (NUMBERS[key] ? Number(text) : text)

export function createHandlers({ client, store }) {
  const { call, callOrStart, scan: scanOutput, decide } = client

  async function status(session) {
    const config = await callOrStart("config")
    if (!config) return "Auto mode: the daemon is not running. It is being started; try again in a moment."
    const state = await call("session", { session }).catch(() => undefined)
    const lines = [`Auto mode: ${config.enabled ? "on" : "off"}. ${statusLine(config.status)}.`]
    for (const [key, item] of Object.entries({ ...CHOICES, ...NUMBERS })) lines.push(`${item.title} (${key}): ${config[key]}`)
    lines.push(`Trusted content: ${config.trusted}`)
    if (state) lines.push(`This session: score ${state.score.toFixed(2)}${state.unscanned ? ", has unscanned output" : ""}${state.flags.length ? `, flagged: ${state.flags.map((flag) => `${flag.source} ${flag.score.toFixed(2)}`).join(", ")}` : ""}`)
    const held = Object.values(store.read(session).pending)
    if (held.length) lines.push(`Held until you send "${COMMAND} allow": ${held.map((item) => item.what).join(" | ")}`)
    return lines.join("\n")
  }

  async function allow(session) {
    const state = store.read(session)
    const held = Object.entries(state.pending)
    if (!held.length && !state.reviews.length) return block("Auto mode: nothing is waiting for your answer.")
    for (const id of state.reviews) await call("review/answer", { id, decision: "continue" }).catch(() => undefined)
    store.update(session, (next) => Object.assign(next, { pending: {}, reviews: [], granted: held.map(([key]) => key) }))
    const parts = []
    if (held.length) parts.push(`The user allowed the ${held.length === 1 ? "call" : "calls"} auto mode was holding: ${held.map(([, item]) => item.what).join(" | ")}. Make exactly the same ${held.length === 1 ? "call" : "calls"} again.`)
    if (state.reviews.length) parts.push("The user chose to give you the output that auto mode withheld. Run the same tool call again to read it; it will carry a warning.")
    return { systemMessage: `Auto mode: allowed for this turn.${held.length ? ` ${held.map(([, item]) => item.what).join(" | ")}` : ""}`, ...context("UserPromptSubmit", `[auto mode] ${parts.join(" ")}`) }
  }

  async function command(session, words) {
    const [name, key, ...rest] = words
    if (name === "status") return block(await status(session))
    if (name === "clear") return block((await callOrStart("clear", { session })) ? "Auto mode: flags cleared for this session." : "Auto mode: the daemon did not answer.")
    if (name === "trust") {
      const result = await callOrStart("trust", { session })
      return block(result ? `Auto mode: flags cleared. ${result.added} flagged ${result.added === 1 ? "output is" : "outputs are"} trusted from now on.` : "Auto mode: the daemon did not answer.")
    }
    if (name === "forget") return block((await callOrStart("trust/reset", {})) ? "Auto mode: trusted content forgotten." : "Auto mode: the daemon did not answer.")
    if (name === "on" || name === "off" || (name === "set" && key && rest.length)) {
      const patch = name === "set" ? { [key]: parseValue(key, rest.join(" ")) } : { enabled: name === "on" }
      const result = await callOrStart("config", patch)
      if (!result) return block("Auto mode: the daemon did not answer.")
      if (result.error) return block(`Auto mode: ${result.error}`)
      return block(name === "set" ? `Auto mode: ${(CHOICES[key] ?? NUMBERS[key])?.title ?? key} set to ${result[key]}.` : `Auto mode is ${result.enabled ? "on" : "off"}.`)
    }
    return block(USAGE)
  }

  return {
    async SessionStart() {
      const config = await callOrStart("config")
      if (config?.status && config.status.state !== "ready" && config.status.state !== "idle") return { systemMessage: `Auto mode: ${statusLine(config.status)}` }
    },

    async UserPromptSubmit({ session_id: session, prompt = "" }) {
      const words = prompt.trim().split(/\s+/)
      const ours = words[0]?.toLowerCase() === COMMAND
      if (ours && words[1]?.toLowerCase() === "allow") {
        await callOrStart("turn", { session })
        return allow(session)
      }
      if (ours) return command(session, words.slice(1).map((word, index) => (index === 0 ? word.toLowerCase() : word)))
      const state = store.read(session)
      for (const id of state.reviews) await call("review/answer", { id, decision: "stop" }).catch(() => undefined)
      if (state.reviews.length || state.granted.length || Object.keys(state.pending).length) store.update(session, (next) => Object.assign(next, { pending: {}, reviews: [], granted: [] }))
      await callOrStart("turn", { session })
    },

    async PreToolUse(input) {
      const session = input.session_id
      const request = toRequest(input)
      const decision = await decide(session, request)
      if (!decision || decision.disabled || decision.effect !== "ask") return
      const key = keyOf(request)
      if (store.read(session).granted.includes(key)) return
      const what = describe(input)
      store.update(session, (state) => (state.pending[key] = { what, reason: decision.reason }))
      return deny(
        `Auto mode holds this ${input.tool_name} call until the user confirms it (universal-auto-mode: ${decision.reason}). Do not look for another way to do the same thing. Tell the user what you wanted to run and why, and that they can allow it by sending the message "${COMMAND} allow". If they do, make exactly the same call again.`,
        `Auto mode is holding a ${input.tool_name} call: ${decision.reason}. Send "${COMMAND} allow" to allow it: ${what}`,
      )
    },

    async PermissionRequest(input) {
      const session = input.session_id
      const request = toRequest(input)
      const decision = await decide(session, request)
      if (!decision || decision.disabled) return
      if (decision.effect !== "ask" || store.read(session).granted.includes(keyOf(request))) return { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } }
      return { systemMessage: `Auto mode leaves this ${input.tool_name} call to you: ${decision.reason}.` }
    },

    async PostToolUse(input) {
      const { session_id: session, tool_name: tool } = input
      if (SKIP_SCAN.has(tool)) return
      const text = textOf(input.tool_response)
      if (text.length < MIN_SCAN_CHARS) return
      const scan = await scanOutput({ session, source: tool, text, ui: true })
      const wasDown = store.read(session).down
      if (Boolean(scan) === wasDown) store.update(session, (state) => (state.down = !scan))
      if (!scan) return wasDown ? undefined : { systemMessage: "Auto mode: the daemon is not answering. Tool output is not scanned until it is back." }
      if (scan.disabled) return
      const notes = []
      if (wasDown) notes.push("Auto mode: the daemon is back. Earlier tool output in this session was not scanned.")
      if (scan.pending) notes.push(`Auto mode is still scanning the output of ${tool}. It reached the agent unscanned.`)
      if (scan.truncated) notes.push(`Auto mode: the output of ${tool} was too long to scan in full. Only its beginning and end were scanned.`)
      if (scan.pending || scan.level === "none") return notes.length ? { systemMessage: notes.join(" ") } : undefined
      const flagged = `Auto mode flagged the output of ${tool} as a possible prompt injection (score ${scan.score.toFixed(2)}).`
      const asked = scan.decision === undefined && scan.review !== undefined
      if (asked || scan.decision === "stop") {
        if (asked) store.update(session, (state) => state.reviews.push(scan.review))
        const how = asked ? ` Send "${COMMAND} allow" to give it to the agent with a warning, or any other message to keep it withheld.` : ""
        return { ...block(withheldNote(scan.score)), continue: false, stopReason: `${flagged} It was withheld and the agent was stopped.${quoted(scan.excerpt)}${how}` }
      }
      if (!scan.quiet && scan.decision === undefined) notes.push(`${flagged} The agent was warned and keeps working.${quoted(scan.excerpt)}`)
      return { ...(notes.length ? { systemMessage: notes.join(" ") } : {}), ...context("PostToolUse", warningAfter(scan.score, tool)) }
    },
  }
}
