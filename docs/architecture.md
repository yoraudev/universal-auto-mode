# Architecture

Universal Auto Mode has one long-running part and one thin part per harness.

```
agent harness ──plugin hooks──> adapter ──HTTP 127.0.0.1:7717──> daemon ──> classifier (ONNX, CPU or GPU)
```

| Directory | Runs in | Role |
| --- | --- | --- |
| `daemon/` | Node.js | Loads the classifier, scores tool output, keeps per-session state, decides on permission requests |
| `adapters/opencode2/` | OpenCode 2 plugin runtime | Forwards tool output and permission requests to the daemon and applies its answers |
| `adapters/pi/` | Pi extension runtime | The same for Pi, and asks the user itself because Pi has no permission prompts |
| `adapters/shared/` | Whichever adapter imports it | The daemon client, the texts given to the model, and the list of settings |
| `bench/` | Node.js | Compares classifiers on tool outputs with planted injections |

The classifier runs in a separate process because it needs a native ONNX runtime and takes several seconds to load. One daemon serves every harness and every session on the machine.

## Daemon

`server.mjs` is an HTTP server bound to `127.0.0.1`. Requests and responses are JSON.

| Endpoint | Body | Answer |
| --- | --- | --- |
| `GET /health` | | `ok`, `ready` (also true while the classifier is unloaded and would load on demand), `model`, `device`, `status` |
| `POST /scan` | `session`, `source`, `text`, optional `budgetMs`, optional `ui` | `pending`, and when finished `score`, `level`, `ms`, `truncated`, plus `excerpt` for a flagged output, `review` when the user is being asked, `decision` when they already answered, or `trusted` when the text is on the trust list |
| `POST /decide` | `session`, `request` | `effect` (`allow` or `ask`), `reason`, `risk`, `score` |
| `POST /ui` | `after`, `sessions` | `seq`, the `notices` newer than `after`, and the pending `reviews` for the listed sessions |
| `POST /review` | `id` | `decision` (`continue`, `stop` or `unanswered`), or `pending` after 20 seconds without an answer |
| `POST /review/answer` | `id`, `decision` | `ok`, or `error` |
| `POST /turn` | `session` | `ok`; ends the effect of an earlier answer |
| `POST /session` | `session` | `score`, `level`, `flags`, `pending`, `unscanned` |
| `POST /clear` | `session` | the session after its score and flags were reset |
| `POST /trust` | `session` | the session after a clear, `added` (how many flagged outputs were put on the trust list) and `trusted` (the size of the list) |
| `POST /trust/reset` | | `trusted`, which is then 0 |
| `GET /config` | | the changeable settings, the provider in use, `trusted` (the size of the trust list) and `status` |
| `POST /config` | any of the changeable settings | the settings and `status`, or `error` |

Every response closes its connection. A reused connection can be reset while the daemon is busy loading a classifier, and the request on it would be lost. The adapter's client also repeats a failed call once before it concludes that the daemon is down. A request body over 64 MB is answered with status 413 and not read further.

A request is refused with status 403 when it carries an `Origin` header or when its `Host` is not `127.0.0.1` or `localhost`. Browsers send `Origin` on every cross-site request that can carry a body, so a web page cannot call the daemon, and the `Host` check stops a page that has rebound its own name to the loopback address.

### Settings

`config.mjs` holds the defaults, the list of settings that can be changed at runtime with their allowed values, and the config file path (`~/.config/universal-auto-mode/config.json`, or `UAM_CONFIG`). At startup every value in the file is checked against the same rules; one that fails is logged and replaced by its default, two that contradict each other (`weak` above `strong`, `overlap` not below `window`) are both replaced, and a file that is not valid JSON is ignored. The file is written through a temporary file that is renamed into place. `POST /config` validates a change. A threshold or a timing value is applied and written to the file before the answer is sent. A change to the model, device, window, overlap or scan limit is answered at once and carried out in the background: the daemon opens a new classifier session, and only when that has succeeded does it swap the session, apply the setting, write the file and close the old session. If it fails, the old session stays in use and nothing is saved. A second such change is refused while one is in progress. `port` and `modelsDir` cannot be changed over HTTP.

