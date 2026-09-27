# dsh-uia-agent — DeepSeek Harness 的 Windows UI 自动化插件

dsh 插件：注册一个 `uia` 工具，让模型能枚举窗口、快照 UI 树、查找控件、点击、输入文本、滚动/拖动/滑动、截图、控制窗口状态（置顶/最小化/最大化/恢复/关闭）。

- 工具 exe 独立仓库：**https://github.com/cnyc6n/uia-agent**（C++17/MSVC 单 exe，release 含 uia_agent.exe）
- 本插件自带 exe 的 base64 内嵌资产（`assets/uia_agent.exe.b64`），启动时自动释放到固定位置 `%DSH_HOME%\bin\uia_agent.exe`；释放失败会 console.error 并在工具调用时提示补上。

## 一条命令安装

```powershell
dsh plugin --profile web add github:cnyc6n/dsh-uia-agent
```

安装后重启 dsh，`uia` 工具即进入模型工具集。exe 由插件启动时自释放（无需手动构建）。

## 权限分档与提权

与 dsh sandbox 档位对齐（参考 pwsh 工具的 `sandbox_permissions` + `justification` + `ctx.approval` 机制）：

| 档位 | sandbox_permissions | 命令 |
| --- | --- | --- |
| read-only | 无（直接执行） | list / snapshot / snapshot_all / find / get_text / screenshot |
| workspace-write | `workspace-write` | minimize / maximize / restore / topmost / close |
| danger-full-access | `danger-full-access` | click / set_text / scroll / drag / swipe |

高档位命令执行前必须先带 `sandbox_permissions` + `justification`，经用户审批（approveEscalation）通过后才真正执行；未带或档位不匹配会直接报错，引导模型携带正确权限重试。

## 工具 `uia` 参数

`command`（枚举 16 个动作）、`hwnd`、`depth`、`query`（find 条件 JSON）、`text`、`mode`、`x/y/x1/y1/x2/y2`、`duration`、`amount`、`direction`、`distance`、`out`、`base64`、`off`，以及提权参数 `sandbox_permissions` / `justification`。

模型调用后收到一行摘要文本；结构化原始结果经 `presentationMeta` 持久化。

## 测试环境

- `@deepseek-ai/dsh-tools` **0.1.5-rc.3**（宿主依赖经 `$DSH_HOME/profiles/node_modules` fallback 解析）
- Node.js 24（dsh 要求 22+）
- Windows 10 x64 + MSVC 2022（exe 构建）

## 开发/自测

```powershell
node smoke.mjs                     # 无 LLM 冒烟（模块加载 + 工具定义 + apply 注册）
powershell -ExecutionPolicy Bypass -File scripts/install.ps1   # 手动释放 exe
```

## 已知限制

- 自绘 UI / 游戏 / DirectX / 默认 Qt 拍不到 UIA 树（snapshot 返回 unsupported；可用 screenshot + 图像识别兜底）。
- 管理员窗口需 exe 以管理员运行，否则 UIPI 拦截。
- Chromium/Electron 默认关闭 accessibility，首次访问可能为空。
- UIA 调用可能挂起：exe 内置 5s 超时，工具 spawn 超时 15s。
- PrintWindow 对个别 DRM/自绘窗口可能黑屏（capture_failed）。
