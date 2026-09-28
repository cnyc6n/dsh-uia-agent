/**
 * dsh-uia-agent - Windows UI Automation agent for dsh (permission-tiered).
 *
 * Registers one `uia` tool: the model passes command + args, the plugin spawns
 * the exe at the fixed location `%DSH_HOME%\bin\uia_agent.exe`, parses the
 * single-line UTF-8 JSON it prints, and returns a short summary to the model.
 *
 * Permission tiers (aligned with the dsh sandbox model):
 *   read-only            list / snapshot / snapshot_all / find / get_text / screenshot
 *   workspace-write      minimize / maximize / restore / topmost / close
 *   danger-full-access   click / set_text / scroll / drag / swipe
 * Higher-tier commands must pass `sandbox_permissions` + `justification` and
 * go through ctx.approval (approveEscalation) before execution - same
 * escalation mechanism as the pwsh tool.
 *
 * exe self-release: on apply, check the fixed exe path; if missing, decode the
 * embedded assets/uia_agent.exe.b64; on failure console.error + tool error.
 */
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { ESCALATION_TARGETS, approveEscalation, validateEscalationArgs } from '@deepseek-ai/dsh-sandbox'

export const name = 'dsh-uia-agent'
export const inject = ['tools', 'approval', 'systemPrompt']

const EXE_NAME = 'uia_agent.exe'

// exe spawn timeout in ms (configurable via plugin config spawnTimeoutMs; default 30s).
// Long drags (--duration) or huge UIA trees can exceed the old 15s budget.
let spawnTimeoutMs = 30_000

const COMMANDS = [
  'list', 'foreground', 'snapshot', 'snapshot_all', 'find', 'click', 'set_text',
  'get_text', 'scroll', 'drag', 'swipe', 'screenshot',
  'minimize', 'maximize', 'restore', 'topmost', 'close',
  'send_keys', 'clipboard', 'wait_for', 'foreach',
]

// command -> required tier (ascending: read-only < workspace-write < danger-full-access)
const COMMAND_LEVEL = {
  list: 'read-only',
  foreground: 'read-only',
  snapshot: 'read-only',
  snapshot_all: 'read-only',
  find: 'read-only',
  get_text: 'read-only',
  screenshot: 'read-only',
  minimize: 'workspace-write',
  maximize: 'workspace-write',
  restore: 'workspace-write',
  topmost: 'workspace-write',
  close: 'workspace-write',
  send_keys: 'danger-full-access',
  clipboard: 'read-only',
  wait_for: 'read-only',
  foreach: 'danger-full-access',
  click: 'danger-full-access',
  set_text: 'danger-full-access',
  scroll: 'danger-full-access',
  drag: 'danger-full-access',
  swipe: 'danger-full-access',
}

// tier -> sandbox_permissions value required for escalation
const LEVEL_TO_MODE = {
  'read-only': null,
  'workspace-write': 'workspace-write',
  'danger-full-access': 'danger-full-access',
}

// tier ordering for <= comparison: read-only(0) < workspace-write(1) < danger-full-access(2)
const tierIndex = { 'read-only': 0, 'workspace-write': 1, 'danger-full-access': 2 }

const READ_ONLY_COMMANDS = COMMANDS.filter(c => COMMAND_LEVEL[c] === 'read-only')
const WRITE_COMMANDS = COMMANDS.filter(c => COMMAND_LEVEL[c] === 'workspace-write')
const DANGER_COMMANDS = COMMANDS.filter(c => COMMAND_LEVEL[c] === 'danger-full-access')

