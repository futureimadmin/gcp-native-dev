const { execFileSync } = require('child_process'); const fs = require('fs'); const path = require('path');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]);
let bad = 0;
for (const root of ['src', 'renderer']) for (const f of walk(path.join(__dirname, '..', root))) { if (!f.endsWith('.js')) continue; try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); } catch (e) { bad++; console.error(f + '\n' + e.stderr); } }
console.log(bad ? bad + ' file(s) with syntax errors' : 'syntax ok'); process.exit(bad ? 1 : 0);
