/* Project types: detect what kind of project a folder is (Maven, Spring Boot, React, Django ...), give each a colour and a tag in the
   Explorer, and describe the commands its right-click menu offers. Works for the open folder and for every project inside a monorepo. */
'use strict';

const PKIND = {
  maven: { label: 'Maven (Java)', short: 'MVN', color: '#e5675d', family: 'java', tool: 'maven' },
  spring: { label: 'Spring Boot', short: 'SPRING', color: '#6db33f', family: 'java', tool: 'maven' },
  quarkus: { label: 'Quarkus', short: 'QUARKUS', color: '#4695eb', family: 'java', tool: 'maven' },
  gradle: { label: 'Gradle', short: 'GRADLE', color: '#2fb5a3', family: 'java', tool: 'gradle' },
  'spring-gradle': { label: 'Spring Boot (Gradle)', short: 'SPRING', color: '#6db33f', family: 'java', tool: 'gradle' },
  ant: { label: 'Ant (Java)', short: 'ANT', color: '#b5598f', family: 'java', tool: 'ant' },
  react: { label: 'React', short: 'REACT', color: '#4fd1f5', family: 'node', tool: 'node' },
  next: { label: 'Next.js', short: 'NEXT', color: '#e8e8e8', family: 'node', tool: 'node' },
  angular: { label: 'Angular', short: 'NG', color: '#e8354f', family: 'node', tool: 'node' },
  vue: { label: 'Vue', short: 'VUE', color: '#42c08a', family: 'node', tool: 'node' },
  svelte: { label: 'Svelte', short: 'SVELTE', color: '#ff6a3d', family: 'node', tool: 'node' },
  nest: { label: 'NestJS', short: 'NEST', color: '#e0234e', family: 'node', tool: 'node' },
  node: { label: 'Node.js', short: 'NODE', color: '#8cc84b', family: 'node', tool: 'node' },
  python: { label: 'Python', short: 'PY', color: '#e6c34a', family: 'python', tool: 'python' },
  django: { label: 'Django', short: 'DJANGO', color: '#3fb985', family: 'python', tool: 'python' },
  flask: { label: 'Flask', short: 'FLASK', color: '#a8b3c0', family: 'python', tool: 'python' },
  fastapi: { label: 'FastAPI', short: 'FASTAPI', color: '#19b3a1', family: 'python', tool: 'python' },
  go: { label: 'Go', short: 'GO', color: '#3fc4e8', family: 'go', tool: 'go' },
  rust: { label: 'Rust', short: 'RUST', color: '#e3946a', family: 'rust', tool: 'rust' },
  dotnet: { label: '.NET', short: '.NET', color: '#9b7cf0', family: 'dotnet', tool: 'dotnet' },
  php: { label: 'PHP (Composer)', short: 'PHP', color: '#8f9bd0', family: 'php', tool: 'php' },
  ruby: { label: 'Ruby', short: 'RUBY', color: '#e0524d', family: 'ruby', tool: 'ruby' },
  flutter: { label: 'Flutter / Dart', short: 'FLUTTER', color: '#5ac8fa', family: 'dart', tool: 'flutter' },
  terraform: { label: 'Terraform', short: 'TF', color: '#a574e8', family: 'iac', tool: 'terraform' },
  helm: { label: 'Helm chart', short: 'HELM', color: '#4f86f7', family: 'iac', tool: 'helm' },
  docker: { label: 'Docker', short: 'DOCKER', color: '#3b9cf0', family: 'iac', tool: 'docker' },
};

const SKIP_DIRS = new Set(['node_modules', 'target', 'build', 'dist', 'out', 'bin', 'obj', '.git', '.idea', '.vscode', '.gradle', '.venv', 'venv', '__pycache__', '.cnd', '.nativity', '.next', 'coverage', '.mvn']);
const projCache = new Map(); // folder (lower case) -> kind | null
const keyOf = (p) => String(p).split('/').join(BS).toLowerCase();

async function readText(dir, name) {
  const r = await tryInv('fs:readFile', joinPath(dir, name));
  return r.ok ? r.data : '';
}

