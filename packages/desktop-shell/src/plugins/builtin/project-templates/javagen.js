/**
 * Maven coordinates, parent POM and package scaffolding for the Java templates (Spring Boot, Quarkus, plain Java, Tomcat WAR).
 * The user chooses the group id, base package and parent; nothing is assumed ("com.example" is never a default).
 */
const JAVA_KEYWORDS = new Set(['abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float', 'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native', 'new', 'package', 'private', 'protected', 'public', 'return', 'short', 'static', 'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'try', 'void', 'volatile', 'while', 'true', 'false', 'null', 'var', 'record']);
const GROUP_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const PKG_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;
const ARTIFACT_RE = /^[a-z][a-z0-9._-]{0,60}$/;
const VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z._-]{0,40}$/;
const SPRING_BOOT = '3.3.5';
const QUARKUS = '3.15.1';

const slug = (n) => String(n).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '') || 'app';
const pkgSafe = (s) => String(s).toLowerCase().replace(/[^a-z0-9_.]/g, '').replace(/\.{2,}/g, '.').replace(/^\.+|\.+$/g, '');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** The package that follows from a group id and an artifact id (hyphens are not allowed in package names). */
const defaultPackage = (groupId, artifactId) => pkgSafe(`${groupId}.${String(artifactId).replace(/[-.]/g, '')}`);

function checkPackage(p, what) {
  if (!PKG_RE.test(p)) throw new Error(`${what} "${p}" is not a valid Java package: lower-case letters, digits and "_", separated by dots.`);
  const bad = p.split('.').find((x) => JAVA_KEYWORDS.has(x));
  if (bad) throw new Error(`${what} cannot contain the Java keyword "${bad}".`);
}

