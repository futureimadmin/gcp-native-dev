/* Appearance: themes, fonts and editor display. Everything applies live and is remembered in settings.appearance / settings.editor.
   Defaults are the NetBeans ones: editor font "Monospaced" 13, interface font Segoe UI, at 100%. */
'use strict';

const NB_EDITOR_FONT = 'Monospaced, "Courier New", monospace'; // NetBeans default editor font
const NB_UI_FONT = '"Segoe UI", sans-serif'; // NetBeans default interface font

/* ---- themes: colours for the interface (CSS variables) and the editor (Monaco) ---- */
const DARK_RULES = [
  ['keyword', 'c792ea'], ['keyword.flow', 'ff79c6'], ['type', '4ec9b0'], ['type.identifier', '4ec9b0'], ['namespace', '7fd1c8'], ['annotation', 'ffb454'],
  ['string', '9ece6a'], ['string.escape', '56d4dd'], ['number', 'ff9e64'], ['regexp', 'f7768e'], ['tag', 'f7768e'], ['predefined', '7aa2f7'], ['variable', 'e0af68'],
  ['delimiter', '9aa5b1'], ['operator', '89ddff'], ['comment', '6f8f6a', 'italic'], ['comment.doc', '7fa57a', 'italic'],
];
const LIGHT_RULES = [
  ['keyword', '7b3fa0'], ['keyword.flow', 'b0306f'], ['type', '00798a'], ['type.identifier', '00798a'], ['namespace', '1d7f74'], ['annotation', 'a05a00'],
  ['string', '2e7d32'], ['string.escape', '00838f'], ['number', 'c25100'], ['regexp', 'c2185b'], ['tag', 'c2185b'], ['predefined', '1a5fb4'], ['variable', 'a0620b'],
  ['delimiter', '555555'], ['operator', '0b7285'], ['comment', '7a8b76', 'italic'], ['comment.doc', '6d8a68', 'italic'],
];
const NETBEANS_RULES = [
  ['keyword', '0000e6', 'bold'], ['keyword.flow', '0000e6', 'bold'], ['type', '000000'], ['annotation', '808000'], ['string', 'ce7b00'], ['number', '000000'],
  ['comment', '969696', 'italic'], ['comment.doc', '969696', 'italic'], ['tag', '0000e6'], ['predefined', '000000'], ['variable', '000000'], ['operator', '000000'], ['delimiter', '000000'],
];

