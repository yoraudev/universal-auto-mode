# Universal Auto Mode

## Tech Stack

- **Language:** JavaScript (ES modules)
- **Runtime:** Node.js (daemon), the host agent's plugin runtime (adapters)
- **Layout:** `daemon/` (local service), `adapters/` (one directory per harness, plus `shared/` for code every adapter uses), `bench/` (classifier benchmark), `e2e/`, `test/`, `scripts/`
- **Classifier:** Horizon-Labs/prompt-injection-guard (`base` by default, `small` optional), quantized ONNX
- **Inference:** `onnxruntime-node` on CPU by default, optionally on a GPU through its DirectML, WebGPU, CUDA or CoreML providers; tokenizer from `@huggingface/transformers`
- **Daemon ↔ adapter transport:** HTTP with JSON bodies on `127.0.0.1`
- **OpenCode adapter:** `@opencode/plugin` 2.x (Promise plugin API for the server part, terminal UI plugin API with Solid JSX for the settings command)
- **Pi adapter:** a Pi extension in plain JavaScript (`tool_call` and `tool_result` events, `/auto-mode` command), loaded by Pi without a build step
- **Codex CLI adapter:** command hooks in plain JavaScript (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest` and `PostToolUse`), one Node.js process per event, registered in `~/.codex/hooks.json` by an install script
- **Tests:** `node:test` (unit), a scripted run against a real daemon (end-to-end)
- **CI / releases:** GitHub Actions

## Project Rules

- Every file in the repository is written in English: code, identifiers, user-facing strings, documentation and commit messages. The only exception is attack samples in other languages inside `bench/payloads.mjs`, which exist to test multilingual detection.
- Commit messages follow Conventional Commits: `type(scope): description`, with types such as `feat`, `fix`, `chore`, `docs`, `refactor`, `test` and `ci`. Mark breaking changes with `!` after the type. Keep the subject line short and make it the best single description of the change; put the details in the commit body, written out in full.
- Commits, pull requests and anything else published to the repository carry only the repository owner's name and email. Never add AI or tool attribution: no `Co-Authored-By` trailers, no "Generated with" lines, no assistant names as author or committer.
- Do not write comments. Every hand-written file (anything that is not auto-generated) stays free of code comments, including config files such as YAML and `.gitattributes`.
- Whenever something is added to, changed in, or removed from the project, every `.md` file that references it must be updated in the same change.
