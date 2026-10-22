#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""dsh-whale-sense helper —— 陪看的眼睛。

每隔 interval 截一张屏，和上一张缩略图比差异；差异够大、又过了冷却期，
就把整图存成 jpg，并在 stdout 吐一行 JSON 事件。

stdin 每行一个 JSON 命令：
  {"op": "snap"}                      强制截一张（不受阈值/冷却限制）
  {"op": "config", "intervalMs": 2000, "threshold": 0.06, "cooldownMs": 45000, "maxWidth": 1280}
  {"op": "quit"}

stdout 每行一个 JSON：
  {"event": "ready"} / {"event": "change", "path": "...", "score": 0.12, "title": "EVE Online", "at": 1719...}
  {"event": "snap", "path": "...", "title": "..."}
  {"event": "error", "message": "..."}
"""

import ctypes
import io
import json
import os
import sys
import time

if sys.platform != "win32":
    raise SystemExit("dsh-whale-sense 只支持 Windows")

from ctypes import wintypes

try:
    from PIL import Image, ImageGrab
except Exception as exc:  # pragma: no cover
    sys.stderr.write("Pillow 不可用: %r\n" % (exc,))
    raise SystemExit(2)

try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    try:
        ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        pass

user32 = ctypes.windll.user32

STATE = {
    "intervalMs": 2000,
    "threshold": 0.06,
    "cooldownMs": 45000,
    "maxWidth": 1280,
}
OUT_DIR = os.environ.get("SENSE_OUT_DIR") or os.path.join(os.path.expanduser("~"), ".dsh", "storages", "whale-sense", "frames")
THUMB = (64, 36)


def emit(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def log(text):
    sys.stderr.write(str(text) + "\n")
    sys.stderr.flush()


def foreground_title():
    try:
        hwnd = user32.GetForegroundWindow()
        length = user32.GetWindowTextLengthW(hwnd)
        if length <= 0:
            return ""
        buf = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buf, length + 1)
        return buf.value.strip()
    except Exception:
        return ""


def grab_full():
    return ImageGrab.grab(all_screens=False)


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


def read_commands():
    buffer = ""
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
            raise SystemExit(0)
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
        if op == "snap":
            try:
                image = grab_full()
                path = save_jpeg(image)
                emit({"event": "snap", "path": path, "title": foreground_title(), "at": int(time.time() * 1000)})
            except Exception as exc:
                emit({"event": "error", "message": "snap failed: %r" % (exc,)})
    raise SystemExit(0)


def main():
    import threading

    watcher = threading.Thread(target=read_commands, daemon=True)
    watcher.start()

    emit({"event": "ready", **STATE})
    previous = None
    last_emit = 0.0
    while True:
        try:
            image = grab_full()
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
            emit({"event": "error", "message": "grab failed: %r" % (exc,)})
        time.sleep(max(0.15, STATE["intervalMs"] / 1000.0))


if __name__ == "__main__":
    main()
