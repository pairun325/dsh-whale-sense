#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""dsh-whale-sense helper —— 陪看的眼睛。

每隔 interval 截一张屏，和上一张缩略图比差异；差异够大、又过了冷却期，
就把整图存成 jpg，并在 stdout 吐一行 JSON 事件。

跨平台：Windows 走 Pillow/ImageGrab + Win32 前台窗口标题；macOS 走系统自带
`screencapture` + `lsappinfo`；Linux 走 grim/gnome-screenshot/spectacle/import/scrot
里可用的那一个 + xdotool/xprop 取标题。只做「截屏—比差异—存图」，不外发任何数据。

stdin 每行一个 JSON 命令：
  {"op": "snap"}                      强制截一张（不受阈值/冷却限制）
  {"op": "config", "intervalMs": 2000, "threshold": 0.06, "cooldownMs": 45000, "maxWidth": 1280}
  {"op": "info"}                      报一次平台/目录/权限提示
  {"op": "quit"}

stdout 每行一个 JSON：
  {"event": "ready", "platform": "darwin", ...}
  {"event": "change", "path": "...", "score": 0.12, "title": "Safari", "at": 1719...}
  {"event": "snap", "path": "...", "title": "..."}
  {"event": "error", "message": "..."}
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

if sys.platform.startswith("win"):
    PLATFORM = "win32"
elif sys.platform == "darwin":
    PLATFORM = "darwin"
else:
    PLATFORM = "linux"

try:
    from PIL import Image
except Exception as exc:  # pragma: no cover
    sys.stderr.write("Pillow 不可用: %r\n" % (exc,))
    raise SystemExit(2)

if PLATFORM == "win32":
    try:
        import ctypes
        from ctypes import wintypes  # noqa: F401
        from PIL import ImageGrab
    except Exception as exc:  # pragma: no cover
        sys.stderr.write("Windows 截屏组件不可用: %r\n" % (exc,))
        raise SystemExit(2)

    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except Exception:
        try:
            ctypes.windll.user32.SetProcessDPIAware()
        except Exception:
            pass

    _user32 = ctypes.windll.user32

STATE = {
    "intervalMs": 2000,
    "threshold": 0.06,
    "cooldownMs": 45000,
    "maxWidth": 1280,
}
OUT_DIR = os.environ.get("SENSE_OUT_DIR") or os.path.join(os.path.expanduser("~"), ".dsh", "storages", "whale-sense", "frames")
THUMB = (64, 36)

# 各平台没权限时截出来是黑图/直接失败，给一句人话方便自查。
PERMISSION_HINT = {
    "darwin": "需要在「系统设置 → 隐私与安全性 → 屏幕录制」里勾上 DSH（或运行本插件的终端），然后重启 DSH",
    "linux": "Wayland 需要 grim，X11 需要 gnome-screenshot/spectacle/import/scrot 之一；确认当前会话允许截屏",
    "win32": "确认当前会话不是锁屏状态",
}


