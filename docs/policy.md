# Policy

This file is generated from `daemon/risk.mjs` and `daemon/config.mjs` by `npm run docs:policy`. Do not edit it by hand.

Every permission request gets a risk tier from its content alone. With the detection setting on `warn`, the default, only `critical` requests are sent to the user. With `ask`, the tier is combined with the highest injection score seen in the session:

| Tier | Sent to the user when |
| --- | --- |
| `low` | never |
| `medium` | the session score is at least 0.9 |
| `high` | the session score is at least 0.3 |
| `critical` | always |

A `deny` from the harness is never changed.

A flagged tool output the user answered with "continue" counts as 0.89 at most, so it keeps `high` actions with the user and lets `medium` ones through. One the user stopped was withheld from the model and does not count.

## Shell commands

Rules are checked in the order below; the first match decides.

### Critical

| Reason | Pattern |
| --- | --- |
| touches credential files | `(^\|[\\/\s"'=])(\.ssh\|\.aws\|\.gnupg\|\.kube\|\.docker[\\/]config\|id_(rsa\|ed25519\|ecdsa)\|\.npmrc\|\.pypirc\|\.netrc\|\.git-credentials\|\.env(\.[\w.-]+)?\|credentials(\.json)?\|auth\.json\|secrets?\.(json\|ya?ml\|toml)\|[\w.-]+\.(pem\|key\|pfx\|p12))(?=$\|[\\/\s"';\|&)])` |
| pipes output into an interpreter | `\\|\s*(sudo\s+)?((ba\|z\|da\|k)?sh\|python\d?\|node\|perl\|ruby\|pwsh\|powershell)\b` |
| evaluates dynamically built code | `\b(iex\|invoke-expression)\b\|\b(ba)?sh\s+<\(\|\beval\s` |
| rewrites or discards git history | `\bgit\s+push\b.*(--force\|\s-f\b\|--force-with-lease\|--mirror)\|\bgit\s+reset\s+--hard\|\bgit\s+clean\s+-\w*f` |
| modifies disks or system state | `\b(mkfs\|fdisk\|diskpart\|shutdown\|reboot)\b\|\bdd\s+.*\bof=\|\bformat\s+[a-z]:` |
| publishes to a registry | `\b(npm\|pnpm\|yarn\|bun\|cargo)\s+publish\b\|\btwine\s+upload\b\|\bgh\s+release\b\|\bdocker\s+push\b` |
| changes privileges or persistence | `\b(sudo\|doas\|runas)\b\|\bchmod\s+\S*[+]s\|\b(crontab\|schtasks\|launchctl\|systemctl)\b\|\breg(\.exe)?\s+add\b\|\bsetx\b` |
| modifies git hooks, shell startup files or global config | `\bgit\s+config\s+.*(--global\|--system)\|core\.hookspath\|[\\/]\.git[\\/]hooks\|authorized_keys\|\.(bash\|zsh)rc\b\|\.(bash_)?profile\b\|\$profile\b` |
| targets the auto-mode daemon itself | `universal-auto-mode\|\buam\b\|:7717\b` |

A recursive or forced `rm` whose target is `/`, `~`, `..`, `.` or `*` is also critical.

### High

| Reason | Pattern |
| --- | --- |
| uses a network tool | `\b(curl\|wget\|ssh\|scp\|sftp\|rsync\|nc\|ncat\|netcat\|telnet\|ftp\|invoke-webrequest\|iwr\|invoke-restmethod\|irm\|start-bitstransfer\|certutil\|bitsadmin)\b` |
| references a URL | `\bhttps?:\/\/` |
| talks to a git remote | `\bgit\s+(push\|clone\|fetch\|pull\|remote\|submodule)\b\|\bgh\s` |
| installs packages | `\b(npm\|pnpm\|yarn\|bun)\s+(i\|install\|add\|create\|dlx\|x)\b\|\b(npx\|bunx\|uvx\|pipx)\b\|\b(pip\|pip3\|uv)\s+(install\|add)\b\|\bcargo\s+(install\|add)\b\|\bgo\s+(get\|install)\b\|\b(brew\|apt\|apt-get\|choco\|winget\|scoop)\s+install\b` |
| runs containers | `\bdocker\s+(run\|pull\|build\|exec)\b` |
| deletes files | `\b(rm\|rmdir\|del\|erase\|rd\|remove-item\|unlink\|shred\|truncate)\b` |
| stops processes | `\b(kill\|pkill\|taskkill\|stop-process)\b` |

A command is also high when one of its arguments is a path outside the project: `~`, a `..` segment, or an absolute path that does not resolve inside the working directory.

### Low

A command is low when it has no output redirection and every segment between `&&`, `||`, `;` and `|` is read-only:

- one of `ls`, `dir`, `cat`, `type`, `head`, `tail`, `grep`, `rg`, `fd`, `wc`, `pwd`, `echo`, `which`, `where`, `tree`, `stat`, `file`, `du`, `df`, `date`, `sort`, `uniq`, `cut`, `jq`, `cd`, `true`, `test`, `get-childitem`, `get-content`, `select-string`, `get-location`
- `git` followed by one of `status`, `diff`, `log`, `show`, `branch`, `rev-parse`, `ls-files`, `blame`, `describe`, `shortlog`
- `find` without `-exec`, `-ok` or `-delete`
- `sed -n` without `-i`
- any program called with only `--version`, `-v`, `-V` or `--help`

### Medium

Every other command.

## File access

| Request | Tier |
| --- | --- |
| Any path matching the credential pattern (the first critical rule above) | `critical` |
| Writing under `.git/` or `.github/workflows/` | `critical` |
| Writing outside the project | `high` |
| Writing inside the project | `medium` |
| Reading outside the project | `medium` |
| Reading inside the project | `low` |

## Other requests

Network fetches and anything an adapter cannot map to a shell command or a file path are `medium`. That includes every MCP tool call, whatever the tool is called.

A request with no effect outside the conversation, such as the agent asking the user a question, is `low`.
