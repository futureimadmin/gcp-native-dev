/**
 * Build tool adapters. One entry per tool; adding a tool means adding an entry here (and a logo in renderer/logos.js).
 *   id, name, files        build files that identify the tool (exact names, or regular expressions)
 *   exe                    command that runs it; wrapper: wrapper script in the project (preferred when present)
 *   versionArgs            how to ask for its version
 *   goals(info)            buttons: { id, label, args: [...], group, rec }  (rec = recommended / shown first)
 *   options                tick boxes: { id, label, args: [...], help }
 *   describe(dir, read)    facts, dependencies, modules ... read from the project files
 */
const fs = require('fs');
const path = require('path');

/* ------------------------------ tiny XML reader (pom.xml, build.xml, csproj) ------------------------------ */

function parseXml(src) {
  const root = { name: '#root', children: [], text: '' };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[\s\S]*?>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1];
    if (m[1] != null) top.text += m[1];
    else if (m[2]) { if (stack.length > 1) stack.pop(); }
    else if (m[3]) {
      const attrs = {};
      for (const a of (m[4] || '').matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = a[2] != null ? a[2] : a[3];
      const el = { name: m[3], attrs, children: [], text: '' };
      top.children.push(el);
      if (!m[5]) stack.push(el);
    } else if (m[6] != null) top.text += m[6];
  }
  return root;
}
const kid = (n, name) => (n && n.children || []).find((c) => c.name === name);
const kids = (n, name) => (n && n.children || []).filter((c) => c.name === name);
const txt = (n, name) => { const c = kid(n, name); return c ? c.text.trim() : ''; };

/* ------------------------------ helpers ------------------------------ */

const exists = (dir, f) => fs.existsSync(path.join(dir, f));
const readText = (dir, f) => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch { return ''; } };
const goal = (id, label, args, group = 'Common', rec = false, extra = {}) => ({ id, label, args, group, rec, ...extra });
const opt = (id, label, args, help = '', dflt = false) => ({ id, label, args, help, default: dflt });

/* ------------------------------ Maven ------------------------------ */

const MAVEN_PLUGIN_GOALS = {
  'spring-boot-maven-plugin': [goal('sb-run', 'spring-boot:run', ['spring-boot:run'], 'Run', true), goal('sb-image', 'build-image', ['spring-boot:build-image'], 'Run'), goal('sb-repackage', 'repackage', ['spring-boot:repackage'], 'Run')],
  'quarkus-maven-plugin': [goal('q-dev', 'quarkus:dev', ['quarkus:dev'], 'Run', true), goal('q-build', 'quarkus:build', ['quarkus:build'], 'Run')],
  'jetty-maven-plugin': [goal('jetty', 'jetty:run', ['jetty:run'], 'Run', true)],
  'tomcat7-maven-plugin': [goal('tomcat', 'tomcat7:run', ['tomcat7:run'], 'Run', true)],
  'tomcat9-maven-plugin': [goal('tomcat', 'tomcat9:run', ['tomcat9:run'], 'Run', true)],
  'exec-maven-plugin': [goal('exec', 'exec:java', ['exec:java'], 'Run')],
  'jacoco-maven-plugin': [goal('jacoco', 'jacoco:report', ['test', 'jacoco:report'], 'Quality')],
  'maven-checkstyle-plugin': [goal('checkstyle', 'checkstyle:check', ['checkstyle:check'], 'Quality')],
  'spotbugs-maven-plugin': [goal('spotbugs', 'spotbugs:check', ['spotbugs:check'], 'Quality')],
  'maven-pmd-plugin': [goal('pmd', 'pmd:check', ['pmd:check'], 'Quality')],
  'maven-javadoc-plugin': [goal('javadoc', 'javadoc:javadoc', ['javadoc:javadoc'], 'Docs')],
  'maven-release-plugin': [goal('release', 'release:prepare', ['release:prepare'], 'Release')],
  'jib-maven-plugin': [goal('jib', 'jib:dockerBuild', ['jib:dockerBuild'], 'Run')],
  'flyway-maven-plugin': [goal('flyway', 'flyway:migrate', ['flyway:migrate'], 'Database')],
  'liquibase-maven-plugin': [goal('liquibase', 'liquibase:update', ['liquibase:update'], 'Database')],
  'maven-enforcer-plugin': [goal('enforcer', 'enforcer:enforce', ['enforcer:enforce'], 'Quality')],
};