`status` tells callers where the classifier is: `loading` with the model name, `downloading` with the model, file, bytes received, total bytes and percentage, `ready`, `idle`, or `error` with a message. `idle` means the classifier was unloaded: every five seconds the daemon checks whether `unloadMinutes` have passed since the last scan started or finished, and if so, and no scan is running, it releases the classifier session. The next `/scan` loads it again and waits for it. Sessions, flags and the trust list are not touched. With `unloadMinutes` at 0 the classifier is never unloaded. When the first load at startup fails, the daemon keeps running in the `error` state; scans then fail, sessions are marked `unscanned`, and a new settings change tries again.

### Models

`models.mjs` maps `base` and `small` to their Hugging Face repositories, each with a commit hash and the SHA-256 checksum of every file, and downloads the quantized ONNX file, the tokenizer and the config from that commit into `modelsDir` when they are missing. A download is written to a `.part` file, hashed while it arrives, and renamed only when the checksum matches; otherwise the `.part` file is deleted and the attempt counts as failed. Files that are already in `modelsDir` are not hashed again. Moving to a newer revision of a model means changing the commit hash and the checksums together. A download reports its progress five times a second, and is tried up to four times with three seconds in between.

### Scanning

`scanner.mjs` tokenizes the text, splits it into windows of 512 tokens that overlap by 64, runs each window through the classifier and returns the highest injection probability. Short windows matter: an injection of one paragraph is diluted in a long document, and the benchmark showed better detection at 512 tokens than at 2,048. Of a text longer than `maxChars`, the first and the last half of `maxChars` characters are scanned as two separate pieces, the middle is not, and the session is then marked `unscanned`. Both ends are covered because an injection usually sits near the end of an output and a harness that shortens a long output tends to keep its ends.

When the score reaches `weak`, the scanner looks for the passage to show the user: it scores pieces of 48 tokens, 24 apart, of the window that scored highest, decodes the best one, replaces control characters and line breaks with spaces and cuts it at 240 characters. This `excerpt` is stored with the flag and travels with notices, reviews and the answer of `/scan`. It costs up to 21 short runs, about a second with `base` on the benchmark CPU, and only for flagged outputs.

Scans run one at a time because inference uses every CPU core, or the whole GPU. Windows are also scored one at a time: scoring 4 or 8 windows in one batch was measured on the benchmark machine and was at most 10 percent faster per window on the CPU, DirectML and WebGPU, which does not pay for the new input shapes it would add on the GPU providers. Within a session, text that was already scanned in full is answered from its stored score instead of being scanned again.

### Device

`device` selects the ONNX Runtime execution provider. `cpu` is the default. A provider name (`dml`, `webgpu`, `cuda`, `coreml`) is passed to the runtime as given, and a failure to load it stops the daemon. `gpu` asks the runtime which of those providers it supports on this machine, opens a session on each, runs one full window twice and keeps the session whose second run was fastest. Providers that fail to load are skipped, and if none is left the CPU is used. `/health` reports the provider in use.

The CPU is the default for both models because GPU providers are slow on the first run at each new input length, and tool outputs rarely repeat a length. The README lists the other downsides.

### Sessions

The daemon keeps, per session id, a list of flags (every scan that scored at least `weak`, with its source, score and state), the scans still running, the scores of text already scanned, and the `unscanned` mark. `level` is `strong` from `strong` upward, `weak` from `weak` upward, and `none` below.

A flag is `open`, `acknowledged` or `withheld`. The session score is the highest flag score, where an acknowledged flag counts as just under `strong` at most and a withheld flag does not count.

The daemon keeps the 500 most recently used sessions. When a new one would exceed that, the session used longest ago is dropped, unless it still has a scan running.

### Trust list

Each flag remembers the SHA-256 checksum of the text it came from. `POST /trust` puts the checksums of a session's flags, except withheld ones, on the trust list and then clears the session like `/clear`. `/scan` answers for a text on the list at once with score 0 and `trusted: true`, without scanning it. The list holds 1,000 entries, the oldest making room for new ones, and is stored as `trusted.json` next to the config file. `POST /trust/reset` empties it. Only the exact text is trusted, so an edited file is scanned again.

### Reviews

