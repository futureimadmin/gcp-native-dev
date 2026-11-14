/* Code advisor rules for JavaScript / TypeScript / React / Node and Python: async + promises, modern syntax, safer defaults.
   Same rule format as advisor-java.js (see the comment there). `langs` limits a rule to some languages; `raw: true` matches the
   original text (string contents included) instead of the comment-free text. */
'use strict';

const JS = ['javascript', 'typescript'];
const TS = ['typescript'];
const PY = ['python'];
const jsRule = (r) => ADV_RULES.push({ langs: JS, ...r });

/* =============================== JavaScript / TypeScript / React / Node =============================== */

jsRule({
  id: 'js.then-chain', kind: 'tip', cat: 'Async / Promises', title: 'Promise .then() chain: use async / await',
  why: 'async/await reads top to bottom like normal code, lets you use try/catch for errors and makes loops and conditions simple. Under the hood it is the same promise.',
  rx: /\.\s*then\s*\([^;]*?\)\s*\.\s*(?:then|catch)\s*\(/g,
  before: 'fetch(url)\n  .then((res) => res.json())\n  .then((data) => render(data))\n  .catch((err) => showError(err));',
  after: 'try {\n  const res = await fetch(url);\n  if (!res.ok) throw new Error(`HTTP ${res.status}`);\n  render(await res.json());\n} catch (err) {\n  showError(err);\n}',
});

jsRule({
  id: 'js.node-callback', kind: 'tip', cat: 'Async / Promises', title: 'Node-style (err, data) callback: use the promise API',
  why: 'Callbacks nest quickly ("callback hell") and each level needs its own error check. Most Node modules have a promise version (fs/promises, timers/promises, util.promisify).',
  rx: /function\s*\w*\s*\(\s*err(?:or)?\s*,\s*\w+\s*\)|\(\s*err(?:or)?\s*,\s*\w+\s*\)\s*=>/g,
  before: 'fs.readFile(path, "utf8", (err, text) => {\n  if (err) return cb(err);\n  parse(text, (err, doc) => { ... });\n});',
  after: 'import { readFile } from "node:fs/promises";\nconst text = await readFile(path, "utf8");       // errors become exceptions\nconst doc = await parse(text);                     // util.promisify(parse) for old APIs',
});

jsRule({
  id: 'js.async-executor', kind: 'tip', cat: 'Async / Promises', title: 'async function passed to new Promise',
  why: 'If the async executor throws, the error is lost and the promise never settles. You rarely need new Promise at all when the work is already async.',
  rx: /new\s+Promise\s*\(\s*async\b/g,
  before: 'return new Promise(async (resolve, reject) => {\n  const data = await load();\n  resolve(data);\n});',
  after: 'async function get() {\n  return await load();       // or just: return load();\n}',
});

jsRule({
  id: 'js.sleep-promise', kind: 'tip', cat: 'Async / Promises', title: 'Hand-made sleep promise',
  why: 'Node has a ready-made promise timer, and in the browser a one-line helper is enough.',
  rx: /new\s+Promise\s*\(\s*\(?\s*(\w+)\s*\)?\s*=>\s*setTimeout\s*\(\s*\1\b/g,
  before: 'await new Promise((resolve) => setTimeout(resolve, 500));',
  after: 'import { setTimeout as sleep } from "node:timers/promises";   // Node\nawait sleep(500);\n// browser: const sleep = (ms) => new Promise((r) => setTimeout(r, ms));',
});

jsRule({
  id: 'js.await-in-loop', kind: 'tip', cat: 'Async / Promises', title: 'await inside a loop runs the calls one after another',
  why: 'If the iterations do not depend on each other, start them all and wait together with Promise.all. 10 requests of 200 ms take 2 s in a loop but about 200 ms in parallel. (Keep the loop when order matters or when you must limit concurrency.)',
  rx: /\bfor\s*\((?!\s*await)[^)]*\)\s*\{[^{}]*\bawait\b[^{}]*\}/g,
  before: 'for (const id of ids) {\n  results.push(await fetchUser(id));\n}',
  after: 'const results = await Promise.all(ids.map((id) => fetchUser(id)));\n// some may fail?  const settled = await Promise.allSettled(ids.map(fetchUser));\n// limit concurrency: use p-limit, or process in chunks of 5',
});

jsRule({
  id: 'js.sequential-awaits', kind: 'tip', cat: 'Async / Promises', title: 'Independent awaits in a row: run them together',
  why: 'The second request does not use the first result, so it can start immediately. Promise.all halves the waiting time.',
  detect(ctx) {
    const hits = [];
    const re = /^\s*(?:const|let)\s+(\w+)\s*=\s*await\s+([^;\n]+);?\s*$/;
    for (let i = 0; i < ctx.lines.length - 1; i++) {
      const a = re.exec(ctx.cleanLines[i]);
      const b = re.exec(ctx.cleanLines[i + 1]);
      if (a && b && !new RegExp(`\\b${a[1]}\\b`).test(b[2])) hits.push({ line: i + 1, index: ctx.lineStarts[i], length: ctx.lines[i].length });
    }
    return hits;
  },
  before: 'const user = await getUser(id);\nconst orders = await getOrders(id);      // waits for getUser first',
  after: 'const [user, orders] = await Promise.all([getUser(id), getOrders(id)]);',
});

jsRule({
  id: 'js.foreach-async', kind: 'tip', cat: 'Async / Promises', title: 'forEach(async ...) does not wait',
  why: 'Array.forEach ignores the promises your async callback returns, so the code after it runs before the work is done and errors are unhandled. Use for...of (sequential) or Promise.all(map) (parallel).',
  rx: /\.\s*forEach\s*\(\s*async\b/g,
  before: 'items.forEach(async (item) => { await save(item); });\nconsole.log("done");          // runs before anything is saved',
  after: 'await Promise.all(items.map((item) => save(item)));\nconsole.log("done");\n// or in order:  for (const item of items) await save(item);',
});

jsRule({
  id: 'js.unhandled-then', kind: 'tip', cat: 'Async / Promises', title: 'Promise with no error handling',
  why: 'A rejected promise nobody catches ends as an "unhandled rejection", which crashes Node (v15+) or only shows in the browser console. Add .catch(), or use try/await.',
  detect(ctx) {
    const hits = [];
    const re = /(^|[;{}]\s*)((?:[\w$.]+(?:\([^;]*?\))?)\s*\.\s*then\s*\([^;]*?;)/gm;
    let m;
    while ((m = re.exec(ctx.clean))) {
      if (/\.\s*(catch|finally)\s*\(/.test(m[2]) || /^\s*(return|const|let|var|await)/.test(m[2]) || /,\s*(?:\(?\w*\)?\s*=>|function)/.test(m[2].slice(m[2].indexOf('.then')))) continue; // has a handler or the result is used
      hits.push({ index: m.index + m[1].length, length: Math.min(60, m[2].length) });
    }
    return hits;
  },
  before: 'saveDraft(doc).then(() => toast("saved"));      // a failure disappears',
  after: 'saveDraft(doc)\n  .then(() => toast("saved"))\n  .catch((err) => toast(`Could not save: ${err.message}`));\n// or: try { await saveDraft(doc); toast("saved"); } catch (err) { ... }',
});

jsRule({
  id: 'js.fetch-ok', kind: 'tip', cat: 'Async / Promises', title: 'fetch() does not fail on HTTP errors',
  why: 'fetch only rejects on network failure. A 404 or 500 still resolves, and .json() then fails in a confusing way. Check response.ok first.',
  detect(ctx) {
    if (!/\bfetch\s*\(/.test(ctx.clean) || /\.ok\b|\.status\b|raise_for_status/.test(ctx.clean) || !/\.json\s*\(\s*\)/.test(ctx.clean)) return [];
    const m = /\bfetch\s*\(/.exec(ctx.clean);
    return [{ index: m.index, length: m[0].length }];
  },
  before: 'const data = await (await fetch(url)).json();',
  after: 'const res = await fetch(url, { signal: AbortSignal.timeout(5000) });   // 5 s deadline\nif (!res.ok) throw new Error(`HTTP ${res.status}`);\nconst data = await res.json();',
});

jsRule({
  id: 'js.xhr', kind: 'tip', cat: 'Async / Promises', title: 'XMLHttpRequest: use fetch',
  why: 'fetch returns a promise, supports streaming, AbortSignal and works the same in browsers and Node 18+.',
  rx: /new\s+XMLHttpRequest\s*\(/g,
  before: 'const xhr = new XMLHttpRequest();\nxhr.onload = () => ...; xhr.open("GET", url); xhr.send();',
  after: 'const res = await fetch(url);\nconst data = await res.json();',
});

jsRule({
  id: 'js.sync-fs', kind: 'tip', cat: 'Async / Promises', title: 'Synchronous file call blocks the event loop',
  why: 'readFileSync and friends freeze the whole Node process while the disk works, so every other request waits. Fine in start-up scripts, bad inside request handlers.',
  rx: /\bfs\s*\.\s*(readFileSync|writeFileSync|readdirSync|statSync|mkdirSync|appendFileSync|copyFileSync|unlinkSync)\b/g,
  before: 'app.get("/report", (req, res) => {\n  res.send(fs.readFileSync("report.html", "utf8"));   // blocks every other request\n});',
  after: 'import { readFile } from "node:fs/promises";\napp.get("/report", async (req, res) => {\n  res.send(await readFile("report.html", "utf8"));\n});',
});

jsRule({
  id: 'js.race-timeout', kind: 'tip', cat: 'Async / Promises', title: 'Promise.race for a timeout: use AbortSignal.timeout',
  why: 'Promise.race leaves the slow request running. AbortSignal.timeout actually cancels the fetch.',
  rx: /Promise\s*\.\s*race\s*\(\s*\[[^\]]*?(?:timeout|setTimeout|sleep|delay)/gi,
  before: 'await Promise.race([fetch(url), timeout(5000)]);',
  after: 'await fetch(url, { signal: AbortSignal.timeout(5000) });',
});

jsRule({
  id: 'js.async-no-await', kind: 'tip', cat: 'Async / Promises', title: 'async function that never awaits',
  why: 'Without await the async keyword only wraps the result in a promise and makes stack traces longer. Remove it, or add the await you forgot (a classic bug).',
  rx: /\basync\s+(?:function\s*\w*\s*)?\([^)]*\)\s*(?:=>)?\s*\{([^{}]*)\}/g, when: (ctx, m) => !/\bawait\b|\bfor\s+await\b|\byield\b/.test(m[1]) && m[1].trim().length > 0,
  before: 'async function total(items) {\n  return items.reduce((a, i) => a + i.price, 0);\n}',
  after: 'function total(items) {\n  return items.reduce((a, i) => a + i.price, 0);\n}\n// or you forgot something:   return await loadPrices(items);',
});

jsRule({
  id: 'js.var', kind: 'tip', cat: 'Modern JavaScript', title: 'var: use const (or let)',
  why: 'var is function-scoped and hoisted, which causes surprising bugs (loop closures, use-before-define). const/let are block-scoped. Start with const and use let only when you reassign.',
  rx: /(^|[;{(\s])var\s+[\w${[]/gm,
  before: 'var total = 0;\nfor (var i = 0; i < n; i++) { ... }',
  after: 'let total = 0;\nfor (let i = 0; i < n; i++) { ... }\nconst limit = 10;           // never reassigned',
});

jsRule({
  id: 'js.loose-equal', kind: 'tip', cat: 'Modern JavaScript', title: '== / != : use === and !==',
  why: 'Loose equality converts types first ("0" == 0, null == undefined), which hides bugs.',
  rx: /(?<![=!<>])(==|!=)(?!=)\s*(?!null\b)/g,
  before: 'if (count == "0") ...',
  after: 'if (count === 0) ...',
  fix: (ctx, h) => ({ start: h.index, end: h.index + h.m[1].length, text: h.m[1] === '==' ? '===' : '!==' }),
});

jsRule({
  id: 'js.optional-chaining', kind: 'tip', cat: 'Modern JavaScript', title: 'a && a.b: use optional chaining ?.',
  why: 'Optional chaining and ?? (nullish coalescing) replace long && chains and || defaults, and ?? keeps 0 and empty strings.',
  rx: /\b([\w$]+)\s*&&\s*\1\s*\.\s*[\w$]+|\b[\w$.]+\s*\|\|\s*(?:''|""|\[\]|\{\}|0)(?!\s*[\w$])/g,
  before: 'const city = user && user.address && user.address.city;\nconst name = input.name || "guest";      // "" becomes "guest" too',
  after: 'const city = user?.address?.city;\nconst name = input.name ?? "guest";         // only null / undefined',
});

jsRule({
  id: 'js.indexof', kind: 'tip', cat: 'Modern JavaScript', title: 'indexOf(x) !== -1: use includes()',
  why: 'includes() says what you mean.',
  rx: /\.\s*indexOf\s*\(([^()]*)\)\s*(?:!==?\s*-1|>\s*-1|===?\s*-1|<\s*0|>=\s*0)/g,
  before: 'if (list.indexOf(item) !== -1) ...',
  after: 'if (list.includes(item)) ...',
});

jsRule({
  id: 'js.object-assign', kind: 'tip', cat: 'Modern JavaScript', title: 'Object.assign({}, a): use spread',
  why: 'Spread syntax is shorter and works for arrays as well.',
  rx: /Object\s*\.\s*assign\s*\(\s*\{\s*\}\s*,/g,
  before: 'const next = Object.assign({}, state, { loading: true });',
  after: 'const next = { ...state, loading: true };',
});

jsRule({
  id: 'js.json-clone', kind: 'tip', cat: 'Modern JavaScript', title: 'JSON.parse(JSON.stringify(x)): use structuredClone',
  why: 'The JSON trick drops Dates, Maps, Sets and undefined. structuredClone copies them correctly (Node 17+, all modern browsers).',
  rx: /JSON\s*\.\s*parse\s*\(\s*JSON\s*\.\s*stringify\s*\(/g,
  before: 'const copy = JSON.parse(JSON.stringify(settings));',
  after: 'const copy = structuredClone(settings);',
});

jsRule({
  id: 'js.arguments', kind: 'tip', cat: 'Modern JavaScript', title: 'arguments object: use rest parameters',
  why: 'Rest parameters are a real array, work in arrow functions and show up in the signature.',
  rx: /\barguments\b/g,
  before: 'function sum() { return Array.prototype.reduce.call(arguments, (a, b) => a + b, 0); }',
  after: 'const sum = (...nums) => nums.reduce((a, b) => a + b, 0);',
});

jsRule({
  id: 'js.string-concat', kind: 'tip', cat: 'Modern JavaScript', title: 'String built with +: use a template literal',
  why: 'Template literals are easier to read and handle multi-line text.',
  raw: true, rx: /(["'])[^"'\n]*\1\s*\+\s*[A-Za-z_$][\w$.]*\s*\+\s*(["'])/g,
  before: 'const msg = "Hello " + user.name + ", you have " + n + " messages";',
  after: 'const msg = `Hello ${user.name}, you have ${n} messages`;',
});

jsRule({
  id: 'js.for-index', kind: 'tip', cat: 'Modern JavaScript', title: 'Index loop: use for...of or array methods',
  why: 'for...of, map, filter and reduce remove the index bookkeeping and the off-by-one errors.',
  rx: /for\s*\(\s*(?:let|var)\s+(\w+)\s*=\s*0\s*;\s*\1\s*<\s*([\w.$]+)\.length\s*;\s*\1\s*\+\+\s*\)/g,
  before: 'for (let i = 0; i < users.length; i++) { send(users[i]); }',
  after: 'for (const user of users) send(user);\nconst names = users.map((u) => u.name);\nconst adults = users.filter((u) => u.age >= 18);',
});

jsRule({
  id: 'js.commonjs', kind: 'tip', cat: 'Modern JavaScript', title: 'require(): use ES module import',
  why: 'ES modules are the standard in browsers and Node, enable tree-shaking and static analysis, and support top-level await.',
  raw: true, rx: /\b(?:const|let|var)\s+(?:\{[^}]*\}|\w+)\s*=\s*require\s*\(\s*['"][^'"]+['"]\s*\)/g,
  before: 'const express = require("express");',
  after: 'import express from "express";          // package.json: "type": "module"',
});

jsRule({
  id: 'js.react-class', kind: 'tip', cat: 'React', title: 'Class component: use a function component with hooks',
  why: 'Function components with hooks are shorter, easier to test and share logic through custom hooks. Class components are legacy.',
  rx: /class\s+\w+\s+extends\s+(?:React\s*\.\s*)?(?:Pure)?Component\b/g,
  before: 'class Profile extends React.Component {\n  state = { user: null };\n  componentDidMount() { load().then((user) => this.setState({ user })); }\n  render() { return <h1>{this.state.user?.name}</h1>; }\n}',
  after: 'function Profile() {\n  const [user, setUser] = useState(null);\n  useEffect(() => {\n    let cancelled = false;\n    load().then((u) => { if (!cancelled) setUser(u); });\n    return () => { cancelled = true; };      // cleanup\n  }, []);\n  return <h1>{user?.name}</h1>;\n}',
});

jsRule({
  id: 'js.react-effect-async', kind: 'tip', cat: 'React', title: 'useEffect callback must not be async',
  why: 'An async function returns a promise, but React expects nothing or a cleanup function. Define the async function inside the effect and call it.',
  rx: /useEffect\s*\(\s*async\b/g,
  before: 'useEffect(async () => {\n  setData(await load());\n}, []);',
  after: 'useEffect(() => {\n  const controller = new AbortController();\n  (async () => {\n    const res = await fetch(url, { signal: controller.signal });\n    setData(await res.json());\n  })();\n  return () => controller.abort();          // cancel when unmounted\n}, [url]);',
});

jsRule({
  id: 'js.ts-any', langs: TS, kind: 'tip', cat: 'TypeScript', title: 'any turns type checking off: use unknown or a generic',
  why: 'any lets every mistake through. unknown forces you to check the value first, and generics keep the relationship between input and output types.',
  rx: /:\s*any\b(?!\s*\[\])|\bas\s+any\b|<any>/g,
  before: 'function first(xs: any): any { return xs[0]; }\nconst data = JSON.parse(text) as any;',
  after: 'function first<T>(xs: readonly T[]): T | undefined { return xs[0]; }\nconst data: unknown = JSON.parse(text);\nif (isUser(data)) { data.name; }       // narrow with a type guard or a schema (zod)',
});

/* =============================== Python =============================== */

const pyRule = (r) => ADV_RULES.push({ langs: PY, ...r });

/** Indented blocks that start with a line matching `startRe`: [{ start, end }] (0-based line numbers, end exclusive) */
function pyBlocks(ctx, startRe) {
  const out = [];
  for (let i = 0; i < ctx.cleanLines.length; i++) {
    if (!startRe.test(ctx.cleanLines[i])) continue;
    const indent = (/^\s*/.exec(ctx.cleanLines[i]) || [''])[0].length;
    let j = i + 1;
    while (j < ctx.cleanLines.length && (!ctx.cleanLines[j].trim() || (/^\s*/.exec(ctx.cleanLines[j]) || [''])[0].length > indent)) j++;
    out.push({ start: i, end: j, indent });
  }
  return out;
}

pyRule({
  id: 'py.blocking-in-async', kind: 'tip', cat: 'asyncio', title: 'Blocking call inside async def freezes the event loop',
  why: 'While requests.get, time.sleep or open().read() runs, the event loop cannot serve anything else, so every other coroutine waits. Use an async library, await asyncio.sleep, or move the call to a thread with asyncio.to_thread.',
  detect(ctx) {
    const hits = [];
    const bad = /\b(requests\s*\.\s*(?:get|post|put|delete|patch|head)\s*\(|time\s*\.\s*sleep\s*\(|urllib\.request\.urlopen\s*\(|subprocess\s*\.\s*(?:run|call|check_output)\s*\()/;
    for (const b of pyBlocks(ctx, /^\s*async\s+def\b/)) {
      for (let i = b.start + 1; i < b.end; i++) {
        const m = bad.exec(ctx.cleanLines[i]);
        if (m) hits.push({ line: i + 1, index: ctx.lineStarts[i] + m.index, length: m[0].length, extra: { call: m[1].replace(/\s+/g, '').replace(/\($/, '') } });
      }
    }
    return hits;
  },
  message: (h) => `${h.extra.call}() blocks the event loop.`,
  before: 'async def fetch(url):\n    r = requests.get(url)          # blocks every other task\n    time.sleep(1)',
  after: 'import httpx, asyncio\nasync def fetch(url):\n    async with httpx.AsyncClient(timeout=10) as client:\n        r = await client.get(url)\n    await asyncio.sleep(1)\n# no async version?  data = await asyncio.to_thread(blocking_function, arg)',
});

pyRule({
  id: 'py.await-in-loop', kind: 'tip', cat: 'asyncio', title: 'await inside a loop runs one call at a time',
  why: 'When the iterations are independent, start them together with asyncio.gather (or a TaskGroup in Python 3.11+).',
  detect(ctx) {
    const hits = [];
    for (const f of pyBlocks(ctx, /^\s*async\s+def\b/)) {
      for (const lp of pyBlocks({ cleanLines: ctx.cleanLines.slice(f.start, f.end) }, /^\s*for\b.*:\s*$/)) {
        for (let i = lp.start + 1; i < lp.end; i++) {
          if (/\bawait\b/.test(ctx.cleanLines[f.start + i]) && !/\b(break|return)\b/.test(ctx.cleanLines.slice(f.start + lp.start, f.start + lp.end).join(' '))) { hits.push({ line: f.start + lp.start + 1, index: ctx.lineStarts[f.start + lp.start], length: ctx.lines[f.start + lp.start].length }); break; }
        }
      }
    }
    return hits;
  },
  before: 'async def load_all(ids):\n    out = []\n    for i in ids:\n        out.append(await fetch(i))',
  after: 'async def load_all(ids):\n    return await asyncio.gather(*(fetch(i) for i in ids))\n# Python 3.11+: structured, cancels siblings on error\nasync with asyncio.TaskGroup() as tg:\n    tasks = [tg.create_task(fetch(i)) for i in ids]\nresults = [t.result() for t in tasks]',
});

pyRule({
  id: 'py.event-loop', kind: 'tip', cat: 'asyncio', title: 'run_until_complete / get_event_loop: use asyncio.run',
  why: 'asyncio.run creates, runs and closes the loop for you. get_event_loop() is deprecated outside a running loop.',
  rx: /asyncio\s*\.\s*get_event_loop\s*\(\s*\)|\.\s*run_until_complete\s*\(|asyncio\s*\.\s*ensure_future\s*\(/g,
  before: 'loop = asyncio.get_event_loop()\nloop.run_until_complete(main())',
  after: 'asyncio.run(main())\n# background work inside a coroutine: task = asyncio.create_task(job())',
});

pyRule({
  id: 'py.threading', kind: 'tip', cat: 'asyncio', title: 'threading.Thread: use a pool or asyncio.to_thread',
  why: 'ThreadPoolExecutor reuses threads, returns futures with results and exceptions, and shuts down cleanly. asyncio.to_thread plugs blocking code into async programs.',
  rx: /threading\s*\.\s*Thread\s*\(/g,
  before: 't = threading.Thread(target=work, args=(x,))\nt.start(); t.join()',
  after: 'from concurrent.futures import ThreadPoolExecutor\nwith ThreadPoolExecutor(max_workers=8) as pool:\n    results = list(pool.map(work, items))      # exceptions surface here\n# inside async code:  result = await asyncio.to_thread(work, x)',
});

pyRule({
  id: 'py.requests-timeout', kind: 'tip', cat: 'Safety', title: 'requests call without a timeout',
  why: 'requests waits forever by default, so one unresponsive server can hang your program. Always pass timeout=.',
  detect(ctx) {
    const hits = [];
    const re = /requests\s*\.\s*(get|post|put|delete|patch|head)\s*\(/g;
    let m;
    while ((m = re.exec(ctx.clean))) {
      const { end } = callArgs(ctx, m.index + m[0].length - 1);
      if (!/\btimeout\s*=/.test(ctx.clean.slice(m.index, end))) hits.push({ index: m.index, length: m[0].length });
    }
    return hits;
  },
  before: 'r = requests.get(url)',
  after: 'r = requests.get(url, timeout=(3.05, 10))   # (connect, read) seconds\nr.raise_for_status()',
});

pyRule({
  id: 'py.open-no-with', kind: 'tip', cat: 'Modern Python', title: 'open() without "with": the file may stay open',
  why: 'If an exception happens before close(), the file handle leaks. A with block always closes it.',
  rx: /^[ \t]*\w+\s*=\s*open\s*\(/gm,
  before: 'f = open(path)\ndata = f.read()\nf.close()',
  after: 'from pathlib import Path\ndata = Path(path).read_text(encoding="utf-8")\n# or\nwith open(path, encoding="utf-8") as f:\n    data = f.read()',
});

pyRule({
  id: 'py.fstring', kind: 'tip', cat: 'Modern Python', title: '% or .format(): use an f-string', since: 6,
  why: 'f-strings are faster, shorter and put the value next to its place in the text.',
  raw: true, rx: /["'][^"'\n]*(?:%[sdrf]|\{\d*\})[^"'\n]*["']\s*(?:%\s*[\w(]|\.\s*format\s*\()/g,
  before: 'msg = "Hello %s, you are %d" % (name, age)\nmsg = "Hello {}".format(name)',
  after: 'msg = f"Hello {name}, you are {age}"\nprice = f"{total:,.2f}"          # formatting inside the braces',
});

pyRule({
  id: 'py.os-path', kind: 'tip', cat: 'Modern Python', title: 'os.path: use pathlib',
  why: 'pathlib.Path objects join with /, and have read_text, exists, glob and more.',
  rx: /os\s*\.\s*path\s*\.\s*(join|exists|isfile|isdir|dirname|basename|splitext)\s*\(/g,
  before: 'cfg = os.path.join(base, "conf", "app.ini")\nif os.path.exists(cfg): ...',
  after: 'from pathlib import Path\ncfg = Path(base) / "conf" / "app.ini"\nif cfg.exists(): text = cfg.read_text()',
});

pyRule({
  id: 'py.range-len', kind: 'tip', cat: 'Modern Python', title: 'for i in range(len(x)): iterate directly or use enumerate',
  why: 'Looping over the items (or enumerate when you need the index) is clearer and avoids index mistakes.',
  rx: /for\s+(\w+)\s+in\s+range\s*\(\s*len\s*\(\s*(\w+)\s*\)\s*\)\s*:/g,
  before: 'for i in range(len(names)):\n    print(i, names[i])',
  after: 'for i, name in enumerate(names):\n    print(i, name)\nfor a, b in zip(xs, ys): ...',
});

pyRule({
  id: 'py.append-loop', kind: 'tip', cat: 'Modern Python', title: 'Loop that appends: use a comprehension',
  why: 'A list (or dict / set) comprehension builds the collection in one expression and is usually faster.',
  detect(ctx) {
    const hits = [];
    for (let i = 0; i < ctx.cleanLines.length - 1; i++) {
      const forLine = /^\s*for\s+\w+(?:\s*,\s*\w+)*\s+in\s+.+:\s*$/.test(ctx.cleanLines[i]);
      const appendLine = /^\s+\w+\.append\(.+\)\s*$/.test(ctx.cleanLines[i + 1]);
      const after = ctx.cleanLines[i + 2];
      const ends = after === undefined || !after.trim() || (/^\s*/.exec(after)[0].length <= /^\s*/.exec(ctx.cleanLines[i])[0].length);
      if (forLine && appendLine && ends) hits.push({ line: i + 1, index: ctx.lineStarts[i], length: ctx.lines[i].length });
    }
    return hits;
  },
  before: 'squares = []\nfor n in numbers:\n    squares.append(n * n)',
  after: 'squares = [n * n for n in numbers]\nevens = [n for n in numbers if n % 2 == 0]\nlookup = {u.id: u for u in users}',
});

pyRule({
  id: 'py.mutable-default', kind: 'tip', cat: 'Safety', title: 'Mutable default argument',
  why: 'The default list/dict is created once and shared by every call, so values leak between calls. Use None and create the object inside.',
  rx: /def\s+\w+\s*\([^)]*=\s*(?:\[\s*\]|\{\s*\}|set\s*\(\s*\))/g,
  before: 'def add(item, bucket=[]):\n    bucket.append(item)\n    return bucket        # same list every call!',
  after: 'def add(item, bucket=None):\n    if bucket is None:\n        bucket = []\n    bucket.append(item)\n    return bucket',
});

pyRule({
  id: 'py.bare-except', kind: 'tip', cat: 'Safety', title: 'Bare except: catches everything, even Ctrl+C',
  why: 'A bare except also catches KeyboardInterrupt and SystemExit and hides real bugs. Catch the specific errors you can handle, and log the rest.',
  rx: /^[ \t]*except\s*:|^[ \t]*except\s+Exception\s*:\s*\n?\s*pass\b/gm,
  before: 'try:\n    risky()\nexcept:\n    pass',
  after: 'try:\n    risky()\nexcept (ValueError, KeyError) as exc:\n    logger.warning("risky failed: %s", exc)\n    raise            # or handle it properly',
});

pyRule({
  id: 'py.shell-true', kind: 'tip', cat: 'Safety', title: 'subprocess with shell=True',
  why: 'With shell=True a user-controlled string can run extra commands (command injection). Pass a list of arguments instead.',
  rx: /shell\s*=\s*True/g,
  before: 'subprocess.run(f"convert {name} out.png", shell=True)',
  after: 'subprocess.run(["convert", name, "out.png"], check=True, timeout=60)',
});

pyRule({
  id: 'py.dataclass', kind: 'tip', cat: 'Modern Python', title: 'Class that only stores its arguments: use @dataclass', since: 7,
  why: '@dataclass generates __init__, __repr__ and __eq__ from the field list (frozen=True makes it immutable; slots=True saves memory).',
  raw: true, rx: /^class\s+(\w+)\s*(?:\([^)]*\))?\s*:\s*\n\s+def\s+__init__\s*\(\s*self((?:\s*,\s*\w+(?:\s*:\s*[\w\[\], .|]+)?(?:\s*=\s*[^,)]+)?)+)\s*\)\s*(?:->\s*None)?\s*:\s*\n((?:\s+self\.\w+\s*=\s*\w+\s*\n?)+)(?!\s+def\b)/gm,
  before: 'class Point:\n    def __init__(self, x, y):\n        self.x = x\n        self.y = y',
  after: 'from dataclasses import dataclass\n\n@dataclass(frozen=True, slots=True)\nclass Point:\n    x: float\n    y: float',
});

pyRule({
  id: 'py.print', kind: 'tip', cat: 'Modern Python', title: 'print() for diagnostics: use logging',
  why: 'logging has levels, timestamps and can be configured or silenced per module. print cannot.',
  rx: /^[ \t]*print\s*\(/gm, when: (ctx) => (ctx.clean.match(/^[ \t]*print\s*\(/gm) || []).length >= 3,
  before: 'print("loaded", n, "rows")',
  after: 'import logging\nlogger = logging.getLogger(__name__)\nlogger.info("loaded %d rows", n)',
});
