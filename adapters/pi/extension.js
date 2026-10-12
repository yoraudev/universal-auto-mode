import { reminder, warning, withheldNote } from "../shared/notices.js"
import { describe, toRequest } from "./request.js"
import { openSettings, statusText } from "./settings.js"

const SKIP_SCAN = new Set(["edit", "write"])
const MIN_SCAN_CHARS = 80
const STATUS_KEY = "universal-auto-mode"
const CONTINUE = "Continue and warn the agent"
const STOP = "Stop the agent"
const ALLOW = "Allow"
const BLOCK = "Block"

const textOf = (content) => content.map((part) => (part.type === "text" ? part.text : "")).join("\n")
const note = (text) => ({ type: "text", text })

function styled(theme, config, progress) {
  if (!theme) return progress ?? statusText(config)
  if (progress) return theme.fg("accent", "● ") + theme.fg("dim", progress)
  if (!config.enabled) return theme.fg("warning", "○ ") + theme.fg("dim", "auto mode: ") + theme.fg("warning", "off")
  return theme.fg("success", "● ") + theme.fg("dim", "auto mode: ") + theme.fg("muted", config.detection)
}

export function createExtension({ call, callOrStart, start }) {
  return function universalAutoMode(pi) {
    const answers = new Map()
    let asking = Promise.resolve()

    const sessionOf = (ctx) => ctx.sessionManager.getSessionId()
    const notify = (ctx, message, type) => {
      if (ctx.hasUI) ctx.ui.notify(message, type)
    }
    const showStatus = (ctx, config, progress) => {
      if (ctx.hasUI && config) ctx.ui.setStatus(STATUS_KEY, styled(ctx.ui.theme, config, progress))
    }

    const review = (ctx, session, tool, scan) => {
      const run = asking.then(async () => {
        if (!answers.has(session)) {
          const choice = await ctx.ui.select(`Auto mode flagged the output of ${tool} as a prompt injection (score ${scan.score.toFixed(2)}).`, [CONTINUE, STOP])
          answers.set(session, choice === CONTINUE ? "continue" : "stop")
        }
        const decision = answers.get(session)
        await call("review/answer", { id: scan.review, decision }).catch(() => undefined)
        return decision
      })
      asking = run.catch(() => undefined)
      return asking
    }

    pi.on("session_start", async (_event, ctx) => {
      showStatus(ctx, await callOrStart("config"))
    })

    pi.on("input", async (_event, ctx) => {
      answers.delete(sessionOf(ctx))
      await callOrStart("turn", { session: sessionOf(ctx) })
    })

    pi.on("tool_call", async (event, ctx) => {
      const decision = await callOrStart("decide", { session: sessionOf(ctx), request: toRequest(event, ctx.cwd) })
      if (!decision || decision.disabled || decision.effect !== "ask") return
      const why = `universal-auto-mode: ${decision.reason}`
      if (!ctx.hasUI) return { block: true, reason: `This call needs confirmation and nobody is present to give it (${why}).` }
      const choice = await ctx.ui.select(`Auto mode asks before this ${event.toolName} call: ${decision.reason}.\n\n${describe(event)}`, [ALLOW, BLOCK])
      if (choice !== ALLOW) return { block: true, reason: `The user did not allow this call (${why}).` }
    })

    pi.on("tool_result", async (event, ctx) => {
      if (event.parentToolCallId || SKIP_SCAN.has(event.toolName)) return
      const text = textOf(event.content)
      if (text.length < MIN_SCAN_CHARS) return
      const session = sessionOf(ctx)
      const scan = await callOrStart("scan", { session, source: event.toolName, text, ui: ctx.hasUI })
      if (!scan || scan.disabled) return
      if (scan.pending) return notify(ctx, `Auto mode is still scanning the output of ${event.toolName}. It reached the agent unscanned.`, "warning")
      if (scan.level === "none") return
      const asked = scan.decision === undefined && scan.review !== undefined
      const decision = asked ? await review(ctx, session, event.toolName, scan) : scan.decision
      const flagged = `Auto mode flagged the output of ${event.toolName} as a possible prompt injection (score ${scan.score.toFixed(2)}).`
      if (decision === "stop") {
        notify(ctx, `${flagged} It was withheld and the agent was stopped.`, "warning")
        ctx.abort()
        return { content: [note(withheldNote(scan.score))], isError: true }
      }
      if (!scan.quiet && (asked || scan.decision === undefined)) notify(ctx, `${flagged} The agent was warned and keeps working.`, "warning")
      return { content: [note(warning(scan.score)), ...event.content, note(reminder)], structuredContent: event.structuredContent }
    })

    pi.registerCommand("auto-mode", {
      description: "Universal auto mode settings",
      handler: async (_args, ctx) => {
        await openSettings({ ui: ctx.ui, call, start, session: sessionOf(ctx), onChange: (config, progress) => showStatus(ctx, config, progress) })
      },
    })
  }
}
