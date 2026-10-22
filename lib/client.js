/**
 * `dsh-whale-sense` — browser half.
 *
 * 左下角一小块「陪看」面板：自动陪看开关、采样间隔、灵敏度、冷却，
 * 再加一个「看我一眼」按钮——点一下我就截屏、看一眼、说一句。
 *
 * 挂在 `/whale-sense` 路由上，不走 React。
 */
window.__ModuleLoader__.load({
  id: 'dsh-whale-sense',
  factory: () => {
    const ROUTE = '/whale-sense';
    const STORAGE_KEY = 'dsh-whale-sense.panel.v1';
    const SLIDERS = [
      { key: 'intervalMs', label: '采样间隔', min: 1000, max: 10000, step: 500, unit: 'ms' },
      { key: 'threshold', label: '灵敏度', min: 0.02, max: 0.3, step: 0.01 },
      { key: 'cooldownMs', label: '冷却', min: 10000, max: 300000, step: 5000, unit: 'ms' },
    ];

    const CSS = `
.dsh-sense-panel {
  position: fixed; z-index: 2147481800; left: 16px; bottom: 96px;
  width: 268px; display: flex; flex-direction: column;
  color: #e8f1ff; font-size: 12px;
  font-family: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  background: linear-gradient(180deg, rgba(16,29,48,.97), rgba(9,16,28,.97));
  border: 1px solid rgba(120,180,255,.24); border-radius: 16px;
  box-shadow: 0 18px 44px rgba(0,0,0,.48);
  -webkit-app-region: no-drag;
}
.dsh-sense-head {
  display: flex; align-items: center; gap: 8px; padding: 9px 12px; user-select: none;
  background: rgba(30,52,86,.55); border-bottom: 1px solid rgba(120,180,255,.14);
  border-radius: 16px 16px 0 0;
}
.dsh-sense-dot { width: 8px; height: 8px; border-radius: 50%; background: #7d8fa8; flex: none; }
.dsh-sense-dot.on { background: #4ea1ff; box-shadow: 0 0 10px #4ea1ff; }
.dsh-sense-title { font-weight: 600; letter-spacing: .02em; }
.dsh-sense-spacer { flex: 1; }
.dsh-sense-mini { background: transparent; color: #9fb6d4; border: none; cursor: pointer; font-size: 14px; }
.dsh-sense-mini:hover { color: #e8f1ff; }
.dsh-sense-body { padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 8px; }
.dsh-sense-row { display: flex; align-items: center; gap: 8px; }
.dsh-sense-row > span { flex: none; width: 62px; color: #a8bcdb; }
.dsh-sense-toggle {
  flex: 1; display: flex; align-items: center; justify-content: space-between;
  background: rgba(90,140,210,.13); color: #cfe2ff; border: 1px solid rgba(120,180,255,.2);
  border-radius: 9px; padding: 5px 9px; cursor: pointer; font-size: 11px;
}
.dsh-sense-toggle .knob { width: 30px; height: 16px; border-radius: 999px; background: rgba(140,170,210,.3); position: relative; flex: none; }
.dsh-sense-toggle .knob::after { content: ''; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: #dce9ff; transition: transform .15s; }
.dsh-sense-toggle.on .knob { background: #4ea1ff; }
.dsh-sense-toggle.on .knob::after { transform: translateX(14px); }
.dsh-sense-match {
  flex: 1; min-width: 0; background: rgba(12,22,38,.9); color: #dbe8ff;
  border: 1px solid rgba(120,180,255,.2); border-radius: 9px; padding: 5px 8px; font-size: 11px;
}
.dsh-sense-slider { flex: 1; display: flex; align-items: center; gap: 8px; }
.dsh-sense-slider input[type=range] { flex: 1; min-width: 0; accent-color: #4ea1ff; }
.dsh-sense-value { flex: none; width: 46px; text-align: right; color: #8fd0ff; font-variant-numeric: tabular-nums; font-size: 10.5px; }
.dsh-sense-look {
  width: 100%; background: #6fb2ff; color: #04121f; border: none; border-radius: 10px;
  padding: 7px 10px; cursor: pointer; font-size: 12px; font-weight: 700;
}
.dsh-sense-look:hover { background: #8cc4ff; }
.dsh-sense-look:disabled { opacity: .55; cursor: default; }
.dsh-sense-foot { color: #8098b8; font-size: 10.5px; line-height: 1.5; min-height: 16px; }
.dsh-sense-chip {
  position: fixed; z-index: 2147481800; left: 16px; bottom: 96px;
  width: 40px; height: 40px; border-radius: 50%; cursor: pointer;
  background: linear-gradient(180deg, rgba(16,29,48,.97), rgba(9,16,28,.97));
  border: 1px solid rgba(120,180,255,.28); color: #cfe2ff; font-size: 16px;
  box-shadow: 0 8px 24px rgba(0,0,0,.42); -webkit-app-region: no-drag;
}
.dsh-sense-chip:hover { background: rgba(70,120,190,.5); }
`;

    function el(tag, className) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      return node;
    }

    async function api(path, options) {
      const response = await fetch(`${ROUTE}${path}`, {
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        ...options,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body?.ok === false) throw new Error(body?.message || `HTTP ${response.status}`);
      return body;
    }

    function readLayout() {
      try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      } catch {
        return {};
      }
    }

    function writeLayout(value) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      } catch {
        /* 无所谓 */
      }
    }

    return {
      apply() {
        let collapsed = readLayout().collapsed === true;
        for (const node of Array.from(document.querySelectorAll('[data-dsh-whale-sense]'))) node.remove();
        for (const node of Array.from(document.querySelectorAll('style[data-dsh-whale-sense-css]'))) node.remove();

        const style = document.createElement('style');
        style.dataset.dshWhaleSenseCss = 'true';
        style.textContent = CSS;
        document.head.appendChild(style);

        const chip = el('button', 'dsh-sense-chip');
        chip.type = 'button';
        chip.dataset.dshWhaleSense = 'chip';
        chip.title = '鲸鱼陪看';
        chip.textContent = '👀';

        const panel = el('div', 'dsh-sense-panel');
        panel.dataset.dshWhaleSense = 'panel';

        const head = el('div', 'dsh-sense-head');
        const dot = el('span', 'dsh-sense-dot');
        const title = el('span', 'dsh-sense-title');
        title.textContent = '鲸鱼陪看';
        const spacer = el('span', 'dsh-sense-spacer');
        const collapse = el('button', 'dsh-sense-mini');
        collapse.type = 'button';
        collapse.textContent = '—';
        head.append(dot, title, spacer, collapse);

        const body = el('div', 'dsh-sense-body');

        const autoRow = el('div', 'dsh-sense-row');
        const autoLabel = el('span');
        autoLabel.textContent = '自动陪看';
        const autoToggle = el('button', 'dsh-sense-toggle');
        autoToggle.type = 'button';
        const autoText = el('span');
        autoText.textContent = '画面变了就说';
        const autoKnob = el('span', 'knob');
        autoToggle.append(autoText, autoKnob);
        autoRow.append(autoLabel, autoToggle);
        body.append(autoRow);

        const matchRow = el('div', 'dsh-sense-row');
        const matchLabel = el('span');
        matchLabel.textContent = '只盯窗口';
        const matchInput = el('input', 'dsh-sense-match');
        matchInput.placeholder = '比如 EVE，留空=所有窗口';
        let matchTimer = null;
        matchInput.addEventListener('input', () => {
          if (matchTimer !== null) clearTimeout(matchTimer);
          matchTimer = setTimeout(async () => {
            try {
              const state = await api('/config', { method: 'POST', body: JSON.stringify({ windowMatch: matchInput.value }) });
              sync(state);
            } catch (error) {
              foot.textContent = String(error.message ?? error);
            }
          }, 400);
        });
        matchRow.append(matchLabel, matchInput);
        body.append(matchRow);

        const sliderValues = {};
        for (const item of SLIDERS) {
          const row = el('div', 'dsh-sense-row');
          const label = el('span');
          label.textContent = item.label;
          const wrap = el('div', 'dsh-sense-slider');
          const range = el('input');
          range.type = 'range';
          range.min = String(item.min);
          range.max = String(item.max);
          range.step = String(item.step);
          const value = el('span', 'dsh-sense-value');
          let timer = null;
          range.addEventListener('input', () => {
            value.textContent = `${range.value}${item.unit ?? ''}`;
            if (timer !== null) clearTimeout(timer);
            timer = setTimeout(async () => {
              try {
                const state = await api('/config', { method: 'POST', body: JSON.stringify({ [item.key]: Number(range.value) }) });
                sync(state);
              } catch (error) {
                foot.textContent = String(error.message ?? error);
              }
            }, 240);
          });
          wrap.append(range, value);
          row.append(label, wrap);
          body.append(row);
          sliderValues[item.key] = { range, value, unit: item.unit ?? '' };
        }

        const lookButton = el('button', 'dsh-sense-look');
        lookButton.type = 'button';
        lookButton.textContent = '看我一眼';
        lookButton.addEventListener('click', async () => {
          lookButton.disabled = true;
          lookButton.textContent = '在看了…';
          try {
            const result = await api('/look', { method: 'POST', body: '{}' });
            foot.textContent = result.woke ? '叫你了，等我说话。' : '没找到活跃会话，先发条消息再叫我。';
          } catch (error) {
            foot.textContent = String(error.message ?? error);
          } finally {
            lookButton.disabled = false;
            lookButton.textContent = '看我一眼';
          }
        });
        body.append(lookButton);

        const foot = el('div', 'dsh-sense-foot');
        body.append(foot);
        panel.append(head, body);
        document.body.append(panel, chip);

        autoToggle.addEventListener('click', async () => {
          const next = !autoToggle.classList.contains('on');
          autoToggle.classList.toggle('on', next);
          try {
            const state = await api('/config', { method: 'POST', body: JSON.stringify({ auto: next }) });
            sync(state);
            foot.textContent = next ? '自动陪看开了，我会看着。' : '自动陪看关了，想聊就点我。';
          } catch (error) {
            foot.textContent = String(error.message ?? error);
          }
        });

        function sync(state) {
          const config = state?.config;
          if (config === null || typeof config !== 'object') return;
          autoToggle.classList.toggle('on', config.auto === true);
          if (typeof config.windowMatch === 'string' && document.activeElement !== matchInput) {
            matchInput.value = config.windowMatch;
          }
          dot.classList.toggle('on', config.auto === true && state.helper === 'running');
          for (const item of SLIDERS) {
            const entry = sliderValues[item.key];
            const value = config[item.key];
            if (typeof value === 'number') {
              entry.range.value = String(value);
              entry.value.textContent = `${Math.round(value * 100) / 100}${entry.unit}`;
            }
          }
          const parts = [`眼睛${state.helper === 'running' ? '在线' : '未启动'}`];
          if (typeof state.recentReactions === 'number') parts.push(`这一小时 ${state.recentReactions} 次`);
          if (state.lastError) parts.push(`报错：${String(state.lastError).slice(0, 40)}`);
          foot.textContent = parts.join(' · ');
        }

        async function refresh() {
          try {
            sync(await api('/state'));
          } catch (error) {
            foot.textContent = `连不上 Host：${String(error.message ?? error).slice(0, 40)}`;
          }
        }

        function applyCollapsed() {
          panel.style.display = collapsed ? 'none' : 'flex';
          chip.style.display = collapsed ? 'block' : 'none';
        }

        collapse.addEventListener('click', () => {
          collapsed = true;
          writeLayout({ collapsed });
          applyCollapsed();
        });
        chip.addEventListener('click', () => {
          collapsed = false;
          writeLayout({ collapsed });
          applyCollapsed();
          void refresh();
        });

        applyCollapsed();
        void refresh();
        const timer = setInterval(refresh, 15000);
        if (typeof timer.unref === 'function') timer.unref();

        return () => {
          clearInterval(timer);
          style.remove();
          panel.remove();
          chip.remove();
        };
      },
    };
  },
});
