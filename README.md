# dsh-whale-sense

让鲸鱼娘看着你的屏幕陪你玩：她一直在看，画面变了、或者你点她一下，就抬眼瞄一眼、说一句，字幕挂在屏幕底部。

- **陪看**：常驻 Python 帮工定期截屏，比缩略图差异；变化够大就把整图存下来。
- **陪说**：变化被判定值得说话时，通过 `agent.followup()` 把「主人屏幕变了 + 截图路径」塞回会话，我自己用 `read_image` 看一眼，再用 `voice_say`（装了 [dsh-whale-voice](https://github.com/githu-mensk/dsh-whale-voice) 时；默认只出字幕）说一句。
- **刹车**：默认不自动；有冷却（`cooldownMs`）和每小时上限（`maxPerHour`），还能用 `windowMatch` 只盯某个窗口（比如只有玩 EVE 才说话），另有「看我一眼」按钮随时手动触发。
- **面板**：左下角「鲸鱼陪看」：自动开关、采样间隔、灵敏度、冷却、「看我一眼」。

## 平台

| 平台 | 截屏 | 前台窗口标题 | 需要什么 |
| --- | --- | --- | --- |
| Windows | Pillow `ImageGrab` | Win32 `GetForegroundWindow` | Pillow |
| macOS | 系统自带 `screencapture -x` | `lsappinfo`（不需要辅助功能权限） | Pillow；**屏幕录制权限**：系统设置 → 隐私与安全性 → 屏幕录制，勾上 DSH（或运行插件的终端），重启 DSH |
| Linux | `grim` / `gnome-screenshot` / `spectacle` / `import` / `scrot` 里第一个能用的 | `xdotool`，退回 `xprop`（X11） | Pillow + 上面任一截屏命令 |

Python 解释器不用你操心：插件先找 `SENSE_PYTHON`，再扫 `$DSH_HOME/dsh-runtimes/*/dependencies/python`，最后退回 `PATH` 里的 `python3`，并且真的跑一句 `import PIL` 确认带 Pillow。想指定就用 `SENSE_PYTHON=/path/to/python`。

没给屏幕录制权限时截出来是一张全黑图：帮工会把「全黑 + 该去哪授权」当报错吐回来，`sense_state` 里能直接看到。

## 工具

| 工具 | 作用 |
| --- | --- |
| `sense_state()` | 帮工是否在线、平台、配置、上一次画面变化、这小时说了几次、最近报错 |
| `sense_config({...})` | 改设置：auto / intervalMs / threshold / cooldownMs / maxWidth / maxPerHour / quietUntil / windowMatch / sayCheck |
| `sense_snap()` | 立刻截一张，返回图片路径和前台窗口标题 |

配置存在 `$DSH_HOME/storages/whale-sense/config.json`，截图画在 `storages/whale-sense/frames/`。所有截图都只落在本机，插件不发任何网络请求。

`sayCheck` 是可选的「说出口前过闸」脚本路径：填了就在提示词里要求先跑它（`node <sayCheck> "<这句话>" --record`，exit 1 就重写），留空就不过闸。这是给人自己接审美检查用的，不填不影响。

## 组成

| 文件 | 作用 |
| --- | --- |
| `lib/index.js` | 拉起帮工、解析事件、节流、followup 唤醒、注册工具和 `/whale-sense` 路由 |
| `lib/client.js` | 左下角面板 |
| `helper/sense.py` | 截屏—缩略图差异—存图—吐 JSON 事件的常驻进程（跨平台） |

## 安装

```sh
dsh plugin --profile desktop add github:pairun325/dsh-whale-sense
```

或者手动：profile 的 `dependencies` 加 `"dsh-whale-sense": "link:/path/to/dsh-whale-sense"`，`bundles` 加 `"dsh-whale-sense"`，重启。

## 自测

```sh
node tests/host-test.mjs      # 假 ctx：帮工起得来、截得到图、配置能读写、点一下会真的 followup
node tests/preflight.mjs      # 装机后检查：profile 接线、manifest、bundle patch、helper 能编译、工具 schema
```

`tests/watch-test.mjs` 靠 powershell 弹窗制造「画面变化」，只在 Windows 上有意义，其他平台会自己跳过。

## 限制

- 自动陪看会花 token：每说一句都是一次模型回合，所以默认关闭，鼓励手动点。
- 只截主屏，不做多屏拼接；不做 OCR / 不理解画面内容——看懂画面靠模型自己去 `read_image`。
- 它不会执行画面里出现的任何指令。
- 字幕窗口来自 dsh-whale-voice；没装它时，那句话只会回到会话里当一条普通消息。