// ---- fixed exe path ----
function exePath() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'bin', EXE_NAME)
}
function assetPath() {
  const here = dirname(fileURLToPath(import.meta.url))
  return join(here, '..', 'assets', `${EXE_NAME}.b64`)
}
// Returns the byte length of the embedded exe, or -1 if it cannot be released.
function sha256hex(buf) {
  return createHash('sha256').update(buf).digest('hex')
}
function assetDir() {
  const here = dirname(fileURLToPath(import.meta.url))
  return join(here, '..', 'assets')
}
function readEmbedded() {
  const b64Path = join(assetDir(), `${EXE_NAME}.b64`)
  const shaPath = join(assetDir(), `${EXE_NAME}.sha256`)
  if (!existsSync(b64Path)) return null
  const bytes = Buffer.from(readFileSync(b64Path, 'utf8').trim(), 'base64')
  if (bytes.length === 0) return null
  const expected = existsSync(shaPath)
    ? readFileSync(shaPath, 'utf8').trim().toLowerCase()
    : null
  return { bytes, expected }
}
// (kept for compat with ensureExe below)
function embeddedExeSize() {
  const asset = assetPath()
  try {
    if (!existsSync(asset)) {
      console.error(`[dsh-uia-agent] embedded asset missing: ${asset} (cannot self-release exe)`)
      return -1
    }
    const b64 = readFileSync(asset, 'utf8').trim()
    const bytes = Buffer.from(b64, 'base64')
    if (bytes.length === 0) {
      console.error('[dsh-uia-agent] embedded asset is empty; cannot release exe')
      return -1
    }
    return bytes.length
  } catch (err) {
    console.error(`[dsh-uia-agent] failed to read embedded asset: ${err?.message ?? err}`)
    return -1
  }
}
function writeEmbeddedExe() {
  const target = exePath()
  try {
    const b64 = readFileSync(assetPath(), 'utf8').trim()
    const bytes = Buffer.from(b64, 'base64')
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, bytes)
    console.log(`[dsh-uia-agent] released uia_agent.exe from embedded asset -> ${target} (${bytes.length} bytes)`)
    return existsSync(target)
  } catch (err) {
    console.error(`[dsh-uia-agent] failed to release exe: ${err?.message ?? err}`)
    return false
  }
}
// Version-aware ensure: if the fixed-path exe exists AND its size matches the
// embedded b64, keep it (respects a manually placed exe of the same version).
// If sizes differ, refresh from the embedded asset so b64 updates take effect.
function ensureExe() {
  const target = exePath()
  const embedded = readEmbedded()
  if (!embedded) {
    console.error('[dsh-uia-agent] embedded asset missing; cannot self-release')
    return existsSync(target) ? target : ''
  }
  const { bytes, expected } = embedded

  // exists: compare sha256 (hand-placed / stale / tampered -> overwrite)
  if (existsSync(target)) {
    const cur = sha256hex(readFileSync(target))
    if (expected && cur === expected) return target // same version, keep
  }

  // release (or refresh)
  try {
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, bytes)
    const got = sha256hex(readFileSync(target))
    if (expected && got !== expected) {
      console.error(`[dsh-uia-agent] hash mismatch after release: got ${got}, want ${expected}`)
      return existsSync(target) ? target : ''
    }
    console.log(`[dsh-uia-agent] released ${EXE_NAME} -> ${target} (${bytes.length} bytes, sha256=${got})`)
    return target
  } catch (err) {
    console.error(`[dsh-uia-agent] release failed: ${err?.message ?? err}`)
    return existsSync(target) ? target : ''
  }
}