A user interface announces the sessions it is showing by calling `/ui` about once a second. With `detection` set to `ask`, when a scan scores at least `strong` in a session announced within the last four seconds, the daemon opens a review for that flag and returns its id from `/scan`. The adapter then calls `/review`, which waits for the answer in rounds of 20 seconds. The interface finds the review in the answer to `/ui`, asks the user and posts the decision to `/review/answer`: `continue` marks the flag acknowledged, `stop` marks it withheld. If the interface stops announcing the session, the review ends as `unanswered` and the flag stays open. A review for a scan that outlasted its budget is marked `late`: the adapter has already passed the output on, so `stop` can only interrupt the session, which the interface does itself.

An answer covers the rest of the turn. It settles every other open review of that session the same way, and later strong flags in the session get the same decision without a review until an adapter calls `/turn`, which it does when the user sends the next message. One tool call often produces several different texts that carry the same injection, for example a page's text, its accessibility tree and the wrapper tool's combined output, and asking for each would repeat the same question.

An adapter that asks the user itself sends `ui: true` with `/scan` instead of announcing sessions. A review is then opened for a strong flag whenever the scan finished within its budget, and the adapter posts the answer to `/review/answer` without calling `/review`.

With the `notifications` setting `off`, the daemon records no notice for a flag and adds `quiet: true` to the answer of `/scan`, which tells an adapter that shows its own notices to skip the one for a warned flag. Reviews, the notice for a withheld output and the notices about outputs that could not be scanned are not affected.

`/ui` also returns notices, one per flag, so an interface can tell the user about flags that did not lead to a review. A later scan of the same text in the same session returns the earlier decision instead of asking again.

`/scan` returns as soon as the scan finishes or `budgetMs` has passed, whichever comes first. The default budget is a minute, so a tool result normally waits for its scan. A scan that outlives the budget keeps running and still counts.

### Deciding

`risk.mjs` rates a request from its content alone. A request has a `kind` (`shell`, `read`, `write`, `network`, `none` or `other`), a `command` or a list of `paths`, and the working directory. `policy.mjs` combines the tier with the session:

The `detection` setting selects between two behaviors. With `warn`, the default, the daemon never opens a review, and `/decide` ignores the session's score and its `unscanned` mark, so only `critical` requests are answered with `ask`. With `ask`, reviews are opened as described above and `/decide` uses the rules below. Flags and notices are recorded in both.

When the `enabled` setting is off, `/scan` and `/decide` answer `{ "disabled": true }` without scanning or deciding, and adapters leave the tool output and the harness's decision alone. The classifier session is kept open. Otherwise:

- `critical` is always `ask`.
- `high` is `ask` from the `weak` score, `medium` from the `strong` score.
- Everything else is `allow`.

Before answering for a `medium` or `high` request in `ask` mode, `/decide` waits up to `decideWaitMs` for the session's running scans. This closes the gap when a model reads a file and requests an action in the same step. With the `unscanned` setting on `allow`, the default, a scan that has still not finished, was cut off at `maxChars` or failed does not cause an `ask`; the interface gets a notice instead. With `unscanned` on `ask`, a session that is marked `unscanned` or still has a scan running after the wait is treated like one with a weak flag: a `high` request is answered with `ask` and a reason that says output could not be scanned. `/clear` and `/trust` remove the mark.

`risk.mjs` tries every shell rule on the command as written and on a copy without quotes, backticks, carets and backslashes, and matches wildcards against a list of credential file names, so that `.e""nv` and `.s*h/id_*` are rated like the names they stand for. A file write is also `critical` when its target is a shell startup file, a hook, an autostart location, the harness configuration, the daemon's own settings or cache, or a file inside the directory the daemon runs from, unless the project is that directory.

The daemon's log records the kind, tier, score, effect and reason of each decision, not the command or the paths.

[policy.md](policy.md) lists every rule. It is generated from `risk.mjs` and `config.mjs` by `scripts/generate-policy-doc.mjs`; run `npm run docs:policy` after changing a rule or a threshold.

## OpenCode 2 adapter

The adapter has a server part and a terminal UI part, loaded by OpenCode from the same plugin entry. Both use `adapters/shared/client.js`, which calls the daemon and starts it as a detached Node.js process that outlives the harness, at most once every 15 seconds. It starts the daemon only when a call could not be delivered, not when the daemon answered with an error status. Before a start it moves a `daemon.log` over 5 MB to `daemon.log.1`. `adapters/shared/scan.js` holds the shortest output that is scanned, 20 characters, and the wording that quotes a flagged passage to the user.