const maven = {
  id: 'maven', name: 'Maven', files: ['pom.xml'], exe: 'mvn', wrapper: ['mvnw.cmd', 'mvnw'], versionArgs: ['-v'],
  goals: (info) => [
    goal('ci', 'clean install', ['clean', 'install'], 'Lifecycle', true), goal('cp', 'clean package', ['clean', 'package'], 'Lifecycle', true), goal('test', 'test', ['test'], 'Lifecycle', true), goal('compile', 'compile', ['compile'], 'Lifecycle'),
    goal('verify', 'verify', ['verify'], 'Lifecycle'), goal('install', 'install', ['install'], 'Lifecycle'), goal('package', 'package', ['package'], 'Lifecycle'), goal('clean', 'clean', ['clean'], 'Lifecycle'), goal('validate', 'validate', ['validate'], 'Lifecycle'),
    goal('deploy', 'deploy', ['deploy'], 'Lifecycle', false, { confirm: 'Deploy publishes the artifact to the remote repository configured in the pom.' }), goal('site', 'site', ['site'], 'Docs'),
    goal('tree', 'dependency:tree', ['dependency:tree'], 'Dependencies'), goal('analyze', 'dependency:analyze', ['dependency:analyze'], 'Dependencies'), goal('resolve', 'dependency:resolve', ['dependency:resolve'], 'Dependencies'),
    goal('sources', 'download sources', ['dependency:sources', 'dependency:resolve', '-Dclassifier=javadoc'], 'Dependencies'), goal('offline', 'go-offline', ['dependency:go-offline'], 'Dependencies'),
    goal('upd', 'dependency updates', ['versions:display-dependency-updates'], 'Dependencies'), goal('pupd', 'plugin updates', ['versions:display-plugin-updates'], 'Dependencies'),
    goal('epom', 'effective-pom', ['help:effective-pom'], 'Inspect'), goal('esettings', 'effective-settings', ['help:effective-settings'], 'Inspect'), goal('wrapper', 'create wrapper', ['wrapper:wrapper'], 'Inspect'),
    ...(info.pluginIds || []).flatMap((p) => MAVEN_PLUGIN_GOALS[p] || []),
  ],
  options: [
    opt('skipTests', 'Skip tests', ['-DskipTests'], 'Compile the tests but do not run them'), opt('skipAll', 'Skip test compilation', ['-Dmaven.test.skip=true']), opt('offline', 'Offline', ['-o'], 'Never contact remote repositories'),
    opt('update', 'Update snapshots', ['-U'], 'Force-check remote repositories for updated snapshots and releases'), opt('parallel', 'Parallel (1 thread per core)', ['-T', '1C']), opt('quiet', 'Quiet', ['-q']), opt('debug', 'Debug (-X)', ['-X']),
    opt('failEnd', 'Fail at end', ['--fail-at-end'], 'Build every module that can be built, report failures at the end'), opt('batch', 'Batch (no colours)', ['-B'], '', true), opt('errors', 'Show stack traces', ['-e']),
  ],
  describe(dir) {
    const doc = parseXml(readText(dir, 'pom.xml'));
    const p = kid(doc, 'project');
    if (!p) return { facts: [['Error', 'pom.xml could not be read']] };
    const parent = kid(p, 'parent');
    const props = {};
    for (const c of kid(p, 'properties') ? kid(p, 'properties').children : []) props[c.name] = c.text.trim();
    const depsOf = (n) => kids(kid(n, 'dependencies'), 'dependency').map((d) => ({ name: `${txt(d, 'groupId')}:${txt(d, 'artifactId')}`, version: txt(d, 'version'), scope: txt(d, 'scope') || 'compile', optional: txt(d, 'optional') === 'true' }));
    const build = kid(p, 'build');
    const plugins = [...kids(kid(build, 'plugins'), 'plugin'), ...kids(kid(kid(build, 'pluginManagement'), 'plugins'), 'plugin')].map((x) => ({ name: `${txt(x, 'groupId') || 'org.apache.maven.plugins'}:${txt(x, 'artifactId')}`, artifact: txt(x, 'artifactId'), version: txt(x, 'version') }));
    const compiler = plugins.find((x) => x.artifact === 'maven-compiler-plugin');
    const java = props['java.version'] || props['maven.compiler.release'] || props['maven.compiler.source'] || props['release.version'] || '';
    const profiles = kids(kid(p, 'profiles'), 'profile').map((x) => ({ id: txt(x, 'id'), active: txt(kid(x, 'activation'), 'activeByDefault') === 'true' })).filter((x) => x.id);
    const modules = kids(kid(p, 'modules'), 'module').map((m) => m.text.trim()).filter(Boolean);
    const groupId = txt(p, 'groupId') || txt(parent, 'groupId');
    const version = txt(p, 'version') || txt(parent, 'version');
    const deps = depsOf(p);
    const hasBoot = (parent && /spring-boot/.test(txt(parent, 'artifactId'))) || plugins.some((x) => x.artifact === 'spring-boot-maven-plugin');
    return {
      title: txt(p, 'name') || txt(p, 'artifactId') || path.basename(dir),
      facts: [['Artifact', `${groupId}:${txt(p, 'artifactId')}:${version}`], ['Packaging', txt(p, 'packaging') || 'jar'], ['Java', java || '(not set)'], ...(parent ? [['Parent', `${txt(parent, 'groupId')}:${txt(parent, 'artifactId')}:${txt(parent, 'version')}`]] : []), ['Wrapper', exists(dir, 'mvnw.cmd') || exists(dir, 'mvnw') ? 'mvnw present' : 'none (uses installed Maven)']],
      dependencies: deps, modules: modules.map((m) => ({ name: m, dir: path.join(dir, m) })), profiles, plugins, properties: props,
      pluginIds: [...new Set(plugins.map((x) => x.artifact).concat(hasBoot ? ['spring-boot-maven-plugin'] : []))], lombok: deps.some((d) => /projectlombok:lombok/.test(d.name)), compilerVersion: compiler ? compiler.version : '',
    };
  },
};