// ---- arg translation / summarizer ----
const COMMAND_DESCRIPTIONS = {
  list: 'enumerate visible top-level windows (real Z-order): hwnd/title/class_name/pid',
  foreground: 'current foreground (keyboard-focus) top-level window: hwnd/title/class_name/pid',
  snapshot: 'UIA control-tree snapshot of one window (depth default 8)',
  snapshot_all: 'snapshot every visible top-level window (UIA -> Win32 fallback)',
  find: 'find nodes by JSON query: {"name":...,"automation_id":...,"control_type":"Edit","class_name":...}',
  click: 'click: --q semantic (InvokePattern) or --x/--y coordinate',
  set_text: 'write text (ValuePattern first, fallback click+Ctrl+A+type)',
  get_text: 'read control text',
  scroll: 'scroll (ScrollPattern or wheel), --amount positive = down',
  drag: 'coordinate drag: --x1 --y1 --x2 --y2 [--duration ms]',
  swipe: 'swipe inside control: --direction up|down|left|right [--distance px]',
  screenshot: 'window screenshot: --out PNG or --base64',
  minimize: 'minimize window',
  maximize: 'maximize window',
  restore: 'restore window',
  topmost: 'always-on-top (--off cancels)',
  close: 'send WM_CLOSE to close window',
  send_keys: 'send keyboard shortcut combo, e.g. ctrl+c / alt+tab (danger)',
  clipboard: 'clipboard: --set text (write) or --get (read)',
  wait_for: 'poll until a control matching --q appears (--timeout_ms default 5000, --interval_ms default 300)',
  foreach: 'run --cmd on every visible window with optional --args JSON',
}
function buildArgs(command, args) {
  const argv = [command]
  const add = (flag, value) => {
    if (value !== undefined && value !== null && value !== '') argv.push(flag, String(value))
  }
  if (args.hwnd !== undefined) add('--hwnd', args.hwnd)
  if (args.depth !== undefined) add('--depth', args.depth)
  if (args.query !== undefined && args.query !== '') argv.push('--q', args.query)
  if (args.text !== undefined) add('--text', args.text)
  if (args.mode !== undefined) add('--mode', args.mode)
  if (args.x !== undefined) add('--x', args.x)
  if (args.y !== undefined) add('--y', args.y)
  if (args.x1 !== undefined) add('--x1', args.x1)
  if (args.y1 !== undefined) add('--y1', args.y1)
  if (args.x2 !== undefined) add('--x2', args.x2)
  if (args.y2 !== undefined) add('--y2', args.y2)
  if (args.duration !== undefined) add('--duration', args.duration)
  if (args.amount !== undefined) add('--amount', args.amount)
  if (args.direction !== undefined) add('--direction', args.direction)
  if (args.distance !== undefined) add('--distance', args.distance)
  if (args.out !== undefined && args.out !== '') add('--out', args.out)
  if (args.base64 === true) argv.push('--base64')
  if (args.off === true && command === 'topmost') argv.push('--off')
  if (args.keys !== undefined) add('--keys', args.keys)
  if (args.set !== undefined) add('--set', args.set)
  if (args.timeout_ms !== undefined) add('--timeout_ms', args.timeout_ms)
  if (args.interval_ms !== undefined) add('--interval_ms', args.interval_ms)
  if (args.cmd !== undefined) add('--cmd', args.cmd)
  if (args.args !== undefined && args.args !== '') add('--args', args.args)
  return argv
}
function summarize(command, json) {
  const j = json
  if (!j || j.ok === false) {
    return j && j.err ? `uia ${command} failed: ${j.err}` : `uia ${command} failed (unparsable output)`
  }
  switch (command) {
    case 'foreground':
      return `foreground window: ${j.hwnd} ${j.title} [${j.class_name}] pid=${j.pid}${j.elevated ? ' (elevated)' : ''}`
    case 'list': {
      // C++ exe returns a bare array for `list`; {windows:[...]} is tolerated
      // for forward-compat. Keep both sides in sync.
      const list = Array.isArray(j) ? j : j.windows
      if (!Array.isArray(list)) return `uia list returned ${JSON.stringify(j)}`
      const lines = list.slice(0, 20).map(w => `${w.hwnd} ${w.title} [${w.class_name}] pid=${w.pid}`)
      return `${list.length} visible top-level windows (Z-order):\n` + lines.join('\n') +
        (list.length > 20 ? `\n... plus ${list.length - 20} more` : '')
    }
    case 'snapshot': {
      // inline the control tree so the model can actually 'see' the UI structure
      const tree = j.tree || {}
      const lines = []
      const walk = (node, depth) => {
        if (!node || lines.length >= 40) return
        const pad = '  '.repeat(depth)
        const r = node.rect
        const rectStr = r && r.cx > 0 ? ` rect=[${r.left},${r.top},${r.right},${r.bottom}]` : ''
        lines.push(`${pad}${node.control_type || '?'} '${node.name || ''}' aid=${node.automation_id || '-'}${rectStr}`)
        ;(node.children || []).forEach((ch) => walk(ch, depth + 1))
      }
      walk(tree, 0)
      return `window ${j.hwnd} snapshot: ${j.nodes} nodes (depth=${j.depth}):
` + lines.join('\n') +
        (lines.length >= 40 ? '\n... (truncated)' : '')
    }
    case 'snapshot_all': {
      const wins = j.windows || []
      const lines = wins.map(w => `${w.hwnd} [${w.backend}] ${w.state?.join(',') || ''} ${w.title}`.trim()).slice(0, 20)
      return `${wins.length} windows snapshotted:\n` + lines.join('\n')
    }
    case 'find':
      return `found ${j.count} nodes (walked ${j.walked}):\n` +
        (j.nodes || []).slice(0, 10).map(n =>
          `${n.control_type} '${n.name}' aid=${n.automation_id || '-'} rect=[${n.rect.left},${n.rect.top},${n.rect.right},${n.rect.bottom}]`
        ).join('\n')
    case 'click':
      return `clicked: ${j.method || j.mode} (${j.x ?? ''},${j.y ?? ''})`
    case 'set_text':
      return `text written: ${j.method || 'input_simulation'}`
    case 'get_text':
      return j.text !== undefined && j.text !== null
        ? `text: ${j.text}`
        : 'uia get_text returned no text field (element may not expose a value)'
    case 'scroll':
      return `scrolled: ${j.method} amount=${j.amount}`
    case 'drag':
      return `dragged: from [${j.from}] to [${j.to}], duration=${j.duration}ms`
    case 'swipe':
      return `swiped: ${j.direction}, distance ${j.distance}px`
    case 'screenshot': {
      // The dsh tool layer cannot push images into the model context directly.
      // Save to a file (pass out=...) and let the model read it with image_analyze.
      if (j.base64) {
        return `screenshot ${j.w}x${j.h} captured as base64 (${Math.round(j.base64.length * 3 / 4 / 1024)} KB). ` +
          'To actually see it, retry with out=<png path> so the file is saved, then use the image_analyze tool on that path.'
      }
      return `screenshot saved: ${j.path} (${j.w}x${j.h}). Read it with the image_analyze tool (path=${j.path}) to see the screen.`
    }
    case 'send_keys':
      return `keys sent: ${j.keys}`
    case 'clipboard':
      return j.mode === 'set' ? 'clipboard written' : `clipboard: ${j.text}`
    case 'wait_for':
      return `found ${j.found} node(s) after ${j.waited_ms}ms`
    case 'foreach':
      return `ran on ${(j.windows || []).length} windows`
    case 'minimize': case 'maximize': case 'restore': case 'close':
      return `window state changed: ${j.state}`
    case 'topmost':
      return `topmost state: ${j.state}`
    default:
      return JSON.stringify(j)
  }
}
function runUia(command, args) {
  const exe = ensureExe()
  if (!exe) {
    throw new Error(
      `uia ${command} cannot run: uia_agent.exe unavailable (self-release failed). ` +
      'Download uia_agent.exe from https://github.com/cnyc6n/uia-agent/releases to %DSH_HOME%\\bin\\ ' +
      'or build locally and run plugin scripts/install.ps1.',
    )
  }
  const argv = buildArgs(command, args)
  const res = spawnSync(exe, argv, { encoding: 'utf8', timeout: spawnTimeoutMs, windowsHide: true })
  if (res.error) {
    if (res.error.code === 'ETIMEDOUT') throw new Error(`uia ${command} timed out`)
    throw new Error(`uia ${command} execution failed: ${res.error.message}`)
  }
  const stdout = (res.stdout || '').trim()
  if (!stdout) {
    const stderr = (res.stderr || '').trim()
    throw new Error(`uia ${command} produced no output${stderr ? `: ${stderr}` : ''} (exit=${res.status})`)
  }
  let parsed
  try {
    parsed = JSON.parse(stdout)
  } catch {
    throw new Error(`uia ${command} output is not JSON: ${stdout.slice(0, 200)}`)
  }
  return parsed
}

