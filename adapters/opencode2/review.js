import { quoted } from "../shared/scan.js"

const TITLE = "Auto mode"
const NOTICE_MS = 12000

const describe = (item) => `${item.source} (score ${item.score.toFixed(2)})`
const ASK_SIZE = { size: "xlarge" }

function question(reviews) {
  const late = reviews.some((review) => review.late) ? " The agent already has it." : ""
  const highest = reviews.reduce((top, review) => (review.score > top.score ? review : top))
  if (reviews.length === 1) return `Possible prompt injection: ${describe(reviews[0])}.${late}${quoted(highest.excerpt)}`
  return `Possible prompt injection in ${reviews.length} outputs (score ${highest.score.toFixed(2)}): ${reviews.map((review) => review.source).join(", ")}.${late}${quoted(highest.excerpt)}`
}

export function createReviewer({ dialog, toast, call, sessions, interrupt }) {
  const handled = new Set()
  let after
  let asking = false

  const ask = async (reviews) => {
    asking = true
    for (const review of reviews) handled.add(review.id)
    try {
      const selection = dialog.select({
        title: question(reviews),
        placeholder: "Your answer covers the rest of this turn",
        options: [
          { value: "continue", title: "Continue and warn the agent", description: "The agent gets the output with a warning to treat it as data" },
          { value: "stop", title: "Stop the agent", description: "The output is withheld from the agent and the session is interrupted" },
        ],
      })
      dialog.set?.(ASK_SIZE)
      const choice = await selection
      const result = await call("review/answer", { id: reviews[0].id, decision: choice ?? "stop" }).catch(() => undefined)
      if (result?.ok && choice !== "continue") await interrupt?.(reviews[0].session)
      if (result?.ok) toast.show({ variant: choice === "continue" ? "info" : "warning", title: TITLE, message: choice === "continue" ? "Continuing. The agent was warned." : "Stopped. The flagged output was withheld." })
    } finally {
      asking = false
    }
  }

  return async function poll() {
    const state = await call("ui", { after, sessions: sessions() }).catch(() => undefined)
    if (!state) return
    after = state.seq
    for (const notice of state.notices) {
      if (notice.review || notice.covered) continue
      if (notice.unscanned) {
        toast.show({ variant: "warning", title: TITLE, message: notice.unscanned === "truncated" ? `The output of ${notice.source} was too long to scan in full. Only its beginning and end were scanned.` : `The output of ${notice.source} could not be scanned.`, duration: NOTICE_MS, sessionID: notice.session })
        continue
      }
      toast.show({
        variant: "warning",
        title: TITLE,
        message: `Flagged the output of ${describe(notice)} as a ${notice.level === "strong" ? "likely" : "possible"} prompt injection. The agent was warned.${quoted(notice.excerpt)}`,
        duration: NOTICE_MS,
        sessionID: notice.session,
      })
    }
    const open = state.reviews.filter((review) => !handled.has(review.id))
    const session = open[0]?.session
    if (!asking && open.length) void ask(open.filter((review) => review.session === session))
  }
}
