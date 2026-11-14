/* Right-click menus of the Explorer. The menu depends on WHAT you click and on the TYPE of project it belongs to:
   project folder (Maven, Spring Boot, React, Django ...), Java package, Java class, other folder, other file.
   Commands run in the Terminal panel so you always see what is executed. Nothing runs until you choose it. */
'use strict';

const isIdent = (s) => /^[A-Za-z_$][\w$]*$/.test(s);
const q = (p) => `"${p}"`;

function runIn(dir, line) {
  showPanel('terminal');
  state.cwd = dir;
  $('term-prompt').textContent = promptStr();
  termRun(line);
}

const cmdItem = (label, dir, line, hint) => ({ label, hint, run: () => runIn(dir, line) });

async function askToken(title, placeholder, re, hint) {
  const v = await promptText(title, placeholder);
  if (!v) return null;
  if (!re.test(v)) { status(hint || 'That value has characters that are not allowed here.', true); return null; }
  return v;
}

/* ------------------------------ Git ------------------------------ */

async function findRepo(dir) {
  let d = dir;
  for (let i = 0; i < 14 && d; i++) {
    if (await inv('fs:exists', joinPath(d, '.git')).catch(() => false)) return d;
    const up = dirName(d);
    if (!up || up === d) break;
    d = up;
  }
  return null;
}

/** Git commands for a folder or file; they run at the root of the repository that contains it. */
async function gitMenu(dir, target) {
  const repo = await findRepo(dir);
  if (!repo) return [cmdItem('Initialize Git repository', dir, 'git init')];
  const rel = target ? target.slice(repo.length).replace(/^[\\/]+/, '').split(BS).join('/') : '';
  const isFile = !!target && /\.[A-Za-z0-9]+$/.test(baseName(target));
  const at = rel ? ` -- ${q(rel)}` : '';
  const g = (label, line) => cmdItem(label, repo, line);
  const items = [
    g('Status', 'git status -sb'), g(rel ? `Diff of this ${isFile ? 'file' : 'folder'}` : 'Diff (unstaged changes)', `git diff${at}`), g('Diff (staged)', `git diff --staged${at}`),
    g(rel ? 'History of this ' + (isFile ? 'file' : 'folder') : 'History (last 20)', `git log --oneline --graph --decorate -20${at}`),
    '-',
    g(rel ? 'Add (stage) this' : 'Add all changes', rel ? `git add ${q(rel)}` : 'git add -A'),
    { label: 'Commit…', run: async () => { const m = await promptText('Commit', 'Commit message'); if (m) runIn(repo, `git commit -m "${m.replace(/["%^&|<>\r\n]/g, "'")}"`); } },
    g('Pull', 'git pull'), g('Push', 'git push'), g('Fetch', 'git fetch --all --prune'),
    '-',
    g('Branches', 'git branch -a -vv'),
    { label: 'New branch…', run: async () => { const b = await askToken('New branch', 'feature/name', /^[\w./-]{1,80}$/, 'Branch names use letters, digits and . / _ -'); if (b) runIn(repo, `git switch -c ${b}`); } },
    { label: 'Switch branch…', run: async () => { const b = await askToken('Switch to branch', 'branch-name', /^[\w./-]{1,80}$/, 'Branch names use letters, digits and . / _ -'); if (b) runIn(repo, `git switch ${b}`); } },
    g('Stash changes', 'git stash push'), g('Apply last stash', 'git stash pop'),
  ];
  if (isFile) items.push('-', g('Blame (who changed each line)', `git blame ${q(rel)}`), { label: 'Discard changes in this file…', run: async () => { if (await confirmBox(`Discard all uncommitted changes in ${baseName(target)}?`, 'The file goes back to the last commit. This cannot be undone.')) runIn(repo, `git restore ${q(rel)}`); } });
  return items;
}

/* ------------------------------ New ... ------------------------------ */

/** Creates a file from a template after asking for a name. */
async function newFromTemplate({ dir, title, placeholder, ext, body, nameRe }) {
  const n = await promptText(title, placeholder);
  if (!n) return;
  if (!(nameRe || /^[A-Za-z_][\w.-]*$/).test(n)) return status('Use letters, digits, - and _ for the name.', true);
  const file = joinPath(dir, n.endsWith(ext) ? n : n + ext);
  try { await inv('fs:create', file, false); await inv('fs:writeFile', file, body(n.replace(/\.[^.]+$/, ''))); } catch (e) { return status(e.message, true); }
  await refreshTree();
  openAt(file, 1);
}

const pascal = (s) => s.replace(/(^|[-_ .]+)(\w)/g, (_m, _a, c) => c.toUpperCase());
const snake = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[-\s.]+/g, '_').toLowerCase();

