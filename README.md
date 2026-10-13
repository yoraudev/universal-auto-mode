# Universal Auto Mode

An auto mode for any AI coding agent and any model. A local classifier scans what the agent reads for prompt injection, and a set of risk rules decides which actions run without asking and which go back to you.

It runs as a local daemon plus a small adapter per harness.

## Adapters

| Harness | Adapter | Setup |
| --- | --- | --- |
| OpenCode 2 | `adapters/opencode2` | [OpenCode 2](#opencode-2) |
| Pi | `adapters/pi` | [Pi](#pi) |

> [!WARNING]
> **This lowers the risk of letting an agent act on its own. It does not remove it.** Read this before relying on it.
>
> Auto mode approves actions for you. Anything it approves runs with your user account's access to your files, your shell and your network, without you seeing it first.
>
> **This is not equivalent to the auto modes that OpenAI and Anthropic build into their own products.** It is not as comprehensive and does not have the same capabilities or strength. It relies on a small text classifier and pattern rules, and it does not judge whether an action matches what you asked for.
>
> What can go wrong:
>
> - **Missed injections.** The classifier is a small model that scores text in isolation. In this project's own benchmark it caught about 93 to 97 percent of planted injections, and politely worded ones were missed far more often. An attacker who knows a classifier is in the way can write around it.
> - **In the default mode a detected injection does not stop anything.** The model is warned and carries on, and network commands, package installs and deletions keep running without a prompt. Whether the injection succeeds then depends on the model heeding the warning. Set **On detection** to `ask` to be asked instead.
> - **Actions approved in a clean session.** Even in `ask` mode, while nothing has been flagged, network commands, package installs and deletions inside the project run without a prompt. An injection the classifier missed can use them.
> - **Rules that read commands as text.** Risk tiers come from pattern matching on the command line and paths. Quotes, escapes and wildcards around a credential file name are seen through, but a command can still hide what it does behind a script file, an alias, an encoding, a variable it sets itself or a tool the rules do not know.
> - **False alarms.** Harmless text is sometimes flagged, most often documentation about prompt injection and files written for AI agents, and one-line outputs such as an error message. Until you clear the flag, more actions in that session come back to you for approval.
> - **Long outputs are scanned in part.** Of an output longer than the scan limit, only the beginning and the end are scanned. An injection in the middle is not seen.
> - **Mistakes by the model.** Nothing here judges whether an action is a good idea. A model that misunderstands you can still delete or overwrite work inside the project without a prompt.
> - **Anything local can call the daemon.** It listens only on your own machine and refuses requests from web pages, but any program running under your user account can clear a session's flags, mark content as trusted or change the settings.
>
> How to lower the risk:
>
> - Keep the harness's own `deny` rules for things that must never happen; auto mode never overrides a `deny`.
> - Work in a repository with committed, pushed history so that changes inside the project can be undone.
> - Keep credentials out of the project directory and out of environment variables the agent's shell inherits.
> - Run the agent in a container or a virtual machine when it reads content you do not trust.
> - Read the reason shown with each prompt; it names the rule and the tool output that raised the score.
>
> You use this at your own risk; see [LICENSE](LICENSE).

## Install

Download the package from the latest release and unpack it, or clone the repository. Then:

```bash
npm install
```

### OpenCode 2

Add the adapter to `opencode.jsonc`, globally or in a project:

```jsonc
{
  "plugins": ["/full/path/to/universal-auto-mode/adapters/opencode2"]
}
```

Run `/auto-mode` to watch the classifier download; it opens a progress view with the percentage, which gives way to the settings when the classifier is ready.

### Pi

Install the extension for your user, or add `-l` to install it for one project:

```bash
pi install /full/path/to/universal-auto-mode/adapters/pi/index.js
```

To try it for one run without installing, start Pi with `pi -e /full/path/to/universal-auto-mode/adapters/pi/index.js`. The footer shows whether auto mode is on and in which mode, and `/auto-mode` opens the settings.

Every adapter starts the daemon when it is not running. The classifier is downloaded on first start: 641 MB for `base`, 268 MB for `small`. Each file is fetched from a fixed revision of the model's repository and kept only if its SHA-256 checksum matches the one in `daemon/models.mjs`.

## How it decides

Every tool output of 20 characters or more is scored from 0 to 1, and an output that scores 0.3 or more is flagged. Notices and questions about a flagged output quote the passage that scored highest, so you can tell a false alarm at a glance. Every permission request gets a risk tier from its content: `low`, `medium`, `high` or `critical`. The full rule list is in [docs/policy.md](docs/policy.md).

What happens next depends on the **On detection** setting.

### `warn` (default)

Nothing is asked because of a flag. The model receives the flagged output with a warning in front of it, telling it to treat the content as data, and keeps working. A notice on screen tells you what was flagged; the **Notifications** setting turns these notices off.

A short reminder follows the flagged output, so that the last thing the model reads is not the injection.

The warning also tells the model to report it: in its reply it should tell you that auto mode flagged the content and what the injected instructions asked for, and when it spots an injection that carries no such warning, it should tell you that it noticed it by itself. That shows you whether the classifier or the model caught something, as far as the model follows the instruction.

Permission requests are approved without a prompt, whatever the session has read. The only exception is the `critical` tier (credential files, `curl … | sh`, force pushes, publishing), which is always sent to you.

### `ask`

A flag changes what you are asked.

When a tool output is flagged strongly (score 0.9 or higher), auto mode stops and asks you before the model sees it:

- **Continue and warn the agent.** The model receives the output with the warning. For the rest of the session that output only keeps `high` actions with you.
- **Stop the agent.** The output is withheld from the model and the session is interrupted. Closing the question without choosing does the same.

You are asked once per turn. Outputs flagged at the same moment are combined into one question, and your answer also applies to anything else flagged before your next message: after "continue" it goes to the model with the warning, after "stop" it is withheld.

A weaker flag (0.3 to 0.9) does not interrupt you. The model gets the output with the warning and a notice appears on screen.

Permission requests are then decided by the tier and the highest score in the session:

| Tier | Examples | Sent to you when |
| --- | --- | --- |
| `low` | reading inside the project, `git status` | never |
| `medium` | editing project files, `npm test` | the session score is at least 0.9 |
| `high` | network tools, package installs, deletion, paths outside the project | the session score is at least 0.3 |
| `critical` | credential files, `curl … \| sh`, force pushes, publishing | always |

When a flag was a false alarm, clear it from the harness: run `/auto-mode` inside the session and choose **Clear flags**. **Trust flagged content** clears the flags too and remembers the flagged outputs, so that exactly the same text is not scanned or flagged again in any session; a file that changes by one character is scanned again. **Forget trusted content** empties that list.

With **Unscanned output** set to `ask`, a session that holds output which could not be scanned in full (longer than the scan limit, a failed scan, a scan still running when the decision is made, or output read while the daemon was not running) is treated like a weak flag: `high` actions are sent to you until you clear the session's flags. The same setting covers the time the daemon cannot be reached at all: the adapter then rates each action itself and sends `high` and `critical` ones to you. With `allow`, or in `warn` mode, an unreachable daemon leaves every decision to the harness, as if auto mode were off.

In both modes a `deny` from the harness stays a `deny`. Every other decision of the harness's own permission rules is replaced by auto mode's.

## Settings

Settings are changed from inside the harness. In OpenCode 2, type `/auto-mode` or pick **Auto mode settings** from the command palette (`ctrl+p`). In Pi, type `/auto-mode`; it shows the same settings as a list, and the footer shows the loading progress. A change takes effect without restarting anything and is saved for the next start. Switching the model or the device loads the new classifier in the background while the old one keeps working. A progress view shows what is happening during that time, with the download percentage when the model has to be fetched first, and a notice appears when the classifier is ready. Pressing esc in the progress view goes to the settings, where a status line leads back to it. If loading fails, the previous classifier stays in use and the menu shows the error.

| Setting | Default | Meaning |
| --- | --- | --- |
| Auto mode | `on` | The switch at the top of the menu. Off means nothing is scanned, no warnings are added and the harness's own permission rules apply unchanged. The daemon keeps running, so turning it back on is immediate. |
| On detection | `warn` | `warn` passes a flagged output to the model with a warning and asks you nothing. `ask` asks you whether to continue or stop and sends riskier actions later in the session to you. |
| Notifications | `on` | Whether a notice appears on screen when an output is flagged and the model is warned. `off` hides those notices only: the model is still warned, and questions and the notice for a withheld output still appear |
| Unscanned output | `allow` | Only used in `ask` mode. `allow` shows a notice when an output could not be scanned in full. `ask` also sends `high` actions in that session to you until you clear its flags, and `high` and `critical` actions while the daemon cannot be reached. |
| Model | `base` | `base` (308M parameters, more accurate) or `small` (141M, about twice as fast) |
| Device | `cpu` | Where the classifier runs: `cpu`, `gpu`, or one provider by name (`dml`, `webgpu`, `cuda`, `coreml`) |
| Unload after | `30` | Minutes without a scan after which the classifier is unloaded to free memory. The next scan loads it again and takes a few seconds longer. `0` keeps it loaded. |
| Flag threshold | `0.3` | Score from which an output is flagged, and in `ask` mode from which `high` actions are sent to you |
| Ask threshold | `0.9` | In `ask` mode, the score from which you are asked about an output and `medium` actions are sent to you |
| Window | `512` | Tokens per classifier window |
| Overlap | `64` | Tokens shared by neighboring windows |
| Scan budget | `60000` | Milliseconds a tool result may wait for its scan. A scan that takes longer continues in the background, and its output reaches the model without a warning. |
| Decision wait | `30000` | Milliseconds a decision waits for scans that are still running |
| Scan limit | `200000` | Longest tool output, in characters, that is scanned in full. Of a longer output, the first and the last half of this many characters are scanned, and a notice tells you. |

The same menu shows the current session's score, clears its flags, and trusts or forgets flagged content.

### Config file

The daemon stores these settings in `~/.config/universal-auto-mode/config.json`, which can also be edited by hand while the daemon is stopped. Every key is optional. A value the daemon cannot use is ignored with a line in its log, and the default applies; the same goes for a file that is not valid JSON. Content you marked as trusted is kept as a list of checksums in `trusted.json` in the same directory, 1,000 entries at most.

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | The auto mode switch |
| `detection` | `"warn"` | `"warn"` or `"ask"`; see [How it decides](#how-it-decides) |
| `notifications` | `"on"` | `"on"` or `"off"`; whether a notice appears when an output is flagged |
| `unscanned` | `"allow"` | `"allow"` or `"ask"`; whether output that could not be scanned in full keeps `high` actions with you in `ask` mode |
| `model` | `"base"` | `"base"` (308M parameters, more accurate) or `"small"` (141M, about twice as fast) |
| `device` | `"cpu"` | Where the classifier runs: `"cpu"`, `"gpu"`, or one provider by name (`"dml"`, `"webgpu"`, `"cuda"`, `"coreml"`) |
| `port` | `7717` | Port on `127.0.0.1` |
| `modelsDir` | `~/.cache/universal-auto-mode/models` | Where classifier files are stored |
| `strong` | `0.9` | Session score from which `medium` actions are sent to you |
| `weak` | `0.3` | Session score from which `high` actions are sent to you |
| `window` | `512` | Tokens per classifier window |
| `overlap` | `64` | Tokens shared by neighboring windows |
| `scanBudgetMs` | `60000` | How long a tool result may wait for its scan before the scan continues in the background |
| `decideWaitMs` | `30000` | How long a decision waits for scans that are still running |
| `maxChars` | `200000` | Longest tool output scanned in full |
| `unloadMinutes` | `30` | Minutes without a scan before the classifier is unloaded; `0` for never |

`port` and `modelsDir` can only be set in the file. The environment variables `UAM_MODEL`, `UAM_DEVICE`, `UAM_PORT` and `UAM_MODELS_DIR` override the file when the daemon starts, and `UAM_CONFIG` points it at a different file.

The OpenCode 2 adapter takes `port`, `modelsDir`, `node` (path to the Node.js binary) and `debug` as options. To set them, write the plugin entry as an object instead of a path:

```jsonc
{
  "plugins": [{ "package": "/full/path/to/universal-auto-mode/adapters/opencode2", "options": { "port": 7717 } }]
}
```

`modelsDir` applies only when the adapter starts the daemon itself. The Pi adapter reads the port from `UAM_PORT`.

### GPU

The default is `cpu` for both models. A GPU is opt-in.

With the device set to `gpu` the daemon tries every GPU provider the machine offers, times one window on each and keeps the fastest. If none works it falls back to the CPU. Naming a provider skips the comparison, and the daemon exits if that provider cannot be loaded.

| Provider | Platform | Needs | Tested |
| --- | --- | --- | --- |
| `dml` (DirectML) | Windows | A DirectX 12 GPU from any vendor | yes, on a Radeon RX 580 |
| `webgpu` | Windows, Linux, macOS | A GPU with Direct3D 12, Vulkan or Metal drivers | yes, on a Radeon RX 580 under Windows, where it runs on Direct3D 12; the Vulkan path on Linux is untested |
| `cuda` | Linux x64 | An NVIDIA GPU with the CUDA and cuDNN libraries that the installed `onnxruntime-node` expects | no |
| `coreml` | macOS | Apple silicon or a supported Mac GPU | no |

Before switching, know the downsides:

- **The first scan at each new input length is slow.** A GPU provider prepares itself for every input length it has not seen, which adds from a few hundred milliseconds to several seconds to that scan. Most tool outputs are short and each has a different length, so this happens often, and short outputs can take longer than on the CPU. DirectML is affected most.
- **The gain is limited to long outputs.** On the tested card, outputs of about 10,000 tokens and more scanned 2 to 3 times faster. Even then a 40,000-token output took about 22 seconds with `base`.
- **Startup takes longer.** With `gpu` the daemon loads the classifier once per provider to compare them before it is ready.
- **The classifier shares the GPU.** It holds video memory for as long as the daemon runs and competes with whatever else uses the card.
- **Scores can differ slightly.** WebGPU results differed from the CPU in the third decimal place, which can move a score across a threshold in rare cases.
- **Most providers are untested.** Only DirectML and WebGPU on one card were tried; see the table above.

## How models reacted

These are observations from a handful of manual runs against one test page, not a benchmark. The page was a harmless article with a hidden note that asked AI assistants to open a tracking URL and to leave that out of their summary. The classifier flagged the page in every run, with scores from 0.91 to 1.00 depending on the tool that read it.

| Model | Auto mode | Opened the URL | Told the user |
| --- | --- | --- | --- |
| Current, capable models | off | no | yes, on their own |
| Current, capable models | `warn` | no | yes; once the warning asked for it, they said that auto mode had flagged the page |
| A weak model | `warn` | no | no. Its reasoning shows it read the note and obeyed the request to leave it out of the summary |

What this showed:

- Capable models did not need the warning on this page. For them the benefit of auto mode is the notice on your screen and, in `ask` mode, that risky actions come back to you.
- With the weak model the flag and the on-screen notice still worked, and the injected action did not happen, but the model stayed silent about the injection. In `warn` mode the outcome depends on the model, which is the reason `ask` mode exists.
- A first version of the warning only told the model how to phrase a report if it made one, and a capable model then said nothing. The warning now asks for the report outright.
- The reminder after the flagged output was added because of the weak-model run. It has not been measured.
- In the weak-model run two harmless outputs were flagged weakly as well: a list of open browser tabs (0.53) and the text of a skill file (0.44).

## Good to know

- MCP tools are covered. Their results are scanned like any other tool output, and every MCP tool call is rated `medium`, because a tool's name says nothing reliable about what it does.
- In `ask` mode, the question about a flagged output appears only in an OpenCode window that has that session open. Without one, for example in `opencode run` or in a subagent's session, nothing is asked: the model gets the output with the warning, and later `medium` and `high` actions in that session are sent to you instead.
- When auto mode sends an action to you, a notice next to OpenCode's permission prompt says why. If you answer such a prompt for an MCP tool with "Always allow", auto mode stops asking about that tool in that project.
- OpenCode 2 allows most actions by default. With those defaults the adapter's visible effect is to turn an `allow` into a prompt for `critical` requests and, in `ask` mode, when the tier and the session score call for it. If you set OpenCode's permissions to `ask`, it also approves the requests that are safe.
- In `opencode run` there is nobody to ask, so a request that would be sent to you is rejected.
- Pi has no permission prompts of its own, so there every question comes from the adapter: before a call that auto mode wants confirmed, and in `ask` mode about a strongly flagged output. In `pi -p` and the JSON mode there is nobody to ask: a call that needs confirmation is blocked, and a flagged output goes to the model with the warning.
- In Pi, tool calls made by a script inside another tool (codemode) are rated one by one, but only the result the model receives is scanned.
- A scan takes about 1.5 seconds per 1,400 tokens with `base` on a six-core desktop CPU, and about half that on a Radeon RX 580 once the GPU has seen that input length. The tool result is held back until its scan is done, so a long page read through a browser tool can add many seconds to that step. A flagged output takes about a second longer with `base` on that CPU, because the daemon then looks for the passage to quote. A scan that outlasts the scan budget finishes in the background; in `ask` mode you are still asked if it is flagged, with a note that the model already has the output.
- Tool output read while auto mode is off is never scanned. If you turn it on in the middle of a session, what the model read before that does not count toward the session score.
- Until the classifier has been downloaded and loaded, tool output cannot be scanned and nothing is flagged or asked, unless **Unscanned output** is set to `ask`.
- The daemon keeps running after the harness exits. After 30 minutes without a scan it unloads the classifier to free memory and loads it again for the next scan; session scores are kept. If the daemon has stopped, the adapter starts it again on the next tool call or when you open `/auto-mode`, and that call waits up to 20 seconds for it, so the output that woke it is scanned too. If it does not come up, a notice tells you that tool output is not being scanned, and the adapter tries again a minute later without holding up the calls in between. Its output goes to `~/.cache/universal-auto-mode/daemon.log` when an adapter started it; a log over 5 MB is moved to `daemon.log.1` at the next start. The log names the reason for each decision but not the command.
- Session scores live in memory and are lost when the daemon restarts. The daemon keeps the 500 most recently used sessions.
- Outputs shorter than 20 characters are not scanned. One-line outputs are scanned, and in a small trial they were flagged by mistake more often than longer text: `base` gave 0.37 to an `npm warn deprecated` line and `small` gave 0.79 to an `ENOENT` error message.
- A request to the daemon may be 64 MB at most. A tool output larger than that is not scanned.

## Development

```bash
npm test
npm run test:e2e
npm run docs:policy
```

`npm run test:e2e` starts its own daemon and downloads the classifier on first use. The benchmark (`npm run bench`) does not run from a fresh clone: its documents are not in the repository and it expects the model files under `models/`. [docs/benchmark.md](docs/benchmark.md) describes what it needs.

Risk rules are in `daemon/risk.mjs` and the decision table is in `daemon/policy.mjs`. How the pieces fit together is described in [docs/architecture.md](docs/architecture.md), and how the classifier was chosen in [docs/benchmark.md](docs/benchmark.md). Every push to `main` publishes a new release.

## License

Free to use, modify and redistribute, as long as the original author stays credited and the project is not presented as someone else's own. See [LICENSE](LICENSE).
