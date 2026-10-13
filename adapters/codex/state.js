import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const DIR = join(homedir(), ".cache", "universal-auto-mode", "codex")
const empty = () => ({ pending: {}, granted: [], reviews: [], down: false })

export function createStore(dir = DIR) {
  const file = (session) => join(dir, `${String(session).replace(/[^\w.-]/g, "_")}.json`)

  const read = (session) => {
    try {
      return { ...empty(), ...JSON.parse(readFileSync(file(session), "utf8")) }
    } catch {
      return empty()
    }
  }

  const write = (session, state) => {
    mkdirSync(dir, { recursive: true })
    const target = file(session)
    writeFileSync(`${target}.${process.pid}.tmp`, JSON.stringify(state))
    renameSync(`${target}.${process.pid}.tmp`, target)
  }

  const update = (session, change) => {
    const state = read(session)
    change(state)
    write(session, state)
    return state
  }

  return { read, update }
}