function newItems(dir, kind, withJava) {
  const fam = kind ? kind.family : '';
  const ts = kind && kind.tags && kind.tags.includes('typescript');
  const items = [];
  if (withJava || fam === 'java') {
    for (const [k, l] of [['class', 'Java Class…'], ['interface', 'Java Interface…'], ['enum', 'Java Enum…'], ['record', 'Java Record…'], ['annotation', 'Java Annotation…'], ['test', 'JUnit 5 Test…'], ['main', 'Class with main()…']]) items.push({ label: l, run: () => { selected = { path: dir, isDir: true }; cmdNewJava(k); } });
    items.push({ label: 'Java Package…', run: () => newPackage(dir) });
  }
  if (kind && ['react', 'next'].includes(kind.id)) {
    const x = ts ? 'tsx' : 'jsx';
    items.push({ label: 'React Component…', run: () => newFromTemplate({ dir, title: 'New React component', placeholder: 'UserCard', ext: `.${x}`, nameRe: /^[A-Z][\w]*$/, body: (n) => `import { useState } from 'react';\n\nexport default function ${n}(${ts ? '{ title = "' + n + '" }: { title?: string }' : '{ title = "' + n + '" }'}) {\n  const [count, setCount] = useState(0);\n\n  return (\n    <section className="${n}">\n      <h2>{title}</h2>\n      <button onClick={() => setCount((c) => c + 1)}>Clicked {count} times</button>\n    </section>\n  );\n}\n` }) });
    items.push({ label: 'React Hook…', run: () => newFromTemplate({ dir, title: 'New custom hook', placeholder: 'useOnline', ext: ts ? '.ts' : '.js', nameRe: /^use[A-Z]\w*$/, body: (n) => `import { useEffect, useState } from 'react';\n\n/** Example hook: loads data once, cancels it when the component goes away. */\nexport function ${n}(url${ts ? ': string' : ''}) {\n  const [data, setData] = useState${ts ? '<unknown>' : ''}(null);\n  const [error, setError] = useState${ts ? '<Error | null>' : ''}(null);\n\n  useEffect(() => {\n    const controller = new AbortController();\n    (async () => {\n      try {\n        const res = await fetch(url, { signal: controller.signal });\n        if (!res.ok) throw new Error(\`HTTP \${res.status}\`);\n        setData(await res.json());\n      } catch (e) {\n        if (e.name !== 'AbortError') setError(e);\n      }\n    })();\n    return () => controller.abort();\n  }, [url]);\n\n  return { data, error };\n}\n` }) });
  }
  if (kind && kind.id === 'angular') {
    for (const [k, l] of [['component', 'Component'], ['service', 'Service'], ['module', 'Module'], ['pipe', 'Pipe'], ['directive', 'Directive'], ['guard', 'Guard']]) items.push({ label: `Angular ${l}…`, run: async () => { const n = await askToken(`New Angular ${l}`, 'user-card', /^[a-z][\w/-]{0,60}$/, 'Use lower-case kebab names such as user-card.'); if (n) runIn(kind.dir, `npx ng generate ${k} ${n}`); } });
  }
  if (kind && kind.id === 'vue') items.push({ label: 'Vue Component…', run: () => newFromTemplate({ dir, title: 'New Vue component', placeholder: 'UserCard', ext: '.vue', nameRe: /^[A-Z]\w*$/, body: (n) => `<script setup${ts ? ' lang="ts"' : ''}>\nimport { ref } from 'vue';\nconst count = ref(0);\n</script>\n\n<template>\n  <section class="${n}">\n    <button @click="count++">Clicked {{ count }} times</button>\n  </section>\n</template>\n` }) });
  if (kind && kind.id === 'svelte') items.push({ label: 'Svelte Component…', run: () => newFromTemplate({ dir, title: 'New Svelte component', placeholder: 'UserCard', ext: '.svelte', nameRe: /^[A-Z]\w*$/, body: () => `<script>\n  let count = 0;\n</script>\n\n<button on:click={() => count++}>Clicked {count} times</button>\n` }) });
  if (fam === 'node' && !['react', 'next', 'angular', 'vue', 'svelte'].includes(kind.id)) {
    items.push({ label: 'Module…', run: () => newFromTemplate({ dir, title: 'New module', placeholder: 'users', ext: ts ? '.ts' : '.js', body: (n) => `/** ${n} */\nexport async function load${pascal(n)}()${ts ? ': Promise<unknown[]>' : ''} {\n  return [];\n}\n` }) });
    items.push({ label: 'Test…', run: () => newFromTemplate({ dir, title: 'New test', placeholder: 'users.test', ext: ts ? '.ts' : '.js', body: (n) => `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\n\ntest('${n} works', () => {\n  assert.equal(1 + 1, 2);\n});\n` }) });
  }
  if (fam === 'python') {
    items.push({ label: 'Python Module…', run: () => newFromTemplate({ dir, title: 'New Python module', placeholder: 'services', ext: '.py', nameRe: /^[A-Za-z_]\w*$/, body: (n) => `"""${n}."""\nfrom __future__ import annotations\n\n\ndef main() -> None:\n    print("hello from ${n}")\n\n\nif __name__ == "__main__":\n    main()\n` }) });
    items.push({ label: 'pytest Test…', run: () => newFromTemplate({ dir, title: 'New pytest file', placeholder: 'test_services', ext: '.py', nameRe: /^test_\w+$/, body: (n) => `import pytest\n\n\ndef test_${n.replace(/^test_/, '')}_works():\n    assert 1 + 1 == 2\n\n\n@pytest.mark.parametrize("a,b,expected", [(1, 2, 3), (2, 2, 4)])\ndef test_add(a, b, expected):\n    assert a + b == expected\n` }) });
    items.push({ label: 'Python Package (folder with __init__.py)…', run: async () => { const n = await askToken('New package', 'mypackage', /^[A-Za-z_]\w*$/, 'Use a valid Python name.'); if (!n) return; try { await inv('fs:create', joinPath(joinPath(dir, n), '__init__.py'), false); await refreshTree(); } catch (e) { status(e.message, true); } } });
    if (kind.id === 'django') items.push({ label: 'Django App…', run: async () => { const n = await askToken('New Django app', 'blog', /^[a-z_]\w*$/, 'Use a lower-case name.'); if (n) runIn(kind.dir, `python manage.py startapp ${n}`); } });
    if (kind.id === 'fastapi') items.push({ label: 'FastAPI Router…', run: () => newFromTemplate({ dir, title: 'New router', placeholder: 'items', ext: '.py', nameRe: /^[a-z_]\w*$/, body: (n) => `from fastapi import APIRouter, HTTPException\n\nrouter = APIRouter(prefix="/${n}", tags=["${n}"])\n\n\n@router.get("/{item_id}")\nasync def read_item(item_id: int):\n    if item_id < 0:\n        raise HTTPException(status_code=404, detail="not found")\n    return {"id": item_id}\n` }) });
  }
  if (fam === 'go') items.push({ label: 'Go File…', run: () => newFromTemplate({ dir, title: 'New Go file', placeholder: 'handler', ext: '.go', nameRe: /^[a-z_]\w*$/, body: () => `package ${snake(baseName(dir)) || 'main'}\n\n` }) }, { label: 'Go Test…', run: () => newFromTemplate({ dir, title: 'New Go test', placeholder: 'handler_test', ext: '.go', nameRe: /^[a-z_]\w*_test$/, body: () => `package ${snake(baseName(dir)) || 'main'}\n\nimport "testing"\n\nfunc TestWorks(t *testing.T) {\n\tif 1+1 != 2 {\n\t\tt.Fatal("math is broken")\n\t}\n}\n` }) });
  if (fam === 'rust') items.push({ label: 'Rust Module…', run: () => newFromTemplate({ dir, title: 'New Rust module', placeholder: 'config', ext: '.rs', nameRe: /^[a-z_]\w*$/, body: () => `pub fn hello() -> &'static str {\n    "hello"\n}\n\n#[cfg(test)]\nmod tests {\n    use super::*;\n\n    #[test]\n    fn works() {\n        assert_eq!(hello(), "hello");\n    }\n}\n` }) });
  if (fam === 'dotnet') for (const k of ['class', 'interface', 'record']) items.push({ label: `C# ${pascal(k)}…`, run: async () => { const n = await askToken(`New C# ${k}`, 'Customer', /^[A-Z]\w*$/, 'Use a PascalCase name.'); if (n) runIn(dir, `dotnet new ${k} -n ${n}`); } });
  if (items.length) items.push('-');
  items.push({ label: 'File…', run: () => { selected = { path: dir, isDir: true }; createEntry(false); } }, { label: 'Folder…', run: () => { selected = { path: dir, isDir: true }; createEntry(true); } });
  return items;
}

