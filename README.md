# dsh-uia-agent - Windows UI Automation agent for DeepSeek Harness

> **[中文](./README.zh.md) | English**

A dsh plugin that registers one `uia` tool, letting the model enumerate windows,
snapshot UI trees, find controls, click, type text, scroll/drag/swipe, screenshot,
and control window state (topmost / minimize / maximize / restore / close).

- Tool exe lives in its own repo: **[uia-agent](https://github.com/cnyc6n/uia-agent)**
  (C++17 / MSVC single exe; the release ships `uia_agent.exe`).
- This plugin embeds the exe as a base64 asset (`assets/uia_agent.exe.b64`) and
  self-releases it to the fixed location `%DSH_HOME%\bin\uia_agent.exe` on startup.
  If release fails, it console.errors and the tool call reports how to add the exe.

## One-click install (beginners)

Either of these two self-contained files installs everything. Download ONE of them
from the repo root or from the **[v1.0 release](https://github.com/cnyc6n/dsh-uia-agent/releases)** page (they do not depend on each other):

- **install.cmd** — double-click it on Windows
- **install.ps1** — `powershell -ExecutionPolicy Bypass -File install.ps1`

The script checks dsh, runs `dsh plugin --profile web add github:cnyc6n/dsh-uia-agent`,
and tells you to restart. No compile, no exe download: the plugin embeds the exe
as base64 and self-releases it (hash-verified) on first start.

## Install from npm

```powershell
npm i -g dsh-uia-agent
# then point dsh's profile at it (or follow the one-command install below for github:)
```

Published versions: **1.1.0** (latest), **1.0.0** (legacy tag).

## Changelog

### 1.2.1
- **desktop** gains `--limit` (max icons returned; 0 = all) and `--name` (substring filter) — see every icon without truncation

### 1.2.0
- **desktop** command: auto-find the desktop icon host (Progman + WorkerW layouts) and list all icons with screen coords
- **global timeout** param: every command accepts `timeout` (ms) forwarded to the exe
- fixed: FindDesktopIconHost only checked WorkerW (missed Progman layout)


### 1.1.0 (latest)
- **geometry / props** commands (window geometry read/write; control properties)
- **drag** `steps` / `hold_ms` for precise drag control
- **send_keys / clipboard / wait_for / foreach** commands
- **snapshot** inlines the control tree into model text
- **screenshot** returns the saved file path (model chooses how to view)
- permission model: commands at or below the session permission run directly
- fixed: raw output always an object, get_text missing-field fallback

### 1.0.0
- Initial standalone release: list / snapshot / snapshot_all / find / click /
  set_text / get_text / scroll / drag / swipe / screenshot / window state
  (topmost / minimize / maximize / restore / close)
- permission tiers + approval escalation, embedded exe self-release (sha256-verified)

## One-command install (manual)

```powershell
dsh plugin --profile web add github:cnyc6n/dsh-uia-agent
```

Restart dsh afterwards; the `uia` tool then enters the model tool set. The exe is
self-released by the plugin on startup - no manual build needed.

## Permission tiers & escalation

Aligned with the dsh sandbox model (same `sandbox_permissions` + `justification`
+ `ctx.approval` surface as the pwsh tool):

| Tier | sandbox_permissions | commands |
| --- | --- | --- |
| read-only | none (runs directly) | list / snapshot / snapshot_all / find / get_text / screenshot |
| workspace-write | `workspace-write` | minimize / maximize / restore / topmost / close |
| danger-full-access | `danger-full-access` | click / set_text / scroll / drag / swipe / send_keys / foreach |

Higher-tier commands must pass `sandbox_permissions` + `justification`; they go
through user approval (approveEscalation) before execution. Missing or mismatched
permission returns an error guiding the model to retry with the correct tier.

## `uia` tool parameters

`command` (enum of 20 actions), `hwnd`, `depth`, `query` (find JSON), `text`, `keys`, `set`, `timeout_ms`, `interval_ms`, `cmd`, `args`,
`mode`, `x/y/x1/y1/x2/y2`, `duration`, `amount`, `direction`, `distance`, `out`,
`base64`, `off`, plus escalation params `sandbox_permissions` / `justification`.

The model gets a short summary text; the structured raw result is persisted via
`presentationMeta`.

## Tested environment

- `@deepseek-ai/dsh-tools` **0.1.5-rc.3** (host deps resolve via the
  `$DSH_HOME/profiles/node_modules` fallback)
- Node.js 24 (dsh requires 22+)
- Windows 10 x64 + MSVC 2022 (exe build)

## Development / self-check

```powershell
node smoke.mjs                     # no-LLM smoke: module load + tool def + apply
powershell -ExecutionPolicy Bypass -File scripts/install.ps1   # manual exe release
```

## Known limits

- Self-drawn UI / games / DirectX / stock Qt expose no UIA tree (`snapshot` returns
  unsupported; fall back to `screenshot` + image recognition).
- Elevated windows require the exe to run as administrator, else UIPI blocks.
- Chromium/Electron disable accessibility by default; the first access may be empty.
- UIA calls may hang: the exe has a built-in 5s timeout; tool spawn timeout is 15s.
- PrintWindow may return black for some DRM / self-drawn windows (`capture_failed`).