/** Checks and completes what the dialog sent. Throws a message the user can act on. */
function normalize(name, input, kind) {
  const o = input || {};
  const artifactId = String(o.artifactId || slug(name)).trim();
  if (!ARTIFACT_RE.test(artifactId)) throw new Error('Artifact id: lower-case letters, digits, ".", "_" or "-".');
  const groupId = String(o.groupId || '').trim();
  if (!groupId) throw new Error('Enter the group id (for example com.acme). There is no default: it should be your own organization.');
  if (!GROUP_RE.test(groupId)) throw new Error(`Group id "${groupId}" should look like com.yourcompany (lower-case, dot separated).`);
  const pkg = String(o.basePackage || defaultPackage(groupId, artifactId)).trim();
  checkPackage(pkg, 'Base package');
  const version = String(o.version || '1.0.0-SNAPSHOT').trim();
  if (!VERSION_RE.test(version)) throw new Error('Version looks like 1.0.0-SNAPSHOT.');
  const java = ['17', '21', '25'].includes(String(o.javaVersion)) ? String(o.javaVersion) : '17';
  const pr = o.parent || {};
  const defaultParent = kind === 'spring-boot';
  const mode = ['default', 'none', 'custom'].includes(pr.mode) ? pr.mode : defaultParent ? 'default' : 'none';
  const parent = { mode: mode === 'default' && !defaultParent ? 'none' : mode };
  if (parent.mode === 'custom') {
    parent.groupId = String(pr.groupId || '').trim();
    parent.artifactId = String(pr.artifactId || '').trim();
    parent.version = String(pr.version || '').trim();
    if (!GROUP_RE.test(parent.groupId) && !/^[a-z][a-z0-9_.-]*$/.test(parent.groupId)) throw new Error('Parent group id is missing or invalid.');
    if (!ARTIFACT_RE.test(parent.artifactId)) throw new Error('Parent artifact id is missing or invalid.');
    if (!VERSION_RE.test(parent.version)) throw new Error('Parent version is missing or invalid.');
    parent.relativePath = String(pr.relativePath || '').trim();
    if (parent.relativePath && /[<>&"]/.test(parent.relativePath)) throw new Error('Parent relative path has invalid characters.');
  }
  return { name, artifactId, groupId, pkg, version, java, parent, layers: o.layers !== false };
}

const dir = (pkg) => pkg.replace(/\./g, '/');
const HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">\n  <modelVersion>4.0.0</modelVersion>\n';

function parentBlock(o) {
  if (o.parent.mode === 'default') return '  <parent>\n    <groupId>org.springframework.boot</groupId>\n    <artifactId>spring-boot-starter-parent</artifactId>\n    <version>' + SPRING_BOOT + '</version>\n    <relativePath/>\n  </parent>\n';
  if (o.parent.mode === 'custom') {
    const p = o.parent;
    return '  <parent>\n    <groupId>' + esc(p.groupId) + '</groupId>\n    <artifactId>' + esc(p.artifactId) + '</artifactId>\n    <version>' + esc(p.version) + '</version>\n' + (p.relativePath ? '    <relativePath>' + esc(p.relativePath) + '</relativePath>\n' : '    <relativePath/>\n') + '  </parent>\n';
  }
  return '';
}

const coords = (o, packaging) => '  <groupId>' + o.groupId + '</groupId>\n  <artifactId>' + o.artifactId + '</artifactId>\n  <version>' + o.version + '</version>\n' + (packaging ? '  <packaging>' + packaging + '</packaging>\n' : '') + '  <name>' + esc(o.name) + '</name>\n';

/* ------------------------------------------------------------------ poms */

function pomPlain(o) {
  return HEAD + parentBlock(o) + coords(o) +
    '  <properties>\n    <maven.compiler.release>' + o.java + '</maven.compiler.release>\n    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>\n  </properties>\n' +
    '  <dependencies>\n    <dependency>\n      <groupId>org.junit.jupiter</groupId>\n      <artifactId>junit-jupiter</artifactId>\n      <version>5.11.3</version>\n      <scope>test</scope>\n    </dependency>\n  </dependencies>\n' +
    '  <build>\n    <plugins>\n      <plugin>\n        <groupId>org.apache.maven.plugins</groupId>\n        <artifactId>maven-surefire-plugin</artifactId>\n        <version>3.5.1</version>\n      </plugin>\n    </plugins>\n  </build>\n</project>\n';
}

function pomSpring(o) {
  const ownParent = o.parent.mode !== 'default';
  const bom = ownParent
    ? '  <dependencyManagement>\n    <dependencies>\n      <dependency>\n        <groupId>org.springframework.boot</groupId>\n        <artifactId>spring-boot-dependencies</artifactId>\n        <version>${spring-boot.version}</version>\n        <type>pom</type>\n        <scope>import</scope>\n      </dependency>\n    </dependencies>\n  </dependencyManagement>\n'
    : '';
  return HEAD + parentBlock(o) + coords(o) +
    '  <properties>\n    <java.version>' + o.java + '</java.version>\n' + (ownParent ? '    <maven.compiler.release>' + o.java + '</maven.compiler.release>\n    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>\n    <spring-boot.version>' + SPRING_BOOT + '</spring-boot.version>\n' : '') + '  </properties>\n' + bom +
    '  <dependencies>\n    <dependency>\n      <groupId>org.springframework.boot</groupId>\n      <artifactId>spring-boot-starter-web</artifactId>\n    </dependency>\n    <dependency>\n      <groupId>org.springframework.boot</groupId>\n      <artifactId>spring-boot-starter-actuator</artifactId>\n    </dependency>\n    <dependency>\n      <groupId>org.springframework.boot</groupId>\n      <artifactId>spring-boot-starter-test</artifactId>\n      <scope>test</scope>\n    </dependency>\n  </dependencies>\n' +
    '  <build>\n    <finalName>app</finalName>\n    <plugins>\n      <plugin>\n        <groupId>org.springframework.boot</groupId>\n        <artifactId>spring-boot-maven-plugin</artifactId>\n' + (ownParent ? '        <version>${spring-boot.version}</version>\n        <executions>\n          <execution>\n            <goals>\n              <goal>repackage</goal>\n            </goals>\n          </execution>\n        </executions>\n' : '') + '      </plugin>\n    </plugins>\n  </build>\n</project>\n';
}

function pomQuarkus(o) {
  return '<?xml version="1.0"?>\n<project xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd" xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n  <modelVersion>4.0.0</modelVersion>\n' + parentBlock(o) + coords(o) +
    '  <properties>\n    <compiler-plugin.version>3.13.0</compiler-plugin.version>\n    <maven.compiler.release>' + o.java + '</maven.compiler.release>\n    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>\n    <quarkus.platform.artifact-id>quarkus-bom</quarkus.platform.artifact-id>\n    <quarkus.platform.group-id>io.quarkus.platform</quarkus.platform.group-id>\n    <quarkus.platform.version>' + QUARKUS + '</quarkus.platform.version>\n    <surefire-plugin.version>3.5.1</surefire-plugin.version>\n  </properties>\n' +
    '  <dependencyManagement>\n    <dependencies>\n      <dependency>\n        <groupId>${quarkus.platform.group-id}</groupId>\n        <artifactId>${quarkus.platform.artifact-id}</artifactId>\n        <version>${quarkus.platform.version}</version>\n        <type>pom</type>\n        <scope>import</scope>\n      </dependency>\n    </dependencies>\n  </dependencyManagement>\n' +
    '  <dependencies>\n    <dependency>\n      <groupId>io.quarkus</groupId>\n      <artifactId>quarkus-rest</artifactId>\n    </dependency>\n    <dependency>\n      <groupId>io.quarkus</groupId>\n      <artifactId>quarkus-smallrye-health</artifactId>\n    </dependency>\n    <dependency>\n      <groupId>io.quarkus</groupId>\n      <artifactId>quarkus-junit5</artifactId>\n      <scope>test</scope>\n    </dependency>\n    <dependency>\n      <groupId>io.rest-assured</groupId>\n      <artifactId>rest-assured</artifactId>\n      <scope>test</scope>\n    </dependency>\n  </dependencies>\n' +
    '  <build>\n    <plugins>\n      <plugin>\n        <groupId>${quarkus.platform.group-id}</groupId>\n        <artifactId>quarkus-maven-plugin</artifactId>\n        <version>${quarkus.platform.version}</version>\n        <extensions>true</extensions>\n        <executions>\n          <execution>\n            <goals>\n              <goal>build</goal>\n              <goal>generate-code</goal>\n              <goal>generate-code-tests</goal>\n            </goals>\n          </execution>\n        </executions>\n      </plugin>\n      <plugin>\n        <artifactId>maven-compiler-plugin</artifactId>\n        <version>${compiler-plugin.version}</version>\n        <configuration>\n          <parameters>true</parameters>\n        </configuration>\n      </plugin>\n      <plugin>\n        <artifactId>maven-surefire-plugin</artifactId>\n        <version>${surefire-plugin.version}</version>\n        <configuration>\n          <systemPropertyVariables>\n            <java.util.logging.manager>org.jboss.logmanager.LogManager</java.util.logging.manager>\n          </systemPropertyVariables>\n        </configuration>\n      </plugin>\n    </plugins>\n  </build>\n</project>\n';
}

function pomWar(o) {
  return HEAD + parentBlock(o) + coords(o, 'war') +
    '  <properties>\n    <maven.compiler.release>' + o.java + '</maven.compiler.release>\n    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>\n  </properties>\n' +
    '  <dependencies>\n    <dependency>\n      <groupId>jakarta.servlet</groupId>\n      <artifactId>jakarta.servlet-api</artifactId>\n      <version>6.0.0</version>\n      <scope>provided</scope>\n    </dependency>\n  </dependencies>\n' +
    '  <build>\n    <finalName>' + o.artifactId + '</finalName>\n    <plugins>\n      <plugin>\n        <groupId>org.apache.maven.plugins</groupId>\n        <artifactId>maven-war-plugin</artifactId>\n        <version>3.4.0</version>\n        <configuration>\n          <failOnMissingWebXml>false</failOnMissingWebXml>\n        </configuration>\n      </plugin>\n    </plugins>\n  </build>\n</project>\n';
}

/* ------------------------------------------------------------------ sources */

const info = (pkg, text) => `/**\n * ${text}\n */\npackage ${pkg};\n`;

function layerInfos(o, layers) {
  if (!o.layers) return {};
  const out = {};
  for (const [sub, text] of layers) out[`src/main/java/${dir(o.pkg)}/${sub}/package-info.java`] = info(`${o.pkg}.${sub}`, text);
  return out;
}

function springSources(o) {
  const p = o.pkg;
  const d = `src/main/java/${dir(p)}`;
  const t = `src/test/java/${dir(p)}`;
  const f = {};
  f[`${d}/Application.java`] = `package ${p};\n\nimport org.springframework.boot.SpringApplication;\nimport org.springframework.boot.autoconfigure.SpringBootApplication;\n\n@SpringBootApplication\npublic class Application {\n    public static void main(String[] args) {\n        SpringApplication.run(Application.class, args);\n    }\n}\n`;
  if (o.layers) {
    f[`${d}/controller/HelloController.java`] = `package ${p}.controller;\n\nimport ${p}.model.Greeting;\nimport ${p}.service.GreetingService;\nimport org.springframework.web.bind.annotation.GetMapping;\nimport org.springframework.web.bind.annotation.RestController;\n\n@RestController\npublic class HelloController {\n    private final GreetingService greetings;\n\n    public HelloController(GreetingService greetings) {\n        this.greetings = greetings;\n    }\n\n    @GetMapping("/")\n    public Greeting hello() {\n        return greetings.greet();\n    }\n}\n`;
    f[`${d}/service/GreetingService.java`] = `package ${p}.service;\n\nimport ${p}.model.Greeting;\nimport org.springframework.stereotype.Service;\n\n@Service\npublic class GreetingService {\n    public Greeting greet() {\n        return new Greeting("Hello from Spring Boot on Nativity Studio");\n    }\n}\n`;
    f[`${d}/model/Greeting.java`] = `package ${p}.model;\n\npublic record Greeting(String message) {\n}\n`;
    Object.assign(f, layerInfos(o, [['repository', 'Data access: Spring Data repositories and database mappings.'], ['config', 'Configuration classes (@Configuration beans, security, properties).'], ['exception', 'Domain exceptions and the global error handler.']]));
    f[`${t}/controller/HelloControllerTest.java`] = `package ${p}.controller;\n\nimport static org.junit.jupiter.api.Assertions.assertEquals;\n\nimport ${p}.service.GreetingService;\nimport org.junit.jupiter.api.Test;\n\nclass HelloControllerTest {\n    @Test\n    void returnsMessage() {\n        assertEquals("Hello from Spring Boot on Nativity Studio", new HelloController(new GreetingService()).hello().message());\n    }\n}\n`;
  } else {
    f[`${d}/HelloController.java`] = `package ${p};\n\nimport java.util.Map;\nimport org.springframework.web.bind.annotation.GetMapping;\nimport org.springframework.web.bind.annotation.RestController;\n\n@RestController\npublic class HelloController {\n    @GetMapping("/")\n    public Map<String, String> hello() {\n        return Map.of("message", "Hello from Spring Boot on Nativity Studio");\n    }\n}\n`;
    f[`${t}/HelloControllerTest.java`] = `package ${p};\n\nimport static org.junit.jupiter.api.Assertions.assertEquals;\n\nimport org.junit.jupiter.api.Test;\n\nclass HelloControllerTest {\n    @Test\n    void returnsMessage() {\n        assertEquals("Hello from Spring Boot on Nativity Studio", new HelloController().hello().get("message"));\n    }\n}\n`;
  }
  return f;
}

function quarkusSources(o) {
  const p = o.pkg;
  const d = `src/main/java/${dir(p)}`;
  const t = `src/test/java/${dir(p)}`;
  const f = {};
  if (o.layers) {
    f[`${d}/resource/GreetingResource.java`] = `package ${p}.resource;\n\nimport ${p}.service.GreetingService;\nimport jakarta.inject.Inject;\nimport jakarta.ws.rs.GET;\nimport jakarta.ws.rs.Path;\nimport jakarta.ws.rs.Produces;\nimport jakarta.ws.rs.core.MediaType;\n\n@Path("/")\npublic class GreetingResource {\n    @Inject\n    GreetingService greetings;\n\n    @GET\n    @Produces(MediaType.TEXT_PLAIN)\n    public String hello() {\n        return greetings.greet();\n    }\n}\n`;
    f[`${d}/service/GreetingService.java`] = `package ${p}.service;\n\nimport jakarta.enterprise.context.ApplicationScoped;\n\n@ApplicationScoped\npublic class GreetingService {\n    public String greet() {\n        return "Hello from Quarkus on Nativity Studio";\n    }\n}\n`;
    Object.assign(f, layerInfos(o, [['model', 'Domain types.'], ['repository', 'Data access (Panache repositories).'], ['config', 'Configuration mappings (@ConfigMapping).']]));
    f[`${t}/resource/GreetingResourceTest.java`] = `package ${p}.resource;\n\nimport static io.restassured.RestAssured.given;\nimport static org.hamcrest.CoreMatchers.containsString;\n\nimport io.quarkus.test.junit.QuarkusTest;\nimport org.junit.jupiter.api.Test;\n\n@QuarkusTest\nclass GreetingResourceTest {\n    @Test\n    void helloEndpoint() {\n        given().when().get("/").then().statusCode(200).body(containsString("Quarkus"));\n    }\n}\n`;
  } else {
    f[`${d}/GreetingResource.java`] = `package ${p};\n\nimport jakarta.ws.rs.GET;\nimport jakarta.ws.rs.Path;\nimport jakarta.ws.rs.Produces;\nimport jakarta.ws.rs.core.MediaType;\n\n@Path("/")\npublic class GreetingResource {\n    @GET\n    @Produces(MediaType.TEXT_PLAIN)\n    public String hello() {\n        return "Hello from Quarkus on Nativity Studio";\n    }\n}\n`;
    f[`${t}/GreetingResourceTest.java`] = `package ${p};\n\nimport static io.restassured.RestAssured.given;\nimport static org.hamcrest.CoreMatchers.containsString;\n\nimport io.quarkus.test.junit.QuarkusTest;\nimport org.junit.jupiter.api.Test;\n\n@QuarkusTest\nclass GreetingResourceTest {\n    @Test\n    void helloEndpoint() {\n        given().when().get("/").then().statusCode(200).body(containsString("Quarkus"));\n    }\n}\n`;
  }
  return f;
}

function plainSources(o) {
  const p = o.pkg;
  const f = {};
  f[`src/main/java/${dir(p)}/App.java`] = `package ${p};\n\npublic class App {\n    public static String greeting() {\n        return "Hello from Nativity Studio";\n    }\n\n    public static void main(String[] args) {\n        System.out.println(greeting());\n    }\n}\n`;
  f[`src/test/java/${dir(p)}/AppTest.java`] = `package ${p};\n\nimport static org.junit.jupiter.api.Assertions.assertTrue;\n\nimport org.junit.jupiter.api.Test;\n\nclass AppTest {\n    @Test\n    void greets() {\n        assertTrue(App.greeting().startsWith("Hello"));\n    }\n}\n`;
  Object.assign(f, layerInfos(o, [['model', 'Domain types.'], ['service', 'Business logic.']]));
  return f;
}

function warSources(o) {
  const p = o.pkg;
  const f = {};
  f[`src/main/java/${dir(p)}/web/HelloServlet.java`] = `package ${p}.web;\n\nimport jakarta.servlet.annotation.WebServlet;\nimport jakarta.servlet.http.HttpServlet;\nimport jakarta.servlet.http.HttpServletRequest;\nimport jakarta.servlet.http.HttpServletResponse;\nimport java.io.IOException;\n\n@WebServlet("/hello")\npublic class HelloServlet extends HttpServlet {\n    @Override\n    protected void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException {\n        resp.setContentType("text/plain");\n        resp.getWriter().println("Hello from a servlet on Tomcat");\n    }\n}\n`;
  Object.assign(f, layerInfos(o, [['service', 'Business logic.'], ['model', 'Domain types.']]));
  return f;
}

/** { 'path': 'content' } for a Java template with the user's coordinates. */
function generate(kind, name, input) {
  const o = normalize(name, input, kind);
  const pom = { 'spring-boot': pomSpring, quarkus: pomQuarkus, 'java-maven': pomPlain, 'java-war-tomcat': pomWar }[kind](o);
  const src = { 'spring-boot': springSources, quarkus: quarkusSources, 'java-maven': plainSources, 'java-war-tomcat': warSources }[kind](o);
  return { o, files: { 'pom.xml': pom, ...src } };
}

module.exports = { generate, normalize, defaultPackage, SPRING_BOOT, QUARKUS };