async function newPackage(dir) {
  const sr = sourceRootFor(dir);
  if (!sr) return status('Choose a folder inside src/main/java (or src/test/java) first.', true);
  const n = await promptText('New Java package', sr.pkg ? `${sr.pkg}.sub` : 'com.example.app', sr.pkg ? `${sr.pkg}.` : '');
  if (!n) return;
  if (!/^[a-z_][\w]*(\.[a-z_][\w]*)*$/.test(n)) return status('Package names look like com.example.app (lower case).', true);
  try { await inv('fs:create', joinPath(sr.root, n.split('.').join(BS)), true); } catch (e) { return status(e.message, true); }
  await refreshTree();
  explorerReveal(joinPath(sr.root, n.split('.').join(BS)), { focus: true });
}

/* ------------------------------ build tool / language commands ------------------------------ */

async function wrapperOf(dir, win, unix, fallback) {
  return (await inv('fs:exists', joinPath(dir, win)).catch(() => false)) ? `.${BS}${win}` : fallback;
}

async function toolItems(kind) {
  const d = kind.dir;
  const c = (label, line, hint) => cmdItem(label, d, line, hint);
  switch (kind.tool) {
    case 'maven': {
      const w = await wrapperOf(d, 'mvnw.cmd', 'mvnw', 'mvn');
      const items = [c('Clean', `${w} clean`), c('Compile', `${w} compile`), c('Test', `${w} test`), c('Package (skip tests)', `${w} package -DskipTests`), c('Package', `${w} package`), c('Install to local repository', `${w} install`), c('Verify', `${w} verify`), '-',
        c('Dependency tree', `${w} dependency:tree`), c('Find unused / undeclared dependencies', `${w} dependency:analyze`), c('Check for newer dependency versions', `${w} versions:display-dependency-updates`), c('Download sources and Javadoc', `${w} dependency:sources dependency:resolve -Dclassifier=javadoc`), c('Effective POM', `${w} help:effective-pom`), '-'];
      if (kind.id === 'spring') items.unshift(c('Run Spring Boot application', `${w} spring-boot:run`), c('Build container image (buildpacks)', `${w} spring-boot:build-image`), '-');
      if (kind.id === 'quarkus') items.unshift(c('Quarkus dev mode (live reload)', `${w} quarkus:dev`), c('Quarkus build', `${w} package`), '-');
      items.push({ label: 'Open pom.xml', run: () => openAt(joinPath(d, 'pom.xml'), 1) }, { label: 'Reload project model (re-read pom.xml)', run: async () => { await tryInv('javac:modules', state.workspace, true); await detectBuildEnv(); scheduleJavaCheck(300); status('Project model reloaded.'); } });
      return items;
    }
    case 'gradle': {
      const w = await wrapperOf(d, 'gradlew.bat', 'gradlew', 'gradle');
      const items = [c('Build', `${w} build`), c('Clean', `${w} clean`), c('Test', `${w} test`), c('Assemble (no tests)', `${w} assemble`), c('Dependencies', `${w} dependencies`), c('List tasks', `${w} tasks --all`)];
      if (kind.id === 'spring-gradle') items.unshift(c('Run Spring Boot application', `${w} bootRun`), '-');
      if (kind.id === 'quarkus') items.unshift(c('Quarkus dev mode', `${w} quarkusDev`), '-');
      return items;
    }
    case 'ant': return [c('Clean and Build', 'ant clean jar'), c('Build', 'ant jar'), c('Clean', 'ant clean'), c('Run tests', 'ant test'), c('Run', 'ant run')];
    case 'node': {
      const pm = kind.pm;
      const run = (s) => (pm === 'npm' ? `npm run ${s}` : pm === 'yarn' ? `yarn ${s}` : `${pm} run ${s}`);
      const names = Object.keys(kind.scripts || {});
      const top = ['dev', 'start', 'build', 'test', 'lint', 'preview', 'serve'].filter((s) => names.includes(s));
      const items = top.map((s) => c(`${s}   (${(kind.scripts[s] || '').slice(0, 38)})`, run(s)));
      if (names.length > top.length) items.push({ label: `All scripts (${names.length})`, sub: names.map((s) => c(`${s}   (${(kind.scripts[s] || '').slice(0, 38)})`, run(s))) });
      if (items.length) items.push('-');
      items.push(c(`Install dependencies (${pm} install)`, `${pm} install`), c('Check for outdated packages', `${pm} outdated`), c('Security audit', `${pm} audit`), c('Update packages', pm === 'yarn' ? 'yarn upgrade' : `${pm} update`));
      items.push({ label: 'Add package…', run: async () => { const n = await askToken('Add package', 'axios', /^(@[\w.-]+\/)?[\w.-]+(@[\w.^~<>=*-]+)?$/, 'That is not a valid package name.'); if (n) runIn(d, `${pm === 'npm' ? 'npm install' : `${pm} add`} ${n}`); } });
      items.push({ label: 'Add dev package…', run: async () => { const n = await askToken('Add dev dependency', 'vitest', /^(@[\w.-]+\/)?[\w.-]+(@[\w.^~<>=*-]+)?$/, 'That is not a valid package name.'); if (n) runIn(d, `${pm === 'npm' ? 'npm install -D' : `${pm} add -D`} ${n}`); } });
      if (kind.id === 'angular') items.unshift(c('ng serve (dev server)', 'npx ng serve'), c('ng build', 'npx ng build'), c('ng test', 'npx ng test'), c('ng lint', 'npx ng lint'), c('ng update (check)', 'npx ng update'), '-');
      items.push('-', { label: 'Open package.json', run: () => openAt(joinPath(d, 'package.json'), 1) });
      return items;
    }
    case 'python': {
      const venv = (await inv('fs:exists', joinPath(d, '.venv')).catch(() => false)) ? `.venv${BS}Scripts${BS}python` : 'python';
      const items = [];
      if (kind.id === 'django') items.push(c('Run development server', `${venv} manage.py runserver`), c('Make migrations', `${venv} manage.py makemigrations`), c('Migrate database', `${venv} manage.py migrate`), c('Run tests', `${venv} manage.py test`), c('Create superuser', `${venv} manage.py createsuperuser`), c('Django shell', `${venv} manage.py shell`), c('Collect static files', `${venv} manage.py collectstatic --noinput`), '-');
      if (kind.id === 'flask') items.push(c('Run Flask (debug)', `${venv} -m flask run --debug`), '-');
      if (kind.id === 'fastapi') items.push(c('Run FastAPI (auto-reload)', `${venv} -m uvicorn main:app --reload`), '-');
      items.push(c('Create virtual environment (.venv)', 'python -m venv .venv'), c('Install requirements', `${venv} -m pip install -r requirements.txt`), c('Run tests (pytest)', `${venv} -m pytest -q`), c('Format code (black)', `${venv} -m black .`), c('Lint (ruff)', `${venv} -m ruff check .`), c('Type check (mypy)', `${venv} -m mypy .`), c('Outdated packages', `${venv} -m pip list --outdated`), c('Freeze requirements', `${venv} -m pip freeze`));
      return items;
    }
    case 'go': return [c('Run', 'go run .'), c('Build', 'go build ./...'), c('Test', 'go test ./...'), c('Vet', 'go vet ./...'), c('Format', 'go fmt ./...'), c('Tidy modules', 'go mod tidy'), c('Download modules', 'go mod download'), c('Newer module versions', 'go list -u -m all')];
    case 'rust': return [c('Run', 'cargo run'), c('Build', 'cargo build'), c('Check (fast)', 'cargo check'), c('Test', 'cargo test'), c('Clippy (lints)', 'cargo clippy'), c('Format', 'cargo fmt'), c('Update dependencies', 'cargo update'), c('Open docs', 'cargo doc --open')];
    case 'dotnet': return [c('Run', 'dotnet run'), c('Watch (hot reload)', 'dotnet watch run'), c('Build', 'dotnet build'), c('Test', 'dotnet test'), c('Restore packages', 'dotnet restore'), c('Format', 'dotnet format'), c('Outdated packages', 'dotnet list package --outdated'), c('Clean', 'dotnet clean')];
    case 'php': return [c('Install', 'composer install'), c('Update', 'composer update'), c('Dump autoload', 'composer dump-autoload'), c('Outdated', 'composer outdated'), c('Run tests', 'composer test')];
    case 'ruby': return [c('Bundle install', 'bundle install'), c('Run specs', 'bundle exec rspec'), c('Outdated gems', 'bundle outdated'), c('Rails server', 'bundle exec rails server')];
    case 'flutter': return [c('Get packages', 'flutter pub get'), c('Run', 'flutter run'), c('Test', 'flutter test'), c('Analyze', 'flutter analyze'), c('Build APK', 'flutter build apk')];
    case 'terraform': return [c('Init', 'terraform init'), c('Validate', 'terraform validate'), c('Format', 'terraform fmt -recursive'), c('Plan (no changes made)', 'terraform plan'), c('Providers', 'terraform providers')];
    case 'helm': return [c('Lint', 'helm lint .'), c('Render templates', 'helm template .'), c('Update dependencies', 'helm dependency update')];
    case 'docker': {
      const name = (baseName(d).toLowerCase().replace(/[^a-z0-9_.-]/g, '-') || 'app');
      return [c('Build image', `docker build -t ${name}:dev .`), c('Compose up (detached)', 'docker compose up -d'), c('Compose down', 'docker compose down'), c('Compose logs', 'docker compose logs --tail 100'), c('Containers', 'docker ps')];
    }
    default: return [];
  }
}

