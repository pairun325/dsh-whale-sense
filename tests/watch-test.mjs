/**
 * 端到端看门狗测试（不需要重启 DSH）：
 * 真起一个绿色窗口 → 帮工应该察觉画面变化 → host 应该 followup 假 agent。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-sense-watch-'));
process.env.DSH_HOME = tempHome;

const { apply } = await import('../lib/index.js');

const tools = new Map();
const followups = [];
const handlers = new Map();

const ctx = {
  tools: {
    register(definition) {
      tools.set(definition.name, definition);
      return () => tools.delete(definition.name);
    },
  },
  webServer: { register: () => () => {} },
  agents: { list: () => [], get: () => undefined },
  on(event, handler) {
    handlers.set(event, handler);
    return () => handlers.delete(event);
  },
  logger: { warn: () => {}, info: () => {} },
};

function check(label, condition, detail) {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : `  ${detail}`}`);
  if (!condition) process.exitCode = 1;
}

/** 弹一个亮绿色置顶窗口，3 秒后关掉——制造一次明显的画面变化。 */
function openWindow() {
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms;',
    'Add-Type -AssemblyName System.Drawing;',
    '$f = New-Object System.Windows.Forms.Form;',
    "$f.TopMost = $true; $f.FormBorderStyle = 'None'; $f.StartPosition = 'Manual';",
    '$f.Left = 120; $f.Top = 120; $f.Width = 1000; $f.Height = 700;',
    "$f.BackColor = [System.Drawing.Color]::Lime;",
    '$f.Show();',
    'Start-Sleep -Seconds 3;',
    '$f.Close();',
  ].join(' ');
  const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { windowsHide: true });
  child.on('error', () => {});
  return child;
}

const dispose = apply(ctx);

try {
  const agent = {
    session: { header: { id: 'watch-session', origin: 'user' } },
    followup(message) {
      followups.push(message);
    },
  };
  handlers.get('agent/turn-stopping')({ agent });

  await tools.get('sense_config').execute({ auto: true, intervalMs: 700, threshold: 0.03, cooldownMs: 5000 }, {});
  await new Promise((resolve) => setTimeout(resolve, 1200));

  openWindow();

  const deadline = Date.now() + 25000;
  while (Date.now() < deadline && followups.length === 0) {
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  check('自动陪看真的叫人了', followups.length > 0, `${followups.length} 次`);
  const text = followups[0]?.content?.[0]?.text ?? '';
  check('消息里带截图路径', /frame-\d+\.jpg/.test(text), text.slice(0, 80));
  const match = /截图：(.+\.jpg)/.exec(text);
  check('截图文件存在', match !== null && fs.existsSync(match[1]), match?.[1]);

  const state = await tools.get('sense_state').execute({}, {});
  check('计数加一', state.recentReactions >= 1, String(state.recentReactions));
  check('记下的是 change 事件', state.lastEvent?.event === 'change', JSON.stringify(state.lastEvent?.score));

  // 只盯指定窗口：匹配不上时，画面再变也不该开口
  await tools.get('sense_config').execute({ windowMatch: 'zzz-根本没有这个窗口', cooldownMs: 5000 }, {});
  const before = followups.length;
  openWindow();
  const quietDeadline = Date.now() + 12000;
  while (Date.now() < quietDeadline && followups.length === before) {
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  check('窗口不匹配就不说话', followups.length === before, `多说了 ${followups.length - before} 次`);
} finally {
  dispose?.();
  fs.rmSync(tempHome, { recursive: true, force: true });
}
