/**
 * 装机前检查：profile 接线、junction、manifest、bundle patch、helper 语法。
 * 不启动 DSH，只读文件；任何一项不对就 exit 1。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const PROFILE = 'C:/Users/93116/.dsh/profiles/desktop';
const PLUGIN = 'E:/dswork/plugins/dsh-whale-sense';
const failures = [];

async function check(label, fn) {
  try {
    const detail = await fn();
    console.log(`PASS  ${label}${detail === undefined ? '' : `  ${detail}`}`);
  } catch (error) {
    failures.push(`${label}: ${error.message}`);
    console.log(`FAIL  ${label}  ${error.message}`);
  }
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

await check('profile JSON 合法', () => {
  const profile = readJson(path.join(PROFILE, 'package.json'));
  if (!profile.dependencies?.['dsh-whale-sense']) throw new Error('dependencies 里没有 link');
  if (!profile.dsh?.profile?.bundles?.includes('dsh-whale-sense')) throw new Error('bundles 里没有');
  return profile.dependencies['dsh-whale-sense'];
});

await check('node_modules 链接指向插件', () => {
  const target = path.join(PROFILE, 'node_modules/dsh-whale-sense');
  if (!fs.existsSync(path.join(target, 'package.json'))) throw new Error('链接不存在或没接上');
  const manifest = readJson(path.join(target, 'package.json'));
  if (manifest.name !== 'dsh-whale-sense') throw new Error(`名字不对：${manifest.name}`);
  return manifest.version;
});

await check('manifest 与 bundle 一致', () => {
  const manifest = readJson(path.join(PLUGIN, 'package.json'));
  if (manifest.dsh?.bundle?.patch !== './cordis.patch.yml') throw new Error('没声明 dsh.bundle.patch');
  if (manifest.dsh?.client?.platform !== 'web') throw new Error('没声明 dsh.client web');
  if (!manifest.exports?.['./client']) throw new Error('exports 里没有 ./client');
  for (const file of manifest.files ?? []) {
    if (!fs.existsSync(path.join(PLUGIN, file))) throw new Error(`files 里列的 ${file} 不存在`);
  }
  return `${Object.keys(manifest.exports).length} 个导出，${manifest.files.length} 个文件`;
});

await check('bundle patch 内容', () => {
  const text = fs.readFileSync(path.join(PLUGIN, 'cordis.patch.yml'), 'utf8');
  if (!text.includes('id: whale-sense')) throw new Error('缺 insert id');
  if (!text.includes("name: 'dsh-whale-sense'")) throw new Error('缺 insert name');
});

await check('主入口与面板文件能从包里导出', () => {
  const manifest = readJson(path.join(PLUGIN, 'package.json'));
  for (const key of ['.', './client']) {
    const target = path.join(PLUGIN, manifest.exports[key]);
    if (!fs.existsSync(target)) throw new Error(`${key} -> ${manifest.exports[key]} 不存在`);
  }
});

await check('helper 能编译', () => {
  execFileSync('E:/ds/resources/runtime/primary-runtime/dependencies/python/python.exe', [
    '-c',
    'import py_compile,sys; py_compile.compile(sys.argv[1], doraise=True)',
    path.join(PLUGIN, 'helper/sense.py'),
  ]);
});

// 工具 schema 子集校验：dsh-tools 会拒掉 required 里点名但 properties 里没有的字段。
function walkSchema(schema, where, problems) {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) return;
  if (schema.type === 'object') {
    const properties = schema.properties ?? {};
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(properties, key)) problems.push(`${where}: required "${key}" 不在 properties 里`);
    }
    for (const [key, value] of Object.entries(properties)) walkSchema(value, `${where}.${key}`, problems);
  }
  if (schema.items !== undefined) walkSchema(schema.items, `${where}[]`, problems);
  for (const key of ['oneOf', 'anyOf', 'allOf']) {
    for (const [index, value] of (schema[key] ?? []).entries()) walkSchema(value, `${where}.${key}[${index}]`, problems);
  }
}

await check('工具 schema 能被 dsh-tools 接受', async () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-sense-schema-'));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = tempHome;
  const definitions = [];
  const ctx = {
    tools: {
      register(definition) {
        definitions.push(definition);
        return () => {};
      },
    },
    webServer: { register: () => () => {} },
    agents: { list: () => [] },
    on: () => () => {},
    logger: { info: () => {}, warn: () => {} },
  };
  const { apply } = await import(`../lib/index.js?preflight=${Date.now()}`);
  const dispose = apply(ctx);
  const problems = [];
  try {
    for (const definition of definitions) {
      walkSchema(definition.parameters, `${definition.name}.parameters`, problems);
      walkSchema(definition.output?.schema, `${definition.name}.output`, problems);
    }
  } finally {
    dispose?.();
    process.env.DSH_HOME = previous;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
  if (problems.length > 0) throw new Error(problems.join('；'));
  return `${definitions.length} 个工具`;
});

console.log(failures.length === 0 ? '\n全部通过，重启后就会加载。' : `\n${failures.length} 项失败`);
if (failures.length > 0) process.exitCode = 1;