/* ------------------------------ format / analyze ------------------------------ */

async function formatJavaFolder(dir) {
  const rel = await inv('search:listFiles', state.workspace);
  const prefix = normPath(relPath(dir));
  const files = rel.filter((r) => /\.java$/i.test(r) && (dir === state.workspace || normPath(r.split('/').join(BS)).startsWith(prefix + BS))).map((r) => joinPath(state.workspace, r.split('/').join(BS)));
  if (!files.length) return status('No Java files here.');
  if (!(await confirmBox(`Format ${files.length} Java file(s)?`, 'Fixes indentation only; your line breaks stay as they are. Open files are saved first.'))) return;
  await saveAll();
  let changed = 0;
  for (const f of files) {
    const txt = await tryInv('fs:readFile', f);
    if (!txt.ok) continue;
    const next = formatJava(txt.data, '    ');
    if (next !== txt.data) { await inv('fs:writeFile', f, next); changed++; }
  }
  await reloadOpenTabs(files);
  status(`Formatted ${changed} of ${files.length} file(s).`);
}

async function reloadOpenTabs(paths) {
  const set = new Set(paths.map(normPath));
  for (const t of state.tabs) {
    if (t.kind !== 'file' || !set.has(normPath(t.path))) continue;
    const txt = await tryInv('fs:readFile', t.path);
    if (txt.ok && t.model.getValue() !== txt.data) { t.model.setValue(txt.data); t.saved = txt.data; }
  }
  renderTabs();
}

async function formatEntry(entry, kind) {
  if (entry.isDir) {
    if (/java/.test(kind ? kind.family : '') || entry.isPkg || entry.pkgRoot) return formatJavaFolder(entry.path);
    const cmd = { node: 'npx prettier --write .', python: 'python -m black .', go: 'go fmt ./...', rust: 'cargo fmt', dotnet: 'dotnet format', iac: 'terraform fmt -recursive' }[kind ? kind.family : ''];
    return cmd ? runIn(entry.path, cmd) : status('No formatter is known for this kind of folder.', true);
  }
  await openAt(entry.path, 1);
  if (/\.java$/i.test(entry.path)) return CNS.run('edit.formatDoc');
  editor.getAction('editor.action.formatDocument').run();
}

