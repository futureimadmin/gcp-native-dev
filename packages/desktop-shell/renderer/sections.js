/* Collapsible sections below the Explorer tree (Source Control, Build, ...). A plugin registers one:
     api.sections.register({ id, title, order, icon: () => Node, mount({ body, actions, badge, redraw }) {...} })
   `mount` runs once; the plugin then fills `body` itself whenever its data changes. */
'use strict';

CNS.sections = [];
const SEC = { mounted: new Map() };

function secOpen(id, dflt) {
  const v = ((state.settings.ui || {}).sections || {})[id];
  return v == null ? dflt !== false : !!v;
}

function renderSections() {
  const box = $('side-sections');
  if (!box) return;
  const list = CNS.sections.slice().sort((a, b) => (a.order || 50) - (b.order || 50));
  box.replaceChildren();
  for (const s of list) {
    let m = SEC.mounted.get(s.id);
    if (!m) {
      const caret = h('span', { class: 'caret', text: '▾' });
      const title = h('span', { class: 'stitle', text: s.title });
      const badge = h('span', { class: 'sbadge' });
      const actions = h('span', { class: 'actions' });
      const head = h('div', { class: 'ssec-h', title: 'Click to collapse or expand' }, caret, s.icon ? s.icon() : null, title, badge, h('span', { class: 'spacer' }), actions);
      const body = h('div', { class: 'ssec-b' });
      const el = h('div', { class: 'ssec', 'data-sec': s.id }, head, body);
      m = { el, body, actions, badge, caret };
      const apply = (open) => { el.classList.toggle('collapsed', !open); caret.textContent = open ? '▾' : '▸'; };
      head.addEventListener('click', async (e) => {
        if (e.target.closest('.actions')) return;
        const open = el.classList.contains('collapsed');
        apply(open);
        state.settings.ui = { ...(state.settings.ui || {}), sections: { ...((state.settings.ui || {}).sections || {}), [s.id]: open } };
        tryInv('settings:set', 'ui.sections', state.settings.ui.sections);
        if (open && m.onOpen) m.onOpen();
      });
      apply(secOpen(s.id, s.defaultOpen));
      SEC.mounted.set(s.id, m);
      try {
        s.mount({
          body, actions, badge: (t) => { badge.textContent = t || ''; badge.classList.toggle('hidden', !t); },
          setOnOpen: (fn) => { m.onOpen = fn; }, isOpen: () => !el.classList.contains('collapsed'),
          open: () => { apply(true); },
        });
      } catch (e) { body.append(h('div', { class: 'msg err', text: `${s.title}: ${e.message}` })); }
    }
    box.append(m.el);
  }
  $('side-split').classList.toggle('hidden', !list.length);
  box.classList.toggle('hidden', !list.length);
}

function wireSections() {
  const split = $('side-split');
  const apply = (px) => document.documentElement.style.setProperty('--sections-h', `${px}px`);
  const saved = Number(((state.settings.ui || {}).sectionsH) || 0);
  if (saved >= 120) apply(saved);
  split.addEventListener('mousedown', (e) => {
    const startY = e.clientY;
    const startH = $('side-sections').offsetHeight;
    const side = $('view-explorer').getBoundingClientRect().height;
    const move = (ev) => apply(Math.max(120, Math.min(side - 140, startH + (startY - ev.clientY))));
    const up = () => {
      document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
      const px = $('side-sections').offsetHeight;
      state.settings.ui = { ...(state.settings.ui || {}), sectionsH: px };
      tryInv('settings:set', 'ui.sectionsH', px);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    e.preventDefault();
  });
  split.addEventListener('dblclick', () => { document.documentElement.style.removeProperty('--sections-h'); });
  CNS.on('sections-changed', renderSections);
}
