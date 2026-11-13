/* Settings dialog: General, Clouds, AI, Plugins, About. */
'use strict';

async function openSettings(tab) {
  state.settings = await inv('settings:get').catch(() => state.settings);
  await loadAi();
  state.plugins = await inv('host:plugins').catch(() => state.plugins);
  state.info = await inv('app:info').catch(() => state.info);
  const body = h('div', { class: 'settings' });
  const nav = h('div', { class: 'snav' });
  const pane = h('div', { class: 'spane' });
  body.append(nav, pane);
  const tabs = { general: ['General', generalPane], runtimes: ['Runtimes', runtimesPane], clouds: ['Clouds', cloudsPane], ai: ['AI', aiPane], plugins: ['Plugins', pluginsPane], about: ['About', aboutPane] };
  const close = modal('Settings', body, [h('button', { class: 'primary', text: 'Done', onclick: () => { close(); renderAiPanel(); renderHome(); } })], { wide: true });
  const show = (id) => {
    nav.replaceChildren(...Object.entries(tabs).map(([k, [label]]) => h('button', { class: k === id ? 'active' : '', text: label, onclick: () => show(k) })));
    pane.replaceChildren(tabs[id][1](() => show(id)));
  };
  show(tabs[tab] ? tab : 'general');
}

function generalPane() {
  const size = h('input', { type: 'number', min: 8, max: 32, value: (state.settings.editor && state.settings.editor.fontSize) || 13 });
  size.onchange = async () => { const n = Math.max(8, Math.min(32, Number(size.value) || 13)); await tryInv('settings:set', 'editor.fontSize', n); state.settings.editor = { ...(state.settings.editor || {}), fontSize: n }; setEditorFontSize(n); };
  const prompt = h('input', { type: 'checkbox', checked: !state.settings.startup || state.settings.startup.promptLogin !== false });
  prompt.onchange = async () => { await tryInv('settings:set', 'startup.promptLogin', prompt.checked); state.settings.startup = { ...(state.settings.startup || {}), promptLogin: prompt.checked }; };
  const mode = h('select', {}, [['afterDelay', 'After a short delay (about 1 second)'], ['onBlur', 'When the window loses focus'], ['off', 'Off (save manually)']].map(([v, t]) => h('option', { value: v, text: t, selected: v === ((state.settings.editor || {}).autoSave || 'afterDelay') })));
  mode.onchange = async () => { await tryInv('settings:set', 'editor.autoSave', mode.value); state.settings.editor = { ...(state.settings.editor || {}), autoSave: mode.value }; };
  const save = async (key, val) => { await tryInv('settings:set', 'editor.' + key, val); state.settings.editor = { ...(state.settings.editor || {}), [key]: val }; };
  const build = h('input', { type: 'checkbox', checked: (state.settings.editor || {}).autoBuild === true });
  build.onchange = () => save('autoBuild', build.checked);
  const check = h('input', { type: 'checkbox', checked: (state.settings.editor || {}).checkErrors !== false });
  check.onchange = () => { save('checkErrors', check.checked); if (!check.checked && typeof clearProblems === 'function') clearProblems(); };
  const delay = h('select', {}, [[5, 'After I stop typing for 5 seconds'], [10, 'After I stop typing for 10 seconds'], [0, 'Only when I save']].map(([v, t]) => h('option', { value: v, text: t, selected: v === (((state.settings.editor || {}).checkDelay) == null ? 5 : (state.settings.editor || {}).checkDelay) })));
  delay.onchange = () => save('checkDelay', Number(delay.value));
  const sweep = h('input', { type: 'checkbox', checked: (state.settings.editor || {}).checkModule === true });
  sweep.onchange = () => save('checkModule', sweep.checked);
  return h('div', {}, h('h3', { text: 'General' }),
    h('label', { text: 'Editor font size' }), size,
    h('label', { text: 'Auto-save' }), mode,
    h('label', { class: 'inline' }, check, ' Check Java for compile errors in the background (red mark in the margin, listed in PROBLEMS)'),
    h('label', { text: 'Check Java' }), delay,
    h('label', { class: 'inline' }, sweep, ' Also check the whole module after each check, so problems in other files show up too (slower on big modules)'),
    h('label', { class: 'inline' }, build, ' Also auto-build Kotlin, TypeScript, Go and C# projects on save (off by default)'),
    h('label', { class: 'inline' }, prompt, ' Ask me to sign in to Google Cloud at startup when no Application Default Credentials are found'),
    h('p', { class: 'hint', text: 'Fonts follow the NetBeans defaults: Segoe UI for the interface, Monospaced for the editor.' }));
}

