# dsh-uia-agent 一键安装（新手版，自包含）
# 只运行本脚本即可：检测 dsh → 安装插件 → 提示重启。
# 无需编译、无需访问 GitHub 下载 exe（插件包内嵌 b64，启动时自动释放+校验）。
# 用法： powershell -ExecutionPolicy Bypass -File install.ps1   （或双击 install.cmd，两者独立可用）
param(
    [string]$ProfileName = "web"
)

# 当前发布版本（发 release 时同步改这里——两个值配套，npm 号与 GitHub tag 对应）
$GITHUB_REF = "v1.2.2"      # GitHub tag
$NPM_REF = "1.2.0"        # npm 版本（对应 GitHub v1.2 的发布）
$ErrorActionPreference = 'Stop'

function Say($msg) { Write-Host "[dsh-uia-agent] $msg" -ForegroundColor Cyan }
function Warn($msg) { Write-Host "[dsh-uia-agent] ! $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host "[dsh-uia-agent] X $msg" -ForegroundColor Red; exit 1 }

Say "=== dsh-uia-agent one-click install ==="

# 1) locate dsh
$dsh = Get-Command dsh -ErrorAction SilentlyContinue
if (-not $dsh) {
    $cands = @(
        (Join-Path $env:APPDATA 'npm\dsh.cmd'),
        (Join-Path $env:APPDATA 'npm\dsh.ps1'),
        (Join-Path $env:USERPROFILE 'npm\dsh.cmd')
    )
    $found = $cands | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $found) {
        Fail "dsh not found. Install DeepSeek Harness first: npm i -g @deepseek-ai/dsh"
    }
    $dshPath = $found
} else {
    $dshPath = $dsh.Source
}
Say "dsh found: $dshPath"

# 2) node version (informational)
try { Say "Node: $(node -v 2>&1)" } catch { Warn "node check skipped" }

# 3) install the plugin: try GitHub (pinned tag) first, fall back to npm (pinned version)
Say "Adding plugin to profile '$ProfileName' (GitHub ref=$GITHUB_REF / npm=$NPM_REF) ..."
& $dshPath plugin --profile $ProfileName add "github:cnyc6n/dsh-uia-agent#$GITHUB_REF"
if ($LASTEXITCODE -ne 0) {
    Warn "GitHub install failed (exit=$LASTEXITCODE), trying npm ..."
    & $dshPath plugin --profile $ProfileName add "dsh-uia-agent@$NPM_REF"
    if ($LASTEXITCODE -ne 0) { Fail "Both GitHub and npm install failed. Check network (GitHub/npm reachable)." }
}
Say "Plugin added to profile '$ProfileName' (version pinned: $GITHUB_REF / $NPM_REF)"

# 4) next steps
Say ""
Say "Done! Next steps:"
Say "  1) Restart dsh (dsh --profile $ProfileName)"
Say "  2) On first start the plugin auto-releases uia_agent.exe to %DSH_HOME%\bin\ with hash check"
Say "  3) Ask the model to use the 'uia' tool (window automation)"
Say "     - read-only (list/snapshot/find/get_text/screenshot) run directly"
Say "     - window-state (minimize/topmost/close) and input (click/set_text/scroll/drag/swipe) need approval"
Say ""
Say "Uninstall: dsh plugin --profile $ProfileName remove dsh-uia-agent"
Say "Re-release exe: delete %DSH_HOME%\bin\uia_agent.exe and restart dsh (auto re-released)"