/* ------------------------------ Gradle ------------------------------ */

const gradle = {
  id: 'gradle', name: 'Gradle', files: ['build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts'], exe: 'gradle', wrapper: ['gradlew.bat', 'gradlew'], versionArgs: ['-v'],
  goals: (info) => [
    goal('build', 'build', ['build'], 'Lifecycle', true), goal('cb', 'clean build', ['clean', 'build'], 'Lifecycle', true), goal('test', 'test', ['test'], 'Lifecycle', true), goal('assemble', 'assemble', ['assemble'], 'Lifecycle'), goal('check', 'check', ['check'], 'Lifecycle'),
    goal('clean', 'clean', ['clean'], 'Lifecycle'), goal('classes', 'classes', ['classes'], 'Lifecycle'), goal('jar', 'jar', ['jar'], 'Lifecycle'),
    goal('deps', 'dependencies', ['dependencies'], 'Inspect'), goal('tasks', 'tasks', ['tasks', '--all'], 'Inspect'), goal('props', 'properties', ['properties'], 'Inspect'), goal('upd', 'wrapper (update)', ['wrapper', '--gradle-version', 'latest'], 'Inspect'),
    ...(info.springBoot ? [goal('bootRun', 'bootRun', ['bootRun'], 'Run', true), goal('bootJar', 'bootJar', ['bootJar'], 'Run'), goal('bootImage', 'bootBuildImage', ['bootBuildImage'], 'Run')] : []),
    ...(info.application ? [goal('run', 'run', ['run'], 'Run', true)] : []),
  ],
  options: [opt('offline', 'Offline', ['--offline']), opt('noTests', 'Skip tests (-x test)', ['-x', 'test']), opt('parallel', 'Parallel', ['--parallel']), opt('refresh', 'Refresh dependencies', ['--refresh-dependencies']), opt('cont', 'Continue after failure', ['--continue']),
    opt('info', 'Info logging', ['--info']), opt('stack', 'Stack traces', ['--stacktrace']), opt('nodaemon', 'No daemon', ['--no-daemon'])],
  describe(dir) {
    const f = ['build.gradle.kts', 'build.gradle'].find((x) => exists(dir, x));
    const text = f ? readText(dir, f) : '';
    const settings = readText(dir, exists(dir, 'settings.gradle.kts') ? 'settings.gradle.kts' : 'settings.gradle');
    const deps = [];
    for (const m of text.matchAll(/^\s*(implementation|api|compileOnly|runtimeOnly|testImplementation|testRuntimeOnly|annotationProcessor|kapt|developmentOnly)\s*\(?\s*['"]([^'"]+)['"]/gm)) { const [g, a, v] = m[2].split(':'); deps.push({ name: `${g}:${a || ''}`, version: v || '', scope: m[1] }); }
    const plugins = [...text.matchAll(/id\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    const mods = [...settings.matchAll(/include\s*\(?([^)\n]+)/g)].flatMap((m) => [...m[1].matchAll(/['"]:?([^'"]+)['"]/g)].map((x) => x[1]));
    return {
      title: (/rootProject\.name\s*=\s*['"]([^'"]+)['"]/.exec(settings) || [])[1] || path.basename(dir),
      facts: [['Build file', f || '(settings only)'], ['Plugins', plugins.slice(0, 6).join(', ') || '(none found)'], ['Wrapper', exists(dir, 'gradlew.bat') ? 'gradlew present' : 'none (uses installed Gradle)']],
      dependencies: deps, modules: mods.map((m) => ({ name: m, dir: path.join(dir, m.replace(/:/g, path.sep)) })), springBoot: plugins.some((p) => /springframework\.boot/.test(p)), application: plugins.includes('application'), lombok: deps.some((d) => /lombok/.test(d.name)),
    };
  },
};

/* ------------------------------ Ant, Make, CMake ------------------------------ */

const ant = {
  id: 'ant', name: 'Ant', files: ['build.xml'], exe: 'ant', wrapper: [], versionArgs: ['-version'],
  goals: (info) => (info.targets || []).slice(0, 40).map((t, i) => goal(`t:${t.name}`, t.name, [t.name], 'Targets', t.isDefault || /^(clean|build|jar|test|run|all)$/.test(t.name))),
  options: [opt('verbose', 'Verbose', ['-v']), opt('debug', 'Debug', ['-d']), opt('keep', 'Keep going', ['-k'])],
  describe(dir) {
    const p = kid(parseXml(readText(dir, 'build.xml')), 'project');
    const targets = kids(p, 'target').map((t) => ({ name: t.attrs.name, isDefault: p && t.attrs.name === p.attrs.default })).filter((t) => t.name && !t.name.startsWith('-'));
    return { title: (p && p.attrs.name) || path.basename(dir), facts: [['Default target', (p && p.attrs.default) || '(none)'], ['Targets', String(targets.length)]], targets, dependencies: [] };
  },
};

const make = {
  id: 'make', name: 'Make', files: ['Makefile', 'makefile', 'GNUmakefile'], exe: 'make', wrapper: [], versionArgs: ['--version'],
  goals: (info) => (info.targets || []).slice(0, 40).map((t) => goal(`t:${t}`, t, [t], 'Targets', /^(all|build|test|clean|install|run)$/.test(t))),
  options: [opt('jobs', 'Parallel (-j)', ['-j']), opt('dry', 'Dry run (-n)', ['-n']), opt('keep', 'Keep going (-k)', ['-k'])],
  describe(dir) {
    const text = readText(dir, ['Makefile', 'makefile', 'GNUmakefile'].find((f) => exists(dir, f)) || 'Makefile');
    const targets = [...new Set([...text.matchAll(/^([A-Za-z0-9_][A-Za-z0-9_.-]*)\s*:(?!=)/gm)].map((m) => m[1]).filter((t) => !/^\./.test(t)))];
    return { title: path.basename(dir), facts: [['Targets', String(targets.length)]], targets, dependencies: [] };
  },
};

const cmake = {
  id: 'cmake', name: 'CMake', files: ['CMakeLists.txt'], exe: 'cmake', wrapper: [], versionArgs: ['--version'],
  goals: () => [goal('configure', 'configure', ['-S', '.', '-B', 'build'], 'Build', true), goal('build', 'build', ['--build', 'build'], 'Build', true), goal('release', 'build (Release)', ['--build', 'build', '--config', 'Release'], 'Build'), goal('install', 'install', ['--install', 'build'], 'Build'), goal('clean', 'clean', ['--build', 'build', '--target', 'clean'], 'Build')],
  options: [],
  describe(dir) { const t = readText(dir, 'CMakeLists.txt'); return { title: (/project\s*\(\s*([\w.-]+)/i.exec(t) || [])[1] || path.basename(dir), facts: [['Minimum CMake', (/cmake_minimum_required\s*\(\s*VERSION\s+([\d.]+)/i.exec(t) || [])[1] || '?']], dependencies: [...t.matchAll(/find_package\s*\(\s*([\w.-]+)/gi)].map((m) => ({ name: m[1], version: '', scope: 'find_package' })) }; },
};

/* ------------------------------ JavaScript: npm / yarn / pnpm / bun ------------------------------ */

function jsManager(dir) { return exists(dir, 'pnpm-lock.yaml') ? 'pnpm' : exists(dir, 'yarn.lock') ? 'yarn' : (exists(dir, 'bun.lockb') || exists(dir, 'bun.lock')) ? 'bun' : 'npm'; }
const jsRun = (pm, s) => (pm === 'npm' ? ['run', s] : pm === 'yarn' ? [s] : ['run', s]);
const node = {
  id: 'npm', name: 'npm / Yarn / pnpm / Bun', files: ['package.json'], exe: 'npm', wrapper: [], versionArgs: ['-v'], dynamicExe: true,
  goals: (info) => {
    const pm = info.pm || 'npm';
    const rec = ['dev', 'start', 'build', 'test', 'lint', 'preview', 'serve', 'format', 'typecheck'];
    const scripts = Object.keys(info.scripts || {}).map((s) => goal(`s:${s}`, s, jsRun(pm, s), 'Scripts', rec.includes(s), { title: info.scripts[s] }));
    const inst = pm === 'npm' ? [goal('install', 'install', ['install'], 'Dependencies', true), goal('ci', 'ci (clean install)', ['ci'], 'Dependencies')] : [goal('install', 'install', ['install'], 'Dependencies', true)];
    return [...inst, ...scripts, goal('outdated', 'outdated', ['outdated'], 'Dependencies'), goal('audit', 'audit', ['audit'], 'Dependencies'), goal('update', 'update', pm === 'yarn' ? ['upgrade'] : ['update'], 'Dependencies'), ...(pm === 'npm' ? [goal('ls', 'list', ['ls', '--depth=0'], 'Dependencies'), goal('auditfix', 'audit fix', ['audit', 'fix'], 'Dependencies')] : [])];
  },
  options: [opt('prod', 'Production only', ['--production']), opt('legacy', 'Legacy peer deps', ['--legacy-peer-deps'], 'npm only'), opt('force', 'Force', ['--force'])],
  describe(dir) {
    let pkg = {};
    try { pkg = JSON.parse(readText(dir, 'package.json')); } catch { return { facts: [['Error', 'package.json could not be read']] }; }
    const pm = jsManager(dir);
    const deps = [...Object.entries(pkg.dependencies || {}).map(([n, v]) => ({ name: n, version: v, scope: 'dependency' })), ...Object.entries(pkg.devDependencies || {}).map(([n, v]) => ({ name: n, version: v, scope: 'dev' })), ...Object.entries(pkg.peerDependencies || {}).map(([n, v]) => ({ name: n, version: v, scope: 'peer' }))];
    return { title: pkg.name || path.basename(dir), pm, scripts: pkg.scripts || {}, facts: [['Package', `${pkg.name || '?'}@${pkg.version || '?'}`], ['Package manager', pm], ['Node engine', (pkg.engines && pkg.engines.node) || '(any)'], ['Type', pkg.type || 'commonjs']], dependencies: deps, modules: (Array.isArray(pkg.workspaces) ? pkg.workspaces : (pkg.workspaces && pkg.workspaces.packages) || []).map((w) => ({ name: w, dir: path.join(dir, w.replace(/\*.*$/, '')) })) };
  },
};

/* ------------------------------ Python ------------------------------ */

const python = {
  id: 'python', name: 'pip / Poetry / uv', files: ['pyproject.toml', 'requirements.txt', 'setup.py', 'Pipfile', 'setup.cfg'], exe: 'python', wrapper: [], versionArgs: ['--version'],
  goals: (info) => {
    const t = info.manager || 'pip';
    if (t === 'poetry') return [goal('install', 'install', ['install'], 'Dependencies', true), goal('test', 'pytest', ['run', 'pytest'], 'Quality', true), goal('build', 'build', ['build'], 'Build', true), goal('update', 'update', ['update'], 'Dependencies'), goal('lock', 'lock', ['lock'], 'Dependencies'), goal('outdated', 'outdated', ['show', '--outdated'], 'Dependencies'), goal('lint', 'ruff', ['run', 'ruff', 'check', '.'], 'Quality'), goal('fmt', 'black', ['run', 'black', '.'], 'Quality')];
    if (t === 'uv') return [goal('sync', 'sync', ['sync'], 'Dependencies', true), goal('test', 'pytest', ['run', 'pytest'], 'Quality', true), goal('build', 'build', ['build'], 'Build'), goal('lock', 'lock', ['lock'], 'Dependencies'), goal('lint', 'ruff', ['run', 'ruff', 'check', '.'], 'Quality'), goal('tree', 'tree', ['tree'], 'Dependencies')];
    return [goal('venv', 'create .venv', ['-m', 'venv', '.venv'], 'Environment', true), goal('install', 'install requirements', ['-m', 'pip', 'install', '-r', 'requirements.txt'], 'Dependencies', true), goal('editable', 'install (editable)', ['-m', 'pip', 'install', '-e', '.'], 'Dependencies'),
      goal('test', 'pytest', ['-m', 'pytest', '-q'], 'Quality', true), goal('build', 'build wheel', ['-m', 'build'], 'Build'), goal('black', 'black', ['-m', 'black', '.'], 'Quality'), goal('ruff', 'ruff', ['-m', 'ruff', 'check', '.'], 'Quality'), goal('mypy', 'mypy', ['-m', 'mypy', '.'], 'Quality'),
      goal('outdated', 'outdated', ['-m', 'pip', 'list', '--outdated'], 'Dependencies'), goal('freeze', 'freeze', ['-m', 'pip', 'freeze'], 'Dependencies')];
  },
  options: [],
  exeFor: (info) => (info.manager === 'poetry' ? 'poetry' : info.manager === 'uv' ? 'uv' : 'python'),
  describe(dir) {
    const manager = exists(dir, 'poetry.lock') || /\[tool\.poetry\]/.test(readText(dir, 'pyproject.toml')) ? 'poetry' : exists(dir, 'uv.lock') || /\[tool\.uv\]/.test(readText(dir, 'pyproject.toml')) ? 'uv' : 'pip';
    const deps = [];
    for (const l of readText(dir, 'requirements.txt').split(/\r?\n/)) { const m = /^\s*([A-Za-z0-9_.-]+)\s*([=<>~!]=?[^#;\s]*)?/.exec(l); if (m && !l.trim().startsWith('#') && !l.trim().startsWith('-')) deps.push({ name: m[1], version: (m[2] || '').replace(/^==/, ''), scope: 'requirements' }); }
    const py = readText(dir, 'pyproject.toml');
    const blk = /^\[project\][\s\S]*?^dependencies\s*=\s*\[([\s\S]*?)\]/m.exec(py);
    if (blk) for (const m of blk[1].matchAll(/["']([A-Za-z0-9_.-]+)\s*([^"']*)["']/g)) deps.push({ name: m[1], version: m[2].trim(), scope: 'project' });
    const pb = /^\[tool\.poetry\.dependencies\]([\s\S]*?)(?:^\[|$)/m.exec(py);
    if (pb) for (const m of pb[1].matchAll(/^([A-Za-z0-9_.-]+)\s*=\s*["{]?([^\n"]*)/gm)) if (m[1] !== 'python') deps.push({ name: m[1], version: m[2].replace(/[",{}]/g, '').trim(), scope: 'poetry' });
    return { title: (/^name\s*=\s*["']([^"']+)/m.exec(py) || [])[1] || path.basename(dir), manager, facts: [['Manager', manager], ['Virtual env', exists(dir, '.venv') ? '.venv present' : 'none yet'], ['Config', ['pyproject.toml', 'requirements.txt', 'setup.py'].filter((f) => exists(dir, f)).join(', ')]], dependencies: deps };
  },
};

/* ------------------------------ Go, Rust, .NET, PHP, Ruby, Dart, Scala, Bazel ------------------------------ */

const go = {
  id: 'go', name: 'Go', files: ['go.mod'], exe: 'go', wrapper: [], versionArgs: ['version'],
  goals: () => [goal('run', 'run .', ['run', '.'], 'Run', true), goal('build', 'build ./...', ['build', './...'], 'Build', true), goal('test', 'test ./...', ['test', './...'], 'Quality', true), goal('race', 'test -race', ['test', '-race', './...'], 'Quality'), goal('vet', 'vet', ['vet', './...'], 'Quality'), goal('fmt', 'fmt', ['fmt', './...'], 'Quality'), goal('tidy', 'mod tidy', ['mod', 'tidy'], 'Dependencies'), goal('dl', 'mod download', ['mod', 'download'], 'Dependencies'), goal('upd', 'newer versions', ['list', '-u', '-m', 'all'], 'Dependencies'), goal('install', 'install', ['install', './...'], 'Build')],
  options: [opt('v', 'Verbose (-v)', ['-v']), opt('count', 'No test cache (-count=1)', ['-count=1'])],
  describe(dir) { const t = readText(dir, 'go.mod'); const deps = [...t.matchAll(/^\s*(?:require\s+)?([\w./~-]+\.[\w./~-]+)\s+(v[\w.+-]+)/gm)].map((m) => ({ name: m[1], version: m[2], scope: 'require' })); return { title: (/^module\s+(\S+)/m.exec(t) || [])[1] || path.basename(dir), facts: [['Go version', (/^go\s+(\S+)/m.exec(t) || [])[1] || '?']], dependencies: deps }; },
};
const cargo = {
  id: 'cargo', name: 'Cargo (Rust)', files: ['Cargo.toml'], exe: 'cargo', wrapper: [], versionArgs: ['--version'],
  goals: () => [goal('run', 'run', ['run'], 'Run', true), goal('build', 'build', ['build'], 'Build', true), goal('test', 'test', ['test'], 'Quality', true), goal('check', 'check', ['check'], 'Build'), goal('rel', 'build --release', ['build', '--release'], 'Build'), goal('clippy', 'clippy', ['clippy'], 'Quality'), goal('fmt', 'fmt', ['fmt'], 'Quality'), goal('doc', 'doc', ['doc'], 'Docs'), goal('update', 'update', ['update'], 'Dependencies'), goal('tree', 'tree', ['tree'], 'Dependencies'), goal('clean', 'clean', ['clean'], 'Build')],
  options: [opt('release', 'Release (--release)', ['--release']), opt('offline', 'Offline', ['--offline']), opt('features', 'All features', ['--all-features'])],
  describe(dir) { const t = readText(dir, 'Cargo.toml'); const sec = /^\[dependencies\]([\s\S]*?)(?:^\[|$)/m.exec(t); const deps = sec ? [...sec[1].matchAll(/^([\w-]+)\s*=\s*(?:"([^"]+)"|\{[^}]*version\s*=\s*"([^"]+)")/gm)].map((m) => ({ name: m[1], version: m[2] || m[3] || '', scope: 'dependency' })) : []; return { title: (/^name\s*=\s*"([^"]+)"/m.exec(t) || [])[1] || path.basename(dir), facts: [['Version', (/^version\s*=\s*"([^"]+)"/m.exec(t) || [])[1] || '?'], ['Edition', (/^edition\s*=\s*"([^"]+)"/m.exec(t) || [])[1] || '?']], dependencies: deps }; },
};
const dotnet = {
  id: 'dotnet', name: '.NET', files: [/\.(csproj|fsproj|vbproj|sln)$/i], exe: 'dotnet', wrapper: [], versionArgs: ['--version'],
  goals: () => [goal('run', 'run', ['run'], 'Run', true), goal('build', 'build', ['build'], 'Build', true), goal('test', 'test', ['test'], 'Quality', true), goal('restore', 'restore', ['restore'], 'Dependencies'), goal('watch', 'watch run', ['watch', 'run'], 'Run'), goal('pub', 'publish (Release)', ['publish', '-c', 'Release'], 'Build'), goal('pack', 'pack', ['pack'], 'Build'), goal('fmt', 'format', ['format'], 'Quality'), goal('clean', 'clean', ['clean'], 'Build'), goal('outd', 'outdated packages', ['list', 'package', '--outdated'], 'Dependencies')],
  options: [opt('release', 'Release (-c Release)', ['-c', 'Release']), opt('norestore', 'No restore', ['--no-restore'])],
  describe(dir) {
    const files = fs.readdirSync(dir).filter((f) => /\.(csproj|fsproj|vbproj)$/i.test(f));
    const deps = []; let fw = '';
    for (const f of files) { const t = readText(dir, f); fw = fw || (/<TargetFrameworks?>([^<]+)</.exec(t) || [])[1] || ''; for (const m of t.matchAll(/<PackageReference\s+Include="([^"]+)"(?:\s+Version="([^"]+)")?/g)) deps.push({ name: m[1], version: m[2] || '', scope: 'package' }); }
    return { title: (files[0] || fs.readdirSync(dir).find((f) => /\.sln$/i.test(f)) || path.basename(dir)).replace(/\.\w+$/, ''), facts: [['Target framework', fw || '?'], ['Projects', String(files.length)]], dependencies: deps };
  },
};
const composer = {
  id: 'composer', name: 'Composer (PHP)', files: ['composer.json'], exe: 'composer', wrapper: [], versionArgs: ['--version'],
  goals: () => [goal('install', 'install', ['install'], 'Dependencies', true), goal('update', 'update', ['update'], 'Dependencies'), goal('dump', 'dump-autoload', ['dump-autoload'], 'Dependencies'), goal('outd', 'outdated', ['outdated'], 'Dependencies'), goal('test', 'test', ['run-script', 'test'], 'Quality', true), goal('validate', 'validate', ['validate'], 'Quality')], options: [],
  describe(dir) { let j = {}; try { j = JSON.parse(readText(dir, 'composer.json')); } catch { /* ignore */ } return { title: j.name || path.basename(dir), facts: [['PHP', (j.require && j.require.php) || '?']], dependencies: [...Object.entries(j.require || {}), ...Object.entries(j['require-dev'] || {})].map(([n, v]) => ({ name: n, version: v, scope: 'package' })) }; },
};
const bundler = {
  id: 'bundler', name: 'Bundler (Ruby)', files: ['Gemfile'], exe: 'bundle', wrapper: [], versionArgs: ['-v'],
  goals: () => [goal('install', 'install', ['install'], 'Dependencies', true), goal('rspec', 'rspec', ['exec', 'rspec'], 'Quality', true), goal('rake', 'rake', ['exec', 'rake'], 'Build'), goal('outd', 'outdated', ['outdated'], 'Dependencies'), goal('update', 'update', ['update'], 'Dependencies')], options: [],
  describe(dir) { const t = readText(dir, 'Gemfile'); return { title: path.basename(dir), facts: [['Ruby', (/^ruby\s+["']([^"']+)/m.exec(t) || [])[1] || '?']], dependencies: [...t.matchAll(/^\s*gem\s+["']([^"']+)["'](?:\s*,\s*["']([^"']+)["'])?/gm)].map((m) => ({ name: m[1], version: m[2] || '', scope: 'gem' })) }; },
};
const flutter = {
  id: 'flutter', name: 'Flutter / Dart', files: ['pubspec.yaml'], exe: 'flutter', wrapper: [], versionArgs: ['--version'],
  goals: () => [goal('get', 'pub get', ['pub', 'get'], 'Dependencies', true), goal('run', 'run', ['run'], 'Run', true), goal('test', 'test', ['test'], 'Quality', true), goal('analyze', 'analyze', ['analyze'], 'Quality'), goal('apk', 'build apk', ['build', 'apk'], 'Build'), goal('web', 'build web', ['build', 'web'], 'Build'), goal('upgrade', 'pub upgrade', ['pub', 'upgrade'], 'Dependencies')], options: [],
  describe(dir) { const t = readText(dir, 'pubspec.yaml'); const sec = /^dependencies:\s*\n((?:[ \t]+.*\n?)*)/m.exec(t); return { title: (/^name:\s*(\S+)/m.exec(t) || [])[1] || path.basename(dir), facts: [['Version', (/^version:\s*(\S+)/m.exec(t) || [])[1] || '?']], dependencies: sec ? [...sec[1].matchAll(/^[ \t]+([\w_]+):\s*(\S*)/gm)].filter((m) => m[1] !== 'flutter').map((m) => ({ name: m[1], version: m[2], scope: 'dependency' })) : [] }; },
};
const sbt = {
  id: 'sbt', name: 'sbt (Scala)', files: ['build.sbt'], exe: 'sbt', wrapper: [], versionArgs: ['--version'],
  goals: () => [goal('compile', 'compile', ['compile'], 'Build', true), goal('test', 'test', ['test'], 'Quality', true), goal('run', 'run', ['run'], 'Run', true), goal('package', 'package', ['package'], 'Build'), goal('clean', 'clean', ['clean'], 'Build'), goal('upd', 'dependencyUpdates', ['dependencyUpdates'], 'Dependencies')], options: [],
  describe(dir) { const t = readText(dir, 'build.sbt'); return { title: (/name\s*:=\s*"([^"]+)"/.exec(t) || [])[1] || path.basename(dir), facts: [['Scala', (/scalaVersion\s*:=\s*"([^"]+)"/.exec(t) || [])[1] || '?']], dependencies: [...t.matchAll(/"([^"]+)"\s+%%?\s+"([^"]+)"\s+%\s+"([^"]+)"/g)].map((m) => ({ name: `${m[1]}:${m[2]}`, version: m[3], scope: 'library' })) }; },
};
const bazel = {
  id: 'bazel', name: 'Bazel', files: ['WORKSPACE', 'WORKSPACE.bazel', 'MODULE.bazel'], exe: 'bazel', wrapper: [], versionArgs: ['--version'],
  goals: () => [goal('build', 'build //...', ['build', '//...'], 'Build', true), goal('test', 'test //...', ['test', '//...'], 'Quality', true), goal('clean', 'clean', ['clean'], 'Build'), goal('query', 'query //...', ['query', '//...'], 'Inspect')], options: [],
  describe(dir) { return { title: path.basename(dir), facts: [['Workspace', ['MODULE.bazel', 'WORKSPACE.bazel', 'WORKSPACE'].find((f) => exists(dir, f)) || '']], dependencies: [] }; },
};

const TOOLS = [maven, gradle, ant, node, python, go, cargo, dotnet, composer, bundler, flutter, sbt, cmake, make, bazel];

module.exports = { TOOLS, parseXml, jsManager, MAVEN_PLUGIN_GOALS };
