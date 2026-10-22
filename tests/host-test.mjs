/**
 * Host 半冒烟测试：假 ctx、临时 DSH_HOME、假 agent。
 * 验证：帮工起得来、截得到图、配置能读写、点「看我一眼」会真的 followup 唤醒。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-sense-test-'));
process.env.DSH_HOME = tempHome;

const { apply } = await import('../lib/index.js');

const tools = new Map();
const routes = new Map();
const handlers = new Map();
const agents = [];
const followups = [];

const ctx = {
  tools: {
    register(definition) {
      tools.set(definition.name, definition);
      return () => tools.delete(definition.name);
    },
  },
  webServer: {
    register(definition) {
      routes.set(definition.path, definition);
      return () => routes.delete(definition.path);
    },
  },
  agents: {
    list: () => agents,
    get: () => undefined,
  },
  on(event, handler) {
    handlers.set(event, handler);
    return () => handlers.delete(event);
  },
  logger: { warn: (message) => console.warn('[warn]', message), info: () => {} },
};

function makeReq(method, url, body) {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body), 'utf8')];
  return {
    method,
    url,
    async *[Symbol.asyncIterator]() {
      for (const chunk of payload) yield chunk;
    },
  };
}

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(value) {
      this.body = value === undefined ? '' : String(value);
    },
    json() {
      return JSON.parse(this.body);
    },
  };
}

async function call(method, url, body) {
  const res = makeRes();
  await routes.get('/whale-sense').handler(makeReq(method, url, body), res);
  return res;
}

function check(label, condition, detail) {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : `  ${detail}`}`);
  if (!condition) process.exitCode = 1;
}

const dispose = apply(ctx);

try {
  check('三个工具注册', ['sense_state', 'sense_config', 'sense_snap'].every((name) => tools.has(name)));
  check('面板路由注册', routes.has('/whale-sense'));

  const state = await tools.get('sense_state').execute({}, {});
  check('自动陪看默认关', state.config.auto === false);

  const config = await tools.get('sense_config').execute({ intervalMs: 999999, threshold: 0.2 }, {});
  check('采样被夹紧', config.config.intervalMs === 60000, JSON.stringify(config.config));
  check('写着盘上', JSON.parse(fs.readFileSync(path.join(tempHome, 'storages', 'whale-sense', 'config.json'), 'utf8')).threshold === 0.2);

  const snap = await tools.get('sense_snap').execute({}, {});
  check('截到图', typeof snap.path === 'string' && fs.existsSync(snap.path), snap.path);
  check('图有内容', fs.statSync(snap.path).size > 4096);
  console.log(`      前台窗口：${snap.title}`);

  const after = await tools.get('sense_state').execute({}, {});
  check('帮工在线', after.helper === 'running', JSON.stringify({ helper: after.helper, error: after.lastError }));

  // 假 agent：模拟会话结束那一钩子，然后点「看我一眼」
  const agent = {
    session: { header: { id: 'test-session', origin: 'user' } },
    followup(message) {
      followups.push(message);
    },
  };
  const turnStopping = handlers.get('agent/turn-stopping');
  check('挂了 turn-stopping 钩子', typeof turnStopping === 'function');
  turnStopping({ agent });

  const look = await call('POST', '/whale-sense/look', {});
  const body = look.json();
  check('看我一眼返回 ok', look.statusCode === 200 && body.ok === true && body.woke === true, look.body);
  check('真的 followup 了一次', followups.length === 1);
  const message = followups[0] ?? {};
  const text = message?.content?.[0]?.text ?? '';
  check('消息是 user 角色', message.role === 'user');
  check('来源是 producer-owned 的插件 kind', message.source?.kind === 'plugin:dsh-whale-sense');
  check('消息带着截图路径', text.includes(String(body.path ?? '???')));
  check('消息要求只出字幕', text.includes('speak=false'));

  const noAgent = await call('POST', '/whale-sense/snap', {});
  check('snap 路由能用', noAgent.statusCode === 200 && noAgent.json().ok === true);
} finally {
  dispose?.();
  fs.rmSync(tempHome, { recursive: true, force: true });
}
