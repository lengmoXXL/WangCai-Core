# 旺财 Core

旺财的业务内核。**壳**（[WangCai](https://github.com/lengmoXXL/WangCai)）只负责窗口、打包、更新 Core，
以及读 `init.ts` 把插件装好；工作区协议、机器连接和界面都在这里。因此换业务逻辑不必重新发布：壳可以
从仓库拉取本仓库重新构建，装到数据目录里再启动。

## 边界

```
WangCai（壳）                       WangCai-Core（本仓库）
├─ desktop/main/index.ts            ├─ main/   plugins machines resources agent
│    窗口 / preload 桥 / 打包       │          host index
├─ desktop/main/config.ts           ├─ ui/     main tabs layout workspace-sidebar
│    读 init.ts 与它的插件清单      │          bridge installs style.css index.html
├─ desktop/main/plugins.ts          │
│    克隆、构建、更新插件           │
├─ desktop/main/spawn.ts            │
│    git/npm 子进程与代理、mirror   │
├─ desktop/main/core.ts             │
│    拉取、构建、加载 Core          │
└─ desktop/main/preload.ts
```
桥接契约——窗口的 scheme、topic、channel、`contractVersion` 与跨桥的类型——在
[@lengmoxxl/sdk](https://www.npmjs.com/package/@lengmoxxl/sdk) 的 `bridge` 模块，壳与本仓库各取一份。

本仓库不 import `electron`。凡是 Electron 独有的能力——窗口、会话、系统、协议——都通过壳传进来的
`CoreHost`（见 [main/host.ts](main/host.ts)）申请：

| host 上的东西 | 用来做什么 |
| --- | --- |
| `paths` | 一次运行读写的位置：`storage`（插件、状态，以及这里下载的 agent 二进制） |
| `version` / `sources` | 壳的版本，以及它随包发布的源码目录——快照按版本重写 `storage/src`，本仓库这部分从 `storage/core-src` 取 |
| `protocol.handle` | 注册插件文件（`wangcai-plugin:`）与预览文档（`wangcai-preview:`）两个协议 |
| `fetch` / `setProxy` | 走壳的 session 出网，代理来自 init.ts 的 `network` |
| `send` | 向窗口发一个话题（插件发布的事件等） |
| `config` | init.ts 读出来的主题与出网方式 |
| `plugins` / `statuses` / `install` | 壳装好的插件清单、插件页要画的行（Core 也在其中），以及行上「更新/重试」要它做的事 |
| `openExternal` / `reload` / `fullscreen` | 打开 http(s) 链接、重画窗口、读全屏状态 |

壳拿回的是 `Core`：它面向的契约版本 `contract`、按名字应答窗口的 `dispatch()`，以及 `dispose()`。

机器上的 `agent`（`wangcai` 节点）由这里装：[main/agent.ts](main/agent.ts) 钉住一个 `agent-v<版本>`
release，本机装到 `storage/bin/wangcai`，远端经 SSH 写到 `~/.local/bin/wangcai`，两边都按同名 `.sha256`
校验。换节点版本改这里的常量即可，不必发壳；壳的 `WANGCAI_AGENT_SOURCE` 让开发运行直接用本机构建的那份。

## 构建

```sh
npm install
npm run build      # dist/main.cjs（主进程 bundle）、dist/ui/（窗口页面）、dist/commit（本次构建的 commit）
npm run typecheck
```

主进程 bundle 自带依赖，壳不需要本仓库的 `node_modules`；窗口页面由壳用 `wangcai-core:` 协议提供。
壳不再随包带上本仓库：启动时数据目录里没有构建好的 Core 就克隆本仓库、用自带的 Node 构建到 `storage/core`
（`storage/core-src` 是那份 clone），已经有构建就直接用，菜单「更新核心组件」才会再拉一次。

## 插件协议

插件是插件仓库里编译好的 `main.cjs`（主进程）和可选的 `ui.js` / `ui.css`（界面）：壳克隆、用自带的 Node
构建，再把目录交给这里加载。契约（`MainContext` / `UiContext`）在
[@lengmoxxl/sdk](https://www.npmjs.com/package/@lengmoxxl/sdk)，配置说明在
[WangCai 的文档](https://github.com/lengmoXXL/WangCai/blob/main/docs/plugins.md)。
