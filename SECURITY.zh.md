# 安全说明

> **[English](./SECURITY.md) | 中文**

## 本插件做什么

注册一个 `uia` 工具，让模型驱动 Windows UI Automation exe（`cnyc6n/uia-agent`）。exe 以 **base64 内嵌**在本包（`assets/uia_agent.exe.b64`），并附带其 SHA-256（`assets/uia_agent.exe.sha256`），安装与使用**完全离线**。

## exe 完整性

`ensureExe()` 在每次插件启动和每次调用前执行：

- 读取内嵌 b64 与声明 sha256
- 若 `%DSH_HOME%\bin\uia_agent.exe` 已存在：比较其 sha256 与声明值——匹配则保留（尊重手动放置的同版本 exe）；不匹配（过期/被篡改/不同构建）则用内嵌资产覆盖
- 写入后重新计算哈希并与声明比对；不一致即报错，绝不静默运行

这意味着被篡改或过期的二进制**总是会被包内校验过的副本替换**——模型永远不会执行未经验证的 exe。

## 权限分档（经 dsh 审批服务强制）

| 档位 | 命令 | 强制方式 |
|---|---|---|
| read-only | list / snapshot / snapshot_all / find / get_text / screenshot | 直接执行 |
| workspace-write | minimize / maximize / restore / topmost / close | 需 `sandbox_permissions=workspace-write` + `justification`，经 `ctx.approval`（approveEscalation）|
| danger-full-access | click / set_text / scroll / drag / swipe | 需 `sandbox_permissions=danger-full-access` + `justification`，须用户批准 |

权限缺失或不匹配会报错；未经用户批准，任何高风险操作都不会执行。若未装配审批服务，高风险命令失败关闭（fail closed）。

## 责任划分

- **本插件** 负责：权限分档、将高风险调用路由到用户审批、释放前校验内嵌 exe 哈希、在固定位置 spawn exe。
- **工具仓库**（`cnyc6n/uia-agent`）负责：正确的自动化实现、可复现构建、提交 sha256 资产。
- **用户** 决定批准什么。批准 `click`/`set_text`/`drag`/`swipe` 意味着接受将真实鼠标/键盘输入注入桌面会话。

## 边界 / 限制

- UIPI：非提升的 dsh 无法触达 elevated（管理员）窗口；插件会把 exe 的 `elevated_requires_admin` 如实呈现，而不是隐藏失败。
- exe 以 dsh 进程的权限运行。以管理员运行 dsh 会扩大 `uia` 的可操作范围——仅在你信任当前会话提示时这样做。
- `screenshot` 使用 PrintWindow；部分 DRM/自绘窗口可能抓黑（系统限制，报 `capture_failed`）。

## 报告

安全相关问题请通过 private advisory 或标记 `security` 的 GitHub issue 提交；修复发布前请勿公开披露利用细节。
