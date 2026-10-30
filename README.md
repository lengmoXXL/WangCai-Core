# 旺财 Core

旺财的业务内核。**壳**（[WangCai](https://github.com/lengmoXXL/WangCai)）只负责窗口、打包、更新 Core，
以及读 `init.ts` 把插件装好；工作区协议、机器连接和界面都在这里。因此换业务逻辑不必重新发布：壳可以
从仓库拉取本仓库重新构建，装到数据目录里再启动。

## 快捷键

Core 自带这些键位（`leader` 默认是空格）：

| 键 | 作用 |
| --- | --- |
| `<leader>w` | 关闭当前标签页 |

其余键位写在 `init.ts` 的 `keys` 里，用 Neovim 记法：`<leader>ff`、`<C-S-p>`、`g g`；空白只作分隔，空格键写
`<Space>`，字符的大写即 Shift，修饰符是 `<C-…>`、`<A-…>`（同 `<M-…>`）、`<D-…>`（Command）与 `<S-…>`。

一个绑定能做三件事：发事件（`{ event, data }`）、调 `commands` 里的函数（`{ command, args }`），或跑脚本
（`{ run }`）。后两种拿到 `{ args, profile, publish, request, send, open }`。`desc` 是前缀提示里的文字，
`insert: true` 让它在输入框和终端里也生效。

```ts
import { appendFileSync } from 'node:fs';

export default {
  leader: ' ',            // 默认是空格
  timeout: 800,           // 前缀等下一个键的时间，毫秒
  keys: {
    '<leader>p': { event: 'plugin-page', desc: '打开插件页' },
    '<leader>log': { desc: '记一行', run: () => appendFileSync('/tmp/wangcai.log', `${Date.now()}\n`) },
    '<leader>wn': { command: 'workspace.new', args: 'local', desc: '本机新开一个工作区' },
  },
  commands: {
    'workspace.new': ({ args, request }) => request('terminal-agent', 'workspace-create', { key: args }),
  },
};
```

优先级：`init.ts` 的 `keys` > 插件 `main.cjs` 的 `keys` > 上面这张表，写法不同但按出来一样的序列（`<Leader>f` 与
`<leader>f`）算同一个。插件也像声明 `config` 一样声明 `keys`，写法同上，只有事件与自己的 `run`，`init.ts` 写同一个
序列就覆盖它。