def emit(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def log(text):
    sys.stderr.write(str(text) + "\n")
    sys.stderr.flush()


# ---------------------------------------------------------------- 截屏


def _capture_command(out_path):
    """返回 (命令, 参数) 或 None。"""
    if PLATFORM == "linux":
        options = [
            ("grim", lambda: ["grim", "-t", "png", out_path]),
            ("gnome-screenshot", lambda: ["gnome-screenshot", "-f", out_path]),
            ("spectacle", lambda: ["spectacle", "-b", "-n", "-o", out_path]),
            ("import", lambda: ["import", "-window", "root", out_path]),
            ("scrot", lambda: ["scrot", "-o", out_path]),
        ]
        for binary, builder in options:
            if shutil.which(binary):
                return builder()
        return None
    return None


def grab_screen():
    """截一张主屏，返回 PIL Image（RGB）。"""
    if PLATFORM == "win32":
        return ImageGrab.grab(all_screens=False).convert("RGB")

    handle, tmp = tempfile.mkstemp(suffix=".png", prefix="sense-")
    os.close(handle)
    try:
        if PLATFORM == "darwin":
            argv = ["screencapture", "-x", "-t", "png", tmp]
        else:
            argv = _capture_command(tmp)
            if argv is None:
                raise RuntimeError("没找到可用的截屏命令：%s" % PERMISSION_HINT["linux"])
        proc = subprocess.run(argv, capture_output=True)
        if proc.returncode != 0:
            detail = proc.stderr.decode("utf-8", "replace").strip()
            raise RuntimeError("截屏命令失败(%s)：%s" % (proc.returncode, detail or argv[0]))
        if not os.path.exists(tmp) or os.path.getsize(tmp) == 0:
            raise RuntimeError("截屏没有产生图像：%s" % PERMISSION_HINT.get(PLATFORM, ""))
        image = Image.open(tmp)
        image.load()
        image = image.convert("RGB").copy()
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass
    extrema = image.convert("L").getextrema()
    if extrema[1] <= 2:
        raise RuntimeError("截到的是一张全黑图，多半是没给屏幕录制权限：%s" % PERMISSION_HINT.get(PLATFORM, ""))
    return image


# ---------------------------------------------------------------- 前台窗口


def foreground_title():
    if PLATFORM == "win32":
        try:
            hwnd = _user32.GetForegroundWindow()
            length = _user32.GetWindowTextLengthW(hwnd)
            if length <= 0:
                return ""
            buf = __import__("ctypes").create_unicode_buffer(length + 1)
            _user32.GetWindowTextW(hwnd, buf, length + 1)
            return buf.value.strip()
        except Exception:
            return ""

    if PLATFORM == "darwin":
        try:
            front = subprocess.run(
                ["lsappinfo", "front"], capture_output=True, text=True, timeout=2
            ).stdout.strip()
            if not front:
                return ""
            info = subprocess.run(
                ["lsappinfo", "info", "-only", "name", front],
                capture_output=True,
                text=True,
                timeout=2,
            ).stdout.strip()
            if "=" in info:
                return info.split("=", 1)[1].strip().strip('"').strip()
        except Exception:
            return ""
        return ""

    # Linux：X11 优先 xdotool，退回 xprop
    try:
        if shutil.which("xdotool"):
            out = subprocess.run(
                ["xdotool", "getactivewindow", "getwindowname"],
                capture_output=True,
                text=True,
                timeout=2,
            ).stdout.strip()
            if out:
                return out
        if shutil.which("xprop"):
            root = subprocess.run(
                ["xprop", "-root", "_NET_ACTIVE_WINDOW"], capture_output=True, text=True, timeout=2
            ).stdout.strip()
            window_id = root.rsplit(" ", 1)[-1] if root else ""
            if window_id and window_id != "0x0":
                name = subprocess.run(
                    ["xprop", "-id", window_id, "_NET_WM_NAME"],
                    capture_output=True,
                    text=True,
                    timeout=2,
                ).stdout.strip()
                if "=" in name:
                    return name.split("=", 1)[1].strip().strip('"')
    except Exception:
        return ""
    return ""


# ---------------------------------------------------------------- 比差异、存图


def thumb_bytes(image):
    small = image.convert("L").resize(THUMB)
    return small.tobytes()


def diff_score(a, b):
    if a is None or b is None or len(a) != len(b):
        return 1.0
    total = 0
    for x, y in zip(a, b):
        total += abs(x - y)
    return total / (len(a) * 255.0)


def save_jpeg(image):
    width = int(STATE["maxWidth"])
    if image.width > width:
        height = max(1, round(image.height * width / image.width))
        image = image.resize((width, height))
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, "frame-%d.jpg" % int(time.time() * 1000))
    image.convert("RGB").save(path, "JPEG", quality=62)
    return path


# ---------------------------------------------------------------- 主循环


def read_commands():
    for chunk in iter(lambda: sys.stdin.readline(), ""):
        line = chunk.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except Exception:
            continue
        op = message.get("op")
        if op == "quit":
            # 退出要在整个进程上生效：在线程里抛 SystemExit 只会杀掉这条线程，
            # 主循环还在截屏，外面看着像「退不掉」。
            os._exit(0)
        if op == "config":
            for key in ("intervalMs", "threshold", "cooldownMs", "maxWidth"):
                value = message.get(key)
                if isinstance(value, (int, float)):
                    STATE[key] = float(value) if key == "threshold" else int(value)
            STATE["intervalMs"] = max(400, min(60000, STATE["intervalMs"]))
            STATE["threshold"] = max(0.005, min(0.9, STATE["threshold"]))
            STATE["cooldownMs"] = max(5000, min(3600000, STATE["cooldownMs"]))
            STATE["maxWidth"] = max(320, min(2560, STATE["maxWidth"]))
            emit({"event": "config", **STATE})
        if op == "info":
            emit({
                "event": "info",
                "platform": PLATFORM,
                "outDir": OUT_DIR,
                "permissionHint": PERMISSION_HINT.get(PLATFORM, ""),
                "state": dict(STATE),
            })
        if op == "snap":
            try:
                image = grab_screen()
                path = save_jpeg(image)
                emit({
                    "event": "snap",
                    "path": path,
                    "title": foreground_title(),
                    "at": int(time.time() * 1000),
                })
            except Exception as exc:
                emit({"event": "error", "message": "snap failed: %s" % (exc,)})
    raise SystemExit(0)


def main():
    import threading

    watcher = threading.Thread(target=read_commands, daemon=True)
    watcher.start()

    emit({"event": "ready", "platform": PLATFORM, **STATE})
    previous = None
    last_emit = 0.0
    while True:
        try:
            image = grab_screen()
            current = thumb_bytes(image)
            score = diff_score(previous, current)
            now = time.time()
            if previous is not None and score >= STATE["threshold"] and (now - last_emit) * 1000 >= STATE["cooldownMs"]:
                path = save_jpeg(image)
                last_emit = now
                emit({
                    "event": "change",
                    "path": path,
                    "score": round(score, 4),
                    "title": foreground_title(),
                    "at": int(now * 1000),
                })
            previous = current
        except Exception as exc:
            emit({"event": "error", "message": "grab failed: %s" % (exc,)})
        time.sleep(max(0.15, STATE["intervalMs"] / 1000.0))


if __name__ == "__main__":
    main()
