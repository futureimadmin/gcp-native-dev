/**
 * Runtimes, build-environment detection, and local servers (Tomcat, anything listening on localhost).
 * This module only DESCRIBES what to run; the UI shows the command and runs it in the terminal panel.
 */
const fs = require('fs');
const path = require('path');
const { exec } = require('./util');

const WIN = process.platform === 'win32';
const SKIP = new Set(['node_modules', '.git', 'target', 'build', 'dist', '.gradle', '.idea', '.venv', '__pycache__', 'out', 'bin', 'obj', '.angular', '.next']);

const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const has = (d, n) => fs.existsSync(path.join(d, n));
const readJson = (f) => { try { return JSON.parse(read(f)); } catch { return null; } };

const JDWP = (port) => `-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:${port}`;

function detectDir(dir) {
  const found = [];
  const rel = (p) => p;

  if (has(dir, 'pom.xml')) {
    const pom = read(path.join(dir, 'pom.xml'));
    const mvn = WIN && has(dir, 'mvnw.cmd') ? 'mvnw.cmd' : (has(dir, 'mvnw') && !WIN ? './mvnw' : 'mvn');
    const spring = /spring-boot/.test(pom);
    const quarkus = /quarkus/.test(pom);
    const war = /<packaging>\s*war\s*<\/packaging>/.test(pom);
    const type = quarkus ? 'Quarkus (Maven)' : spring ? 'Spring Boot (Maven)' : war ? 'Java web app (Maven, WAR)' : 'Java (Maven)';
    const tasks = [
      { id: 'build', kind: 'build', label: 'Compile (Maven)', cmd: `${mvn} -q -B compile`, needs: 'maven' },
      { id: 'package', kind: 'build', label: 'Package', cmd: `${mvn} -B package -DskipTests`, needs: 'maven' },
      { id: 'test', kind: 'test', label: 'Test', cmd: `${mvn} -B test`, needs: 'maven' },
    ];
    if (quarkus) {
      tasks.push({ id: 'run', kind: 'run', label: 'Run (dev mode, live reload)', cmd: `${mvn} quarkus:dev`, needs: 'maven', port: 8080 });
      tasks.push({ id: 'debug', kind: 'debug', label: 'Debug (port 5005)', cmd: `${mvn} quarkus:dev -Ddebug=5005`, needs: 'maven', port: 8080, debugPort: 5005, debugKind: 'java' });
    } else if (spring) {
      tasks.push({ id: 'run', kind: 'run', label: 'Run', cmd: `${mvn} spring-boot:run`, needs: 'maven', port: 8080 });
      tasks.push({ id: 'debug', kind: 'debug', label: 'Debug (port 5005)', cmd: `${mvn} spring-boot:run "-Dspring-boot.run.jvmArguments=${JDWP(5005)}"`, needs: 'maven', port: 8080, debugPort: 5005, debugKind: 'java' });
    }
    if (war) tasks.push({ id: 'deploy-tomcat', kind: 'server', label: 'Package and deploy to Tomcat', cmd: `${mvn} -B package -DskipTests`, needs: 'maven', deployWar: true });
    found.push({ type, dir, java: true, war, tasks });
  }

  const gradleFile = ['build.gradle', 'build.gradle.kts'].find((f) => has(dir, f));
  if (gradleFile) {
    const g = read(path.join(dir, gradleFile));
    const gw = WIN && has(dir, 'gradlew.bat') ? 'gradlew.bat' : (has(dir, 'gradlew') && !WIN ? './gradlew' : 'gradle');
    const spring = /spring-boot|org\.springframework\.boot/.test(g);
    const quarkus = /quarkus/.test(g);
    const tasks = [
      { id: 'build', kind: 'build', label: 'Compile (Gradle)', cmd: `${gw} -q classes`, needs: 'gradle' },
      { id: 'package', kind: 'build', label: 'Build', cmd: `${gw} build -x test`, needs: 'gradle' },
      { id: 'test', kind: 'test', label: 'Test', cmd: `${gw} test`, needs: 'gradle' },
    ];
    if (quarkus) {
      tasks.push({ id: 'run', kind: 'run', label: 'Run (dev mode)', cmd: `${gw} quarkusDev`, needs: 'gradle', port: 8080 });
      tasks.push({ id: 'debug', kind: 'debug', label: 'Debug (port 5005)', cmd: `${gw} quarkusDev -Ddebug=5005`, needs: 'gradle', port: 8080, debugPort: 5005, debugKind: 'java' });
    } else if (spring) {
      tasks.push({ id: 'run', kind: 'run', label: 'Run', cmd: `${gw} bootRun`, needs: 'gradle', port: 8080 });
      tasks.push({ id: 'debug', kind: 'debug', label: 'Debug (port 5005)', cmd: `${gw} bootRun --debug-jvm`, needs: 'gradle', port: 8080, debugPort: 5005, debugKind: 'java' });
    }
    found.push({ type: quarkus ? 'Quarkus (Gradle)' : spring ? 'Spring Boot (Gradle)' : 'Java (Gradle)', dir, java: true, tasks });
  }

  const pkg = has(dir, 'package.json') ? readJson(path.join(dir, 'package.json')) : null;
  if (pkg) {
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const scripts = pkg.scripts || {};
    const fw = deps['@angular/core'] ? 'Angular' : deps.next ? 'Next.js' : deps.react ? 'React' : deps.vue ? 'Vue' : deps.svelte ? 'Svelte' : deps.express || deps.fastify || deps['@nestjs/core'] ? 'Node.js service' : 'Node.js';
    const ts = !!deps.typescript;
    const tasks = [];
    if (!has(dir, 'node_modules')) tasks.push({ id: 'install', kind: 'build', label: 'Install dependencies', cmd: has(dir, 'pnpm-lock.yaml') ? 'pnpm install' : has(dir, 'yarn.lock') ? 'yarn install' : 'npm install', needs: 'node' });
    else tasks.push({ id: 'install', kind: 'build', label: 'Install dependencies', cmd: 'npm install', needs: 'node' });
    if (scripts.build) tasks.push({ id: 'build', kind: 'build', label: 'Build', cmd: 'npm run build', needs: 'node', auto: ts && !deps.vite && !deps['@angular/core'] ? true : false });
    if (scripts.test) tasks.push({ id: 'test', kind: 'test', label: 'Test', cmd: 'npm test', needs: 'node' });
    const runScript = scripts.dev ? 'dev' : scripts.start ? 'start' : scripts.serve ? 'serve' : '';
    if (runScript) tasks.push({ id: 'run', kind: 'run', label: `Run (npm run ${runScript})`, cmd: runScript === 'start' ? 'npm start' : `npm run ${runScript}`, needs: 'node', port: fw === 'Angular' ? 4200 : deps.vite ? 5173 : 3000 });
    const main = pkg.main && !/[*?]/.test(pkg.main) ? pkg.main : (has(dir, 'server.js') ? 'server.js' : has(dir, 'index.js') ? 'index.js' : '');
    if (main && /^[\w./-]+$/.test(main) && !['React', 'Angular', 'Vue', 'Next.js', 'Svelte'].includes(fw)) {
      tasks.push({ id: 'debug', kind: 'debug', label: 'Debug (inspector on 9229)', cmd: `node --inspect=9229 ${main}`, needs: 'node', port: 3000, debugPort: 9229, debugKind: 'node' });
    }
    found.push({ type: fw, dir, tasks });
  }

  if (has(dir, 'requirements.txt') || has(dir, 'pyproject.toml') || has(dir, 'setup.py')) {
    const req = read(path.join(dir, 'requirements.txt')).toLowerCase() + read(path.join(dir, 'pyproject.toml')).toLowerCase();
    const entry = ['main.py', 'app.py', 'manage.py', 'wsgi.py'].find((f) => has(dir, f)) || '';
    const fastapi = /fastapi/.test(req);
    const django = /django/.test(req);
    const tasks = [{ id: 'install', kind: 'build', label: 'Install dependencies', cmd: has(dir, 'requirements.txt') ? 'python -m pip install -r requirements.txt' : 'python -m pip install -e .', needs: 'python' }];
    if (fastapi && entry === 'main.py') tasks.push({ id: 'run', kind: 'run', label: 'Run (uvicorn --reload)', cmd: 'python -m uvicorn main:app --reload --port 8000', needs: 'python', port: 8000 });
    else if (django && entry === 'manage.py') tasks.push({ id: 'run', kind: 'run', label: 'Run (manage.py runserver)', cmd: 'python manage.py runserver', needs: 'python', port: 8000 });
    else if (entry) tasks.push({ id: 'run', kind: 'run', label: `Run (${entry})`, cmd: `python ${entry}`, needs: 'python' });
    if (entry && /^[\w.]+$/.test(entry)) tasks.push({ id: 'debug', kind: 'debug', label: 'Debug (debugpy on 5678)', cmd: `python -m debugpy --listen 5678 --wait-for-client ${entry}`, needs: 'python', debugPort: 5678, debugKind: 'python' });
    tasks.push({ id: 'test', kind: 'test', label: 'Test (pytest)', cmd: 'python -m pytest', needs: 'python' });
    found.push({ type: fastapi ? 'Python (FastAPI)' : django ? 'Python (Django)' : 'Python', dir, tasks });
  }

  if (has(dir, 'go.mod')) {
    found.push({ type: 'Go', dir, tasks: [
      { id: 'build', kind: 'build', label: 'Build', cmd: 'go build ./...', needs: 'go', auto: true },
      { id: 'test', kind: 'test', label: 'Test', cmd: 'go test ./...', needs: 'go' },
      { id: 'run', kind: 'run', label: 'Run', cmd: 'go run .', needs: 'go' },
      { id: 'debug', kind: 'debug', label: 'Debug (delve on 2345)', cmd: 'dlv debug --headless --listen=127.0.0.1:2345 --api-version=2', needs: 'go', debugPort: 2345, debugKind: 'go' },
    ] });
  }

  const proj = fs.existsSync(dir) && fs.readdirSync(dir).find((f) => /\.(csproj|fsproj)$/.test(f));
  if (proj) {
    found.push({ type: '.NET', dir, tasks: [
      { id: 'build', kind: 'build', label: 'Build', cmd: 'dotnet build', needs: 'dotnet', auto: true },
      { id: 'test', kind: 'test', label: 'Test', cmd: 'dotnet test', needs: 'dotnet' },
      { id: 'run', kind: 'run', label: 'Run', cmd: 'dotnet run', needs: 'dotnet', port: 5000 },
    ] });
  }
  return found.map((f) => ({ ...f, rel: rel(path.basename(f.dir)) }));
}

