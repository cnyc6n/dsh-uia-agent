# Release Checklist / 发布检查清单

> Keep both repos in sync. Run top-to-bottom; tick every box before tagging.
> 两个仓库同步发布，从上到下执行，打 tag 前必须全部勾选。

## 1. 工具仓库（cnyc6n/uia-agent）· 编译与资产

- [ ] 改完代码后 `build.ps1` 全量构建通过（0.4x MB 单 exe）
- [ ] 实测新功能（list/snapshot/find/click/set_text/... 全命令冒烟）
- [ ] `scripts/pack.ps1` 生成新 `assets/uia_agent.exe.b64` + `.sha256`
- [ ] `scripts/verify.ps1` 回环校验通过（b64 解码哈希 == sha256 文件）
- [ ] commit + push master（force 前先 fetch，避免覆盖 CI 资产提交）

## 2. 插件仓库（cnyc6n/dsh-uia-agent）· 同步与接入

- [ ] 新 exe 的 b64/sha256 复制进 `assets/`（保持与工具仓库一致）
- [ ] `lib/index.js` 接入新命令（COMMANDS / COMMAND_LEVEL / 描述 / summarize / 参数 / buildArgs）
- [ ] 插件语法 `node --check lib/index.js` 通过
- [ ] 插件端到端验证（mock never 策略：新命令直接执行）
- [ ] host 副本同步：`C:\Users\ysc\.dsh\profiles\web\node_modules\dsh-uia-agent\`
- [ ] 固定位置 exe：`C:\Users\ysc\.dsh\bin\uia_agent.exe`（哈希 == 新 b64）
- [ ] README（EN+ZH）更新：命令表 / 权限表 / 参数列表 / npm 段 / **Changelog（先于发布！）**

## 3. GitHub 发布

- [ ] 工具仓库打 tag `v1.<x>` + push → CI（release.yml）自动 build+pack+release
- [ ] CI 全绿（Build/Pack/Verify/Commit artifacts/Create release 全 success）
- [ ] 插件仓库打 tag `v1.<x>` + push
- [ ] 插件仓库建 release（install.cmd + install.ps1 资产）
- [ ] **release body 中英双语 changelog**（工具仓 + 插件仓都写）
- [ ] 清理旧 tag：只留 `v1.x` 主版本；中间 tag 用 `v1.x.y` 跟随最新 release

## 4. npm 发布（dsh-uia-agent）

- [ ] `package.json` version bump（主版本对齐 GitHub tag；同版本不可覆盖 → 用 patch）
- [ ] **README 含 Changelog 后再 publish**（教训：先改 README 再发，否则包内是旧版）
- [ ] `npm publish`（需 bypass-2FA token；普通 token 会 403）
- [ ] 历史版本用 `--tag legacy`（避免抢 latest）
- [ ] 等 npm 处理（PUT 202 后 ~2 分钟可见），registry API 验证 versions + dist-tags

## 5. 收尾验证

- [ ] `npm view dsh-uia-agent versions` 含全部预期版本
- [ ] 包内 README（EN+ZH）含 Changelog（`npm pack` + 解压检查）
- [ ] 固定位置 exe 哈希 == master sha256（重启 dsh 自动刷新）
- [ ] 重启 dsh 实测新命令（uia 工具 20+ 命令）

---

## 常见坑（踩过）

- **CI 会自动提交资产回 master**：本地 push 前先 `git fetch`，force 会覆盖 CI 提交
- **npm 同版本不可覆盖**：README/changelog 漏了就 bump patch 重发
- **npm tag 名不能是 SemVer range**：`--tag v1.0` 会被拒，用 `legacy`
- **pwsh Get-Content 读 UTF-8 中文会乱码**：验证用 node 读
- **固定位置 exe 是会话启动时释放的**：改 exe 后删掉它让 ensureExe 释放新版，或等重启
- **360/Defender 启发式误报**：新 exe 哈希变化会重新触发，先在 360 加信任再测
