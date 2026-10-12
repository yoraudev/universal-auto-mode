import { Plugin } from "@opencode/plugin/tui"
import { createSignal } from "solid-js"
import { createClient } from "../shared/client.js"
import { REASON_PREFIX } from "./request.js"
import { createReviewer } from "./review.js"
import { isBusy, openSettings, statusLine } from "./settings.js"

const POLL_MS = 500
const REASON_TOAST_MS = 20000
const REVIEW_POLL_MS = 1000

export default Plugin.define({
  id: "universal-auto-mode",
  setup(ctx) {
    const { call, start } = createClient(ctx.options)

    const watch = (initial) =>
      new Promise((resolve) => {
        const [status, setStatus] = createSignal(initial)
        const stop = () => {
          clearInterval(timer)
          resolve()
        }
        const timer = setInterval(async () => {
          const config = await call("config").catch(() => undefined)
          if (!config) return
          setStatus(config.status)
          if (isBusy(config.status)) return
          stop()
          ctx.ui.dialog.clear()
        }, POLL_MS)
        ctx.ui.dialog.show(
          () => (
            <box flexDirection="column" paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
              <text>Auto mode</text>
              <text>{statusLine(status())}</text>
              <text>Actions above low risk are sent to you until the classifier is ready. Press esc for the settings.</text>
            </box>
          ),
          stop,
        )
      })

    const unsubscribe = ctx.data.on("permission.asked", (event) => {
      const message = event.data?.message
      if (!message?.startsWith(REASON_PREFIX)) return
      ctx.ui.toast.show({ variant: "warning", title: "Auto mode is asking because", message: message.slice(REASON_PREFIX.length), duration: REASON_TOAST_MS, sessionID: event.data.sessionID })
    })

    const sessions = () => {
      const route = ctx.ui.router.current()
      const open = ctx.ui.tabs.list().map((tab) => tab.sessionID)
      return route.type === "session" ? [...new Set([route.sessionID, ...open])] : open
    }
    const interrupt = (sessionID) => ctx.client.session.interrupt({ sessionID }).catch(() => undefined)
    const reviewer = setInterval(createReviewer({ dialog: ctx.ui.dialog, toast: ctx.ui.toast, call, sessions, interrupt }), REVIEW_POLL_MS)

    ctx.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "universal-auto-mode.settings",
          title: "Auto mode settings",
          description: "Change the classifier, device and thresholds, or clear this session's flags",
          group: "Auto mode",
          bind: false,
          palette: true,
          slash: { name: "auto-mode" },
          run: () => {
            const route = ctx.ui.router.current()
            void openSettings({ dialog: ctx.ui.dialog, toast: ctx.ui.toast, call, start, watch, sessionID: route.type === "session" ? route.sessionID : undefined })
          },
        },
      ],
    }))

    return () => {
      clearInterval(reviewer)
      unsubscribe()
    }
  },
})
