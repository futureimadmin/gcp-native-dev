/* Code advisor rules for Java: SOLID (orange, class level), modern Java, collections, concurrency, CompletableFuture, lambdas, generics,
   streams and Lombok. Every rule explains itself with an "old way" and a "modern way" sample that the editor shows in a pop-up.

   Rule fields
     id, kind ('solid' | 'tip' | 'lombok'), cat, title, why, since (Java feature level the modern way needs)
     rx (+ when)            find matches in the code (comments and string contents are blanked, offsets are unchanged)
     detect(ctx)            or: return [{ index, length, line, extra }] yourself
     before / after         sample code, strings or (ctx, hit) => string
     fix(ctx, hit)          optional safe automatic fix => { start, end, text }                                          */
'use strict';

const ADV_RULES = [];
const rule = (r) => ADV_RULES.push(r);
const NLJ = String.fromCharCode(10);

/** Parenthesised argument list that starts at ctx.clean[open] === '(' : { args: [...], end } */
function callArgs(ctx, open) {
  let depth = 0;
  let i = open;
  const parts = [];
  let cur = '';
  for (; i < ctx.clean.length; i++) {
    const c = ctx.clean[i];
    if ('([{<'.includes(c) && !(c === '<' && /[\s=]/.test(ctx.clean[i + 1] || ' '))) depth++;
    else if (')]}>'.includes(c) && !(c === '>' && ctx.clean[i - 1] === '-')) { depth--; if (depth === 0) break; }
    if (c === ',' && depth === 1) { parts.push(cur.trim()); cur = ''; continue; }
    if (depth >= 1 && !(depth === 1 && i === open)) cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return { args: parts, end: i };
}

/** Methods with their body text: [{ t, m, start, end, body }] */
function methodBodies(ctx) {
  if (ctx._bodies) return ctx._bodies;
  const out = [];
  for (const t of ctx.parsed.types) {
    for (const m of t.methods) {
      let i = ctx.lineStarts[m.line - 1];
      const open = ctx.clean.indexOf('(', i);
      if (open < 0) continue;
      const { end } = callArgs(ctx, open);
      let j = end + 1;
      while (j < ctx.clean.length && ctx.clean[j] !== '{' && ctx.clean[j] !== ';') j++;
      if (ctx.clean[j] !== '{') continue;
      const close = ctx.matchBrace(j);
      out.push({ t, m, start: j, end: close, body: ctx.clean.slice(j + 1, close) });
    }
  }
  ctx._bodies = out;
  return out;
}

const isTrivialGetter = (b, f) => new RegExp(`^\\s*return\\s+(this\\.)?${f}\\s*;\\s*$`).test(b);
const isTrivialSetter = (b, f) => new RegExp(`^\\s*(this\\.)?${f}\\s*=\\s*\\w+\\s*;\\s*$`).test(b);
const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Getters/setters that only read or assign one field. */
function accessorsOf(ctx, t) {
  const bodies = methodBodies(ctx).filter((x) => x.t === t);
  const getters = [];
  const setters = [];
  for (const f of t.fields) {
    if ((f.mods || []).includes('static')) continue;
    const C = cap1(f.name);
    for (const b of bodies) {
      if ((b.m.name === `get${C}` || (f.type === 'boolean' && b.m.name === `is${C}`)) && !b.m.params && isTrivialGetter(b.body, f.name)) getters.push({ f, b });
      if (b.m.name === `set${C}` && isTrivialSetter(b.body, f.name)) setters.push({ f, b });
    }
  }
  return { getters, setters, bodies };
}

/* =============================== SOLID (orange, on the class) =============================== */

const CONCERNS = [
  ['database access', /java\.sql|javax\.persistence|jakarta\.persistence|JdbcTemplate|EntityManager|PreparedStatement|\bConnection\b|\bResultSet\b/],
  ['HTTP / web', /HttpServletRequest|HttpClient|RestTemplate|WebClient|java\.net\.http|ResponseEntity|@RestController|@RequestMapping|@GetMapping|@PostMapping/],
  ['file I/O', /java\.io\.File|java\.nio\.file|\bFileWriter\b|\bFileReader\b|\bFiles\.\w+/],
  ['user interface', /javax\.swing|javafx|java\.awt|\bJFrame\b|\bJPanel\b/],
  ['messaging', /KafkaTemplate|JmsTemplate|RabbitTemplate|PubSub|\bKafkaConsumer\b/],
  ['JSON / XML conversion', /ObjectMapper|\bGson\b|JAXB|DocumentBuilder/],
  ['e-mail', /JavaMailSender|javax\.mail|jakarta\.mail/],
  ['caching', /\bRedisTemplate\b|\bCaffeine\b|CacheManager/],
];

rule({
  id: 'solid.srp', kind: 'solid', cat: 'Single Responsibility', title: 'Class does too much (Single Responsibility Principle)',
  why: 'A class should have one reason to change. This one mixes several jobs, so a change to one of them risks breaking the others and makes it hard to test.',
  detect(ctx) {
    const hits = [];
    for (const t of ctx.parsed.types) {
      if (t.kind !== 'class' && t.kind !== 'enum') continue;
      const body = ctx.clean.slice(t.bodyStart, t.bodyEnd);
      const found = CONCERNS.filter(([, re]) => re.test(body)).map(([n]) => n);
      const methods = t.methods.filter((m) => !m.ctor && !/^(get|set|is)[A-Z]/.test(m.name)).length;
      const reasons = [];
      if (methods > 20) reasons.push(`${methods} behaviour methods`);
      if (t.fields.filter((f) => !f.constant).length > 15) reasons.push(`${t.fields.length} fields`);
      if (t.endLine - t.line > 600) reasons.push(`${t.endLine - t.line} lines`);
      if (found.length >= 3) reasons.push(`mixes ${found.slice(0, 4).join(', ')}`);
      if (reasons.length) hits.push({ line: t.line, extra: { t, reasons, found } });
    }
    return hits;
  },
  message: (h) => `${h.extra.t.name}: ${h.extra.reasons.join('; ')}.`,
  before: 'class OrderService {\n  void placeOrder(Order o) { /* validate, price, save to DB, call payment HTTP API, send e-mail, write audit file */ }\n}',
  after: 'class OrderService {                     // orchestrates only\n  OrderService(OrderRepository repo, PaymentGateway pay, Notifier mail) { ... }\n  void placeOrder(Order o) { validator.check(o); repo.save(o); pay.charge(o); mail.send(o); }\n}\ninterface OrderRepository { void save(Order o); }   // database\ninterface PaymentGateway  { void charge(Order o); } // HTTP\ninterface Notifier        { void send(Order o); }   // e-mail',
});

rule({
  id: 'solid.ocp', kind: 'solid', cat: 'Open / Closed', title: 'Type checks that grow with every new case (Open/Closed Principle)',
  why: 'Long instanceof / if-else / switch chains must be edited every time a new type appears. Put the behaviour on the types (polymorphism) or use a sealed interface with a pattern-matching switch, so new cases do not touch old code.',
  since: 0,
  detect(ctx) {
    const hits = [];
    const seen = new Set();
    for (const b of methodBodies(ctx)) {
      const inst = (b.body.match(/\binstanceof\b/g) || []).length;
      const elseIf = (b.body.match(/\belse\s+if\b/g) || []).length;
      const sw = /switch\s*\(\s*([\w.()]+)\s*\)\s*\{([\s\S]*)$/.exec(b.body);
      let swCases = 0;
      let swOn = '';
      if (sw) { swOn = sw[1]; swCases = (sw[2].match(/\bcase\b/g) || []).length; }
      const typeLike = /type|kind|category|code|mode|shape|vehicle|status/i.test(swOn);
      let why = '';
      if (inst >= 3) why = `${inst} instanceof checks in ${b.m.name}()`;
      else if (elseIf >= 3 && /instanceof|\.equals\(|==/.test(b.body) && /type|kind|category|code|mode|instanceof/i.test(b.body)) why = `an if / else-if chain with ${elseIf + 1} branches in ${b.m.name}()`;
      else if (swCases >= 5 && typeLike) why = `a switch on "${swOn}" with ${swCases} cases in ${b.m.name}()`;
      if (why && !seen.has(b.t.name)) { seen.add(b.t.name); hits.push({ line: b.t.line, extra: { why, method: b.m.name, t: b.t } }); }
    }
    return hits;
  },
  message: (h) => `${h.extra.t.name}: ${h.extra.why}.`,
  before: 'double area(Shape s) {\n  if (s instanceof Circle c) return Math.PI * c.r() * c.r();\n  else if (s instanceof Square q) return q.side() * q.side();\n  else if (s instanceof Triangle t) return t.b() * t.h() / 2;\n  throw new IllegalArgumentException();\n}',
  after: 'sealed interface Shape permits Circle, Square, Triangle {\n  double area();                       // each type owns its behaviour\n}\nrecord Circle(double r) implements Shape { public double area() { return Math.PI * r * r; } }\n// or keep it central, but checked by the compiler (Java 21):\ndouble area(Shape s) {\n  return switch (s) {\n    case Circle c   -> Math.PI * c.r() * c.r();\n    case Square q   -> q.side() * q.side();\n    case Triangle t -> t.b() * t.h() / 2;\n  };                                   // adding a new Shape is a compile error until handled\n}',
});

rule({
  id: 'solid.lsp', kind: 'solid', cat: 'Liskov Substitution', title: 'Override refuses to do its job (Liskov Substitution Principle)',
  why: 'Code that works with the base type must keep working with every subtype. An override that throws UnsupportedOperationException breaks callers that trusted the base contract. Split the interface or rethink the inheritance.',
  detect(ctx) {
    const hits = [];
    const seen = new Set();
    for (const b of methodBodies(ctx)) {
      if (b.t.kind === 'interface') continue;
      if (!(b.t.extends.length || b.t.implements.length)) continue;
      if (/^\s*throw\s+new\s+(UnsupportedOperationException|NotImplementedException|IllegalStateException\(\s*"not supported)/.test(b.body) || /^\s*throw\s+new\s+UnsupportedOperationException/.test(b.body)) {
        if (!(b.m.annots || []).includes('Override') && !b.t.implements.length && !b.t.extends.length) continue;
        const key = b.t.name;
        const prev = hits.find((h) => h.extra.t.name === key);
        if (prev) prev.extra.methods.push(b.m.name);
        else { hits.push({ line: b.t.line, extra: { t: b.t, methods: [b.m.name] } }); seen.add(key); }
      }
    }
    return hits;
  },
  message: (h) => `${h.extra.t.name} does not support: ${h.extra.methods.join(', ')}().`,
  before: 'class Penguin extends Bird {\n  @Override void fly() { throw new UnsupportedOperationException(); }  // callers of Bird.fly() now crash\n}',
  after: 'interface Bird { void eat(); }\ninterface FlyingBird extends Bird { void fly(); }   // only birds that can fly promise to fly\nclass Sparrow implements FlyingBird { ... }\nclass Penguin implements Bird { ... }',
});

rule({
  id: 'solid.isp', kind: 'solid', cat: 'Interface Segregation', title: 'Fat interface (Interface Segregation Principle)',
  why: 'Clients should not be forced to depend on methods they do not use. A large interface forces every implementer to provide everything (often with empty or throwing methods). Split it into small role interfaces.',
  detect(ctx) {
    const hits = [];
    for (const t of ctx.parsed.types) {
      if (t.kind !== 'interface') continue;
      const abstract = t.methods.filter((m) => (m.mods || []).includes('abstract'));
      if (abstract.length > 7) hits.push({ line: t.line, extra: { t, n: abstract.length } });
    }
    return hits;
  },
  message: (h) => `${h.extra.t.name} declares ${h.extra.n} abstract methods.`,
  before: 'interface Worker {\n  void code(); void test(); void design(); void deploy(); void manage(); void hire(); void fire(); void report();\n}',
  after: 'interface Developer { void code(); void test(); }\ninterface Designer  { void design(); }\ninterface Manager   { void manage(); void hire(); void report(); }\nclass FullStack implements Developer, Designer { ... }   // takes only the roles it plays',
});

rule({
  id: 'solid.dip', kind: 'solid', cat: 'Dependency Inversion', title: 'Depends on a concrete class (Dependency Inversion Principle)',
  why: 'High-level code should depend on abstractions. Creating a concrete service with new inside the class glues them together and makes unit testing hard. Depend on an interface and receive it through the constructor (dependency injection).',
  detect(ctx) {
    const hits = [];
    const JDKISH = /^(Thread|Object|StringBuilder|String|ArrayList|HashMap|LinkedList|HashSet|Random|Scanner|Date)$/;
    for (const t of ctx.parsed.types) {
      if (t.kind !== 'class') continue;
      const bad = [];
      for (const f of t.fields) {
        if ((f.mods || []).includes('static') && (f.mods || []).includes('final')) continue;
        const lineText = ctx.cleanLines[f.line - 1] || '';
        const m = /=\s*new\s+([A-Z]\w*(?:Service|Repository|Dao|DAO|Client|Gateway|Manager|Provider|Handler|Processor|Mailer|Sender))\s*(?:<[^>]*>)?\s*\(/.exec(lineText);
        if (m && !JDKISH.test(m[1])) bad.push(`${f.name} = new ${m[1]}()`);
      }
      if (bad.length) hits.push({ line: t.line, extra: { t, bad } });
    }
    return hits;
  },
  message: (h) => `${h.extra.t.name} creates its own collaborators: ${h.extra.bad.slice(0, 3).join(', ')}.`,
  before: 'class ReportJob {\n  private final MailService mail = new MailService();   // locked to one implementation\n}',
  after: 'class ReportJob {\n  private final Mailer mail;                            // interface\n  ReportJob(Mailer mail) { this.mail = mail; }        // injected: a fake in tests, SMTP in production\n}\n// Spring: @RequiredArgsConstructor (Lombok) or @Autowired constructor does the wiring',
});

/* =============================== concurrency / Executor framework =============================== */

rule({
  id: 'conc.new-thread', kind: 'tip', cat: 'Executor Framework', title: 'Use an ExecutorService instead of raw threads',
  why: 'Creating a Thread per task is expensive and unbounded. Executors reuse threads, queue work, return Futures and shut down cleanly. On Java 21 use virtual threads for blocking I/O.',
  rx: /\bnew\s+Thread\s*\(/g, when: (ctx, m) => !/extends\s+Thread/.test(ctx.clean.slice(Math.max(0, m.index - 80), m.index)),
  before: 'new Thread(() -> sendEmail(user)).start();',
  after: 'try (ExecutorService pool = Executors.newVirtualThreadPerTaskExecutor()) {   // Java 21, ideal for blocking I/O\n  pool.submit(() -> sendEmail(user));\n}                                                                               // close() waits for tasks\n// CPU-bound work: Executors.newFixedThreadPool(Runtime.getRuntime().availableProcessors())',
});

rule({
  id: 'conc.cached-pool', kind: 'tip', cat: 'Executor Framework', title: 'Cached thread pool can create unlimited threads',
  why: 'newCachedThreadPool creates a new thread whenever all are busy, so a traffic spike can exhaust memory. Use a bounded pool (with a bounded queue and a rejection policy) or virtual threads.',
  rx: /Executors\s*\.\s*newCachedThreadPool\s*\(/g,
  before: 'ExecutorService pool = Executors.newCachedThreadPool();',
  after: 'ExecutorService pool = new ThreadPoolExecutor(\n    4, 16, 60, TimeUnit.SECONDS,\n    new ArrayBlockingQueue<>(200),                     // bounded queue\n    new ThreadPoolExecutor.CallerRunsPolicy());        // back-pressure instead of an OutOfMemoryError',
});

rule({
  id: 'conc.fixed-pool-io', kind: 'tip', cat: 'Executor Framework', title: 'Blocking I/O work: virtual threads scale better than a fixed pool', since: 21,
  why: 'Thread pools sized for CPUs starve when tasks wait on network or disk. Virtual threads (Java 21) are cheap, so you can have one per task and stop tuning pool sizes.',
  rx: /Executors\s*\.\s*newFixedThreadPool\s*\(/g, when: (ctx) => /HttpClient|java\.sql|Socket|URLConnection|RestTemplate|WebClient|Files\.|HttpURLConnection/.test(ctx.clean),
  before: 'ExecutorService pool = Executors.newFixedThreadPool(50);   // 50 blocked threads = 50 idle CPUs\n',
  after: 'try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {   // one cheap thread per task\n  urls.forEach(u -> pool.submit(() -> fetch(u)));\n}',
});

rule({
  id: 'conc.executor-close', kind: 'tip', cat: 'Executor Framework', title: 'Executor is never shut down', since: 19,
  why: 'A pool whose threads are not stopped keeps the JVM alive and leaks threads. From Java 19 an ExecutorService is AutoCloseable, so try-with-resources shuts it down and waits for tasks.',
  rx: /\bExecutors\s*\.\s*new\w+\s*\(/g, when: (ctx, m) => !/\.\s*(shutdown|shutdownNow|close)\s*\(/.test(ctx.clean) && !/try\s*\(\s*[^)]*$/.test(ctx.clean.slice(Math.max(0, m.index - 80), m.index)) && !/(static|private|protected)\s[^;]*$/.test(ctx.clean.slice(Math.max(0, m.index - 60), m.index)),
  before: 'ExecutorService pool = Executors.newFixedThreadPool(4);\npool.submit(task);\n// forgot pool.shutdown()',
  after: 'try (ExecutorService pool = Executors.newFixedThreadPool(4)) {\n  pool.submit(task);\n}   // waits for the task, then shuts the pool down',
});

rule({
  id: 'conc.timer', kind: 'tip', cat: 'Executor Framework', title: 'Timer / TimerTask: use ScheduledExecutorService',
  why: 'A Timer runs everything on one thread, and an uncaught exception kills it for good. ScheduledExecutorService has a pool, survives task failures and supports fixed rate or delay.',
  rx: /\bnew\s+Timer\s*\(|extends\s+TimerTask\b|new\s+TimerTask\s*\(/g,
  before: 'new Timer().schedule(new TimerTask() { public void run() { poll(); } }, 0, 5000);',
  after: 'ScheduledExecutorService ses = Executors.newScheduledThreadPool(1);\nses.scheduleWithFixedDelay(this::poll, 0, 5, TimeUnit.SECONDS);',
});

rule({
  id: 'conc.sleep-loop', kind: 'tip', cat: 'Executor Framework', title: 'Polling loop with Thread.sleep: schedule it',
  why: 'A while(true) loop that sleeps ties up a thread and is awkward to stop. Let a ScheduledExecutorService run the work periodically.',
  rx: /while\s*\(\s*(true|!\s*\w+\.?\w*)\s*\)\s*\{[^}]{0,400}?Thread\s*\.\s*sleep\s*\(/g,
  before: 'while (true) {\n  poll();\n  Thread.sleep(5000);\n}',
  after: 'ScheduledExecutorService ses = Executors.newSingleThreadScheduledExecutor();\nses.scheduleWithFixedDelay(this::poll, 0, 5, TimeUnit.SECONDS);\n// stop with ses.shutdown()',
});

rule({
  id: 'conc.volatile-counter', kind: 'tip', cat: 'Concurrency', title: 'volatile counter is not atomic: use AtomicInteger / LongAdder',
  why: 'count++ is read, add, write. Two threads can interleave and lose updates even when the field is volatile. Atomic classes make it a single atomic step; LongAdder is faster under heavy contention.',
  rx: /\bvolatile\s+(int|long)\s+(\w+)/g,
  before: 'private volatile int hits;\nvoid hit() { hits++; }          // updates can be lost',
  after: 'private final AtomicInteger hits = new AtomicInteger();\nvoid hit() { hits.incrementAndGet(); }\n// many writers: private final LongAdder hits = new LongAdder();  hits.increment();',
});

rule({
  id: 'conc.synchronized-counter', kind: 'tip', cat: 'Concurrency', title: 'synchronized block only to bump a number: use an atomic',
  why: 'A lock around a single increment is heavier than needed. AtomicInteger / AtomicLong do it lock-free.',
  rx: /\bsynchronized\b[^{;]*\{\s*[\w.]+\s*(?:\+\+|--|\+=\s*\w+|-=\s*\w+)\s*;?\s*\}/g,
  before: 'synchronized (this) { count++; }',
  after: 'private final AtomicInteger count = new AtomicInteger();\ncount.incrementAndGet();',
});

rule({
  id: 'conc.wait-notify', kind: 'tip', cat: 'Concurrency', title: 'wait() / notify(): use java.util.concurrent',
  why: 'wait/notify is easy to get wrong (lost signals, spurious wake-ups). BlockingQueue, CountDownLatch, Semaphore or CompletableFuture express the same idea safely.',
  rx: /(?<![\w])(?:\w+\s*\.\s*)?(?:wait\s*\(\s*\)|notify(?:All)?\s*\(\s*\))/g,
  before: 'synchronized (lock) { while (queue.isEmpty()) lock.wait(); item = queue.remove(); }',
  after: 'BlockingQueue<Item> queue = new LinkedBlockingQueue<>();\nItem item = queue.take();       // blocks until an item arrives\nqueue.put(item);                // producer side',
});

rule({
  id: 'conc.sync-collections', kind: 'tip', cat: 'Collections (java.util.concurrent)', title: 'Collections.synchronizedXxx: use a concurrent collection',
  why: 'A synchronized wrapper locks the whole collection for every call and still needs manual locking to iterate. ConcurrentHashMap and CopyOnWriteArrayList are built for concurrent use.',
  rx: /Collections\s*\.\s*synchronized(Map|List|Set)\s*\(/g,
  before: 'Map<String, User> users = Collections.synchronizedMap(new HashMap<>());',
  after: 'Map<String, User> users = new ConcurrentHashMap<>();      // fine-grained locking, atomic compute/merge\nList<Listener> listeners = new CopyOnWriteArrayList<>();   // read-mostly lists\nSet<String> seen = ConcurrentHashMap.newKeySet();',
});

rule({
  id: 'conc.shared-hashmap', kind: 'tip', cat: 'Collections (java.util.concurrent)', title: 'HashMap / ArrayList shared between threads',
  why: 'This class uses threads or locks, but keeps a plain HashMap/ArrayList in a field. These classes are not thread-safe: concurrent writes can corrupt them or lose data. Use ConcurrentHashMap, CopyOnWriteArrayList or ConcurrentLinkedQueue.',
  detect(ctx) {
    if (!/\b(Thread|Executor\w*|CompletableFuture|synchronized|@Async|parallelStream|ScheduledFuture|ForkJoin\w*)\b/.test(ctx.clean)) return [];
    const hits = [];
    for (const t of ctx.parsed.types) {
      for (const f of t.fields) {
        if ((f.mods || []).includes('static') === false && (f.mods || []).includes('final') === false && !/synchronized|Thread|Executor/.test(ctx.clean)) continue;
        const line = ctx.cleanLines[f.line - 1] || '';
        const m = /=\s*new\s+(HashMap|ArrayList|HashSet|LinkedList|TreeMap)\b/.exec(line);
        if (!m) continue;
        const repl = { HashMap: 'ConcurrentHashMap', TreeMap: 'ConcurrentSkipListMap', ArrayList: 'CopyOnWriteArrayList', LinkedList: 'ConcurrentLinkedQueue', HashSet: 'ConcurrentHashMap.newKeySet()' }[m[1]];
        hits.push({ line: f.line, index: ctx.lineStarts[f.line - 1] + line.indexOf(m[0]), length: m[0].length, extra: { name: f.name, from: m[1], to: repl } });
      }
    }
    return hits;
  },
  message: (h) => `${h.extra.name} is a ${h.extra.from}; consider ${h.extra.to}.`,
  before: 'private final Map<String, Session> sessions = new HashMap<>();   // many request threads',
  after: 'private final Map<String, Session> sessions = new ConcurrentHashMap<>();\nsessions.computeIfAbsent(id, k -> new Session(k));   // atomic "create if missing"',
});

rule({
  id: 'util.legacy-collections', kind: 'tip', cat: 'Collections (java.util)', title: 'Legacy collection class (Vector / Hashtable / Stack)',
  why: 'These classes lock every method and have old APIs. ArrayList, HashMap and ArrayDeque are faster; use ConcurrentHashMap or CopyOnWriteArrayList when you really need thread safety.',
  rx: /\bnew\s+(Vector|Hashtable|Stack)\b|\b(Vector|Hashtable|Stack)\s*</g,
  before: 'Hashtable<String, Integer> counts = new Hashtable<>();\nStack<Integer> undo = new Stack<>();',
  after: 'Map<String, Integer> counts = new ConcurrentHashMap<>();   // or HashMap when single-threaded\nDeque<Integer> undo = new ArrayDeque<>();                  // push / pop / peek',
});

rule({
  id: 'util.arrays-aslist', kind: 'tip', cat: 'Collections (java.util)', title: 'Immutable factory methods: List.of / Set.of / Map.of', since: 9,
  why: 'Arrays.asList and Collections.singletonList/emptyList are older ways to build small constant lists. List.of, Set.of and Map.of are immutable, null-hostile and read better.',
  rx: /Arrays\s*\.\s*asList\s*\(|Collections\s*\.\s*(singletonList|emptyList|singleton|emptySet|emptyMap)\s*\(/g,
  before: 'List<String> roles = Arrays.asList("USER", "ADMIN");\nList<String> none = Collections.emptyList();',
  after: 'List<String> roles = List.of("USER", "ADMIN");\nList<String> none = List.of();\nMap<String, Integer> limits = Map.of("free", 10, "pro", 100);',
});

rule({
  id: 'util.unmodifiable-copy', kind: 'tip', cat: 'Collections (java.util)', title: 'Collections.unmodifiableXxx is only a view: use copyOf', since: 10,
  why: 'unmodifiableList wraps the same list, so changes to the original still show through. List.copyOf takes an immutable snapshot.',
  rx: /Collections\s*\.\s*unmodifiable(List|Set|Map)\s*\(/g,
  before: 'return Collections.unmodifiableList(items);   // callers still see later changes',
  after: 'return List.copyOf(items);                      // immutable snapshot (Set.copyOf, Map.copyOf)',
});

rule({
  id: 'util.map-containsKey-put', kind: 'tip', cat: 'Collections (java.util)', title: 'Map: check-then-put can be one call',
  why: 'containsKey followed by put/get looks up the key twice and is not atomic on concurrent maps. putIfAbsent, computeIfAbsent, getOrDefault and merge do it in one step.',
  rx: /if\s*\(\s*!\s*(\w+)\s*\.\s*containsKey\s*\(\s*([^)]+?)\s*\)\s*\)\s*\{?\s*\1\s*\.\s*put\s*\(\s*\2\s*,\s*([^;]+?)\)\s*;\s*\}?/g,
  before: 'if (!cache.containsKey(key)) {\n  cache.put(key, new ArrayList<>());\n}\ncache.get(key).add(item);',
  after: 'cache.computeIfAbsent(key, k -> new ArrayList<>()).add(item);\n// counting:   counts.merge(word, 1, Integer::sum);\n// default:    int n = counts.getOrDefault(word, 0);',
  fix: (ctx, h) => ({ start: h.index, end: h.index + h.length, text: `${h.m[1]}.putIfAbsent(${h.m[2]}, ${h.m[3]});` }),
});

rule({
  id: 'util.map-counting', kind: 'tip', cat: 'Collections (java.util)', title: 'Counting with put(get + 1): use merge',
  why: 'map.put(k, map.get(k) + 1) fails with a NullPointerException for new keys and is not atomic. merge handles both.',
  rx: /(\w+)\s*\.\s*put\s*\(\s*([^,]+?)\s*,\s*\1\s*\.\s*get\s*\(\s*\2\s*\)\s*\+\s*(1|\w+)\s*\)/g,
  before: 'counts.put(word, counts.get(word) + 1);',
  after: 'counts.merge(word, 1, Integer::sum);',
  fix: (ctx, h) => ({ start: h.index, end: h.index + h.length, text: `${h.m[1]}.merge(${h.m[2]}, ${h.m[3]}, Integer::sum)` }),
});

rule({
  id: 'util.map-getordefault', kind: 'tip', cat: 'Collections (java.util)', title: 'containsKey ? get : default  ->  getOrDefault',
  why: 'getOrDefault is shorter and looks the key up once.',
  rx: /(\w+)\s*\.\s*containsKey\s*\(\s*([^)]+?)\s*\)\s*\?\s*\1\s*\.\s*get\s*\(\s*\2\s*\)\s*:\s*([^;,)]+)/g,
  before: 'int n = counts.containsKey(w) ? counts.get(w) : 0;',
  after: 'int n = counts.getOrDefault(w, 0);',
  fix: (ctx, h) => ({ start: h.index, end: h.index + h.length, text: `${h.m[1]}.getOrDefault(${h.m[2]}, ${h.m[3].trim()})` }),
});

rule({
  id: 'util.map-keyset', kind: 'tip', cat: 'Collections (java.util)', title: 'Iterating keySet() and calling get(): iterate entrySet()',
  why: 'Each get() is another lookup. entrySet() gives key and value together.',
  rx: /for\s*\(\s*[\w<>?,\s]+\s+(\w+)\s*:\s*(\w+)\s*\.\s*keySet\s*\(\s*\)\s*\)\s*\{[^}]*\b\2\s*\.\s*get\s*\(\s*\1\s*\)/g,
  before: 'for (String k : prices.keySet()) {\n  total += prices.get(k);\n}',
  after: 'for (Map.Entry<String, Double> e : prices.entrySet()) {\n  total += e.getValue();\n}\n// or: prices.forEach((k, v) -> ...)   /   prices.values().stream().mapToDouble(d -> d).sum()',
});

rule({
  id: 'util.collections-sort', kind: 'tip', cat: 'Collections (java.util)', title: 'Collections.sort(list): use list.sort(...)', since: 8,
  why: 'List.sort is the instance method since Java 8 and takes a Comparator directly.',
  rx: /Collections\s*\.\s*sort\s*\(\s*(\w+)\s*(?:,\s*([^;]+?))?\s*\)/g,
  before: 'Collections.sort(people, new Comparator<Person>() { ... });',
  after: 'people.sort(Comparator.comparing(Person::getLastName).thenComparing(Person::getFirstName));\nnames.sort(null);   // natural order',
  fix: (ctx, h) => ({ start: h.index, end: h.index + h.length, text: `${h.m[1]}.sort(${h.m[2] ? h.m[2] : 'null'})` }),
});

rule({
  id: 'util.size-empty', kind: 'tip', cat: 'Collections (java.util)', title: 'size() == 0: use isEmpty()',
  why: 'isEmpty() says what you mean and is O(1) for every collection (size() can be O(n) on some).',
  rx: /\b([A-Za-z_][\w.]*)\s*\.\s*size\s*\(\s*\)\s*(==\s*0|!=\s*0|>\s*0|<\s*1|>=\s*1)/g,
  before: 'if (orders.size() == 0) { ... }\nif (orders.size() > 0) { ... }',
  after: 'if (orders.isEmpty()) { ... }\nif (!orders.isEmpty()) { ... }',
  fix: (ctx, h) => ({ start: h.index, end: h.index + h.length, text: /^(==\s*0|<\s*1)$/.test(h.m[2]) ? `${h.m[1]}.isEmpty()` : `!${h.m[1]}.isEmpty()` }),
});

rule({
  id: 'util.toarray', kind: 'tip', cat: 'Collections (java.util)', title: 'toArray(new T[n]): use toArray(T[]::new)', since: 11,
  why: 'The generator form is shorter and cannot get the size wrong.',
  rx: /\.\s*toArray\s*\(\s*new\s+(\w+)\s*\[[^\]]*\]\s*\)/g,
  before: 'String[] a = list.toArray(new String[list.size()]);',
  after: 'String[] a = list.toArray(String[]::new);',
  fix: (ctx, h) => ({ start: h.index, end: h.index + h.length, text: `.toArray(${h.m[1]}[]::new)` }),
});

rule({
  id: 'util.immutable-hash', kind: 'tip', cat: 'Collections (java.util)', title: 'Hand-written hash code: use Objects.hash',
  why: 'The 31 * result + ... pattern is easy to get wrong. Objects.hash(a, b, c) (or a record / Lombok @EqualsAndHashCode) does it for you.',
  rx: /\b(\w+)\s*=\s*31\s*\*\s*\1\s*\+/g,
  before: 'int result = 17;\nresult = 31 * result + name.hashCode();\nresult = 31 * result + age;',
  after: 'return Objects.hash(name, age);',
});

rule({
  id: 'util.stringbuffer', kind: 'tip', cat: 'Strings', title: 'StringBuffer: use StringBuilder',
  why: 'StringBuffer synchronises every call. Unless several threads append to the same buffer (rare), StringBuilder is faster.',
  rx: /\bStringBuffer\b/g, when: (ctx, m) => !/^\s*import\b/.test(ctx.lineText(m.index)),
  before: 'StringBuffer sb = new StringBuffer();',
  after: 'StringBuilder sb = new StringBuilder();',
  fix: (ctx, h) => ({ start: h.index, end: h.index + h.length, text: 'StringBuilder' }),
});

rule({
  id: 'util.string-concat-loop', kind: 'tip', cat: 'Strings', title: 'String += inside a loop',
  why: 'Each += creates a new String, so the loop is O(n²). Use StringBuilder, String.join or Collectors.joining.',
  detect(ctx) {
    const hits = [];
    const re = /\b(for|while)\s*\([^)]*\)\s*\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(ctx.clean))) {
      const acc = /\b(\w+)\s*\+=\s*[^;]+;/.exec(m[2]);
      if (acc && new RegExp(`\\bString\\s+${acc[1]}\\b`).test(ctx.clean.slice(0, m.index))) hits.push({ index: m.index, length: m[0].length });
    }
    return hits;
  },
  before: 'String csv = "";\nfor (String s : items) csv += s + ",";',
  after: 'String csv = String.join(",", items);\n// or: items.stream().collect(Collectors.joining(","))\n// or a StringBuilder when the loop does more work',
});

rule({
  id: 'util.trim-isempty', kind: 'tip', cat: 'Strings', title: 'trim().isEmpty(): use isBlank()', since: 11,
  why: 'isBlank() handles all Unicode white space and avoids creating a trimmed copy.',
  rx: /\.\s*trim\s*\(\s*\)\s*\.\s*(isEmpty\s*\(\s*\)|length\s*\(\s*\)\s*==\s*0)/g,
  before: 'if (name == null || name.trim().isEmpty()) ...',
  after: 'if (name == null || name.isBlank()) ...',
  fix: (ctx, h) => ({ start: h.index, end: h.index + h.length, text: '.isBlank()' }),
});

rule({
  id: 'util.equals-literal', kind: 'tip', cat: 'Strings', title: 'x.equals("literal"): put the literal first',
  why: '"literal".equals(x) can never throw a NullPointerException.',
  rx: /\b([a-z]\w*(?:\(\))?)\s*\.\s*equals\s*\(\s*"[^"]*"\s*\)/g,
  before: 'if (command.equals("stop")) ...      // NPE when command is null',
  after: 'if ("stop".equals(command)) ...       // false when null\n// enums: use == ;  Objects.equals(a, b) when both can be null',
});

rule({
  id: 'util.legacy-date', kind: 'tip', cat: 'Dates', title: 'java.util.Date / Calendar / SimpleDateFormat: use java.time', since: 8,
  why: 'The old date classes are mutable, confusing (months start at 0) and SimpleDateFormat is not thread-safe. java.time is immutable and thread-safe.',
  rx: /\bnew\s+Date\s*\(|Calendar\s*\.\s*getInstance\s*\(|\bnew\s+SimpleDateFormat\s*\(|\bnew\s+GregorianCalendar\s*\(/g,
  before: 'Date now = new Date();\nSimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd");\nString s = f.format(now);',
  after: 'Instant now = Instant.now();                           // a point in time\nLocalDate today = LocalDate.now();                     // a calendar date\nString s = today.format(DateTimeFormatter.ISO_LOCAL_DATE);   // thread-safe formatter\nDuration d = Duration.between(start, end);',
});

rule({
  id: 'util.boxed-ctor', kind: 'tip', cat: 'Modern Java', title: 'new Integer(...) is deprecated: use valueOf',
  why: 'The wrapper constructors are deprecated for removal. valueOf can reuse cached instances.',
  rx: /\bnew\s+(Integer|Long|Double|Boolean|Short|Byte|Character|Float)\s*\(/g,
  before: 'Integer n = new Integer(5);',
  after: 'Integer n = Integer.valueOf(5);   // or simply: Integer n = 5;',
  fix: (ctx, h) => ({ start: h.index, end: h.index + h.length, text: `${h.m[1]}.valueOf(` }),
});

rule({
  id: 'util.finally-close', kind: 'tip', cat: 'Modern Java', title: 'close() in finally: use try-with-resources', since: 7,
  why: 'Closing in finally is verbose and hides the original exception if close() also fails. try-with-resources closes automatically and keeps both exceptions.',
  rx: /finally\s*\{[^}]*\.\s*close\s*\(\s*\)/g,
  before: 'BufferedReader r = null;\ntry { r = new BufferedReader(new FileReader(f)); ... }\nfinally { if (r != null) r.close(); }',
  after: 'try (BufferedReader r = Files.newBufferedReader(path)) {\n  ...\n}   // closed automatically',
});

rule({
  id: 'util.resource-leak', kind: 'tip', cat: 'Modern Java', title: 'Stream / reader opened without try-with-resources', since: 7,
  why: 'If an exception happens before close() the file handle leaks. For whole files, Files.readString / Files.lines are even simpler.',
  rx: /\bnew\s+(FileInputStream|FileOutputStream|FileReader|FileWriter|BufferedReader|BufferedWriter|Scanner|PrintWriter|InputStreamReader)\s*\(/g,
  when: (ctx, m) => !/try\s*\([^)]*$/.test(ctx.clean.slice(Math.max(0, m.index - 140), m.index)) && !/(new\s+\w+\s*\(\s*)$/.test(ctx.clean.slice(Math.max(0, m.index - 24), m.index)),
  before: 'FileReader fr = new FileReader(file);\nBufferedReader br = new BufferedReader(fr);\nString text = br.readLine();',
  after: 'String text = Files.readString(Path.of(file));            // Java 11\ntry (var lines = Files.lines(path)) { ... }               // streams must be closed too\ntry (var br = Files.newBufferedReader(path)) { ... }',
});

rule({
  id: 'util.catch-generic', kind: 'tip', cat: 'Error handling', title: 'Catching Exception/Throwable or ignoring the error',
  why: 'Catching everything hides bugs and swallows InterruptedException. An empty catch block loses the error completely. Catch the specific exceptions you can handle, and log or rethrow the rest.',
  rx: /catch\s*\(\s*(?:Exception|Throwable)\s+\w+\s*\)|catch\s*\([^)]*\)\s*\{\s*\}|\.\s*printStackTrace\s*\(\s*\)/g,
  before: 'try { save(order); } catch (Exception e) { e.printStackTrace(); }',
  after: 'try {\n  save(order);\n} catch (SQLException | IOException e) {\n  log.error("Could not save order {}", order.id(), e);   // keep the stack trace in the log\n  throw new OrderException("save failed", e);             // let the caller decide\n}',
});

rule({
  id: 'util.system-out', kind: 'tip', cat: 'Error handling', title: 'System.out / System.err: use a logger',
  why: 'A logger has levels, timestamps, thread names and can be redirected or switched off in production.',
  rx: /System\s*\.\s*(out|err)\s*\.\s*print(ln|f)?\s*\(/g,
  before: 'System.out.println("Saved " + order.getId());',
  after: 'private static final Logger log = LoggerFactory.getLogger(OrderService.class);\nlog.info("Saved order {}", order.getId());     // placeholders avoid string building when disabled\n// with Lombok just add @Slf4j to the class and use log.info(...)',
});

/* =============================== modern Java language features =============================== */

rule({
  id: 'modern.instanceof-cast', kind: 'tip', cat: 'Modern Java', title: 'instanceof + cast: use pattern matching', since: 16,
  why: 'The compiler can bind the cast variable for you, so the separate cast line disappears.',
  rx: /if\s*\(\s*(\w+)\s+instanceof\s+([\w.<>?]+)\s*\)\s*\{\s*(?:final\s+)?\2\s+(\w+)\s*=\s*\(\s*\2\s*\)\s*\1\s*;/g,
  before: 'if (o instanceof Circle) {\n  Circle c = (Circle) o;\n  return c.radius();\n}',
  after: 'if (o instanceof Circle c) {      // c is already a Circle here\n  return c.radius();\n}',
  fix: (ctx, h) => ({ start: h.index, end: h.index + h.length, text: `if (${h.m[1]} instanceof ${h.m[2]} ${h.m[3]}) {` }),
});

rule({
  id: 'modern.switch-expression', kind: 'tip', cat: 'Modern Java', title: 'Old-style switch with break: use a switch expression', since: 14,
  why: 'Arrow cases cannot fall through by accident, and a switch expression returns a value and must cover every case.',
  detect(ctx) {
    const hits = [];
    const re = /\bswitch\s*\([^)]*\)\s*\{/g;
    let m;
    while ((m = re.exec(ctx.clean))) {
      const open = m.index + m[0].length - 1;
      const close = ctx.matchBrace(open);
      const body = ctx.clean.slice(open, close);
      if (/\bcase\b[^:;{]*:/.test(body) && !/->/.test(body.slice(0, 200)) && (body.match(/\bbreak\s*;/g) || []).length >= 2) hits.push({ index: m.index, length: m[0].length });
    }
    return hits;
  },
  before: 'String name;\nswitch (day) {\n  case MONDAY: case FRIDAY: name = "busy"; break;\n  case SUNDAY: name = "rest"; break;\n  default: name = "normal";\n}',
  after: 'String name = switch (day) {\n  case MONDAY, FRIDAY -> "busy";\n  case SUNDAY         -> "rest";\n  default             -> "normal";\n};',
});

rule({
  id: 'modern.text-block', kind: 'tip', cat: 'Modern Java', title: 'Multi-line string built with + and \\n: use a text block', since: 15,
  why: 'Text blocks keep SQL, JSON and HTML readable, with no escaping and no concatenation.',
  detect(ctx) {
    const hits = [];
    const lines = ctx.lines;
    let run = 0;
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*[+=(]?\s*(\w+\s*=\s*)?".*\\n"\s*\+?\s*;?\s*$/.test(lines[i]) || /^\s*\+\s*".*"\s*\+?\s*;?\s*$/.test(lines[i])) run++;
      else run = 0;
      if (run === 3) hits.push({ line: i - 1, index: ctx.lineStarts[i - 2], length: lines[i - 2].length });
    }
    return hits;
  },
  before: 'String sql = "SELECT id, name\\n" +\n             "FROM users\\n" +\n             "WHERE active = 1";',
  after: 'String sql = """\n    SELECT id, name\n    FROM users\n    WHERE active = 1\n    """;',
});

rule({
  id: 'modern.var', kind: 'tip', cat: 'Modern Java', title: 'Long type written twice: use var', since: 10,
  why: 'When the right side already shows the type, var removes the repetition and keeps the line short. (The variable is still strongly typed.)',
  rx: /\b([A-Z]\w*<[^=;()]{8,}>)\s+(\w+)\s*=\s*new\s+\w+\s*<[^()]*>\s*\(/g,
  before: 'Map<String, List<Customer>> byCity = new HashMap<String, List<Customer>>();',
  after: 'var byCity = new HashMap<String, List<Customer>>();\n// or keep the interface type and use the diamond:\nMap<String, List<Customer>> byCity = new HashMap<>();',
});

rule({
  id: 'modern.diamond', kind: 'tip', cat: 'Generics', title: 'Repeated type arguments: use the diamond <>', since: 7,
  why: 'The compiler infers the type arguments from the declaration, so write <> on the right.',
  rx: /=\s*new\s+(ArrayList|HashMap|HashSet|LinkedList|TreeMap|LinkedHashMap|TreeSet|ArrayDeque|ConcurrentHashMap|CopyOnWriteArrayList)\s*<\s*[A-Z][^()=;]*>\s*\(\s*\)\s*;/g,
  before: 'List<String> names = new ArrayList<String>();',
  after: 'List<String> names = new ArrayList<>();',
  fix: (ctx, h) => ({ start: h.index, end: h.index + h.length, text: `= new ${h.m[1]}<>();` }),
});

rule({
  id: 'modern.raw-type', kind: 'tip', cat: 'Generics', title: 'Raw type: add type arguments',
  why: 'A raw List/Map turns off type checking, so mistakes become ClassCastException at run time instead of compile errors.',
  rx: /(?<![\w.<>])(List|ArrayList|LinkedList|Map|HashMap|TreeMap|LinkedHashMap|Set|HashSet|TreeSet|Collection|Iterator|Iterable|Optional|Comparable|Comparator|Class|Supplier|Function|Callable|Future|CompletableFuture|Stream)\s+([a-z_]\w*)\s*(=|;|,|\)|:)/g,
  when: (ctx, m) => !/^\s*(import|package)\b/.test(ctx.lineText(m.index)) && !/\bcase\b|\breturn\b|\bnew\b|\bthrow\b|\belse\b/.test(ctx.clean.slice(Math.max(0, m.index - 12), m.index)),
  before: 'List names = new ArrayList();\nnames.add(42);                 // accepted, fails later\nString s = (String) names.get(0);',
  after: 'List<String> names = new ArrayList<>();\n// names.add(42);               // compile error: caught immediately\nString s = names.get(0);        // no cast',
});

rule({
  id: 'modern.new-raw', kind: 'tip', cat: 'Generics', title: 'new ArrayList() without <>: add the diamond',
  why: 'A raw "new" produces an unchecked-conversion warning and loses the type arguments.',
  rx: /\bnew\s+(ArrayList|HashMap|HashSet|LinkedList|TreeMap|LinkedHashMap|TreeSet|ArrayDeque)\s*\(/g,
  before: 'List<String> xs = new ArrayList();',
  after: 'List<String> xs = new ArrayList<>();',
  fix: (ctx, h) => ({ start: h.index, end: h.index + h.length, text: `new ${h.m[1]}<>(` }),
});

rule({
  id: 'modern.object-cast', kind: 'tip', cat: 'Generics', title: 'Object parameter that is cast back: make the method generic',
  why: 'Taking Object and casting inside loses type safety. A generic method (<T>) lets the compiler check the call sites and removes the cast.',
  detect(ctx) {
    const hits = [];
    for (const b of methodBodies(ctx)) {
      const ps = b.m.params ? b.m.params.split(',') : [];
      for (const p of ps) {
        const pm = /^\s*(?:final\s+)?Object\s+(\w+)\s*$/.exec(p);
        if (pm && new RegExp(`\\(\\s*[A-Z][\\w<>?]*\\s*\\)\\s*${pm[1]}\\b`).test(b.body)) { hits.push({ line: b.m.line, extra: { name: b.m.name } }); break; }
      }
    }
    return hits;
  },
  before: 'static void show(Object x) {\n  String s = (String) x;      // blows up for other types\n}',
  after: 'static <T extends CharSequence> void show(T x) {   // the compiler checks every caller\n  System.out.println(x.length());\n}\n// or return a typed value: static <T> T first(List<T> xs) { return xs.get(0); }',
});

rule({
  id: 'modern.unchecked', kind: 'tip', cat: 'Generics', title: '@SuppressWarnings("unchecked") hides a generics problem',
  why: 'An unchecked cast can fail later with a ClassCastException far from the cause. Carry the type with a Class<T> token (type.cast(obj)) or fix the declaration.',
  rx: /@SuppressWarnings\s*\(\s*(?:\{\s*)?"(unchecked|rawtypes)"/g,
  before: '@SuppressWarnings("unchecked")\nList<String> xs = (List<String>) obj;',
  after: '<T> T read(Object obj, Class<T> type) {\n  return type.cast(obj);            // checked at run time, with a clear message\n}\n// collections: List<String> xs = List.copyOf((Collection<? extends String>) obj);',
});

rule({
  id: 'modern.wildcard', kind: 'tip', cat: 'Generics', title: 'List<Number> parameter: use a bounded wildcard (PECS)',
  why: 'List<Number> does not accept a List<Integer>. If the method only reads, use <? extends Number>; if it only writes, use <? super Integer> ("Producer Extends, Consumer Super").',
  rx: /\(\s*(?:final\s+)?(List|Collection|Iterable|Set)<(Number|Object|CharSequence|Comparable|Serializable)>\s+\w+/g,
  before: 'double sum(List<Number> xs) { ... }       // sum(List.of(1, 2)) does not compile',
  after: 'double sum(List<? extends Number> xs) { ... } // accepts List<Integer>, List<Double> ...\nvoid fill(List<? super Integer> out) { out.add(1); }',
});

rule({
  id: 'modern.record', kind: 'tip', cat: 'Modern Java', title: 'Plain data class: use a record', since: 16,
  why: 'A class that only holds final fields, with a constructor, getters, equals, hashCode and toString, is exactly what a record is. One line replaces dozens.',
  detect(ctx) {
    const hits = [];
    for (const t of ctx.parsed.types) {
      if (t.kind !== 'class' || t.extends.length || (t.mods || []).includes('abstract')) continue;
      const fields = t.fields.filter((f) => !(f.mods || []).includes('static'));
      if (fields.length < 1 || fields.some((f) => !(f.mods || []).includes('final'))) continue;
      if ((t.annots || []).length && !(t.annots || []).every((a) => ['Value', 'Immutable'].includes(a))) continue;
      const names = new Set(fields.map((f) => f.name));
      const ok = t.methods.every((m) => m.ctor || ['toString', 'equals', 'hashCode'].includes(m.name) || ((/^(get|is)[A-Z]/.test(m.name) || names.has(m.name)) && !m.params));
      if (!ok || t.methods.length < 2) continue;
      hits.push({ line: t.line, extra: { t, fields } });
    }
    return hits;
  },
  message: (h) => `${h.extra.t.name} can be: record ${h.extra.t.name}(${h.extra.fields.map((f) => `${f.fullType || f.type} ${f.name}`).join(', ')})`,
  before: 'public final class Point {\n  private final int x; private final int y;\n  public Point(int x, int y) { this.x = x; this.y = y; }\n  public int getX() { return x; }  public int getY() { return y; }\n  // equals, hashCode, toString ...\n}',
  after: 'public record Point(int x, int y) { }\n// accessors are x() and y(); equals, hashCode and toString are generated\n// validation: public Point { if (x < 0) throw new IllegalArgumentException(); }',
});

rule({
  id: 'modern.optional-return', kind: 'tip', cat: 'Modern Java', title: 'Method returns null for "not found": return Optional', since: 8,
  why: 'null forces every caller to remember a check. Optional<T> makes "might be missing" part of the signature.',
  detect(ctx) {
    const hits = [];
    for (const b of methodBodies(ctx)) {
      const m = b.m;
      if (m.ctor || !m.ret || /^(void|int|long|double|float|boolean|char|short|byte|String|Optional|List|Set|Map|Collection|Object)$/.test(m.ret) || /\[\]/.test(m.ret)) continue;
      if (!/^(find|lookup|search|load|fetch|get\w*By|get\w*For)/.test(m.name)) continue;
      if (/\breturn\s+null\s*;/.test(b.body)) hits.push({ line: m.line, extra: { name: m.name, ret: m.ret } });
    }
    return hits;
  },
  message: (h) => `${h.extra.name}() returns ${h.extra.ret} or null.`,
  before: 'User findByEmail(String email) {\n  ...\n  return null;                       // caller must remember to check\n}',
  after: 'Optional<User> findByEmail(String email) {\n  ...\n  return Optional.empty();\n}\nString name = repo.findByEmail(e).map(User::name).orElse("guest");',
});

rule({
  id: 'modern.null-collection', kind: 'tip', cat: 'Collections (java.util)', title: 'Returning null for a collection: return an empty one',
  why: 'Callers loop over the result; null makes every one of them add a check. An empty list is always safe to iterate.',
  detect(ctx) {
    const hits = [];
    for (const b of methodBodies(ctx)) {
      if (!/^(List|Set|Map|Collection|Iterable)$/.test(b.m.ret || '')) continue;
      if (/\breturn\s+null\s*;/.test(b.body)) hits.push({ line: b.m.line, extra: { name: b.m.name, ret: b.m.ret } });
    }
    return hits;
  },
  message: (h) => `${h.extra.name}() returns null instead of an empty ${h.extra.ret}.`,
  before: 'List<Order> ordersOf(User u) {\n  if (u == null) return null;\n  ...\n}',
  after: 'List<Order> ordersOf(User u) {\n  if (u == null) return List.of();      // or Collections.emptyList()\n  ...\n}',
});

rule({
  id: 'modern.null-ternary', kind: 'tip', cat: 'Modern Java', title: 'x != null ? x : default: use Objects.requireNonNullElse', since: 9,
  why: 'Says "value or default" directly, and evaluates the variable once.',
  rx: /\b(\w+)\s*!=\s*null\s*\?\s*\1\s*:\s*([^;:,)]+)/g,
  before: 'String name = input != null ? input : "guest";',
  after: 'String name = Objects.requireNonNullElse(input, "guest");\n// or: Optional.ofNullable(input).orElse("guest");',
  fix: (ctx, h) => ({ start: h.index, end: h.index + h.length, text: `Objects.requireNonNullElse(${h.m[1]}, ${h.m[2].trim()})` }),
});

rule({
  id: 'modern.optional-ternary', kind: 'tip', cat: 'Modern Java', title: 'Optional isPresent() ? get() : default: use orElse', since: 8,
  why: 'orElse / orElseGet / orElseThrow express it in one call; get() without a check throws.',
  rx: /\b(\w+)\s*\.\s*isPresent\s*\(\s*\)\s*\?\s*\1\s*\.\s*get\s*\(\s*\)\s*:\s*([^;:,)]+)/g,
  before: 'String n = opt.isPresent() ? opt.get() : "none";',
  after: 'String n = opt.orElse("none");           // orElseGet(() -> compute()) when the default is costly',
  fix: (ctx, h) => ({ start: h.index, end: h.index + h.length, text: `${h.m[1]}.orElse(${h.m[2].trim()})` }),
});

rule({
  id: 'modern.optional-ifpresent', kind: 'tip', cat: 'Modern Java', title: 'isPresent() then get(): use ifPresent / map / orElseThrow', since: 8,
  why: 'Checking isPresent() and then calling get() is just a null check with extra steps. Use the functional methods.',
  detect(ctx) {
    const hits = [];
    const re = /if\s*\(\s*(\w+)\s*\.\s*isPresent\s*\(\s*\)\s*\)/g;
    let m;
    while ((m = re.exec(ctx.clean))) if (new RegExp(`\\b${m[1]}\\s*\\.\\s*get\\s*\\(`).test(ctx.clean.slice(m.index, m.index + 400))) hits.push({ index: m.index, length: m[0].length });
    return hits;
  },
  before: 'if (user.isPresent()) {\n  send(user.get());\n}',
  after: 'user.ifPresent(this::send);\n// value or exception:  User u = user.orElseThrow(() -> new NotFound(id));\n// transform:           String n = user.map(User::name).orElse("guest");',
});

rule({
  id: 'modern.optional-get', kind: 'tip', cat: 'Modern Java', title: 'findFirst().get(): use orElseThrow()', since: 10,
  why: 'get() on an empty Optional throws a vague NoSuchElementException. orElseThrow() says it is intentional; pass a supplier for a clear message.',
  rx: /\)\s*\.\s*(findFirst|findAny)\s*\(\s*\)\s*\.\s*get\s*\(\s*\)/g,
  before: 'Order o = orders.stream().filter(Order::isOpen).findFirst().get();',
  after: 'Order o = orders.stream().filter(Order::isOpen).findFirst()\n                .orElseThrow(() -> new IllegalStateException("no open order"));',
  fix: (ctx, h) => ({ start: h.index, end: h.index + h.length, text: `).${h.m[1]}().orElseThrow()` }),
});

/* =============================== CompletableFuture / Future =============================== */

rule({
  id: 'async.future-get', kind: 'tip', cat: 'CompletableFuture', title: 'Blocking on a Future with get(): compose instead',
  why: 'future.get() parks the calling thread until the result arrives, which defeats the point of going async (and throws two checked exceptions). Chain stages with thenApply / thenCompose / thenCombine and block (join) only at the edge of the program.',
  rx: /\b(\w*(?:[Ff]uture|[Ff]uture\w*|task|result)\w*)\s*\.\s*get\s*\(\s*\)|supplyAsync\s*\([^;]*\)\s*\.\s*get\s*\(\s*\)/g,
  when: (ctx, m) => /Future|CompletableFuture/.test(ctx.clean),
  before: 'Future<User> f = pool.submit(() -> loadUser(id));\nUser u = f.get();                     // blocked here\nFuture<Orders> g = pool.submit(() -> loadOrders(u));\nreturn g.get();',
  after: 'return CompletableFuture\n    .supplyAsync(() -> loadUser(id), pool)\n    .thenApplyAsync(u -> loadOrders(u), pool)    // no thread is blocked while waiting\n    .orTimeout(3, TimeUnit.SECONDS)\n    .exceptionally(ex -> Orders.empty());',
});

rule({
  id: 'async.default-pool', kind: 'tip', cat: 'CompletableFuture', title: 'supplyAsync / runAsync without an executor',
  why: 'Without an executor the task runs on the shared ForkJoinPool.commonPool, which has about one thread per CPU. A few blocking tasks (HTTP, database) can starve every other async job in the JVM. Pass your own executor (for example virtual threads).',
  detect(ctx) {
    const hits = [];
    const re = /CompletableFuture\s*\.\s*(supplyAsync|runAsync)\s*\(/g;
    let m;
    while ((m = re.exec(ctx.clean))) {
      const { args } = callArgs(ctx, m.index + m[0].length - 1);
      if (args.length < 2) hits.push({ index: m.index, length: m[0].length });
    }
    return hits;
  },
  before: 'CompletableFuture.supplyAsync(() -> httpGet(url));      // shared common pool',
  after: 'private static final ExecutorService IO = Executors.newVirtualThreadPerTaskExecutor();\nCompletableFuture.supplyAsync(() -> httpGet(url), IO);',
});

rule({
  id: 'async.no-error-handling', kind: 'tip', cat: 'CompletableFuture', title: 'Async stage with no error handling',
  why: 'An exception inside supplyAsync / runAsync is stored in the future. If nobody calls join/get or adds exceptionally/handle/whenComplete it silently disappears.',
  detect(ctx) {
    const hits = [];
    const re = /(^|[;{}]\s*)(CompletableFuture\s*\.\s*(?:supplyAsync|runAsync)\s*\([^;]*;)/gm;
    let m;
    while ((m = re.exec(ctx.clean))) {
      if (!/\b(exceptionally|handle|whenComplete|join|get|orTimeout)\s*\(/.test(m[2])) hits.push({ index: m.index + m[1].length, length: 40 });
    }
    return hits;
  },
  before: 'CompletableFuture.runAsync(() -> sendReport());     // failures vanish',
  after: 'CompletableFuture.runAsync(() -> sendReport(), pool)\n    .exceptionally(ex -> { log.error("report failed", ex); return null; });\n// or .whenComplete((v, ex) -> { if (ex != null) log.error("report failed", ex); });',
});

rule({
  id: 'async.nested-join', kind: 'tip', cat: 'CompletableFuture', title: 'join()/get() inside a stage: use thenCompose',
  why: 'Blocking inside thenApply wastes a pool thread and can dead-lock a small pool. When the next step is itself async, flatten it with thenCompose.',
  rx: /\.\s*then(?:Apply|Accept)(?:Async)?\s*\([^;]*?\.\s*(?:join|get)\s*\(\s*\)/g,
  before: 'cf.thenApply(u -> loadOrdersAsync(u).join());',
  after: 'cf.thenCompose(u -> loadOrdersAsync(u));        // returns a CompletableFuture, nothing blocks',
});

rule({
  id: 'async.join-loop', kind: 'tip', cat: 'CompletableFuture', title: 'Waiting for futures one by one: use allOf',
  why: 'Joining inside a loop is fine for correctness but hides whether all tasks failed or timed out together. CompletableFuture.allOf waits for all at once and lets you attach one timeout or error handler.',
  rx: /for\s*\(\s*(?:final\s+)?(?:CompletableFuture|Future)<[^>]*>\s+\w+\s*:[^)]*\)\s*\{[^}]*\.\s*(?:join|get)\s*\(\s*\)/g,
  before: 'List<String> out = new ArrayList<>();\nfor (CompletableFuture<String> f : futures) out.add(f.join());',
  after: 'CompletableFuture.allOf(futures.toArray(CompletableFuture[]::new))\n    .orTimeout(10, TimeUnit.SECONDS)\n    .join();\nList<String> out = futures.stream().map(CompletableFuture::join).toList();   // all already done',
});

rule({
  id: 'async.no-timeout', kind: 'tip', cat: 'CompletableFuture', title: 'Async call without a timeout', since: 9,
  why: 'If the remote call never answers, the future never completes. orTimeout fails it after a deadline; completeOnTimeout supplies a fallback.',
  detect(ctx) {
    if (/\b(orTimeout|completeOnTimeout)\s*\(/.test(ctx.clean)) return [];
    const m = /CompletableFuture\s*\.\s*(supplyAsync|runAsync)\s*\(/.exec(ctx.clean);
    return m ? [{ index: m.index, length: m[0].length }] : [];
  },
  before: 'CompletableFuture.supplyAsync(() -> slowService(), pool).thenAccept(this::show);',
  after: 'CompletableFuture.supplyAsync(() -> slowService(), pool)\n    .orTimeout(2, TimeUnit.SECONDS)                      // fails with TimeoutException\n    // .completeOnTimeout(DEFAULT, 2, TimeUnit.SECONDS)   // or fall back to a default\n    .thenAccept(this::show);',
});

rule({
  id: 'async.submit-future', kind: 'tip', cat: 'CompletableFuture', title: 'executor.submit() returns a plain Future: use CompletableFuture to compose',
  why: 'A plain Future can only be polled or blocked on. CompletableFuture lets you chain, combine and handle errors without blocking.',
  rx: /Future<[^=;]*>\s+(\w+)\s*=\s*(\w+)\s*\.\s*submit\s*\(/g,
  before: 'Future<Price> p = pool.submit(() -> fetchPrice(id));',
  after: 'CompletableFuture<Price> p = CompletableFuture.supplyAsync(() -> fetchPrice(id), pool);\nCompletableFuture<Total> total = p.thenCombine(tax, (price, t) -> price.plus(t));',
});

/* =============================== lambdas, functional interfaces, streams =============================== */

const SAM = {
  Runnable: ['() -> { ... }', 'Runnable r = () -> log.info("tick");'],
  Callable: ['() -> value', 'Callable<String> c = () -> load();'],
  Comparator: ['(a, b) -> ...', 'people.sort(Comparator.comparing(Person::getName));'],
  Supplier: ['() -> value', 'Supplier<Config> s = Config::load;'],
  Consumer: ['x -> ...', 'Consumer<String> c = System.out::println;'],
  Function: ['x -> ...', 'Function<String, Integer> f = Integer::parseInt;'],
  Predicate: ['x -> boolean', 'Predicate<String> p = String::isBlank;'],
  BiFunction: ['(a, b) -> ...', 'BiFunction<Integer, Integer, Integer> add = Integer::sum;'],
  ActionListener: ['e -> ...', 'button.addActionListener(e -> save());'],
};

rule({
  id: 'lambda.anonymous', kind: 'tip', cat: 'Lambdas', title: 'Anonymous inner class: use a lambda', since: 8,
  why: 'An anonymous class that implements a single-method interface can be a lambda. It is shorter, and with method references (Type::method) shorter still.',
  rx: /\bnew\s+(Runnable|Callable|Comparator|Supplier|Consumer|Function|Predicate|BiFunction|ActionListener)\s*(?:<[^>(){}]*>)?\s*\(\s*\)\s*\{/g,
  before: (ctx, h) => `new ${h.m[1]}() {\n  @Override public void method(...) { ... }\n}`,
  after: (ctx, h) => `${(SAM[h.m[1]] || ['', ''])[0]}\n// for example:\n${(SAM[h.m[1]] || ['', ''])[1]}`,
});

rule({
  id: 'lambda.method-ref', kind: 'tip', cat: 'Lambdas', title: 'Lambda only calls one method: use a method reference', since: 8,
  why: 'x -> x.getName() is the same as Person::getName. Method references are shorter and name the method being called.',
  rx: /\b(\w+)\s*->\s*\1\s*\.\s*(\w+)\s*\(\s*\)(?!\s*[.\w])|\b(\w+)\s*->\s*new\s+(\w+)\s*\(\s*\3\s*\)|\b(\w+)\s*->\s*System\.out\.println\(\s*\5\s*\)|\(\s*(\w+)\s*\)\s*->\s*(\w+)\s*\.\s*(\w+)\s*\(\s*\6\s*\)/g,
  before: 'names = people.stream().map(p -> p.getName()).toList();\nitems.forEach(i -> System.out.println(i));\nlist.stream().map(s -> new Dto(s))...',
  after: 'names = people.stream().map(Person::getName).toList();\nitems.forEach(System.out::println);\nlist.stream().map(Dto::new)...',
  fix: (ctx, h) => {
    if (h.m[5]) return { start: h.index, end: h.index + h.length, text: 'System.out::println' };
    if (h.m[7] && !/^[A-Z]/.test(h.m[7])) return { start: h.index, end: h.index + h.length, text: `${h.m[7]}::${h.m[8]}` };
    return null;
  },
});

rule({
  id: 'lambda.comparator', kind: 'tip', cat: 'Lambdas', title: 'Hand-written comparison: use Comparator.comparing', since: 8,
  why: 'Comparator.comparing(Type::getX) (with thenComparing, reversed, nullsFirst) is shorter and cannot get a comparison direction wrong.',
  rx: /\(\s*(\w+)\s*,\s*(\w+)\s*\)\s*->\s*\1\s*\.\s*(\w+)\s*\(\s*\)\s*\.\s*compareTo\s*\(\s*\2\s*\.\s*\3\s*\(\s*\)\s*\)|\(\s*(\w+)\s*,\s*(\w+)\s*\)\s*->\s*(Integer|Long|Double)\s*\.\s*compare\s*\(\s*\4\s*\.\s*(\w+)\s*\(\s*\)\s*,\s*\5\s*\.\s*\7\s*\(\s*\)\s*\)/g,
  before: 'people.sort((a, b) -> a.getName().compareTo(b.getName()));\npeople.sort((a, b) -> Integer.compare(a.getAge(), b.getAge()));',
  after: 'people.sort(Comparator.comparing(Person::getName));\npeople.sort(Comparator.comparingInt(Person::getAge).reversed());\npeople.sort(Comparator.comparing(Person::getCity).thenComparing(Person::getName));',
});

rule({
  id: 'lambda.functional-interface', kind: 'tip', cat: 'Functional programming', title: 'Single-method interface: @FunctionalInterface or a java.util.function type', since: 8,
  why: 'An interface with exactly one abstract method can be implemented with a lambda. Mark it @FunctionalInterface so the compiler guards it, or use the ready-made type from java.util.function (Function, Predicate, Consumer, Supplier ...).',
  detect(ctx) {
    const hits = [];
    for (const t of ctx.parsed.types) {
      if (t.kind !== 'interface' || (t.annots || []).includes('FunctionalInterface')) continue;
      const abs = t.methods.filter((m) => (m.mods || []).includes('abstract'));
      if (abs.length !== 1 || t.implements.length) continue;
      const m = abs[0];
      const ps = m.params ? m.params.split(',').length : 0;
      let suggestion;
      if (ps === 0) suggestion = m.ret === 'void' ? 'Runnable' : `Supplier<${m.ret}>   (or Callable<${m.ret}> if it throws)`;
      else if (ps === 1) suggestion = m.ret === 'void' ? 'Consumer<T>' : m.ret === 'boolean' ? 'Predicate<T>' : `Function<T, ${m.ret}>`;
      else if (ps === 2) suggestion = m.ret === 'void' ? 'BiConsumer<T, U>' : m.ret === 'boolean' ? 'BiPredicate<T, U>' : `BiFunction<T, U, ${m.ret}>`;
      else suggestion = 'keep your own interface';
      hits.push({ line: t.line, extra: { t, m, suggestion } });
    }
    return hits;
  },
  message: (h) => `${h.extra.t.name}.${h.extra.m.name}() could be ${h.extra.suggestion}.`,
  before: 'interface Validator { boolean check(String s); }\nValidator v = new Validator() { public boolean check(String s) { return !s.isEmpty(); } };',
  after: '@FunctionalInterface\ninterface Validator { boolean check(String s); }\nValidator v = s -> !s.isEmpty();\n// or skip the interface:  Predicate<String> v = s -> !s.isEmpty();\nPredicate<String> both = v.and(s -> s.length() < 20);   // compose',
  fix: (ctx, h) => {
    const ls = ctx.lineStarts[h.line - 1];
    const indent = (/^\s*/.exec(ctx.lines[h.line - 1]) || [''])[0];
    return { start: ls, end: ls, text: `${indent}@FunctionalInterface${NLJ}` };
  },
});

rule({
  id: 'stream.loop-filter-map', kind: 'tip', cat: 'Streams', title: 'Loop that filters and collects: use a stream', since: 8,
  why: 'A for-loop that tests each element and adds a converted value to another list is a filter + map + collect. The stream says that directly.',
  rx: /for\s*\(\s*(?:final\s+)?[\w<>?,\[\]\s]+?\s+(\w+)\s*:\s*([\w.()]+)\s*\)\s*\{\s*if\s*\(([^{};]+)\)\s*\{?\s*(\w+)\s*\.\s*add\s*\(([^;]+)\)\s*;\s*\}?\s*\}/g,
  before: 'List<String> names = new ArrayList<>();\nfor (User u : users) {\n  if (u.isActive()) names.add(u.getName());\n}',
  after: 'List<String> names = users.stream()\n    .filter(User::isActive)\n    .map(User::getName)\n    .toList();                       // Java 16 (collect(Collectors.toList()) before)',
});

rule({
  id: 'stream.loop-sum', kind: 'tip', cat: 'Streams', title: 'Loop that adds things up: use mapToInt/mapToDouble().sum()', since: 8,
  why: 'Summing, counting, min and max over a collection are one-liners on streams.',
  rx: /for\s*\(\s*(?:final\s+)?[\w<>?,\[\]\s]+?\s+(\w+)\s*:\s*([\w.()]+)\s*\)\s*\{\s*(\w+)\s*\+=\s*\1\s*\.\s*(\w+)\s*\(\s*\)\s*;\s*\}/g,
  before: 'double total = 0;\nfor (Item i : items) total += i.getPrice();',
  after: 'double total = items.stream().mapToDouble(Item::getPrice).sum();\n// count: stream().filter(...).count()   max: stream().max(Comparator.comparing(Item::getPrice))',
});

rule({
  id: 'stream.loop-any', kind: 'tip', cat: 'Streams', title: 'Loop that looks for a match: use anyMatch / findFirst', since: 8,
  why: 'Searching loops with an early return are what anyMatch, allMatch, noneMatch and findFirst are for.',
  rx: /for\s*\(\s*(?:final\s+)?[\w<>?,\[\]\s]+?\s+(\w+)\s*:\s*([\w.()]+)\s*\)\s*\{\s*if\s*\(([^{};]+)\)\s*\{?\s*return\s+(true|\1)\s*;\s*\}?\s*\}\s*return\s+(false|null)\s*;/g,
  before: 'for (User u : users) {\n  if (u.getAge() > 18) return true;\n}\nreturn false;',
  after: 'return users.stream().anyMatch(u -> u.getAge() > 18);\n// the element itself: users.stream().filter(...).findFirst()   (an Optional)',
});

rule({
  id: 'stream.foreach', kind: 'tip', cat: 'Streams', title: 'collection.stream().forEach(): call forEach directly',
  why: 'Collection.forEach does the same without creating a stream.',
  rx: /\.\s*stream\s*\(\s*\)\s*\.\s*forEach\s*\(/g,
  before: 'items.stream().forEach(this::process);',
  after: 'items.forEach(this::process);',
  fix: (ctx, h) => ({ start: h.index, end: h.index + h.length, text: '.forEach(' }),
});

rule({
  id: 'stream.tolist', kind: 'tip', cat: 'Streams', title: 'collect(Collectors.toList()): use toList()', since: 16,
  why: 'Stream.toList() is shorter. It returns an unmodifiable list, so keep collect(Collectors.toList()) (or toCollection(ArrayList::new)) if you need to add to the result.',
  rx: /\.\s*collect\s*\(\s*Collectors\s*\.\s*toList\s*\(\s*\)\s*\)/g,
  before: 'List<String> names = people.stream().map(Person::getName).collect(Collectors.toList());',
  after: 'List<String> names = people.stream().map(Person::getName).toList();',
  fix: (ctx, h) => ({ start: h.index, end: h.index + h.length, text: '.toList()' }),
});

rule({
  id: 'stream.count-anymatch', kind: 'tip', cat: 'Streams', title: 'filter(...).count() > 0: use anyMatch / noneMatch', since: 8,
  why: 'anyMatch stops at the first hit; count() looks at every element.',
  rx: /\.\s*filter\s*\(([^;]*?)\)\s*\.\s*count\s*\(\s*\)\s*(>\s*0|!=\s*0|==\s*0|>=\s*1)|\.\s*filter\s*\(([^;]*?)\)\s*\.\s*findFirst\s*\(\s*\)\s*\.\s*isPresent\s*\(\s*\)/g,
  before: 'boolean has = users.stream().filter(u -> u.isAdmin()).count() > 0;',
  after: 'boolean has  = users.stream().anyMatch(User::isAdmin);\nboolean none = users.stream().noneMatch(User::isAdmin);',
});

rule({
  id: 'stream.grouping', kind: 'tip', cat: 'Streams', title: 'Building a Map of Lists by hand: use groupingBy', since: 8,
  why: 'Grouping, counting and partitioning are built into Collectors.',
  rx: /if\s*\(\s*!\s*(\w+)\s*\.\s*containsKey\s*\([^)]*\)\s*\)\s*\{?\s*\1\s*\.\s*put\s*\([^,]+,\s*new\s+(?:ArrayList|HashSet|LinkedList)/g,
  before: 'Map<String, List<User>> byCity = new HashMap<>();\nfor (User u : users) {\n  if (!byCity.containsKey(u.getCity())) byCity.put(u.getCity(), new ArrayList<>());\n  byCity.get(u.getCity()).add(u);\n}',
  after: 'Map<String, List<User>> byCity = users.stream().collect(Collectors.groupingBy(User::getCity));\nMap<String, Long> counts = users.stream().collect(Collectors.groupingBy(User::getCity, Collectors.counting()));\nMap<Boolean, List<User>> split = users.stream().collect(Collectors.partitioningBy(User::isActive));',
});

rule({
  id: 'stream.parallel', kind: 'tip', cat: 'Streams', title: 'parallelStream() shares the common pool',
  why: 'Parallel streams run on the shared ForkJoinPool. They help for large CPU-bound work, but hurt for small collections or blocking calls and can slow every other parallel task in the JVM. Measure before using them.',
  rx: /\.\s*parallelStream\s*\(|\.\s*parallel\s*\(\s*\)/g,
  before: 'orders.parallelStream().map(this::callRemoteApi).toList();   // blocks the common pool',
  after: 'orders.stream().map(this::price).toList();   // start sequential\n// CPU-heavy and large (>10k items)? benchmark with JMH, or run in your own ForkJoinPool:\nnew ForkJoinPool(8).submit(() -> orders.parallelStream()...).get();',
});

rule({
  id: 'stream.index-loop', kind: 'tip', cat: 'Collections (java.util)', title: 'Index loop that only reads list.get(i): use for-each',
  why: 'The enhanced for loop removes the index bookkeeping and works for every Iterable.',
  detect(ctx) {
    const hits = [];
    const re = /for\s*\(\s*int\s+(\w+)\s*=\s*0\s*;\s*\1\s*<\s*(\w+)\s*\.\s*size\s*\(\s*\)\s*;\s*\1\s*\+\+\s*\)\s*\{/g;
    let m;
    while ((m = re.exec(ctx.clean))) {
      const close = ctx.matchBrace(m.index + m[0].length - 1);
      const body = ctx.clean.slice(m.index + m[0].length, close);
      const stripped = body.replace(new RegExp(`\\b${m[2]}\\s*\\.\\s*get\\s*\\(\\s*${m[1]}\\s*\\)`, 'g'), '');
      if (stripped !== body && !new RegExp(`\\b${m[1]}\\b`).test(stripped)) hits.push({ index: m.index, length: m[0].length });
    }
    return hits;
  },
  before: 'for (int i = 0; i < names.size(); i++) {\n  print(names.get(i));\n}',
  after: 'for (String name : names) {\n  print(name);\n}\n// or: names.forEach(this::print);',
});

/* =============================== Lombok =============================== */

function lombokNote(ctx) {
  return ctx.lombok ? 'Lombok is already in this project.' : 'Lombok is not in this project yet: right-click the project > Lombok > Add Lombok dependency (or use the lightbulb).';
}

rule({
  id: 'lombok.accessors', kind: 'lombok', cat: 'Lombok', title: 'Hand-written getters and setters: use Lombok annotations',
  why: 'Getters and setters that only read or assign a field are boilerplate. @Getter / @Setter (or @Data) generate them at compile time and the IDE still knows the methods exist.',
  detect(ctx) {
    const hits = [];
    for (const t of ctx.parsed.types) {
      if (t.kind !== 'class' || (t.annots || []).some((a) => ['Data', 'Value', 'Getter', 'Setter'].includes(a))) continue;
      const { getters, setters } = accessorsOf(ctx, t);
      if (getters.length + setters.length >= 3) hits.push({ line: t.line, extra: { t, getters: getters.length, setters: setters.length } });
    }
    return hits;
  },
  message: (h, ctx) => `${h.extra.t.name} has ${h.extra.getters} trivial getter(s) and ${h.extra.setters} setter(s). ${lombokNote(ctx)}`,
  before: 'public class User {\n  private String name; private int age;\n  public String getName() { return name; }\n  public void setName(String name) { this.name = name; }\n  public int getAge() { return age; }\n  public void setAge(int age) { this.age = age; }\n}',
  after: '@Data                      // getters, setters, equals, hashCode, toString\npublic class User {\n  private String name;\n  private int age;\n}\n// read-only: @Value or a record;  only some: @Getter / @Setter on the class or a field',
  lombokFix: 'accessors',
});

rule({
  id: 'lombok.constructor', kind: 'lombok', cat: 'Lombok', title: 'Constructor that copies parameters into fields: @RequiredArgsConstructor / @AllArgsConstructor',
  why: 'A constructor that does nothing but assign each field is generated for you by Lombok. This is common with Spring constructor injection.',
  detect(ctx) {
    const hits = [];
    for (const t of ctx.parsed.types) {
      if (t.kind !== 'class' || (t.annots || []).some((a) => /ArgsConstructor|Data|Value|Builder/.test(a))) continue;
      const fields = t.fields.filter((f) => !(f.mods || []).includes('static'));
      if (fields.length < 2) continue;
      for (const b of methodBodies(ctx).filter((x) => x.t === t && x.m.ctor)) {
        const assigns = (b.body.match(/\bthis\s*\.\s*\w+\s*=\s*\w+\s*;/g) || []).length;
        const stmts = b.body.split(';').filter((s) => s.trim()).length;
        if (assigns >= 2 && assigns === stmts) { hits.push({ line: t.line, extra: { t } }); break; }
      }
    }
    return hits;
  },
  message: (h, ctx) => `${h.extra.t.name}'s constructor only assigns fields. ${lombokNote(ctx)}`,
  before: 'public class OrderService {\n  private final OrderRepo repo; private final Mailer mailer;\n  public OrderService(OrderRepo repo, Mailer mailer) { this.repo = repo; this.mailer = mailer; }\n}',
  after: '@RequiredArgsConstructor           // constructor for all final fields\npublic class OrderService {\n  private final OrderRepo repo;\n  private final Mailer mailer;\n}',
});

rule({
  id: 'lombok.tostring-equals', kind: 'lombok', cat: 'Lombok', title: 'Hand-written toString / equals / hashCode: use @ToString / @EqualsAndHashCode',
  why: 'These methods list every field and must be updated whenever a field changes. Lombok keeps them in sync automatically.',
  detect(ctx) {
    const hits = [];
    for (const t of ctx.parsed.types) {
      if (t.kind !== 'class' || (t.annots || []).some((a) => /^(Data|Value|ToString|EqualsAndHashCode)$/.test(a))) continue;
      const names = t.methods.map((m) => m.name);
      if (names.includes('toString') || (names.includes('equals') && names.includes('hashCode'))) hits.push({ line: t.line, extra: { t, what: [names.includes('toString') ? 'toString()' : '', names.includes('equals') ? 'equals()/hashCode()' : ''].filter(Boolean).join(' and ') } });
    }
    return hits;
  },
  message: (h, ctx) => `${h.extra.t.name} writes ${h.extra.what} by hand. ${lombokNote(ctx)}`,
  before: '@Override public String toString() { return "User{name=" + name + ", age=" + age + "}"; }\n@Override public boolean equals(Object o) { ... }\n@Override public int hashCode() { return Objects.hash(name, age); }',
  after: '@ToString\n@EqualsAndHashCode(onlyExplicitlyIncluded = true)   // pick the fields with @EqualsAndHashCode.Include\npublic class User { @EqualsAndHashCode.Include private Long id; private String name; }',
});

rule({
  id: 'lombok.logger', kind: 'lombok', cat: 'Lombok', title: 'Logger field: use @Slf4j',
  why: 'private static final Logger log = LoggerFactory.getLogger(X.class) is the same line in every class, and easy to copy with the wrong class name. @Slf4j adds the field named "log" for you.',
  rx: /(?:private\s+)?(?:static\s+)?(?:final\s+)?(?:Logger|Log)\s+\w+\s*=\s*(?:LoggerFactory|Logger|LogManager|LogFactory)\s*\.\s*get\w*\s*\(/g,
  before: 'private static final Logger log = LoggerFactory.getLogger(OrderService.class);',
  after: '@Slf4j                      // adds: private static final Logger log\npublic class OrderService {\n  void run() { log.info("started"); }\n}',
  lombokFix: 'slf4j',
});

rule({
  id: 'lombok.builder', kind: 'lombok', cat: 'Lombok', title: 'Hand-written builder: use @Builder',
  why: 'A static nested Builder class repeats every field three times. @Builder generates it, including toBuilder() with @Builder(toBuilder = true).',
  detect(ctx) {
    const hits = [];
    for (const t of ctx.parsed.types) {
      if (t.kind !== 'class' || (t.annots || []).includes('Builder')) continue;
      const nested = ctx.parsed.types.find((x) => x.outer === t.name && /Builder$/.test(x.name));
      if (nested) hits.push({ line: nested.line, extra: { t } });
    }
    return hits;
  },
  message: (h, ctx) => `${h.extra.t.name} has its own Builder class. ${lombokNote(ctx)}`,
  before: 'public static class Builder {\n  private String name; private int age;\n  public Builder name(String n) { this.name = n; return this; }\n  public Builder age(int a) { this.age = a; return this; }\n  public User build() { return new User(name, age); }\n}',
  after: '@Builder\npublic class User {\n  private final String name;\n  private final int age;\n}\nUser u = User.builder().name("Ann").age(30).build();',
});

rule({
  id: 'lombok.nonnull', kind: 'lombok', cat: 'Lombok', title: 'Objects.requireNonNull on parameters: use @NonNull',
  why: '@NonNull on a parameter or field makes Lombok generate the null check with a clear message.',
  rx: /Objects\s*\.\s*requireNonNull\s*\(\s*\w+\s*(?:,\s*"[^"]*")?\s*\)/g, when: (ctx) => ctx.lombok || /lombok/.test(ctx.clean),
  before: 'this.repo = Objects.requireNonNull(repo, "repo");',
  after: 'public OrderService(@NonNull OrderRepo repo) {    // Lombok adds the null check\n  this.repo = repo;\n}',
});