async function analyzeEntry(entry) {
  if (!entry.isDir) {
    await openAt(entry.path, 1);
    advSchedule(0);
    return showPanel('suggestions');
  }
  return advAnalyzeProject(entry.path);
}

/* ------------------------------ Java: generate / refactor on a class ------------------------------ */

/** Opens the class file, puts the cursor inside its main class, and runs fn (the generators work on the cursor's class). */
async function withJavaClass(file, fn) {
  await openAt(file, 1);
  const model = activeJavaModel();
  if (!model) return status('Could not open that class.', true);
  const parsed = parseModel(model);
  const want = baseName(file).replace(/\.java$/i, '');
  const t = parsed.types.find((x) => x.name === want && !x.outer) || parsed.types[0];
  if (!t) return status('No class found in this file.', true);
  editor.setPosition({ lineNumber: Math.min(t.endLine, t.line + 1), column: 1 });
  fn();
}

async function filesWith(query, include) {
  const r = await inv('search:files', state.workspace, { query, wholeWord: false, regex: true, caseSensitive: true, include });
  return r;
}

const REF_FILES = '*.java,*.kt,*.xml,*.properties,*.yml,*.yaml,*.gradle,*.md';

async function refRenameClass(file) {
  await saveAll();
  const old = baseName(file).replace(/\.java$/i, '');
  const nn = await promptText('Rename class', 'New class name', old);
  if (!nn || nn === old) return;
  if (!isIdent(nn)) return status('That is not a valid Java name.', true);
  const target = joinPath(dirName(file), `${nn}.java`);
  if (await inv('fs:exists', target).catch(() => false)) return status(`${nn}.java already exists here.`, true);
  const res = await filesWith(`\\b${old}\\b`, REF_FILES);
  if (!(await confirmBox(`Rename ${old} to ${nn}?`, `${res.total} occurrence(s) of the word "${old}" in ${res.files.length} file(s) will be changed, and ${baseName(file)} renamed.${res.truncated ? ' (more than shown)' : ''}\nThis matches the whole word, so check comments and strings; undo with Git.`))) return;
  const list = res.files.map((f) => f.file);
  await inv('search:replace', state.workspace, { query: `\\b${old}\\b`, regex: true, caseSensitive: true }, list, nn);
  const tab = state.tabs.find((t) => t.kind === 'file' && normPath(t.path) === normPath(file));
  if (tab) { tab.saved = tab.model.getValue(); await closeTab(tab); }
  await inv('fs:rename', file, target);
  await reloadOpenTabs(list.filter((f) => normPath(f) !== normPath(file)));
  JV.stale = true;
  await refreshTree();
  await openAt(target, 1);
  scheduleJavaCheck(500, target);
  status(`Renamed ${old} to ${nn}.`);
}

function renameClassOfActiveFile() {
  const t = state.active;
  if (!t || t.kind !== 'file' || !/\.java$/i.test(t.path)) return status('Open a Java file first.', true);
  return refRenameClass(t.path);
}

async function refMoveClass(file) {
  await saveAll();
  const sr = sourceRootFor(dirName(file));
  if (!sr) return status('This class is not inside src/main/java or src/test/java.', true);
  const name = baseName(file).replace(/\.java$/i, '');
  const pkg = await promptText('Move class to package', 'com.example.other', sr.pkg);
  if (!pkg || pkg === sr.pkg) return;
  if (!/^[a-z_][\w]*(\.[a-z_][\w]*)*$/.test(pkg)) return status('Package names look like com.example.app (lower case).', true);
  const dir = joinPath(sr.root, pkg.split('.').join(BS));
  const target = joinPath(dir, `${name}.java`);
  if (await inv('fs:exists', target).catch(() => false)) return status(`${name}.java already exists in ${pkg}.`, true);
  const oldFqn = sr.pkg ? `${sr.pkg}.${name}` : name;
  const res = await filesWith(`\\b${oldFqn.replace(/\./g, '\\.')}\\b`, REF_FILES);
  if (!(await confirmBox(`Move ${name} to ${pkg}?`, `The file moves, its package line changes, and ${res.total} reference(s) to ${oldFqn} in ${res.files.length} file(s) are updated.\nClasses that used it WITHOUT an import (same package) need an import added: the red marks will show them.`))) return;
  if (res.files.length) await inv('search:replace', state.workspace, { query: `\\b${oldFqn.replace(/\./g, '\\.')}\\b`, regex: true, caseSensitive: true }, res.files.map((f) => f.file), `${pkg}.${name}`);
  const tab = state.tabs.find((t) => t.kind === 'file' && normPath(t.path) === normPath(file));
  if (tab) { tab.saved = tab.model.getValue(); await closeTab(tab); }
  if (!(await inv('fs:exists', dir).catch(() => false))) await inv('fs:create', dir, true);
  await inv('fs:rename', file, target);
  let text = await inv('fs:readFile', target);
  text = /^\s*package\s+[\w.]+\s*;/m.test(text) ? text.replace(/^(\s*)package\s+[\w.]+\s*;/m, `$1package ${pkg};`) : `package ${pkg};\n\n${text}`;
  await inv('fs:writeFile', target, text);
  await reloadOpenTabs(res.files.map((f) => f.file));
  JV.stale = true;
  await refreshTree();
  await openAt(target, 1);
  scheduleJavaCheck(500, target);
  status(`Moved ${name} to ${pkg}.`);
}