function detectBuild(ws) {
  if (!ws || !fs.existsSync(ws)) return [];
  const out = detectDir(ws);
  if (!out.length) {
    for (const e of fs.readdirSync(ws, { withFileTypes: true })) {
      if (e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith('.')) out.push(...detectDir(path.join(ws, e.name)));
    }
  }
  if (!out.length) {
    let hasJava = false;
    const scan = (d, depth) => {
      if (hasJava || depth > 10) return;
      let es = [];
      try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of es) {
        if (e.isFile() && e.name.endsWith('.java')) { hasJava = true; return; }
        if (e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith('.')) scan(path.join(d, e.name), depth + 1);
      }
    };
    scan(ws, 0);
    if (hasJava) out.push({ type: 'Java (plain)', dir: ws, rel: path.basename(ws), java: true, tasks: [{ id: 'build', kind: 'build', label: 'Compile (built-in javac)', cmd: 'javac', needs: 'java' }] });
  }
  return out;
}

function register({ ipcMain, wrap, tools }) {
  ipcMain.handle('runtime:list', wrap(async () => tools.list()));
  ipcMain.handle('runtime:set', wrap(async (id, dir) => { tools.setOverride(String(id), dir ? String(dir) : ''); return tools.list(); }));
  ipcMain.handle('build:detect', wrap(async (ws) => detectBuild(ws)));

  /* ----- Tomcat ----- */
  const tomcat = () => {
    const home = tools.tomcatHome();
    if (!home) throw new Error('Apache Tomcat was not found. Set its folder in Settings > Runtimes.');
    return home;
  };
  ipcMain.handle('server:tomcatInfo', wrap(async () => {
    const home = tools.tomcatHome();
    return { home: home || '', apps: home && has(home, 'webapps') ? fs.readdirSync(path.join(home, 'webapps')).filter((n) => !/^(ROOT|docs|examples|host-manager|manager)$/.test(n)) : [] };
  }));
  ipcMain.handle('server:tomcatCommand', wrap(async (mode) => {
    const home = tomcat();
    const script = path.join(home, 'bin', WIN ? 'catalina.bat' : 'catalina.sh');
    if (mode === 'start') return { title: 'Tomcat', port: 8080, cmd: `"${script}" run` };
    if (mode === 'debug') return { title: 'Tomcat (debug 8000)', port: 8080, debugPort: 8000, cmd: WIN ? `set "JPDA_ADDRESS=8000"&& set "JPDA_TRANSPORT=dt_socket"&& "${script}" jpda run` : `JPDA_ADDRESS=8000 JPDA_TRANSPORT=dt_socket "${script}" jpda run` };
    if (mode === 'stop') return { title: 'Stop Tomcat', cmd: `"${script}" stop` };
    throw new Error('Unknown mode.');
  }));
  ipcMain.handle('server:tomcatDeploy', wrap(async (dir) => {
    const home = tomcat();
    const targetDir = path.join(dir, 'target');
    const wars = fs.existsSync(targetDir) ? fs.readdirSync(targetDir).filter((f) => f.endsWith('.war')) : [];
    const buildLibs = path.join(dir, 'build', 'libs');
    if (!wars.length && fs.existsSync(buildLibs)) wars.push(...fs.readdirSync(buildLibs).filter((f) => f.endsWith('.war')).map((f) => path.join('..', 'build', 'libs', f)));
    if (!wars.length) throw new Error('No .war file found. Package the project first.');
    const war = path.resolve(targetDir, wars[0]);
    const dest = path.join(home, 'webapps', path.basename(war));
    fs.copyFileSync(war, dest);
    return { dest, context: `/${path.basename(war, '.war')}` };
  }));

  /* ----- what is listening on this machine ----- */
  ipcMain.handle('server:listening', wrap(async () => {
    if (!WIN) {
      const r = await exec('lsof', ['-iTCP', '-sTCP:LISTEN', '-P', '-n'], { timeout: 8000 });
      return r.out.split('\n').slice(1).map((l) => l.split(/\s+/)).filter((p) => p[8]).map((p) => ({ port: Number(p[8].split(':').pop()), process: p[0], pid: Number(p[1]) }));
    }
    const ns = await exec('netstat', ['-ano', '-p', 'tcp'], { timeout: 10000 });
    const tl = await exec('tasklist', ['/FO', 'CSV', '/NH'], { timeout: 10000 });
    const names = new Map();
    for (const line of tl.out.split(/\r?\n/)) {
      const m = /^"([^"]+)","(\d+)"/.exec(line);
      if (m) names.set(Number(m[2]), m[1]);
    }
    const seen = new Set();
    const rows = [];
    for (const line of ns.out.split(/\r?\n/)) {
      const m = /^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)/.exec(line);
      if (!m) continue;
      const port = Number(m[2]);
      if (seen.has(port)) continue;
      seen.add(port);
      rows.push({ port, address: m[1], pid: Number(m[3]), process: names.get(Number(m[3])) || '' });
    }
    return rows.filter((r) => r.pid > 4).sort((a, b) => a.port - b.port);
  }));
}

module.exports = { register, detectBuild };