const THEMES = [
  { id: 'nativity-dark', name: 'Nativity Dark', kind: 'dark', monaco: 'cns-dark',
    vars: { '--bg': '#0e0f0c', '--bg2': '#151713', '--bg3': '#1c1e19', '--line': '#2a2d28', '--fg': '#f0ece3', '--dim': '#9a9c93', '--accent': '#8a9e90', '--accent2': '#a9c0b0', '--danger': '#d9776b', '--ok': '#7fbf8a', '--warn': '#d9b45b', '--cloud': '#4f7fc7', '--hover': '#25302a', '--on-accent': '#0e0f0c' } },
  { id: 'nativity-light', name: 'Nativity Light', kind: 'light', rules: LIGHT_RULES,
    vars: { '--bg': '#fbfaf7', '--bg2': '#f2f0ea', '--bg3': '#e8e5dc', '--line': '#d6d2c6', '--fg': '#1d1f1a', '--dim': '#6b6e64', '--accent': '#4d6b57', '--accent2': '#3a5545', '--danger': '#c0392b', '--ok': '#2e7d4f', '--warn': '#a8812b', '--cloud': '#2f6bb3', '--hover': '#e6e3d9', '--on-accent': '#ffffff' } },
  { id: 'netbeans-light', name: 'NetBeans Classic', kind: 'light', rules: NETBEANS_RULES,
    vars: { '--bg': '#ffffff', '--bg2': '#f0f0f0', '--bg3': '#e4e4e4', '--line': '#c9c9c9', '--fg': '#000000', '--dim': '#5a5a5a', '--accent': '#3875d7', '--accent2': '#1f5bb5', '--danger': '#c00000', '--ok': '#2e8b3f', '--warn': '#b8860b', '--cloud': '#3875d7', '--hover': '#dfe8f6', '--on-accent': '#ffffff' } },
  { id: 'midnight', name: 'Midnight', kind: 'dark', rules: DARK_RULES,
    vars: { '--bg': '#0b1020', '--bg2': '#101830', '--bg3': '#16213f', '--line': '#24305a', '--fg': '#e6ecff', '--dim': '#8d9bc4', '--accent': '#6ea8fe', '--accent2': '#9ec5ff', '--danger': '#ff7b7b', '--ok': '#7fd6a0', '--warn': '#f0c674', '--cloud': '#6ea8fe', '--hover': '#1c2850', '--on-accent': '#0b1020' } },
  { id: 'solarized-dark', name: 'Solarized Dark', kind: 'dark', rules: DARK_RULES,
    vars: { '--bg': '#002b36', '--bg2': '#073642', '--bg3': '#0b4452', '--line': '#1c5563', '--fg': '#93a1a1', '--dim': '#657b83', '--accent': '#268bd2', '--accent2': '#2aa198', '--danger': '#dc322f', '--ok': '#859900', '--warn': '#b58900', '--cloud': '#268bd2', '--hover': '#0d4a58', '--on-accent': '#fdf6e3' } },
  { id: 'solarized-light', name: 'Solarized Light', kind: 'light', rules: LIGHT_RULES,
    vars: { '--bg': '#fdf6e3', '--bg2': '#eee8d5', '--bg3': '#e4ddc4', '--line': '#d3cbb0', '--fg': '#586e75', '--dim': '#839496', '--accent': '#268bd2', '--accent2': '#2aa198', '--danger': '#dc322f', '--ok': '#859900', '--warn': '#b58900', '--cloud': '#268bd2', '--hover': '#e8e1c8', '--on-accent': '#fdf6e3' } },
  { id: 'high-contrast', name: 'High Contrast', kind: 'hc', monacoBase: 'hc-black',
    vars: { '--bg': '#000000', '--bg2': '#0a0a0a', '--bg3': '#141414', '--line': '#ffffff', '--fg': '#ffffff', '--dim': '#d0d0d0', '--accent': '#ffd700', '--accent2': '#ffee58', '--danger': '#ff6b6b', '--ok': '#00e676', '--warn': '#ffd54f', '--cloud': '#4fc3f7', '--hover': '#262626', '--on-accent': '#000000' } },
];
const SYSTEM_THEME = { id: 'system', name: 'Follow the system', kind: 'system' };

const ACCENTS = ['#8a9e90', '#4f7fc7', '#3875d7', '#7c5cff', '#c792ea', '#d9776b', '#e0a100', '#2aa198', '#3fa66a'];

const EDITOR_FONTS = [
  ['Monospaced, "Courier New", monospace', 'Monospaced (NetBeans default)', null],
  ['Consolas, "Courier New", monospace', 'Consolas', 'Consolas'],
  ['"Cascadia Code", Consolas, monospace', 'Cascadia Code', 'Cascadia Code'],
  ['"Cascadia Mono", Consolas, monospace', 'Cascadia Mono', 'Cascadia Mono'],
  ['"JetBrains Mono", Consolas, monospace', 'JetBrains Mono', 'JetBrains Mono'],
  ['"Fira Code", Consolas, monospace', 'Fira Code', 'Fira Code'],
  ['"Source Code Pro", Consolas, monospace', 'Source Code Pro', 'Source Code Pro'],
  ['"Courier New", monospace', 'Courier New', 'Courier New'],
  ['"Lucida Console", monospace', 'Lucida Console', 'Lucida Console'],
  ['Menlo, Monaco, monospace', 'Menlo', 'Menlo'],
  ['"SF Mono", Menlo, monospace', 'SF Mono', 'SF Mono'],
  ['"DejaVu Sans Mono", monospace', 'DejaVu Sans Mono', 'DejaVu Sans Mono'],
];
const UI_FONTS = [
  ['"Segoe UI", sans-serif', 'Segoe UI (NetBeans default)', null],
  ['system-ui, sans-serif', 'System font', null],
  ['Arial, sans-serif', 'Arial', 'Arial'],
  ['Calibri, sans-serif', 'Calibri', 'Calibri'],
  ['Verdana, sans-serif', 'Verdana', 'Verdana'],
  ['Tahoma, sans-serif', 'Tahoma', 'Tahoma'],
  ['Inter, "Segoe UI", sans-serif', 'Inter', 'Inter'],
  ['"Helvetica Neue", Helvetica, sans-serif', 'Helvetica Neue', 'Helvetica Neue'],
];

