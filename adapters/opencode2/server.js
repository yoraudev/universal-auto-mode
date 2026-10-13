import { Plugin } from "@opencode/plugin"
import { createClient } from "../shared/client.js"
import { reminder, warning, withheldNote } from "../shared/notices.js"
import { MIN_SCAN_CHARS } from "../shared/scan.js"
import { REASON_PREFIX, toRequest } from "./request.js"

const SKIP_SCAN = new Set(["write", "edit", "patch", "todowrite", "todoread"])

function withheld(result, score) {
  return { ...result, output: typeof result.output === "string" ? withheldNote(score) : undefined, content: withheldNote(score) }
}

function textOf(result) {
  if (typeof result.content === "string") return result.content
  if (Array.isArray(result.content)) return result.content.map((part) => (part.type === "text" ? part.text : "")).join("\n")
  if (result.output === undefined) return ""
  return typeof result.output === "string" ? result.output : JSON.stringify(result.output)
}

function withWarning(result, score) {
  if (typeof result.content === "string") return { ...result, content: warning(score) + result.content + reminder }
  if (Array.isArray(result.content)) return { ...result, content: [{ type: "text", text: warning(score) }, ...result.content, { type: "text", text: reminder }] }
  if (typeof result.output === "string") return { ...result, output: warning(score) + result.output + reminder }
  return result
}

export default Plugin.define({
  id: "universal-auto-mode",
  async setup(ctx) {
    const cwd = ctx.location.directory
    const debug = Boolean(ctx.options.debug)
    const { callOrStart, scan: scanOutput, decide } = createClient(ctx.options)

    await callOrStart("health", undefined, { wait: false })

    const trustKey = `trusted:${cwd}`
    const trusted = new Set((await ctx.storage.get(trustKey)) ?? [])
    const asked = new Map()
    const events = ctx.event.subscribe()[Symbol.asyncIterator]()
    const follow = async () => {
      for (;;) {
        const { value: event, done } = await events.next()
        if (done) return
        if (event.type === "permission.asked" && event.data.message?.startsWith(REASON_PREFIX)) asked.set(event.data.id, event.data.action)
        if (event.type !== "permission.replied") continue
        const action = asked.get(event.data.requestID)
        asked.delete(event.data.requestID)
        if (!action || event.data.reply !== "always" || toRequest({ action, resources: [] }, cwd).kind !== "other") continue
        trusted.add(action)
        await ctx.storage.set(trustKey, [...trusted])
      }
    }
    follow().catch((error) => console.error("[universal-auto-mode] event stream ended:", error.message))

    await ctx.session.hook("prompt", (prompt) => callOrStart("turn", { session: prompt.sessionID }).then(() => undefined))

    await ctx.tool.hook("execute.after", async (event) => {
      if (event.status !== "completed" || SKIP_SCAN.has(event.tool)) return
      const text = textOf(event.result)
      if (text.length < MIN_SCAN_CHARS) return
      const scan = await scanOutput({ session: event.sessionID, source: event.tool, text })
      if (!scan || scan.disabled || scan.pending || scan.level === "none") return
      let decision = scan.decision
      while (scan.review !== undefined && decision === undefined) {
        const review = await callOrStart("review", { id: scan.review })
        decision = review ? review.decision : "unanswered"
      }
      if (decision !== "stop") {
        event.result = withWarning(event.result, scan.score)
        return
      }
      event.result = withheld(event.result, scan.score)
      await ctx.session.interrupt({ sessionID: event.sessionID }).catch((error) => console.error("[universal-auto-mode] could not interrupt the session:", error.message))
    })

    await ctx.permission.hook("evaluate", async (evaluation) => {
      if (debug) console.error("[universal-auto-mode] evaluate", JSON.stringify(evaluation))
      if (evaluation.effect === "deny") return
      const request = toRequest(evaluation, cwd)
      if (request.kind === "other" && trusted.has(evaluation.action)) return
      const decision = await decide(evaluation.sessionID, request)
      if (!decision || decision.disabled) return
      evaluation.effect = decision.effect
      if (decision.effect === "ask") evaluation.message = REASON_PREFIX + decision.reason
    })

    return () => events.return?.()
  },
})
