# Security

## What this plugin does

Registers one `uia` tool that lets the model drive the Windows UI Automation
exe (`cnyc6n/uia-agent`). The exe itself is **embedded as base64** in this
package (`assets/uia_agent.exe.b64`) together with its SHA-256
(`assets/uia_agent.exe.sha256`), so installation and use are fully **offline**.

## exe integrity

`ensureExe()` runs on every plugin start and before every call:

- reads the embedded b64 + declared sha256
- if `%DSH_HOME%\bin\uia_agent.exe` exists, compares its sha256 with the declared
  one: a match keeps it (respects a hand-placed same-version exe); a mismatch
  (stale / tampered / different build) triggers an overwrite from the embedded
  asset
- after writing, recomputes the hash and verifies it against the declared one;
  a mismatch is an error, never a silent run

This means a tampered or stale binary is **always replaced** by the package's
own verified copy — the model never executes an unverified exe.

## Permission tiers (enforced through dsh's approval service)

| Tier | Commands | Enforcement |
|---|---|---|
| read-only | list / snapshot / snapshot_all / find / get_text / screenshot | runs directly |
| workspace-write | minimize / maximize / restore / topmost / close | requires `sandbox_permissions=workspace-write` + `justification`, goes through `ctx.approval` (approveEscalation) |
| danger-full-access | click / set_text / scroll / drag / swipe | requires `sandbox_permissions=danger-full-access` + `justification`, user approval required |

Missing or mismatched permission returns an error; nothing high-risk executes
without user approval. If no approval service is composed, high-risk commands
fail closed.

## Responsibility split

- **This plugin** is responsible for: permission tiers, routing high-risk calls
  through user approval, verifying the embedded exe's hash before release, and
  spawning the exe at the fixed location.
- **The tool repo** (`cnyc6n/uia-agent`) is responsible for correct automation
  implementation and reproducible builds with committed sha256 assets.
- **The user** decides what to approve. Approving `click`/`set_text`/`drag`/
  `swipe` means accepting that real mouse/keyboard input will be injected into
  the desktop session.

## Boundaries / limitations

- UIPI: a non-elevated dsh cannot reach elevated (admin) windows; the plugin
  surfaces `elevated_requires_admin` from the exe instead of hiding the failure.
- The exe runs with the privileges of the dsh process. Running dsh as
  administrator expands what `uia` can touch — only do that if you trust the
  session's prompts.
- `screenshot` uses PrintWindow; some DRM / self-drawn windows may capture black
  (system limitation, reported as `capture_failed`).

## Reporting

For security issues, open a private advisory or a GitHub issue marked
`security`. Do not publish exploit details publicly before a fix ships.