const APPEARANCE_DEFAULTS = {
  theme: 'nativity-dark', accent: '', editorFont: NB_EDITOR_FONT, uiFont: NB_UI_FONT, scale: 100,
  ligatures: false, lineHeight: 0, minimap: true, wordWrap: false, lineNumbers: true, whitespace: 'none',
  cursor: 'line', blinking: 'blink', smooth: false, guides: true, bracketColors: true, folding: true, highlight: 'line',
};

const appearance = () => ({ ...APPEARANCE_DEFAULTS, ...(state.settings.appearance || {}) });
const fontInstalled = (probe) => { try { return !probe || document.fonts.check(`13px "${probe}"`); } catch { return true; } };

function resolveTheme(id) {
  if (id === 'system') {
    const dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    return THEMES.find((t) => t.id === (dark ? 'nativity-dark' : 'nativity-light'));
  }
  return THEMES.find((t) => t.id === id) || THEMES[0];
}

/** Lightens or darkens a #rrggbb colour. */
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v + (amt >= 0 ? (255 - v) * amt : v * amt))));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => f(v).toString(16).padStart(2, '0')).join('')}`;
}
const luma = (hex) => { const n = parseInt(hex.slice(1), 16); return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };

/** Registers one Monaco theme per Nativity theme (the first, Nativity Dark, is defined by the editor start-up code). */
function defineAppearanceThemes() {
  if (typeof monaco === 'undefined') return;
  for (const t of THEMES) {
    if (t.monaco) continue;
    monaco.editor.defineTheme(`cns-${t.id}`, {
      base: t.monacoBase || (t.kind === 'light' ? 'vs' : 'vs-dark'), inherit: true,
      rules: (t.rules || []).map(([token, fg, fontStyle]) => ({ token, foreground: fg, ...(fontStyle ? { fontStyle } : {}) })),
      colors: { 'editor.background': t.vars['--bg'], 'editor.foreground': t.vars['--fg'], 'editor.lineHighlightBackground': t.vars['--bg2'], 'editorLineNumber.foreground': t.vars['--dim'] },
    });
  }
}
const monacoThemeFor = (t) => t.monaco || `cns-${t.id}`;

function editorOptionsFromAppearance() {
  const a = appearance();
  const e = state.settings.editor || {};
  return {
    fontFamily: a.editorFont, fontSize: e.fontSize || 13, fontLigatures: !!a.ligatures, lineHeight: a.lineHeight || 0,
    minimap: { enabled: !!a.minimap }, wordWrap: a.wordWrap ? 'on' : 'off', lineNumbers: a.lineNumbers ? 'on' : 'off',
    renderWhitespace: a.whitespace, cursorStyle: a.cursor, cursorBlinking: a.blinking, smoothScrolling: !!a.smooth, cursorSmoothCaretAnimation: a.smooth ? 'on' : 'off',
    guides: { indentation: !!a.guides, bracketPairs: !!a.bracketColors }, bracketPairColorization: { enabled: !!a.bracketColors }, folding: !!a.folding, renderLineHighlight: a.highlight,
  };
}

/** Applies everything: interface colours and fonts, the editor theme and options, the page zoom. */
function applyAppearance() {
  const a = appearance();
  const t = resolveTheme(a.theme);
  const root = document.documentElement;
  for (const [k, v] of Object.entries(t.vars)) root.style.setProperty(k, v);
  if (a.accent && /^#[0-9a-f]{6}$/i.test(a.accent)) {
    root.style.setProperty('--accent', a.accent);
    root.style.setProperty('--accent2', luma(t.vars['--bg']) > 0.5 ? shade(a.accent, -0.25) : shade(a.accent, 0.3));
    root.style.setProperty('--on-accent', luma(a.accent) > 0.6 ? '#0e0f0c' : '#ffffff');
  }
  root.style.setProperty('--font', a.uiFont);
  root.style.setProperty('--mono', a.editorFont);
  root.style.colorScheme = t.kind === 'light' ? 'light' : 'dark';
  root.dataset.theme = t.id;
  if (typeof monaco !== 'undefined' && editor) {
    monaco.editor.setTheme(monacoThemeFor(t));
    editor.updateOptions(editorOptionsFromAppearance());
  }
  tryInv('app:setZoom', Math.max(0.7, Math.min(1.6, (a.scale || 100) / 100)));
}

async function saveAppearance(patch) {
  state.settings.appearance = { ...(state.settings.appearance || {}), ...patch };
  await tryInv('settings:set', 'appearance', state.settings.appearance);
  applyAppearance();
}

/* ---- the Appearance page in Settings ---- */

function appearancePane(redraw) {
  const a = appearance();
  const e = state.settings.editor || {};
  const size = e.fontSize || 13;
  const set = (patch) => saveAppearance(patch).then(redraw);

  const themeCard = (t) => {
    const r = t.kind === 'system' ? resolveTheme('system') : t;
    const v = r.vars;
    return h('button', { class: `thm${a.theme === t.id ? ' on' : ''}`, title: t.name, onclick: () => set({ theme: t.id }) },
      h('div', { class: 'thm-prev', style: `background:${v['--bg']};color:${v['--fg']};border-color:${v['--line']}` },
        h('div', { class: 'thm-bar', style: `background:${v['--bg2']};border-color:${v['--line']}` }, h('i', { style: `background:${v['--accent']}` }), h('i', { style: `background:${v['--dim']}` })),
        h('div', { class: 'thm-code' }, h('b', { style: `color:${v['--accent']}`, text: 'class ' }), h('span', { text: 'Aa' }), h('em', { style: `color:${v['--dim']}`, text: ' // text' }))),
      h('span', { class: 'thm-name', text: t.kind === 'system' ? `${t.name} (${r.name})` : t.name }));
  };
  const accents = h('div', { class: 'swatches' },
    h('button', { class: `sw auto${a.accent ? '' : ' on'}`, title: 'The theme’s own colour', text: 'Auto', onclick: () => set({ accent: '' }) }),
    ...ACCENTS.map((c) => h('button', { class: `sw${a.accent === c ? ' on' : ''}`, style: `background:${c}`, title: c, onclick: () => set({ accent: c }) })),
    (() => { const i = h('input', { type: 'color', value: a.accent || '#8a9e90', title: 'Pick any colour' }); i.onchange = () => set({ accent: i.value }); return i; })());

  const fontSel = (list, value, key) => {
    const known = list.some((f) => f[0] === value);
    const sel = h('select', {}, ...list.map(([css, name, probe]) => {
      const ok = fontInstalled(probe);
      return h('option', { value: css, text: ok ? name : `${name} (not installed)`, selected: css === value, disabled: !ok });
    }), h('option', { value: '__custom', text: 'Other font…', selected: !known }));
    sel.onchange = () => { if (sel.value !== '__custom') set({ [key]: sel.value }); else redraw(); };
    return sel;
  };
  const customFont = (list, value, key) => {
    if (list.some((f) => f[0] === value)) return null;
    const i = h('input', { value, spellcheck: 'false', placeholder: 'Font name, for example "Iosevka", monospace' });
    i.onchange = () => set({ [key]: i.value.trim() || APPEARANCE_DEFAULTS[key] });
    return i;
  };
  const num = (value, min, max, step, onChange) => { const i = h('input', { type: 'number', min, max, step, value }); i.onchange = () => onChange(Math.max(min, Math.min(max, Number(i.value) || min))); return i; };
  const tog = (key, label, hint) => h('label', { class: 'inline', title: hint || '' }, (() => { const c = h('input', { type: 'checkbox', checked: !!a[key] }); c.onchange = () => set({ [key]: c.checked }); return c; })(), ` ${label}`);
  const pick = (key, label, opts) => { const s = h('select', {}, ...opts.map(([v, t]) => h('option', { value: v, text: t, selected: a[key] === v }))); s.onchange = () => set({ [key]: s.value }); return [h('label', { text: label }), s]; };

  const sample = h('pre', { class: 'apx-sample', style: `font-family:${a.editorFont};font-size:${size}px;line-height:${a.lineHeight ? `${a.lineHeight}px` : 'normal'};font-variant-ligatures:${a.ligatures ? 'normal' : 'none'}` },
    '@Service\npublic class Orders {\n    // maps → arrows, != == >= <= => ->\n    String find(int id) { return "order-" + id; }\n}');

  return h('div', { class: 'apx' }, h('h3', { text: 'Appearance' }),
    h('p', { class: 't-dim', text: 'Changes apply at once and are remembered. The defaults are the NetBeans ones: editor font Monospaced 13, interface font Segoe UI at 100%.' }),
    h('h4', { text: 'Theme' }),
    h('div', { class: 'thms' }, themeCard(SYSTEM_THEME), ...THEMES.map(themeCard)),
    h('label', { text: 'Accent colour' }), accents,
    h('h4', { text: 'Editor font' }),
    h('label', { text: 'Font' }), fontSel(EDITOR_FONTS, a.editorFont, 'editorFont'), customFont(EDITOR_FONTS, a.editorFont, 'editorFont'),
    h('div', { class: 'row' },
      h('div', {}, h('label', { text: 'Size' }), num(size, 8, 40, 1, async (n) => { state.settings.editor = { ...e, fontSize: n }; await tryInv('settings:set', 'editor.fontSize', n); applyAppearance(); redraw(); })),
      h('div', {}, h('label', { text: 'Line height (0 = automatic)' }), num(a.lineHeight, 0, 80, 1, (n) => set({ lineHeight: n })))),
    tog('ligatures', 'Font ligatures (join symbols like => != >=; needs a font that has them, such as Cascadia Code or Fira Code)'),
    sample,
    h('h4', { text: 'Interface' }),
    h('label', { text: 'Interface font' }), fontSel(UI_FONTS, a.uiFont, 'uiFont'), customFont(UI_FONTS, a.uiFont, 'uiFont'),
    h('label', { text: 'Interface size' }), (() => { const s = h('select', {}, ...[[80, '80% (compact)'], [90, '90%'], [100, '100% (default)'], [110, '110%'], [125, '125%'], [150, '150% (large)']].map(([v, t]) => h('option', { value: v, text: t, selected: v === Number(a.scale) }))); s.onchange = () => set({ scale: Number(s.value) }); return s; })(),
    h('h4', { text: 'Editor display' }),
    h('div', { class: 'apx-grid' },
      tog('minimap', 'Minimap'), tog('lineNumbers', 'Line numbers'), tog('wordWrap', 'Wrap long lines'), tog('folding', 'Code folding'),
      tog('guides', 'Indent guides'), tog('bracketColors', 'Coloured bracket pairs'), tog('smooth', 'Smooth scrolling and caret')),
    ...pick('whitespace', 'Show whitespace', [['none', 'Never'], ['boundary', 'Between words'], ['selection', 'In the selection'], ['all', 'Always']]),
    ...pick('cursor', 'Cursor', [['line', 'Line'], ['block', 'Block'], ['underline', 'Underline'], ['line-thin', 'Thin line']]),
    ...pick('blinking', 'Cursor blinking', [['blink', 'Blink'], ['smooth', 'Smooth'], ['phase', 'Phase'], ['expand', 'Expand'], ['solid', 'Solid']]),
    ...pick('highlight', 'Highlight the current line', [['line', 'Line'], ['gutter', 'Margin only'], ['all', 'Both'], ['none', 'Off']]),
    h('div', { class: 'row', style: 'margin-top:14px' }, h('button', { text: 'Reset to NetBeans defaults', onclick: async () => {
      state.settings.editor = { ...e, fontSize: 13 }; await tryInv('settings:set', 'editor.fontSize', 13);
      await saveAppearance({ ...APPEARANCE_DEFAULTS }); redraw(); status('Appearance reset to the NetBeans defaults.');
    } })));
}