/** What kind of project is in `dir`? Returns { id, ...PKIND, dir, scripts, pm, tags } or null when it is just a folder. */
async function detectProjectKind(dir, force) {
  const k = keyOf(dir);
  if (!force && projCache.has(k)) return projCache.get(k);
  let entries = [];
  try { entries = await inv('fs:readDir', dir); } catch { projCache.set(k, null); return null; }
  const names = new Set(entries.map((e) => e.name.toLowerCase()));
  const has = (n) => names.has(n);
  const anyExt = (re) => entries.some((e) => !e.isDir && re.test(e.name));
  const tags = [];
  if (has('dockerfile') || has('docker-compose.yml') || has('docker-compose.yaml') || has('compose.yaml')) tags.push('docker');
  let id = null;
  let scripts = {};
  let pm = 'npm';
  let text = '';

  if (has('pom.xml')) {
    text = await readText(dir, 'pom.xml');
    id = /spring-boot/i.test(text) ? 'spring' : /quarkus/i.test(text) ? 'quarkus' : 'maven';
    if (/lombok/i.test(text)) tags.push('lombok');
  } else if (has('build.gradle') || has('build.gradle.kts') || has('settings.gradle') || has('settings.gradle.kts')) {
    text = (await readText(dir, has('build.gradle') ? 'build.gradle' : 'build.gradle.kts')) || '';
    id = /spring-boot|org\.springframework\.boot/i.test(text) ? 'spring-gradle' : /quarkus/i.test(text) ? 'quarkus' : 'gradle';
    if (/lombok/i.test(text)) tags.push('lombok');
  } else if (has('build.xml')) id = 'ant';
  else if (has('package.json')) {
    let pkg = {};
    try { pkg = JSON.parse(await readText(dir, 'package.json')); } catch { pkg = {}; }
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    scripts = pkg.scripts || {};
    pm = has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : has('bun.lockb') ? 'bun' : 'npm';
    id = deps.next ? 'next' : (deps['@angular/core'] || has('angular.json')) ? 'angular' : deps['@nestjs/core'] ? 'nest' : deps.vue ? 'vue' : deps.svelte ? 'svelte' : deps.react ? 'react' : 'node';
    if (deps.typescript || has('tsconfig.json')) tags.push('typescript');
  } else if (has('pyproject.toml') || has('requirements.txt') || has('setup.py') || has('pipfile') || has('manage.py') || has('environment.yml') || has('setup.cfg')) {
    text = `${await readText(dir, 'requirements.txt')}\n${await readText(dir, 'pyproject.toml')}\n${await readText(dir, 'Pipfile')}`.toLowerCase();
    id = has('manage.py') || /\bdjango\b/.test(text) ? 'django' : /\bfastapi\b/.test(text) ? 'fastapi' : /\bflask\b/.test(text) ? 'flask' : 'python';
  } else if (has('go.mod')) id = 'go';
  else if (has('cargo.toml')) id = 'rust';
  else if (anyExt(/\.(csproj|sln|fsproj)$/i)) id = 'dotnet';
  else if (has('composer.json')) id = 'php';
  else if (has('gemfile')) id = 'ruby';
  else if (has('pubspec.yaml')) id = 'flutter';
  else if (has('chart.yaml')) id = 'helm';
  else if (anyExt(/\.tf$/i)) id = 'terraform';
  else if (tags.includes('docker')) id = 'docker';

  const out = id ? { id, ...PKIND[id], dir, scripts, pm, tags, text } : null;
  if (out && id === 'quarkus' && !has('pom.xml')) out.tool = 'gradle';
  projCache.set(k, out);
  return out;
}

const cachedKind = (dir) => projCache.get(keyOf(dir)) || null;

/** Finds the project a file or folder belongs to: the nearest folder above it (up to the workspace) that is a project. */
async function projectOf(p) {
  let dir = p;
  for (let i = 0; i < 20 && dir; i++) {
    const kind = await detectProjectKind(dir);
    if (kind) return kind;
    if (!state.workspace || keyOf(dir) === keyOf(state.workspace)) break;
    const up = dirName(dir);
    if (!up || up === dir) break;
    dir = up;
  }
  return null;
}

/* ------------------------------ Explorer colours ------------------------------ */

function paintProject(node, kind) {
  if (!node || !kind) return;
  node.classList.add('proj');
  node.style.setProperty('--pc', kind.color);
  if (!node.querySelector(':scope > .ptag')) node.append(h('span', { class: 'ptag', text: kind.short, title: `${kind.label} project` }));
}

/** Colours the project folders listed in `container` (direct children), without slowing the tree down. */
async function paintProjectChildren(container, entries) {
  const dirs = entries.filter((e) => e.isDir && !SKIP_DIRS.has(e.name.toLowerCase()) && !e.name.startsWith('.')).slice(0, 60);
  const nodes = new Map();
  for (const n of container.querySelectorAll(':scope > .node[data-path]')) nodes.set(keyOf(n.dataset.path), n);
  let i = 0;
  const worker = async () => {
    while (i < dirs.length) {
      const e = dirs[i++];
      const kind = await detectProjectKind(e.path);
      if (kind) paintProject(nodes.get(keyOf(e.path)), kind);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}

async function paintRoot() {
  if (!state.workspace) return;
  const kind = await detectProjectKind(state.workspace, true);
  const root = document.querySelector('#tree .node.root');
  if (!root) return;
  root.classList.toggle('proj', !!kind);
  if (kind) { root.style.setProperty('--pc', kind.color); const old = root.querySelector('.ptag'); if (old) old.remove(); root.querySelector('b').after(h('span', { class: 'ptag', text: kind.short, title: `${kind.label} project` })); }
  const st = $('st-lang');
  if (st && kind && !state.active) { st.textContent = kind.label; st.style.color = kind.color; }
  document.documentElement.style.setProperty('--project-color', kind ? kind.color : 'transparent');
}
