# dsh-uia-agent — Windows UI Automation agent for DeepSeek Harness

把 [uia_agent](../README.md)（C++ 编写的 Windows UI 自动化单 exe）包装成 dsh 插件：
注册一个 `uia` 工具，让模型能枚举窗口、快照 UI 树、查找控件、点击、输入文本、滚动/拖动/滑动、截图、控制窗口状态（置顶/最小化/最大化/恢复/关闭）。

## 结构

```
plugin/
├─ package.json        # dsh 插件清单（bundle patch、工具贡献）
├─ cordis.patch.yml    # 挂载层：- id: uia-agent name: dsh-uia-agent
├─ lib/index.js        # uia 工具：spawn 固定位置的 exe，解析单行 UTF-8 JSON
├─ scripts/install.ps1 # 把 exe 释放到固定位置 %DSH_HOME%\bin\uia_agent.exe
└─ smoke.mjs           # 无 LLM 冒烟（模块加载 + 工具定义 + apply 注册）
```

## 依赖关系

- **宿主包**：`@deepseek-ai/cordis`、`@deepseek-ai/dsh-tools`（dsh 容器内提供，走 `$DSH_HOME/profiles/node_modules` fallback，插件无需自带）。
- **exe**：固定位置 `%DSH_HOME%\bin\uia_agent.exe`（`DSH_HOME` 缺省 `~\.dsh`）。工具每次调用都 spawn 该固定路径，更新 exe 只需重跑 `scripts/install.ps1`。

## 安装

```powershell
# 1) 构建 uia_agent.exe（见仓库根 README，或直接跑根目录 build.ps1）
#    或者直接从 GitHub release 下载 exe（install.ps1 会自动尝试）
# 2) 把 exe 释放到固定位置
powershell -ExecutionPolicy Bypass -File plugin/scripts/install.ps1
#    exe 来源优先级：
#      a. 参数 / 环境变量 UIA_AGENT_EXE 指定的路径
#      b. 本地构建产物（仓库根 build/uia_agent.exe）
#      c. GitHub release 资产（仓库默认 cnyc6n/dsh-uia-agent，可用 UIA_AGENT_REPO 覆盖）

# 3) 把插件装进 profile（file: 依赖指向插件目录）
dsh plugin --profile web add file:<plugin 目录的绝对路径>
```

若 profile 的 `cordis.patch.yml` 里插件被 `disabled: true`，去掉该行后重启启用。

## 工具 `uia`

参数（JSON Schema，模型可见）：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `command` | string 枚举 | list / snapshot / snapshot_all / find / click / set_text / get_text / scroll / drag / swipe / screenshot / minimize / maximize / restore / topmost / close |
| `hwnd` | number | 目标窗口句柄（list / snapshot_all 的 hwnd 字段） |
| `depth` | number | 快照深度（默认 8） |
| `query` | string | 查找条件 JSON，如 `{"control_type":"Edit"}`、`{"automation_id":"num7Button"}` |
| `text` / `mode` / `x` / `y` / `x1` / `y1` / `x2` / `y2` / `duration` / `amount` / `direction` / `distance` / `out` / `base64` / `off` | 见各命令 | 坐标均为屏幕物理像素 |

模型调用后收到一行摘要文本（不塞大 JSON 进上下文）；结构化原始结果经 `presentationMeta` 持久化。

## 示例

```
uia 工具：command=snapshot_all → "共 22 个窗口快照：527984 [uia] 计算器…"
uia 工具：command=find, hwnd=1378628, query={"control_type":"Edit"} → 找到 1 个节点
uia 工具：command=set_text, hwnd=1378628, query={"control_type":"Edit"}, text=hello → 已写入文本
uia 工具：command=screenshot, hwnd=1378628, out=C:\tmp\notepad.png → 截图已保存
```

## 已知限制

- 自绘 UI / 游戏 / DirectX / 默认 Qt 拍不到 UIA 树（snapshot 返回 unsupported；可用 screenshot + 图像识别兜底）。
- 管理员窗口需 exe 以管理员运行，否则 UIPI 拦截。
- Chromium/Electron 默认关闭 accessibility，首次访问可能为空。
- UIA 调用可能挂起：exe 内置 5s 超时（`--timeout` 可调），工具 spawn 超时 15s。
- PrintWindow 对个别 DRM/自绘窗口可能黑屏（capture_failed），属系统限制。
