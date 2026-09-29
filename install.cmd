@echo off
REM ====================================================
REM  dsh-uia-agent one-click installer (self-contained).
REM  Double-click this file. No install.ps1 needed.
REM  Single-line PowerShell -Command, no cmd escaping.
REM ====================================================

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $dsh = Get-Command dsh -ErrorAction SilentlyContinue; if (-not $dsh) { $c = @($env:APPDATA+'\npm\dsh.cmd', $env:APPDATA+'\npm\dsh.ps1', $env:USERPROFILE+'\npm\dsh.cmd'); $d = $c | Where-Object { Test-Path $_ } | Select-Object -First 1; if (-not $d) { Write-Host '[dsh-uia-agent] X dsh not found. Install DeepSeek Harness first: npm i -g @deepseek-ai/dsh' -ForegroundColor Red; exit 1 }; $dshCmd = $d } else { $dshCmd = 'dsh' }; $m = '[dsh-uia-agent] dsh found: ' + $dshCmd; Write-Host $m -ForegroundColor Cyan; $ref = 'v1.1'; try { $nref = (npm view dsh-uia-agent version 2>$null) } catch { $nref = 'latest' }; if (-not $nref) { $nref = 'latest' }; Write-Host ('[dsh-uia-agent] Adding plugin to profile web (github #' + $ref + ' / npm ' + $nref + ') ...') -ForegroundColor Cyan; & $dshCmd plugin --profile web add ('github:cnyc6n/dsh-uia-agent#' + $ref); if ($LASTEXITCODE -ne 0) { Write-Host ('[dsh-uia-agent] GitHub install failed (exit=' + $LASTEXITCODE + '), trying npm ...') -ForegroundColor Yellow; & $dshCmd plugin --profile web add ('dsh-uia-agent@' + $nref); if ($LASTEXITCODE -ne 0) { $m2 = '[dsh-uia-agent] X Both GitHub and npm install failed.'; Write-Host $m2 -ForegroundColor Red; exit 1 } }; Write-Host '[dsh-uia-agent] Done! Restart dsh (dsh --profile web). On first start the plugin auto-releases uia_agent.exe with hash check. Ask the model to use the uia tool.' -ForegroundColor Green"

echo.
pause