### Server plugin

`adapters/opencode2/server.js` is a Promise plugin for `@opencode/plugin` 2.x.

On setup it calls `/health` and starts the daemon if nothing answers. The same happens whenever a later call fails.

| Hook | What the adapter does |
| --- | --- |
| `tool` `execute.after` | Sends the output of a completed tool call to `/scan`. If the answer names a review, it waits on `/review` for the user's decision. On `stop` it replaces the output with a note that it was withheld and interrupts the session. Otherwise, when the level is not `none`, it puts a warning in front of the output. Output shorter than 20 characters and the output of tools that only repeat the model's own text are skipped. |
| `session` `prompt` | Calls `/turn` when the user sends a message. |
| `permission` `evaluate` | Maps the request to the daemon's shape, calls `/decide` and writes the answer into `effect`. For `ask` it sets `message` to the reason. A `deny` is left alone, and so is an MCP tool the user has answered with "Always allow". |

`request.js` maps OpenCode's `action` and `resources` by exact action name: `shell` becomes `shell` with the resource as the command, `read`, `grep` and `glob` become `read`, `edit` becomes `write`, `webfetch` and `websearch` become `network`, and `question` becomes `none`. Every other action becomes `other`. MCP tools arrive as `<server>_<tool>` and always land there; matching on parts of a tool's name would let a tool called `read_page` or `list_and_send` pass as a read.

OpenCode runs MCP tools through its `execute` tool, so one MCP call produces two `execute.after` events with the same text, one for the MCP tool and one for `execute`.

The plugin also follows OpenCode's event stream. When a permission prompt that auto mode caused is answered with `always` and the action is not one of OpenCode's own, it stores the action name under the project directory in the plugin's storage and no longer overrides OpenCode's decision for it.

If the daemon cannot be reached, both hooks do nothing and OpenCode's own permission rules apply.

### Terminal UI plugin

`adapters/opencode2/tui.jsx` registers one command, `universal-auto-mode.settings`, in the `global` keymap mode, with the slash name `auto-mode` and a command palette entry. A layer in the default mode is not listed in either place.

The command runs `openSettings` from `settings.js`, which is plain logic over the host's dialogs and has no OpenCode imports. It reads `/config` and, inside a session, `/session`, shows every setting with its current value in a select dialog, asks for the new value with a second select dialog or a text prompt, posts it to `/config` and reports the result in a toast. It then shows the list again until the user closes it. The first entry is the auto mode switch, which posts the opposite of the current `enabled` value as soon as it is selected. Inside a session the list has an entry that calls `/clear` and one that calls `/trust`, and when the trust list is not empty, an entry that calls `/trust/reset`.

While `status` is `loading` or `downloading`, `openSettings` calls the `watch` function it was given before showing the list. `tui.jsx` implements `watch` as a small dialog whose text is a Solid signal: it polls `/config` twice a second and updates the line in place, closes itself when the classifier is ready or has failed, and resolves early when the user presses esc. The list then carries a status line that opens the progress view again. Changing the model or the device goes straight to the progress view. When the status turns `ready`, a toast says so. If the daemon does not answer, the command starts it and retries for about 20 seconds.

`tui.jsx` is the only file with JSX. OpenCode compiles it when it loads the plugin and supplies `solid-js` and the OpenTUI elements, so the project has no build step.

OpenCode's own settings screen has no extension point for plugins, so the settings live in this separate dialog.

The same plugin runs `createReviewer` from `review.js` once a second. It posts the open session and the sessions in open tabs to `/ui`, shows a toast for each notice that has neither a review nor an earlier answer covering it, and for the open reviews of one session opens a single select dialog with the two answers, naming every source. It answers the first review, which settles the others, and never asks about the same review twice. Closing the dialog counts as `stop`. After a `stop` the plugin interrupts the session through OpenCode's client, which is what ends a late review. It also shows a toast for an output that was too long to scan in full or whose scan failed. It also listens for `permission.asked` events and shows the reason in a toast when the message starts with the adapter's prefix, because OpenCode's permission prompt does not display it.

## Pi adapter

