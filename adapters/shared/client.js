import { spawn } from "node:child_process"
import { mkdirSync, openSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const DAEMON = fileURLToPath(new URL("../../daemon/server.mjs", import.meta.url))
const LOG_DIR = join(homedir(), ".cache", "universal-auto-mode")
const START_INTERVAL_MS = 15000

export function createClient(options) {
  const port = options.port ?? 7717
  let started = 0

  const request = async (path, body) => {
    const response = await fetch(`http://127.0.0.1:${port}/${path}`, { method: body ? "POST" : "GET", body: body && JSON.stringify(body) })
    return response.json()
  }

  const call = (path, body) => request(path, body).catch(() => request(path, body))

  const start = () => {
    if (Date.now() - started < START_INTERVAL_MS) return
    started = Date.now()
    const env = { ...process.env, UAM_PORT: String(port) }
    if (options.modelsDir) env.UAM_MODELS_DIR = options.modelsDir
    mkdirSync(LOG_DIR, { recursive: true })
    const log = openSync(join(LOG_DIR, "daemon.log"), "a")
    const child = spawn(options.node ?? "node", [DAEMON], { env, detached: true, stdio: ["ignore", log, log], windowsHide: true })
    child.on("error", (error) => console.error("[universal-auto-mode] could not start the daemon:", error.message))
    child.unref()
  }

  const callOrStart = (path, body) =>
    call(path, body).catch(() => {
      start()
      return undefined
    })

  return { call, start, callOrStart }
}