const LEVEL_TEXT = {
  'read-only': 'read-only (enumerate/read/screenshot), no escalation',
  'workspace-write': 'window state changes (minimize/maximize/restore/topmost/close)',
  'danger-full-access': 'simulated input (click/type/scroll/drag/swipe)',
}

export function uiaTool(ctx) {
  return defineTool({
    name: 'uia',
    description:
      'Windows desktop UI automation. `command` picks the action; `hwnd` is the window handle (from uia list/snapshot_all); `query` is the find condition JSON. Coordinates are physical screen pixels. ' +
      `Permission tiers: read-only commands (${READ_ONLY_COMMANDS.join('/')}) run directly; ` +
      `window-state commands (${WRITE_COMMANDS.join('/')}) need sandbox_permissions=workspace-write + justification; ` +
      `input commands (${DANGER_COMMANDS.join('/')}) need sandbox_permissions=danger-full-access + justification. ` +
      'Higher-tier commands require sandbox_permissions + justification and user approval before executing.',
    parameters: {
      command: {
        type: 'string', required: true, enum: COMMANDS,
        description: 'action: ' + COMMANDS.map(c => `${c}(${LEVEL_TEXT[COMMAND_LEVEL[c]]})`).join('; '),
      },
      hwnd: { type: 'number', description: 'target window handle (hwnd field of uia list / snapshot_all)' },
      depth: { type: 'number', description: 'snapshot depth (default 8)' },
      query: { type: 'string', description: 'find condition JSON, e.g. {"control_type":"Edit"}; used by find/click/set_text/get_text/scroll/swipe' },
      text: { type: 'string', description: 'text to write for set_text' },
      mode: { type: 'string', enum: ['semantic', 'mouse'], description: 'click mode: semantic=InvokePattern first, mouse=coordinate click' },
      keys: { type: 'string', description: 'send_keys: shortcut combo like "ctrl+c" / "alt+tab" / "shift+f10"' },
      set: { type: 'string', description: 'clipboard: text to write when using --set; omit to read' },
      timeout_ms: { type: 'number', description: 'wait_for: max wait in ms (default 5000)' },
      interval_ms: { type: 'number', description: 'wait_for: poll interval in ms (default 300, min 50)' },
      cmd: { type: 'string', description: 'foreach: sub-command to run on each window (snapshot/close/find/...)' },
      args: { type: 'string', description: 'foreach: sub-command args as JSON object, e.g. {"depth":0}' },
      button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'mouse button for click (default left); right/middle for those clicks' },
      count: { type: 'number', description: 'click count: 1 (default) or 2 for double-click' },
      x: { type: 'number', description: 'click X (physical screen px)' },
      y: { type: 'number', description: 'click Y' },
      x1: { type: 'number', description: 'drag start X' },
      y1: { type: 'number', description: 'drag start Y' },
      x2: { type: 'number', description: 'drag end X' },
      y2: { type: 'number', description: 'drag end Y' },
      duration: { type: 'number', description: 'drag duration ms (default 300)' },
      amount: { type: 'number', description: 'scroll amount (positive = down, default 1)' },
      direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: 'swipe direction' },
      distance: { type: 'number', description: 'swipe distance px (default half of control size)' },
      out: { type: 'string', description: 'screenshot output PNG path' },
      base64: { type: 'boolean', description: 'screenshot as base64 (default when no --out)' },
      off: { type: 'boolean', description: 'topmost: true cancels always-on-top' },
      // escalation (same surface as the pwsh tool)
      sandbox_permissions: {
        type: 'string', enum: [...ESCALATION_TARGETS],
        description: 'permission needed for higher-tier commands: workspace-write (window state) or danger-full-access (simulated input). Must be paired with justification and goes through user approval.',
      },
      justification: {
        type: 'string',
        description: 'paired with sandbox_permissions: one sentence explaining why this command needs the wider access.',
      },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          text: { type: 'string', required: true },
          raw: { type: 'object', additionalProperties: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
      presentationMeta: (_args, value) => ({ kind: 'uia', command: _args.command, raw: value.raw }),
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const command = typeof args.command === 'string' ? args.command : ''
      if (!COMMANDS.includes(command)) {
        throw new Error(`uia: command must be one of ${COMMANDS.join('/')}`)
      }
      const level = COMMAND_LEVEL[command]
      const requiredMode = LEVEL_TO_MODE[level]

      // Current permission of this tool: 'never' session policy = user granted
      // full trust (danger-full-access); 'ask' = only read-only by default.
      const approver = ctx?.get?.('approval')
      const policy = approver?.effectivePolicy?.(exec?.agent?.session)
      const currentMode = policy === 'never' ? 'danger-full-access' : 'read-only'

      // Commands whose required tier <= current permission run directly,
      // with or without sandbox_permissions. Only needing MORE than current
      // permission requires sandbox_permissions + justification (+ approval in 'ask').
      if (tierIndex[requiredMode] > tierIndex[currentMode]) {
        validateEscalationArgs(args.sandbox_permissions, args.justification)
        if (args.sandbox_permissions !== requiredMode) {
          throw new Error(
            `uia ${command} requires ${requiredMode} permission but current is ${currentMode}. ` +
            `Pass sandbox_permissions="${requiredMode}" plus a justification to escalate.`,
          )
        }
        if (policy !== 'never') {
          if (!approver) throw new Error(`uia ${command} needs approval but no approval service is composed`)
          const outcome = await approveEscalation(
            {
              requestedMode: requiredMode,
              justification: args.justification,
              effectiveMode: currentMode,
              subject: 'command',
            },
            {
              approver,
              agent: exec?.agent,
              callId: exec?.callId,
              toolName: 'uia',
              signal: exec?.signal,
            },
          )
          if (outcome !== requiredMode) {
            throw new Error(`uia ${command} escalation to ${requiredMode} not approved (${outcome})`)
          }
        }
      }

      // read-only path needs no sandbox_permissions at all.

      const json = runUia(command, args)
      // keep raw an object for schema stability: wrap bare arrays (list) in { windows }
      const raw = Array.isArray(json) ? { windows: json } : json
      return { text: summarize(command, json), raw }
    },
    presentCall: () => ({ card: 'generic', title: 'Windows UI automation', kind: 'other' }),
    presentResult(_args, result) {
      if (result.isError) return undefined
      return { card: 'generic', title: `uia · ${_args.command}` }
    },
  })
}

export function apply(ctx, config = {}) {
  if (Number.isFinite(config.spawnTimeoutMs) && config.spawnTimeoutMs > 0) {
    spawnTimeoutMs = config.spawnTimeoutMs
  }
  ensureExe()
  ctx.systemPrompt.section({
    name: 'tool:uia',
    order: 200,
    text:
      `Use the \`uia\` tool for Windows desktop UI automation. Read-only commands (${READ_ONLY_COMMANDS.join('/')}) run without approval. ` +
      `Window-state commands (${WRITE_COMMANDS.join('/')}) and input commands (${DANGER_COMMANDS.join('/')}) require \`sandbox_permissions\` + \`justification\` and user approval. ` +
      'Always pick the narrowest sufficient permission tier. Coordinates are physical screen pixels.',
  })
  ctx.effect(() => ctx.tools.register(uiaTool(ctx)), 'dsh-uia-agent.tool')
}