async function refRenamePackage(dir) {
  await saveAll();
  const sr = sourceRootFor(dir);
  if (!sr || !sr.pkg) return status('Choose a package folder inside src/main/java or src/test/java.', true);
  const nn = await promptText('Rename package', 'New package name', sr.pkg);
  if (!nn || nn === sr.pkg) return;
  if (!/^[a-z_][\w]*(\.[a-z_][\w]*)*$/.test(nn)) return status('Package names look like com.example.app (lower case).', true);
  const target = joinPath(sr.root, nn.split('.').join(BS));
  if (await inv('fs:exists', target).catch(() => false)) return status(`The package ${nn} already exists; merging packages is not supported.`, true);
  const re = `(?<![\\w.])${sr.pkg.replace(/\./g, '\\.')}(?![\\w])`;
  const res = await filesWith(re, REF_FILES);
  if (!(await confirmBox(`Rename package ${sr.pkg} to ${nn}?`, `${res.total} reference(s) in ${res.files.length} file(s) are updated (package lines, imports, class names, Spring and XML settings), and the folder is moved. Sub-packages move with it.`))) return;
  if (res.files.length) await inv('search:replace', state.workspace, { query: re, regex: true, caseSensitive: true }, res.files.map((f) => f.file), nn);
  for (const t of state.tabs.filter((x) => x.kind === 'file' && normPath(x.path).startsWith(normPath(dir) + BS))) { t.saved = t.model.getValue(); await closeTab(t); }
  const parent = dirName(target);
  if (!(await inv('fs:exists', parent).catch(() => false))) await inv('fs:create', parent, true);
  await inv('fs:rename', dir, target);
  await reloadOpenTabs(res.files.map((f) => f.file));
  JV.stale = true;
  await refreshTree();
  explorerReveal(target, { focus: true });
  scheduleJavaCheck(800);
  status(`Renamed package ${sr.pkg} to ${nn}.`);
}

async function refExtractInterface(file) {
  await withJavaClass(file, async () => {
    const model = activeJavaModel();
    const parsed = parseModel(model);
    const name = baseName(file).replace(/\.java$/i, '');
    const t = parsed.types.find((x) => x.name === name) || parsed.types[0];
    const methods = t.methods.filter((m) => !m.ctor && (m.mods || []).includes('public') && !(m.mods || []).includes('static'));
    if (!methods.length) return status('This class has no public instance methods to extract.', true);
    const iname = await promptText('Extract interface', 'Interface name', `${name}Api`);
    if (!iname) return;
    if (!isIdent(iname)) return status('That is not a valid Java name.', true);
    const ifile = joinPath(dirName(file), `${iname}.java`);
    if (await inv('fs:exists', ifile).catch(() => false)) return status(`${iname}.java already exists.`, true);
    const body = methods.map((m) => `    ${m.typeParams ? `${m.typeParams} ` : ''}${m.ret || 'void'} ${m.name}(${m.params});`).join(NLC);
    await inv('fs:create', ifile, false);
    await inv('fs:writeFile', ifile, `${parsed.package ? `package ${parsed.package};${NLC}${NLC}` : ''}public interface ${iname} {${NLC}${body}${NLC}}${NLC}`);
    const text = model.getValue();
    const re = new RegExp(`(\\bclass\\s+${name}\\b(?:\\s*<[^{>]*>)?(?:\\s+extends\\s+[\\w.<>?, ]+?)?)(\\s+implements\\s+([^{]+?))?(\\s*\\{)`);
    const m = re.exec(text);
    if (m) {
      const at = model.getPositionAt(m.index);
      const end = model.getPositionAt(m.index + m[0].length);
      editor.executeEdits('extract-interface', [{ range: new monaco.Range(at.lineNumber, at.column, end.lineNumber, end.column), text: `${m[1]} implements ${m[3] ? `${m[3].trim()}, ` : ''}${iname}${m[4]}` }]);
      await saveActive();
    }
    JV.stale = true;
    await refreshTree();
    status(`Created ${iname} with ${methods.length} method(s); ${name} now implements it.`);
  });
}

async function genUnitTest(file) {
  const text = await inv('fs:readFile', file);
  const parsed = JavaParse.parse(text);
  const name = baseName(file).replace(/\.java$/i, '');
  const t = parsed.types.find((x) => x.name === name) || parsed.types[0];
  if (!t) return status('No class found in this file.', true);
  const norm = file.split(BS).join('/');
  const m = /^(.*)\/src\/main\/(java|kotlin)\/(.*)\/[^/]+$/.exec(norm);
  const dir = m ? joinPath(joinPath(m[1].split('/').join(BS), `src${BS}test${BS}${m[2]}`), m[3].split('/').join(BS)) : dirName(file);
  const target = joinPath(dir, `${name}Test.java`);
  if (await inv('fs:exists', target).catch(() => false)) return openAt(target, 1);
  const methods = t.methods.filter((x) => !x.ctor && (x.mods || []).includes('public') && !(x.mods || []).includes('static'));
  const body = (methods.length ? methods : [{ name: 'works' }]).map((x) => `${NLC}    @Test${NLC}    void ${x.name}() {${NLC}        // TODO arrange, act, assert${NLC}        fail("not implemented yet");${NLC}    }`).join(NLC);
  await inv('fs:create', target, false);
  await inv('fs:writeFile', target, `${parsed.package ? `package ${parsed.package};${NLC}${NLC}` : ''}import org.junit.jupiter.api.Test;${NLC}${NLC}import static org.junit.jupiter.api.Assertions.fail;${NLC}${NLC}class ${name}Test {${NLC}${body}${NLC}}${NLC}`);
  await refreshTree();
  await openAt(target, 1);
  status(`Created ${name}Test with ${methods.length || 1} test method(s). Needs JUnit 5 on the test classpath.`);
}

async function addLombokAnnotationPicker(file) {
  await withJavaClass(file, () => {
    const model = activeJavaModel();
    const parsed = parseModel(model);
    const t = parsed.types.find((x) => x.name === baseName(file).replace(/\.java$/i, '')) || parsed.types[0];
    quickPick({
      placeholder: 'Add which Lombok annotation to the class?', items: LOMBOK_ANNOTATIONS.map(([n, fqn, d]) => ({ label: `@${n}`, detail: d, icon: '🧩', data: { n, fqn } })),
      onPick: async (it) => {
        if (!ADV.lombok && !(await confirmBox('Lombok is not in this project yet', 'Add the Lombok dependency first?'))) return;
        if (!ADV.lombok) await addLombokDependency();
        const indent = (/^\s*/.exec(model.getLineContent(t.line)) || [''])[0];
        const edits = [{ range: new monaco.Range(t.line, 1, t.line, 1), text: `${indent}@${it.data.n}${NLC}` }];
        for (const e of importEdit(model, it.data.fqn, parsed)) edits.push({ range: new monaco.Range(e.range.startLineNumber, 1, e.range.startLineNumber, 1), text: e.text });
        editor.executeEdits('lombok', edits);
        status(`Added @${it.data.n}.`);
      },
    });
  });
}

