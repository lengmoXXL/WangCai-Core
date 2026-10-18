# 旺财 Core

旺财的业务内核。**壳**（[WangCai](https://github.com/lengmoXXL/WangCai)）只负责窗口、打包与更新 Core，
工作区协议、插件管理、机器连接和界面都在这里。因此换业务逻辑不需要发布 App：壳可以从仓库拉取本仓库
重新构建，装到数据目录里再启动。

## 边界

```
WangCai（壳）                       WangCai-Core（本仓库）
├─ desktop/main/index.ts           ├─ main/   config plugins manager install
│    窗口 / preload 桥 / 打包       │          machines resources agent index
├─ desktop/main/core.ts            ├─ ui/     main tabs layout workspace-sidebar
│    解析、加载、重建 Core          │          installs style.css index.html
└─ desktop/main/preload.ts         └─ shared.ts  桥、协议与插件类型
```

本仓库不 import `electron`。凡是 Electron 独有的能力——窗口、会话、系统、协议与 IPC——都通过壳传进来的
`CoreHost`（见 [main/host.ts](main/host.ts)）申请：

| host 上的东西 | 用来做什么 |
| --- | --- |
| `paths` | 一次运行读写的位置：`config`（init.ts）、`storage`（插件、状态）、`resources`（agent 二进制）、`node`（构建插件用的 Node） |
| `protocol.handle` | 注册插件文件（`wangcai-plugin:`）与预览文档（`wangcai-preview:`）两个协议 |
| `ipc.handle` | 注册 preload 按 [shared.ts](shared.ts) 里的名字调用的通道 |
| `fetch` / `setProxy` | 走 App 的 session 出网，代理来自 init.ts 的 `network` |
| `send` | 向窗口发一个话题（插件安装进度等） |
| `openExternal` / `reload` / `fullscreen` | 打开 http(s) 链接、重画窗口、读全屏状态 |

壳拿回的是 `Core`：窗口上色用的 `background`、本次运行的 `network`（壳自己更新 Core 时要用），以及
`dispose()`。

## 构建

```sh
npm install
npm run build      # dist/main.cjs（主进程 bundle）、dist/ui/（窗口页面）、dist/commit（本次构建的 commit）
npm run typecheck
```

主进程 bundle 自带依赖，壳不需要本仓库的 `node_modules`；窗口页面由壳用 `wangcai-core:` 协议提供。
壳在打包时把 `dist/` 整个放进 `Resources/core`，运行时也可以拉取本仓库重建成同样形状后放进数据目录，
两者只差一个目录。

## 插件协议

插件是插件仓库里编译好的 `main.cjs`（主进程）和可选的 `ui.js` / `ui.css`（界面），由本仓库克隆、用 App
自带的 Node 构建并加载。契约（`MainContext` / `UiContext`）在
[@lengmoxxl/sdk](https://www.npmjs.com/package/@lengmoxxl/sdk)，配置说明在
[WangCai 的文档](https://github.com/lengmoXXL/WangCai/blob/main/docs/plugins.md)。