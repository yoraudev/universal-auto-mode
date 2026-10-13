import { spawn } from "node:child_process"
import { mkdirSync, openSync, renameSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { loadConfig } from "../../daemon/config.mjs"
import { classify } from "../../daemon/risk.mjs"

const DAEMON = fileURLToPath(new URL("../../daemon/server.mjs", import.meta.url))
const LOG_DIR = join(homedir(), ".cache", "universal-auto-mode")
const LOG_FILE = join(LOG_DIR, "daemon.log")
const LOG_MAX_BYTES = 5 * 1024 * 1024
const START_INTERVAL_MS = 15000
const START_WAIT_MS = 20000
const START_POLL_MS = 250
const GIVE_UP_MS = 60000

export const OFFLINE_REASON = "the auto mode daemon is not running"

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function rotate(file, maxBytes = LOG_MAX_BYTES) {
  try {
    if (statSync(file).size > maxBytes) renameSync(file, `${file}.1`)
  } catch {}
}

function launchDaemon(options, port) {
  const env = { ...process.env, UAM_PORT: String(port) }
  if (options.modelsDir) env.UAM_MODELS_DIR = options.modelsDir
  mkdirSync(LOG_DIR, { recursive: true })
  rotate(LOG_FILE)
  const log = openSync(LOG_FILE, "a")
  const child = spawn(options.node ?? "node", [DAEMON], { env, detached: true, stdio: ["ignore", log, log], windowsHide: true })
  child.on("error", (error) => console.error("[universal-auto-mode] could not start the daemon:", error.message))
  child.unref()
}

export function createClient(options) {
  const port = options.port ?? 7717
  const launch = options.launch ?? (() => launchDaemon(options, port))
  const waitMs = options.waitMs ?? START_WAIT_MS
  const missed = new Set()
  let started = 0
  let gaveUp = 0

  const request = async (path, body) => {
    const response = await fetch(`http://127.0.0.1:${port}/${path}`, { method: body ? "POST" : "GET", body: body && JSON.stringify(body) })
    if (!response.ok) throw Object.assign(new Error(`the daemon answered ${response.status}`), { status: response.status })
    return response.json()
  }

  const call = (path, body) => request(path, body).catch(() => request(path, body))

  const start = () => {
    if (Date.now() - started < START_INTERVAL_MS) return
    started = Date.now()
    launch()
  }

  const callOrStart = async (path, body, { wait = true } = {}) => {
    try {
      return await call(path, body)
    } catch (error) {
      if (error.status) return undefined
    }
    start()
    if (!wait || Date.now() - gaveUp < GIVE_UP_MS) return undefined
    for (const deadline = Date.now() + waitMs; Date.now() < deadline; ) {
      await sleep(Math.min(START_POLL_MS, waitMs))
      try {
        return await request(path, body)
      } catch (error) {
        if (error.status) return undefined
      }
    }
    gaveUp = Date.now()
    return undefined
  }

  const failClosed = () => {
    const config = loadConfig(options.env ?? process.env)
    return config.enabled && config.detection === "ask" && config.unscanned === "ask"
  }

  const scan = async (body) => {
    const result = await callOrStart("scan", missed.has(body.session) ? { ...body, missed: true } : body)
    if (result) missed.delete(body.session)
    else missed.add(body.session)
    return result
  }

  const decide = async (session, request) => {
    const decision = await callOrStart("decide", { session, request })
    if (decision || !failClosed()) return decision
    const { risk, reason } = classify(request)
    if (risk !== "high" && risk !== "critical") return undefined
    return { effect: "ask", reason: `${reason}; ${OFFLINE_REASON}`, risk, offline: true }
  }

  return { call, start, callOrStart, scan, decide }
}
