# 旺财 Core

旺财的业务内核。**壳**（[WangCai](https://github.com/lengmoXXL/WangCai)）只负责窗口、打包、更新 Core，
以及读 `init.ts` 把插件装好；工作区协议、机器连接和界面都在这里。因此换业务逻辑不必重新发布：壳可以
从仓库拉取本仓库重新构建，装到数据目录里再启动。

## 快捷键

键位写在 `~/.config/wangcai/init.ts` 的 `keys` 里，用 Neovim 记法。`<leader>` 是前缀键，默认空格，用同一个文件
顶层的 `leader` 改它。其余写法：空白只作分隔，空格键写 `<Space>`，字符的大写即 Shift，修饰符是 `<C-…>`、
`<A-…>`（同 `<M-…>`）、`<D-…>`（Command）与 `<S-…>`，例如 `<leader>ff`、`<C-S-p>`、`g g`。

一个绑定能做三件事：发事件（`{ event, data }`：订阅它的插件、窗口里订阅它的视图都会收到）、调 `commands` 里的函数
（`{ command, args }`，`commands` 是 `init.ts` 顶层的一张表，名字对应函数），或跑脚本（`{ run }`）。

发 `core:close-tab` 这个事件就关掉当前标签页；发 `core:show-view` 带 `data: { plugin }` 则把那个插件的视图切到前台，
没开就打开（工作区插件是切到它的工作区），焦点跟着过去，不用再点一下；接上 `wangcai:shown` 的视图（比如终端）按完直接就能打字。
`init.ts` 的绑定和插件的 `keys` 都把 `event` 写成这两个名字之一即可。

`{ command }` 与 `{ run }` 这两种拿到 `{ args, profile, publish, request, send, open }`：`args` 是绑定里写的参数，`profile` 是主题配置，
`publish` 发事件，`request` 调插件的界面方法（插件用 `ui.handle` 注册的那些），`send` 只往窗口发一条带名字的消息
（窗口里订阅这个名字的视图会收到），`open` 打开链接。

`desc` 是按下前缀后右下角列出的文字。

绑定默认是 **local** 的：焦点在插件页面里（点进去）才生效，在别处按了没有反应；写 `global: true` 就不再受焦点
限制；输入框和终端里另由 `insert: true` 决定，不写它就不在那里生效。

Core 自带的键位：

| 键 | 作用 | 范围 |
| --- | --- | --- |
| `<leader>w` | 关闭当前标签页 | `global` |

焦点在插件页里的输入框或终端时，在同一个输入框或终端里连按两次 Esc（300 毫秒内）离开焦点，这一页的 local 键随即可用；
没有正在等下一个键的前缀时，第一下 Esc 照常送给里面的程序，终端里运行的 vim 照收。

写法不同但按出来一样的（`<Leader>f` 与 `<leader>f`）算同一个序列。

同一个序列，local 的绑定压过 global 的；同为 local 或同为 global 时，`init.ts` 的绑定压过插件的，插件的压过 Core
自带的。

你自己那份 `init.ts` 大致如下：

```ts
import { appendFileSync } from 'node:fs';

export default {
  leader: ' ',
  timeout: 800,           // 前缀等下一个键的时间，毫秒
  keys: {
    '<leader>p': { event: 'plugin-page', desc: '打开插件页', global: true },
    '<leader>log': { desc: '记一行', run: () => appendFileSync('/tmp/wangcai.log', `${Date.now()}\n`) }, // 默认 local
    '<leader>wn': { command: 'workspace.new', args: 'local', desc: '本机新开一个工作区', global: true },
  },
  commands: {
    'workspace.new': ({ args, request }) => request('terminal-agent', 'workspace-create', { key: args }),
  },
};
```

插件在 `main.cjs` 里用 `exports.keys = { … }` 声明键位，写法与 `init.ts` 的 `keys` 相同，动作只能发事件或跑自己
的 `run`。插件的其他导出（`activate`、`config` 等）见[插件手册](https://github.com/lengmoXXL/WangCai/blob/main/docs/plugins.md)。
插件要有看得见的页面，它的 local 键才生效——没有 `open` 导出时显示的主视图，或它已经打开的侧栏标签页；否则绑定得写
`global: true`。

改完 `init.ts` 要重启 App 才生效。