/* ------------------------------ the menus ------------------------------ */

const copyItems = (p, extra) => [
  { label: 'Copy Path', run: () => copyText(p, 'Path') }, { label: 'Copy Relative Path', run: () => copyText(relPath(p), 'Relative path') }, ...(extra || []),
  { label: 'Show in Windows File Explorer', run: () => tryInv('shell:showItem', p) },
];

const entryEditItems = (e) => [
  { label: 'Rename…', hint: 'F2', run: async () => { const n = await promptText('Rename', 'New name', baseName(e.path)); if (n) try { await inv('fs:rename', e.path, joinPath(dirName(e.path), n)); await refreshTree(); } catch (err) { status(err.message, true); } } },
  { label: 'Move to Recycle Bin', hint: 'Del', run: async () => { if (await confirmBox(`Move ${baseName(e.path)} to the Recycle Bin?`, 'You can restore it from there.')) { try { await inv('fs:trash', e.path); await refreshTree(); } catch (err) { status(err.message, true); } } } },
];

async function projectMenu(entry, kind, isRoot) {
  const dir = entry.path;
  const ext = await toolItems(kind);
  const items = [];
  items.push({ label: `New`, sub: newItems(dir, kind, kind.family === 'java') });
  if (ext.length) items.push({ label: kind.tool === 'maven' ? 'Maven' : kind.tool === 'gradle' ? 'Gradle' : kind.tool === 'node' ? kind.pm.toUpperCase() : kind.label, sub: ext, dot: kind.color });
  items.push({ label: 'Git', sub: await gitMenu(dir, isRoot ? null : dir) });
  items.push('-');
  items.push({ label: 'Format', sub: [{ label: kind.family === 'java' ? 'Format all Java files…' : 'Format project', run: () => formatEntry({ path: dir, isDir: true }, kind) }, ...(kind.family === 'node' ? [cmdItem('ESLint fix', dir, 'npx eslint . --fix')] : []), ...(kind.family === 'python' ? [cmdItem('Sort imports (isort)', dir, 'python -m isort .')] : [])] });
  if (kind.family === 'java') {
    items.push({ label: 'Refactor', sub: [
      { label: 'Rename Class…', run: async () => { await javaIndex(false); quickPick({ placeholder: 'Rename which class?', items: JV.types.filter((t) => !t.outer && normPath(t.file).startsWith(normPath(dir) + BS)).map((t) => ({ label: t.name, detail: t.fqn, icon: KIND_ICON[t.kind], data: t })), onPick: (it) => refRenameClass(it.data.file) }); } },
      { label: 'Rename Package…', run: async () => { await javaIndex(false); const pk = [...new Set(JV.types.filter((t) => t.pkg && normPath(t.file).startsWith(normPath(dir) + BS)).map((t) => t.pkg))].sort(); quickPick({ placeholder: 'Rename which package?', items: pk.map((p) => ({ label: p, icon: '📦', data: p })), onPick: (it) => { const t = JV.types.find((x) => x.pkg === it.data); if (t) refRenamePackage(dirName(t.file)); } }); } },
      { label: 'Move Class to Another Package…', run: async () => { await javaIndex(false); quickPick({ placeholder: 'Move which class?', items: JV.types.filter((t) => !t.outer && normPath(t.file).startsWith(normPath(dir) + BS)).map((t) => ({ label: t.name, detail: t.fqn, icon: KIND_ICON[t.kind], data: t })), onPick: (it) => refMoveClass(it.data.file) }); } },
      ...(isRoot ? [] : [{ label: 'Rename Project Folder…', run: () => entryEditItems(entry)[0].run() }]),
    ] });
    items.push({ label: 'Lombok', dot: '#b39ddb', sub: [{ label: ADV.lombok ? 'Lombok is in this project ✔' : 'Add Lombok dependency…', run: () => addLombokDependency(), disabled: ADV.lombok === true }, { label: 'Find boilerplate Lombok could remove (analyze project)', run: () => advAnalyzeProject(dir) }] });
  } else if (kind.family === 'node' || kind.family === 'python') {
    items.push({ label: 'Refactor', sub: [{ label: 'Rename folder…', run: () => entryEditItems(entry)[0].run(), disabled: isRoot }, { label: 'Find and replace in project…', run: () => CNS.run('search.files') }] });
  }
  items.push({ label: 'Analyze', sub: [
    { label: kind.family === 'java' ? 'SOLID principles, modern Java, concurrency…' : 'Async patterns and modern syntax…', run: () => advAnalyzeProject(dir) },
    ...(kind.family === 'java' ? [{ label: 'Compile errors in this module', run: () => CNS.run('java.compile') }] : []),
  ] });
  items.push('-', { label: 'Open Terminal Here', run: () => runIn(dir, 'cd .') }, ...copyItems(dir));
  if (!isRoot) items.push('-', ...entryEditItems(entry));
  return items;
}

async function packageMenu(entry) {
  const dir = entry.path;
  const sr = sourceRootFor(dir);
  const kind = await projectOf(dir);
  const items = [{ label: 'New', sub: newItems(dir, kind || { family: 'java', tags: [] }, true) }];
  items.push({ label: 'Git', sub: await gitMenu(dir, dir) });
  items.push('-', { label: 'Format all files in this package…', run: () => formatJavaFolder(dir) });
  items.push({ label: 'Refactor', sub: [{ label: 'Rename Package…', run: () => refRenamePackage(dir), disabled: !(sr && sr.pkg) }, { label: 'Add Sub-package…', run: () => newPackage(dir) }] });
  items.push({ label: 'Analyze package (SOLID, modern Java)…', run: () => advAnalyzeProject(dir) });
  items.push('-', { label: 'Copy Package Name', run: () => copyText(sr && sr.pkg ? sr.pkg : baseName(dir), 'Package name'), disabled: !(sr && sr.pkg) }, ...copyItems(dir));
  items.push('-', ...entryEditItems(entry));
  return items;
}

