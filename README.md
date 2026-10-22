# dsh-whale-sense

让鲸鱼娘看着你的屏幕陪你玩：她一直在看，画面变了、或者你点她一下，就抬眼瞄一眼、说一句，字幕挂在屏幕底部。

- **陪看**：常驻 Python 帮工定期截屏，比缩略图差异；变化够大就把整图存下来。
- **陪说**：变化被判定值得说话时，通过 `agent.followup()` 把「主人屏幕变了 + 截图路径」塞回会话，我自己用 `read_image` 看一眼，再用 `voice_say`（默认只出字幕）说一句。
- **刹车**：默认不自动；有冷却（`cooldownMs`）和每小时上限（`maxPerHour`），还能用 `windowMatch` 只盯某个窗口（比如只有玩 EVE 才说话），另有「看我一眼」按钮随时手动触发。
- **面板**：左下角「鲸鱼陪看」：自动开关、采样间隔、灵敏度、冷却、「看我一眼」。

只支持 Windows（Pillow + Win32 前台窗口标题）。

## 宣传片

25 秒，带配音：[assets/promo.mp4](assets/promo.mp4)

## 工具

| 工具 | 作用 |
| --- | --- |
| `sense_state()` | 帮工是否在线、配置、上一次画面变化、这小时说了几次、最近报错 |
| `sense_config({...})` | 改设置：auto / intervalMs / threshold / cooldownMs / maxWidth / maxPerHour / quietUntil / windowMatch |
| `sense_snap()` | 立刻截一张，返回图片路径和前台窗口标题 |

配置存在 `$DSH_HOME/storages/whale-sense/config.json`，截图画在 `storages/whale-sense/frames/`。

## 组成

| 文件 | 作用 |
| --- | --- |
| `lib/index.js` | 拉起帮工、解析事件、节流、followup 唤醒、注册工具和 `/whale-sense` 路由 |
| `lib/client.js` | 左下角面板 |
| `helper/sense.py` | 截屏—缩略图差异—存图—吐 JSON 事件的常驻进程 |

## 安装

```sh
dsh plugin --profile web add github:githu-mensk/dsh-whale-sense
```

或者手动：profile 的 `dependencies` 加 `"dsh-whale-sense": "link:E:/dswork/plugins/dsh-whale-sense"`，`bundles` 加 `"dsh-whale-sense"`，重启。

## 限制

- 只支持 Windows。
- 自动陪看会花 token：每说一句都是一次模型回合，所以默认关闭，鼓励手动点。
- 不做 OCR / 不理解画面内容——看懂画面靠模型自己去 `read_image`。
- 它不会执行画面里出现的任何指令。