function runtimesPane() {
  const box = h('div', {}, h('h3', { text: 'Runtimes' }),
    h('p', { class: 'hint', text: 'Tools the IDE uses to build, run and debug your projects. Choose an install folder to override what is on your PATH (for example a different JDK). Applies immediately.' }));
  const list = h('div', {}, h('div', { class: 'hint', text: 'Detecting…' }));
  box.append(list);
  const draw = (rows) => list.replaceChildren(...rows.map((r) => h('div', { class: 'card' },
    h('div', { class: 'cardh' }, h('span', { class: 'dot ' + (r.found ? 'ok' : 'off') }), h('b', { text: r.name }), h('small', { class: 't-dim', text: r.found ? (r.version || 'found') : 'not found' }), h('span', { class: 'spacer' }),
      r.override ? h('span', { class: 'chip', text: 'custom' }) : null),
    h('div', { class: 'kv', text: r.path || (r.folder ? 'Choose the Tomcat folder (contains bin/catalina)' : 'Not on PATH') }),
    h('div', { class: 'row' },
      h('button', { text: 'Browse…', onclick: async () => {
        const d = await inv('dialog:selectFolder', 'Select the ' + r.name + ' install folder').catch(() => null);
        if (!d) return;
        const res = await tryInv('runtime:set', r.id, d);
        if (!res.ok) return status(res.error, true);
        draw(res.data); detectBuildEnv();
      } }),
      r.override ? h('button', { text: 'Reset', onclick: async () => { const res = await tryInv('runtime:set', r.id, ''); if (res.ok) { draw(res.data); detectBuildEnv(); } } }) : null))));
  tryInv('runtime:list').then((r) => (r.ok ? draw(r.data) : list.replaceChildren(h('div', { class: 'msg err', text: r.error }))));
  return box;
}

function cloudsPane() {
  const rows = state.clouds.map((c) => {
    const s = state.cloudStatus[c.id] || {};
    const region = h('select', { onchange: async (e) => { await tryInv('settings:set', `cloud.region.${c.id}`, e.target.value); } },
      (c.regions || []).map((r) => h('option', { value: r, text: r, selected: r === (((state.settings.cloud || {}).region || {})[c.id] || c.defaultRegion) })));
    return h('div', { class: 'card' }, h('div', { class: 'cardh' }, h('span', { class: `dot ${s.signedIn ? 'ok' : 'off'}` }), h('b', { text: c.name }), h('span', { class: 'chip', text: c.kind })),
      h('div', { class: 'hint', text: s.signedIn ? `${s.identity || ''}${s.scope ? ` · ${s.scope}` : ''}` : 'Not signed in' }),
      c.regions && c.regions.length > 1 ? h('div', {}, h('label', { text: 'Default region' }), region) : null);
  });
  return h('div', {}, h('h3', { text: 'Clouds' }), h('p', { class: 'hint', text: 'Sign in from the Clouds view. You can be signed in to several clouds at once. Sign-in uses each cloud’s own CLI; the IDE never sees your passwords.' }), ...rows);
}