async function folderMenu(entry) {
  const dir = entry.path;
  const kind = await projectOf(dir);
  const items = [{ label: 'New', sub: newItems(dir, kind, false) }, { label: 'Git', sub: await gitMenu(dir, dir) }, '-'];
  if (kind) items.push({ label: 'Format…', run: () => formatEntry(entry, kind) });
  items.push({ label: 'Analyze folder…', run: () => advAnalyzeProject(dir) });
  items.push('-', { label: 'Open Terminal Here', run: () => runIn(dir, 'cd .') }, ...copyItems(dir), '-', ...entryEditItems(entry));
  return items;
}

async function javaFileMenu(entry) {
  const f = entry.path;
  const kind = await projectOf(f);
  const sr = sourceRootFor(dirName(f));
  const qn = sr ? `${sr.pkg ? `${sr.pkg}.` : ''}${baseName(f).replace(/\.java$/i, '')}` : baseName(f);
  const J = (id) => () => withJavaClass(f, () => CNS.run(id));
  return [
    { label: 'Open', run: () => openAt(f, 1) },
    '-',
    { label: 'Generate', sub: [
      { label: 'Getters and Setters', run: J('java.gettersSetters') }, { label: 'Getters', run: J('java.getters') }, { label: 'Setters', run: J('java.setters') }, { label: 'Constructor', run: J('java.constructor') },
      { label: 'toString()', run: J('java.toString') }, { label: 'equals() and hashCode()', run: J('java.equalsHash') }, { label: 'Override Methods…', run: J('java.override') }, '-',
      { label: 'Unit Test (JUnit 5)', run: () => genUnitTest(f) }, { label: 'Extract Interface…', run: () => refExtractInterface(f) },
    ] },
    { label: 'Lombok', dot: '#b39ddb', sub: [
      { label: 'Replace getters / setters with Lombok', run: async () => { await openAt(f, 1); advRunOn(state.active, { quiet: true }); const fi = currentFindings().find((x) => x.id === 'lombok.accessors'); if (fi) advApply(fi); else status('No hand-written getters and setters to replace.'); } },
      { label: 'Replace logger field with @Slf4j', run: async () => { await openAt(f, 1); advRunOn(state.active, { quiet: true }); const fi = currentFindings().find((x) => x.id === 'lombok.logger'); if (fi) advApply(fi); else status('No logger field found.'); } },
      { label: 'Add Lombok annotation…', run: () => addLombokAnnotationPicker(f) },
      '-', { label: ADV.lombok ? 'Lombok is in this project ✔' : 'Add Lombok dependency…', run: () => addLombokDependency(), disabled: ADV.lombok === true },
    ] },
    { label: 'Refactor', sub: [{ label: 'Rename Class…', hint: 'F2', run: () => refRenameClass(f) }, { label: 'Move to Another Package…', run: () => refMoveClass(f) }, { label: 'Extract Interface…', run: () => refExtractInterface(f) }, '-', { label: 'Organize Imports', run: J('java.organizeImports') }] },
    { label: 'Format', run: () => formatEntry(entry, kind) },
    { label: 'Navigate', sub: [{ label: 'Type Hierarchy', run: J('java.hierarchy') }, { label: 'List Methods', run: J('java.methods') }, { label: 'Show Implementations / Subclasses', run: J('nav.impl') }, { label: 'Go to Supertype', run: J('java.superType') }] },
    { label: 'Analyze', sub: [{ label: 'SOLID, modern Java, concurrency…', run: () => analyzeEntry(entry) }, { label: 'Compile errors in this file', run: async () => { await openAt(f, 1); scheduleJavaCheck(0, f); showPanel('problems'); } }] },
    { label: 'Git', sub: await gitMenu(dirName(f), f) },
    '-',
    ...entryEditItems(entry),
    '-',
    ...copyItems(f, [{ label: 'Copy Qualified Name', run: () => copyText(qn, 'Class name') }]),
  ];
}

async function fileMenuFor(entry) {
  const f = entry.path;
  const kind = await projectOf(f);
  const ext = (/\.([\w]+)$/.exec(f) || [])[1] || '';
  const items = [{ label: 'Open', run: () => openAt(f, 1) }];
  const runner = { js: 'node', mjs: 'node', cjs: 'node', py: kind && kind.family === 'python' ? 'python' : 'python', go: 'go run', ts: 'npx tsx' }[ext.toLowerCase()];
  if (runner) items.push({ label: `Run ${baseName(f)}`, run: () => runIn(dirName(f), `${runner} ${q(baseName(f))}`) });
  if (/^(js|jsx|ts|tsx|py|java)$/i.test(ext)) items.push({ label: 'Analyze (modern way, async, SOLID)…', run: () => analyzeEntry(entry) });
  items.push({ label: 'Format', run: () => formatEntry(entry, kind) }, { label: 'Git', sub: await gitMenu(dirName(f), f) }, '-', ...entryEditItems(entry), '-', ...copyItems(f));
  return items;
}

/** The menu for something in the Explorer. */
async function explorerMenu(entry) {
  if (entry.isRoot) {
    const kind = await detectProjectKind(entry.path);
    const cloud = { label: 'Cloud Native', dot: '#4f7fc7', sub: projectMenuItems() };
    if (!kind) return [{ label: 'New', sub: newItems(entry.path, null, false) }, { label: 'Git', sub: await gitMenu(entry.path, null) }, '-', cloud, '-', ...copyItems(entry.path)];
    return [...(await projectMenu(entry, kind, true)), '-', cloud];
  }
  if (entry.isDir) {
    if (entry.isPkg || entry.pkgRoot) return packageMenu(entry);
    const kind = await detectProjectKind(entry.path);
    if (kind) return projectMenu(entry, kind, false);
    return folderMenu(entry);
  }
  if (/\.java$/i.test(entry.path)) return javaFileMenu(entry);
  return fileMenuFor(entry);
}

async function showExplorerMenu(ev, entry) {
  ev.preventDefault();
  ev.stopPropagation();
  selected = entry;
  const x = ev.clientX;
  const y = ev.clientY;
  let items;
  try { items = await explorerMenu(entry); } catch (e) { console.error(e); items = entryEditItems(entry); }
  ctxMenu(x, y, items);
}
