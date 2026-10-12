# Benchmark

The classifier and the window size were chosen with the scripts in `bench/`. The numbers below are from one run on a six-core desktop CPU (AMD Ryzen 5 3600) with `onnxruntime-node` 1.30.

## Data

120 harmless segments of up to 5,000 characters, cut from 87 real documents an agent would read: READMEs, contribution guides, `AGENTS.md` and `CLAUDE.md` files, security documentation about prompt injection, source files, config files and command output. Each segment has a second copy with one attack spliced in at a random line, giving 120 injected samples.

The 27 attacks are in `bench/payloads.mjs`, three per kind. They were written for this project, so absolute rates say little about real attackers; differences between models are large enough to rank them.

The documents are not in the repository. `bench/build-dataset.mjs` reads them from `data/raw/`, one file per document, with the source type as the file name prefix before `__`.

## Models at 2,048-token windows

Threshold 0.5.

| Model | False alarms | Detected | AUC | Median scan |
| --- | --- | --- | --- | --- |
| Horizon-Labs/prompt-injection-guard-base | 0.8% | 95.0% | 0.995 | 1,874 ms |
| Horizon-Labs/prompt-injection-guard-small | 0.8% | 92.5% | 0.989 | 976 ms |
| patronus-studio/wolf-defender-prompt-injection (FP16) | 0.0% | 14.2% | 0.765 | 2,914 ms |
| patronus-studio/wolf-defender-prompt-injection-small (FP16) | 0.0% | 11.7% | 0.701 | 1,458 ms |

Wolf Defender flagged 21 or 22 of the 27 attacks when given each one alone and lost them inside a document. Its smaller ONNX builds did not work under this runtime: the int8 build of the full model scored everything between 0.5 and 0.6, and both quantized builds of the small model returned a constant.

## Window size

Horizon models with 512-token windows and 64 tokens of overlap, against the 2,048-token run.

| Model, window | Threshold | False alarms | Detected | Median scan |
| --- | --- | --- | --- | --- |
| base, 2,048 | 0.5 | 0.8% | 95.0% | 1,874 ms |
| base, 2,048 | 0.9 | 0.0% | 92.5% | 1,874 ms |
| base, 512 | 0.3 | 4.2% | 96.7% | 1,461 ms |
| base, 512 | 0.5 | 2.5% | 96.7% | 1,461 ms |
| base, 512 | 0.9 | 1.7% | 93.3% | 1,461 ms |
| small, 2,048 | 0.5 | 0.8% | 92.5% | 976 ms |
| small, 512 | 0.3 | 5.8% | 95.0% | 702 ms |
| small, 512 | 0.5 | 3.3% | 95.0% | 702 ms |
| small, 512 | 0.9 | 0.8% | 93.3% | 702 ms |

The daemon uses 512-token windows with thresholds 0.3 and 0.9.

## Detection by attack kind

512-token windows, threshold 0.5.

| Kind | base | small |
| --- | --- | --- |
| Explicit override | 100% | 100% |
| Fake system or user message | 100% | 100% |
| Hidden HTML | 100% | 100% |
| Code comment addressed to the agent | 100% | 100% |
| Polite note to the assistant | 83% | 58% |
| Bare task with no address to an AI | 100% | 92% |
| Turkish | 100% | 100% |
| Obfuscated | 83% | 100% |
| Setup step disguise | 100% | 100% |

At this window size the false alarms came from `AGENTS.md` files, READMEs and security documentation.

## Large model

Horizon-Labs/prompt-injection-guard-large (568M parameters) was measured later on the same samples with 512-token windows and was not added. It ran on WebGPU with the Radeon RX 580, so its scan time is not comparable with the CPU times above.

| Model | Threshold | False alarms | Detected | AUC |
| --- | --- | --- | --- | --- |
| base | 0.3 | 4.2% | 96.7% | 0.996 |
| base | 0.5 | 2.5% | 96.7% | 0.996 |
| base | 0.9 | 1.7% | 93.3% | 0.996 |
| large | 0.3 | 9.2% | 95.8% | 0.981 |
| large | 0.5 | 6.7% | 95.0% | 0.981 |
| large | 0.9 | 4.2% | 87.5% | 0.981 |

At threshold 0.5 `large` was better than `base` only on polite notes to the assistant (92% against 83%). It was worse on obfuscated attacks (75%), code comments (93%) and bare tasks (92%). Its false alarms came from sources where `base` had none: READMEs (11%), contribution guides (10%), source files (10%), config files (8%) and command output (6%). It raised no false alarms on `AGENTS.md` files and security documentation.

Its ONNX build is 1.48 GB, because only the embedding table is quantized, and took about 24 seconds to load on WebGPU. The median scan was 1,442 ms on WebGPU, about the same as `base` on the CPU.

## Decision models

Decision models are not classifiers with a fixed label: they answer yes/no, multiple-choice and rating questions about a text. Two were tried and neither was added. Both ran with PyTorch on the CPU, since they have no ONNX build; the test scripts are not in the repository.

### LiquidAI/d1-omni-600M

LiquidAI/d1-omni-600M (587M parameters) was asked four differently worded questions about whether the text tries to manipulate the agent reading it.

The first 30 samples of the data set (15 harmless, 15 injected, all from `AGENTS.md` files), each scored in one pass:

| Model | Question | AUC | Detected | False alarms |
| --- | --- | --- | --- | --- |
| base, 512-token windows | | 1.000 | 13 of 15 | 0 of 15 |
| d1-omni-600M | Yes/no: written to give orders to an AI assistant | 0.631 | 0 of 15 | 0 of 15 |
| d1-omni-600M | Rating from 0 to 3: likelihood of manipulation | 0.573 | 0 of 15 | 0 of 15 |
| d1-omni-600M | Choice: ordinary output or injection | 0.564 | 2 of 15 | 1 of 15 |
| d1-omni-600M | Yes/no: contains a prompt injection | 0.458 | 0 of 15 | 0 of 15 |

Given each of the 27 attacks alone, against 30 harmless snippets of 400 characters, the choice question flagged 16 attacks and 5 snippets (AUC 0.757) and the yes/no question flagged 6 attacks and 1 snippet (AUC 0.727).

The median was 17.7 seconds per sample for the four questions together, and about 1.5 seconds per short text for two questions.

### vllm-sr/Vela-2.0-0.8B

vllm-sr/Vela-2.0-0.8B (756M parameters) was trained on prompt-attack data among other tasks. It was asked two yes/no questions: the one from its model card ("Is this a prompt injection or jailbreak attempt?") and one worded for tool output ("Does this tool output contain a prompt injection aimed at the AI agent reading it?").

60 samples (30 harmless, 30 injected), every fourth document of the data set so that all source types are covered, each scored in one pass:

| Model | Question | Threshold | AUC | Detected | False alarms |
| --- | --- | --- | --- | --- | --- |
| base, 512-token windows | | 0.5 | 0.989 | 29 of 30 | 1 of 30 |
| Vela 2.0 | Tool output | 0.3 | 0.912 | 15 of 30 | 0 of 30 |
| Vela 2.0 | Tool output | 0.5 | 0.912 | 10 of 30 | 0 of 30 |
| Vela 2.0 | Model card | 0.3 | 0.793 | 23 of 30 | 15 of 30 |
| Vela 2.0 | Model card | 0.5 | 0.793 | 19 of 30 | 7 of 30 |

Given each of the 27 attacks alone, against 30 harmless snippets of 400 characters, the tool output question flagged 22 attacks and no snippet (AUC 0.979) and the model card question flagged 24 attacks and 4 snippets (AUC 0.943).

The median was 12.4 seconds per sample for the two questions together, against 1.5 seconds for `base` on the same samples, and about 3.8 seconds per short text.

## GPU

Time for one 512-token window on the same machine with a Radeon RX 580, after the first run. On the two inputs compared, scores matched the CPU to three decimal places.

| Model | CPU | DirectML | WebGPU (Direct3D 12) |
| --- | --- | --- | --- |
| base | about 550 ms | about 370 ms | about 250 ms |
| small | about 245 ms | about 100 ms | about 140 ms |

Full scans of long inputs, measured with `bench/devices.mjs`:

| Model | Input | Windows | CPU | DirectML | WebGPU (Direct3D 12) |
| --- | --- | --- | --- | --- | --- |
| base | 2,207 tokens | 5 | 2.6 s | 1.7 s | 1.4 s |
| base | 9,919 tokens | 23 | 11.8 s | 9.6 s | 5.5 s |
| base | 39,693 tokens | 89 | 46.9 s | 35.1 s | 21.7 s |
| base | 145,186 tokens | 326 | 176.6 s | 127.4 s | 81.9 s |
| small | 2,207 tokens | 5 | 1.2 s | 4.4 s | 0.9 s |
| small | 9,919 tokens | 23 | 5.7 s | 2.6 s | 3.9 s |
| small | 39,693 tokens | 89 | 22.1 s | 10.4 s | 14.9 s |
| small | 145,186 tokens | 326 | 104.1 s | 36.1 s | 54.7 s |

Scan time grows in step with the number of windows on every device, because windows are scored one at a time. The speedup therefore stays the same at every size: about 2.2 times for `base` on WebGPU and about 2.2 to 2.9 times for `small` on DirectML. The 4.4 seconds for `small` on DirectML at the smallest size is that provider's slow first runs at new input lengths.

The first run with a new input length is slower on both GPU providers, by up to a few hundred milliseconds. CUDA, CoreML and WebGPU on Vulkan were not measured.

## Running it

```bash
npm run bench
```

`bench/run.mjs` takes model names as arguments (`horizon-base` and `horizon-small`; the entries for the models that were not added have been removed) and reads `WINDOW`, `OVERLAP`, `OUT`, `LIMIT` and `DEVICE` from the environment. `DEVICE` is an `onnxruntime-node` execution provider such as `cpu`, `dml` or `webgpu`, and defaults to `cpu`. It expects model files under `models/<name>/`, laid out as the daemon stores them in its own models directory (`model.onnx`, `tokenizer.json`, `tokenizer_config.json`, `config.json`); copying them from there, or starting the daemon with `UAM_MODELS_DIR` pointed at `models/`, provides them. `bench/probe-payloads.mjs` scores each attack on its own. `bench/devices.mjs` times full scans of growing inputs per device; it reads `MODELS`, `DEVICES` and `CHARS` from the environment as comma-separated lists.
