import { CHOICES, NUMBERS, RELOADS, isBusy, statusLine } from "../shared/settings.js"

export { isBusy, statusLine }

const START_ATTEMPTS = 20

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function switchOptions(config) {
  return [
    {
      value: "enabled",
      title: config.enabled ? "Auto mode: on" : "Auto mode: off",
      category: "Auto mode",
      description: config.enabled
        ? "Select to turn off. The classifier stays loaded."
        : "Select to turn on. The classifier is already loaded.",
    },
  ]
}

function statusOptions(status, canWatch) {
  if (!status || status.state === "ready") return []
  const description = status.state === "error" ? status.message : canWatch ? "Select to watch the progress" : "Select to refresh"
  return [{ value: "status", title: statusLine(status), category: "Status", description }]
}

function sessionOptions(session) {
  if (!session) return []
  const flagged = session.flags.map((flag) => `${flag.source} ${flag.score.toFixed(2)}`).join(", ")
  return [
    {
      value: "clear",
      title: `Clear flags (score ${session.score.toFixed(2)})`,
      category: "This session",
      description: session.flags.length ? `Marks as false alarms: ${flagged}` : "Nothing has been flagged in this session",
      disabled: session.score === 0 && !session.unscanned,
    },
    {
      value: "trust",
      title: "Trust flagged content",
      category: "This session",
      description: session.flags.length ? `Clears the flags and never flags this exact content again: ${flagged}` : "Nothing has been flagged in this session",
      disabled: session.flags.length === 0,
    },
  ]
}

function trustOptions(config) {
  if (!config.trusted) return []
  return [{ value: "forget", title: `Forget trusted content (${config.trusted})`, category: "Detection", description: "Content you marked as trusted is scanned and flagged again" }]
}

async function pick(key, config, dialog) {
  if (CHOICES[key]) {
    const selection = dialog.select({ title: CHOICES[key].title, options: CHOICES[key].options, current: config[key] })
    dialog.set?.({ size: "large" })
    return selection
  }
  const text = await dialog.prompt({ title: NUMBERS[key].title, description: NUMBERS[key].help, value: String(config[key]) })
  if (text === undefined || text.trim() === "") return undefined
  return Number(text)
}

export async function openSettings({ dialog, toast, call, start, watch, sessionID, retryMs = 1000 }) {
  const say = (variant, message) => toast.show({ variant, title: "Auto mode", message })
  let attempts = 0
  let wasBusy = false
  let showProgress = true

  for (;;) {
    const config = await call("config").catch(() => undefined)
    if (!config) {
      if (!start || attempts >= START_ATTEMPTS) return say("error", "The daemon is not running.")
      if (attempts === 0) say("info", "Starting the daemon…")
      attempts++
      start()
      await sleep(retryMs)
      continue
    }

    const busy = isBusy(config.status)
    if (wasBusy && config.status?.state === "ready") say("success", `The classifier is ready: ${config.model} on ${config.provider}.`)
    wasBusy = busy

    if (busy && watch && showProgress) {
      showProgress = false
      await watch(config.status)
      continue
    }
    showProgress = false

    const session = sessionID ? await call("session", { session: sessionID }).catch(() => undefined) : undefined
    const options = [
      ...switchOptions(config),
      ...statusOptions(config.status, Boolean(watch)),
      ...sessionOptions(session),
      ...Object.entries(CHOICES).map(([key, item]) => ({
        value: key,
        title: `${item.title}: ${config[key]}${key === "device" && config.provider && config.provider !== config.device ? ` (running on ${config.provider})` : ""}`,
        category: item.category,
        description: item.description,
      })),
      ...Object.entries(NUMBERS).map(([key, item]) => ({ value: key, title: `${item.title}: ${config[key]}`, category: item.category, description: item.description })),
      ...trustOptions(config),
    ]

    const selection = dialog.select({ title: "Auto mode", placeholder: "Search settings", options })
    dialog.set?.({ size: "large" })
    const key = await selection
    if (key === undefined) return
    if (key === "status") {
      showProgress = true
      continue
    }

    if (key === "enabled") {
      const result = await call("config", { enabled: !config.enabled }).catch((error) => ({ error: error.message }))
      if (result.error) say("error", result.error)
      else say(result.enabled ? "success" : "warning", result.enabled ? "Auto mode is on." : "Auto mode is off. OpenCode's own permission rules apply.")
      continue
    }

    if (key === "clear") {
      await call("clear", { session: sessionID })
      say("success", "Flags cleared for this session.")
      continue
    }

    if (key === "trust") {
      const result = await call("trust", { session: sessionID }).catch(() => undefined)
      if (result) say("success", `Flags cleared. ${result.added} flagged ${result.added === 1 ? "output is" : "outputs are"} trusted from now on.`)
      else say("error", "The daemon did not answer.")
      continue
    }

    if (key === "forget") {
      await call("trust/reset", {}).catch(() => undefined)
      say("success", "Trusted content forgotten.")
      continue
    }

    const value = await pick(key, config, dialog)
    if (value === undefined || value === config[key]) continue
    const result = await call("config", { [key]: value }).catch((error) => ({ error: error.message }))
    if (result.error) say("error", result.error)
    else if (RELOADS.has(key)) {
      wasBusy = true
      showProgress = true
    } else say("success", `${(CHOICES[key] ?? NUMBERS[key]).title} set to ${result[key]}.`)
  }
}
