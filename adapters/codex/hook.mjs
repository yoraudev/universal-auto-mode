import { createClient } from "../shared/client.js"
import { createHandlers } from "./handlers.js"
import { createStore } from "./state.js"

let text = ""
for await (const chunk of process.stdin) text += chunk

try {
  const input = JSON.parse(text)
  const client = createClient({ port: process.env.UAM_PORT ? Number(process.env.UAM_PORT) : undefined, breakaway: true })
  const handler = createHandlers({ client, store: createStore() })[input.hook_event_name]
  const output = handler ? await handler(input) : undefined
  if (output) process.stdout.write(JSON.stringify(output))
} catch (error) {
  process.stderr.write(`universal-auto-mode: ${error.message}\n`)
  process.exitCode = 1
}
