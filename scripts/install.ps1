# dsh-uia-agent install: release the exe to a fixed location.
# The plugin tools always call this fixed path, so updating is just re-running this script.
# 固定位置: %DSH_HOME%\bin\uia_agent.exe  (DSH_HOME 缺省 ~\.dsh)
$ErrorActionPreference = 'Stop'

$homeDir = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$binDir  = Join-Path $homeDir 'bin'
$target  = Join-Path $binDir 'uia_agent.exe'

# GitHub Release 上的主工具 exe（仓库可自定义：-Repo owner/repo）
$repo = if ($env:UIA_AGENT_REPO) { $env:UIA_AGENT_REPO } else { 'cnyc6n/dsh-uia-agent' }

function Get-GitHubReleaseExe {
    param([string]$Repo)
    $releaseUrl = "https://api.github.com/repos/$Repo/releases/latest"
    try {
        $rel = Invoke-RestMethod -Uri $releaseUrl -Headers @{ 'User-Agent' = 'dsh-uia-agent-install' }
    } catch {
        Write-Warning "无法读取 GitHub release：$($_.Exception.Message)"
        return $null
    }
    $asset = $rel.assets | Where-Object { $_.name -eq 'uia_agent.exe' } | Select-Object -First 1
    if (-not $asset) {
        Write-Warning "release 中未找到 uia_agent.exe 资产（assets: $($rel.assets.name -join ', ')）"
        return $null
    }
    $exe = Join-Path $env:TEMP 'uia_agent.exe'
    try {
        Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $exe -Headers @{ 'User-Agent' = 'dsh-uia-agent-install' }
        Write-Output "已从 GitHub release 下载: $($asset.browser_download_url)"
        return $exe
    } catch {
        Write-Warning "下载失败：$($_.Exception.Message)"
        return $null
    }
}

# exe 来源优先级：1) 参数 / 环境变量  2) 本地构建产物（插件目录或相邻 build）  3) GitHub release
$source = $null
if ($args -and $args.Count -gt 0 -and $args[0]) {
    $source = $args[0]
}
if (-not $source) { $source = $env:UIA_AGENT_EXE }
if (-not $source -or -not (Test-Path $source)) {
    # 本仓库是 monorepo：uia_agent C++ 源码在插件目录的上一级，构建产物在 ../build/
    $repoRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent   # plugin/scripts -> plugin -> 仓库根
    $candidates = @(
        (Join-Path $repoRoot 'build\uia_agent.exe'),
        (Join-Path $PSScriptRoot '..\uia_agent.exe'),
        (Join-Path $PSScriptRoot '..\build\uia_agent.exe')
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { $source = $c; break }
    }
}
if (-not $source -or -not (Test-Path $source)) {
    Write-Output "本地未找到已构建的 uia_agent.exe，尝试从 GitHub release 获取..."
    $source = Get-GitHubReleaseExe -Repo $repo
}
if (-not $source -or -not (Test-Path $source)) {
    Write-Error "uia_agent.exe 不可用。请任选其一：`n  - 构建 C++ 源码后重跑（仓库根 build.ps1）`n  - 传 exe 路径给本脚本：  install.ps1 D:\path\to\uia_agent.exe`n  - 设置 UIA_AGENT_EXE 环境变量指向 exe`n  - 先往 GitHub release 上传 uia_agent.exe 资产"
    exit 1
}

New-Item -ItemType Directory -Path $binDir -Force | Out-Null
Copy-Item -Path $source -Destination $target -Force

Write-Output ("uia_agent.exe -> {0}  ({1:N0} bytes)" -f $target, (Get-Item $target).Length)
Write-Output ("source           -> {0}" -f $source)

# 自检：能跑起来
& $target --help *> $null
if ($LASTEXITCODE -eq 0) {
    Write-Output 'smoke: uia_agent --help OK'
} else {
    Write-Output "smoke: exit code $LASTEXITCODE"
}
exit 0