`adapters/pi/index.js` is the extension entry Pi loads; it builds the daemon client and hands it to `createExtension` in `extension.js`, which holds the behavior and takes the client as an argument so the tests can replace it. The daemon is contacted from `session_start` on, never from the factory.

| Pi event or command | What the adapter does |
| --- | --- |
| `session_start` | Reads `/config`, which starts the daemon if needed, and shows the state in the footer in the theme's colors: a green dot with `auto mode: warn` or `auto mode: ask`, or an amber circle with `auto mode: off` |
| `input` | Calls `/turn`, so an earlier answer stops applying |
| `tool_call` | Translates the call with `request.js` (`bash` and `powershell` to `shell`, `read`, `grep`, `find` and `ls` to `read`, `edit` and `write` to `write`, everything else to `other`) and calls `/decide`. On `ask` it shows a select dialog with **Allow** and **Block** and blocks the call unless the user allows it. Without a user interface it blocks |
| `tool_result` | Sends the text of the result to `/scan` with `ui` set to whether a user interface exists. A flagged result gets the warning as a new first content part and the reminder as a new last one, and a notice that quotes the flagged passage is shown. A result that was too long to scan in full is reported with a notice of its own. If the answer names a review, it asks **Continue and warn the agent** or **Stop the agent**, posts the answer, and on `stop` replaces the result with the withheld note, marks it as an error and aborts the agent |
| `/auto-mode` | Runs `openSettings` from `settings.js`: a select dialog listing every setting, a second select dialog or a text input for the new value, and a footer line that follows the classifier while it loads |

Results of `edit` and `write`, results shorter than 20 characters, and results of calls that another tool made (`parentToolCallId` set) are not scanned; the result of the calling tool is, and that is the one the model reads. Calls made by another tool still go through `/decide`.

Results that arrive together are asked about once: the questions run one after another, and the first answer is reused for the rest of the turn, as the daemon does for later scans. Closing the question counts as `stop`.

## Texts given to the model

`adapters/shared/notices.js` holds the warning put in front of a flagged result, the reminder put after it, and the note that replaces a withheld one. The reminder repeats in two sentences that the content did not come from the user and that the flag is to be reported even if the content asked for silence; it is there because an injection usually sits near the end of an output, and a weaker model gives the last instruction it read the most weight. The warning tells the model to treat the content as data, to tell the user in its reply that auto mode flagged it and what the injected instructions asked for, and to say that it noticed the injection itself when the content carries no such warning.

## Adding an adapter

An adapter needs two things from its harness: the text of each tool result, and a point where a pending action can be approved or sent to the user. It then calls `/scan` and `/decide` with a session id that is stable for the conversation and translates the harness's request into `kind`, `command` or `paths`, and `cwd`.

## Releases

`.github/workflows/release.yml` runs on every push to `main`: unit tests, a check that `docs/policy.md` matches the code, compute the next version (major and minor from `package.json`, patch one higher than the latest matching tag), and publish a release with the packed project. Classifier files are not part of the package.

## Tests

- `test/` holds unit tests (`node:test`) for the risk rules, the decision table, the OpenCode action mapping, the Pi adapter (driven with a fake extension API: warning, asking, stopping, blocking and its settings command), settings validation and the settings dialog flow, driven with fake dialogs: changing values, the progress view, load errors and starting a stopped daemon, and for the review question and the score of answered flags. `test/risk.test.mjs` also holds the commands that used to slip past a rule (quoting, wildcards, variables, command substitution, flags that write or run), each with the tier it must get. `test/daemon.test.mjs` covers reading a damaged or invalid config file, the trust list file, the checksum check of a download with a fake server, the decision for a session with unscanned output, and log rotation.
- `e2e/run.mjs` starts a daemon on its own port, scans a clean and an injected fixture, and checks the decisions that follow, including a decision that has to wait for a running scan and clearing a session. It checks the quoted passage of a flagged output, a one-line injection, the `unscanned` setting with a scan that is still running, trusting and forgetting flagged content, an output cut at the scan limit whose injection sits at the end, and the classifier being unloaded when idle and loaded again by the next scan. It then changes settings over `/config`, turns auto mode off and on, runs a review to each of its two answers, switches the model in the background and waits for it, and checks that an oversized request and a request with an `Origin` header are refused. It uses a temporary config file and needs the classifier files for both models.
