import { CHOICES, NUMBERS, RELOADS, isBusy, statusLine } from "../shared/settings.js"

const POLL_MS = 500

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export const statusText = (config) => (config.enabled ? `auto mode: ${config.detection}` : "auto mode: off")

async function pick(key, config, ui) {
  if (CHOICES[key]) {
    const labels = CHOICES[key].options.map((option) => `${option.value}: ${option.description}`)
    const label = await ui.select(`${CHOICES[key].title}. ${CHOICES[key].description}. Now: ${config[key]}`, labels)
    return label === undefined ? undefined : CHOICES[key].options[labels.indexOf(label)].value
  }
  const text = await ui.input(`${NUMBERS[key].title}. ${NUMBERS[key].help} Now: ${config[key]}`, String(config[key]))
  if (text === undefined || text.trim() === "") return undefined
  return Number(text)
}

export async function watchLoading({ ui, call, onChange, pollMs = POLL_MS }) {
  for (;;) {
    const config = await call("config").catch(() => undefined)
    if (!config) return
    if (!isBusy(config.status)) {
      onChange(config)
      if (config.status?.state === "error") ui.notify(`Auto mode: the classifier could not be loaded. ${config.status.message}`, "error")
      else ui.notify(`Auto mode: the classifier is ready (${config.model} on ${config.provider}).`, "info")
      return
    }
    onChange(config, statusLine(config.status))
    await sleep(pollMs)
  }
}

export async function openSettings({ ui, call, start, session, onChange = () => {}, pollMs }) {
  for (;;) {
    const config = await call("config").catch(() => undefined)
    if (!config) {
      start?.()
      return ui.notify("Auto mode: the daemon is not running. It is being started; run /auto-mode again in a moment.", "warning")
    }
    onChange(config, isBusy(config.status) ? statusLine(config.status) : undefined)

    const state = session ? await call("session", { session }).catch(() => undefined) : undefined
    const entries = [["enabled", config.enabled ? "Auto mode: on (select to turn off)" : "Auto mode: off (select to turn on)"]]
    if (config.status && config.status.state !== "ready") entries.push(["status", `${statusLine(config.status)} (select to refresh)`])
    if (state?.flags.length) entries.push(["clear", `Clear flags of this session (score ${state.score.toFixed(2)})`])
    for (const [key, item] of Object.entries(CHOICES)) {
      const running = key === "device" && config.provider && config.provider !== config.device ? ` (running on ${config.provider})` : ""
      entries.push([key, `${item.title}: ${config[key]}${running}`])
    }
    for (const [key, item] of Object.entries(NUMBERS)) entries.push([key, `${item.title}: ${config[key]}`])

    const label = await ui.select("Auto mode", entries.map(([, text]) => text))
    const key = entries.find(([, text]) => text === label)?.[0]
    if (key === undefined) return
    if (key === "status") continue

    if (key === "clear") {
      await call("clear", { session }).catch(() => undefined)
      ui.notify("Auto mode: flags cleared for this session.", "info")
      continue
    }

    const value = key === "enabled" ? !config.enabled : await pick(key, config, ui)
    if (value === undefined || value === config[key]) continue
    const result = await call("config", { [key]: value }).catch((error) => ({ error: error.message }))
    if (result.error) {
      ui.notify(`Auto mode: ${result.error}`, "error")
      continue
    }
    if (RELOADS.has(key)) {
      watchLoading({ ui, call, onChange, pollMs })
      continue
    }
    onChange(result)
    if (key === "enabled") ui.notify(result.enabled ? "Auto mode is on." : "Auto mode is off. Nothing is scanned and no tool call is held back.", result.enabled ? "info" : "warning")
    else ui.notify(`Auto mode: ${(CHOICES[key] ?? NUMBERS[key]).title} set to ${result[key]}.`, "info")
  }
}