function aiPane(rerender) {
  const ai = state.ai;
  if (!ai) return h('div', { class: 'hint', text: 'Loading…' });
  const cards = ai.api.map((a) => {
    const key = h('input', { type: 'password', placeholder: a.keySet ? '•••••••• (stored)' : 'API key', autocomplete: 'off' });
    const msg = h('div', { class: 'msg' });
    const base = a.configurableBaseUrl ? h('input', { value: a.baseUrl, placeholder: 'Base URL' }) : null;
    const model = h('input', { value: a.model, placeholder: 'Model', list: `models-${a.id}` });
    if (a.auth === 'signin') {
      return h('div', { class: 'card' }, h('div', { class: 'cardh' }, h('span', { class: 'dot ' + (a.ready ? 'ok' : 'off') }), h('b', { text: a.name }), h('span', { class: 'chip', text: 'no API key' })),
        h('div', { class: 'hint', text: a.help }),
        h('div', { class: 'msg ' + (a.ready ? 'ok' : ''), text: a.statusText }),
        h('label', { text: 'Model' }), h('input', { value: a.model, list: 'models-' + a.id, onchange: async (e) => { await tryInv('ai:setConfig', a.id, { model: e.target.value.trim() }); } }),
        h('datalist', { id: 'models-' + a.id }, a.models.map((m) => h('option', { value: m }))),
        h('div', { class: 'row' }, a.canLogin && !a.ready ? h('button', { class: 'primary', text: 'Sign in', onclick: () => aiSignIn(a.id) }) : null, h('button', { text: 'Re-check', onclick: async () => { await loadAi(); rerender(); } })));
    }
    return h('div', { class: 'card' }, h('div', { class: 'cardh' }, h('span', { class: `dot ${a.keySet || !a.needsKey ? 'ok' : 'off'}` }), h('b', { text: a.name })),
      h('div', { class: 'hint', text: a.help }),
      h('datalist', { id: `models-${a.id}` }, a.models.map((m) => h('option', { value: m }))),
      h('label', { text: 'Model' }), model,
      base ? h('label', { text: 'Base URL' }) : null, base,
      h('label', { text: a.needsKey ? 'API key (stored encrypted by Windows)' : 'API key (optional)' }), key,
      h('div', { class: 'row' },
        h('button', { class: 'primary', text: 'Save', onclick: async () => {
          const cfg = { model: model.value.trim() };
          if (base) cfg.baseUrl = base.value.trim();
          let r = await tryInv('ai:setConfig', a.id, cfg);
          if (r.ok && key.value.trim()) r = await tryInv('ai:setKey', a.id, key.value.trim());
          msg.className = r.ok ? 'msg ok' : 'msg err';
          msg.textContent = r.ok ? 'Saved.' : r.error;
          if (r.ok) { key.value = ''; await loadAi(); rerender(); }
        } }),
        a.keySet ? h('button', { text: 'Remove key', onclick: async () => { await tryInv('ai:clearKey', a.id); await loadAi(); rerender(); } }) : null), msg);
  });
  const cli = ai.cli.map((a) => h('div', { class: 'card slim' }, h('span', { class: `dot ${a.installed ? 'ok' : 'off'}` }), h('b', { text: a.name }), h('small', { text: a.installed ? `installed (${a.cmd})` : a.installHint })));
  return h('div', {}, h('h3', { text: 'AI assistants' }),
    !ai.secureStorage ? h('p', { class: 'msg err', text: 'OS encryption is unavailable, so API keys cannot be stored.' }) : null,
    h('p', { class: 'hint', text: 'Keys are encrypted with the Windows keystore and used only by the IDE’s main process. Code you attach is sent to the provider you choose; use the local option to keep it on this machine.' }),
    ...cards, h('h3', { text: 'Terminal agents' }), h('p', { class: 'hint', text: 'These open in a terminal window in your project folder and use their own sign-in.' }), ...cli);
}

function pluginsPane(rerender) {
  const rows = state.plugins.map((p) => h('div', { class: 'card' },
    h('div', { class: 'cardh' }, h('b', { text: p.name }), h('small', { text: `${p.id} ${p.version}` }), h('span', { class: 'chip', text: p.builtin ? 'built-in' : 'third-party' }), p.error ? h('span', { class: 't-err', text: 'error' }) : null),
    h('div', { class: 'hint', text: p.description || '' }), p.error ? h('div', { class: 'msg err', text: p.error }) : null,
    !p.builtin ? h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: p.enabled, onchange: async (e) => {
      if (e.target.checked && !(await confirmBox(`Enable ${p.name}?`, 'Third-party plugins run with full access to your files and credentials on this computer. Only enable plugins you trust. Restart the IDE to apply.'))) { e.target.checked = false; return; }
      state.plugins = await inv('host:setEnabled', p.id, e.target.checked).catch(() => state.plugins);
      status('Restart the IDE to apply the plugin change.');
    } }), ' Enabled (restart required)') : null));
  return h('div', {}, h('h3', { text: 'Plugins' }),
    h('p', { class: 'hint', text: 'Clouds, AI providers, templates and migration analyzers are plugins. Add your own by dropping a folder with a plugin.json into the plugins folder.' }),
    h('div', { class: 'row' }, h('button', { text: 'Open plugins folder', onclick: () => inv('host:openPluginsDir').catch((e) => status(e.message, true)) }), h('button', { text: 'Plugin guide', onclick: () => CNS.run('help.plugins') })), ...rows);
}

function aboutPane() {
  const i = state.info || {};
  return h('div', {}, h('h3', { text: 'Nativity Studio' }),
    h('div', { class: 'kv' }, `Version ${i.version || ''} · Electron ${i.electron || ''} · ${i.platform || ''}`),
    h('div', { class: 'kv' }, `Data folder: ${i.userData || ''}`),
    h('div', { class: 'kv' }, `Secure key storage: ${i.secureStorage ? 'available' : 'unavailable'}`));
}
