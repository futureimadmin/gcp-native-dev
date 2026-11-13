/** More New Project templates: Java, Spring Boot, Quarkus, Tomcat WAR, React, Vue, Angular, Go, .NET. */

const slug = (n) => String(n).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '') || 'app';
const json = (o) => `${JSON.stringify(o, null, 2)}\n`;
const readme = (name, body) => `# ${name}\n\n${body}\n\nCreated with Nativity Studio. Use the Run menu (Build, Run, Debug), or right-click the project > **Enable Cloud Native Development** to connect it to a cloud.\n`;
const GI_JAVA = 'target/\nbuild/\n.gradle/\n*.class\n*.log\n.idea/\n*.iml\n.env\n';
const GI_NODE = 'node_modules/\ndist/\n.env\n.env.*\n*.log\n.angular/\n';

const JAVA_VER = '17';

const container = (jar) => `FROM eclipse-temurin:${JAVA_VER}-jre\nWORKDIR /app\nCOPY target/${jar} app.jar\nENV PORT=8080\nEXPOSE 8080\nUSER 1000\nENTRYPOINT ["sh","-c","java -Dserver.port=$PORT -jar app.jar"]\n`;

exports.register = (ctx) => {
  ctx.templates.register({
    id: 'java-maven', name: 'Java application (Maven)', language: 'Java', cloud: 'any',
    description: 'Plain Java console application built with Maven and JUnit 5.',
    files: (name) => {
      const a = slug(name);
      return {
        'pom.xml': `<?xml version="1.0" encoding="UTF-8"?>\n<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">\n  <modelVersion>4.0.0</modelVersion>\n  <groupId>com.example</groupId>\n  <artifactId>${a}</artifactId>\n  <version>1.0.0</version>\n  <properties>\n    <maven.compiler.release>${JAVA_VER}</maven.compiler.release>\n    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>\n  </properties>\n  <dependencies>\n    <dependency>\n      <groupId>org.junit.jupiter</groupId>\n      <artifactId>junit-jupiter</artifactId>\n      <version>5.11.3</version>\n      <scope>test</scope>\n    </dependency>\n  </dependencies>\n  <build>\n    <plugins>\n      <plugin>\n        <groupId>org.apache.maven.plugins</groupId>\n        <artifactId>maven-surefire-plugin</artifactId>\n        <version>3.5.1</version>\n      </plugin>\n    </plugins>\n  </build>\n</project>\n`,
        'src/main/java/com/example/App.java': 'package com.example;\n\npublic class App {\n    public static String greeting() {\n        return "Hello from Nativity Studio";\n    }\n\n    public static void main(String[] args) {\n        System.out.println(greeting());\n    }\n}\n',
        'src/test/java/com/example/AppTest.java': 'package com.example;\n\nimport static org.junit.jupiter.api.Assertions.assertTrue;\n\nimport org.junit.jupiter.api.Test;\n\nclass AppTest {\n    @Test\n    void greets() {\n        assertTrue(App.greeting().startsWith("Hello"));\n    }\n}\n',
        '.gitignore': GI_JAVA,
        'README.md': readme(name, 'Java (Maven).\n\n```\nmvn package\njava -cp target/classes com.example.App\n```'),
      };
    },
  });

  ctx.templates.register({
    id: 'spring-boot', name: 'Spring Boot REST service', language: 'Java', cloud: 'any',
    description: 'Spring Boot 3 web service with Actuator health, a sample controller, a test and a Dockerfile. Runs on Cloud Run, ECS, Container Apps or Kubernetes.',
    files: (name) => {
      const a = slug(name);
      return {
        'pom.xml': `<?xml version="1.0" encoding="UTF-8"?>\n<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">\n  <modelVersion>4.0.0</modelVersion>\n  <parent>\n    <groupId>org.springframework.boot</groupId>\n    <artifactId>spring-boot-starter-parent</artifactId>\n    <version>3.3.5</version>\n    <relativePath/>\n  </parent>\n  <groupId>com.example</groupId>\n  <artifactId>${a}</artifactId>\n  <version>1.0.0</version>\n  <properties>\n    <java.version>${JAVA_VER}</java.version>\n  </properties>\n  <dependencies>\n    <dependency>\n      <groupId>org.springframework.boot</groupId>\n      <artifactId>spring-boot-starter-web</artifactId>\n    </dependency>\n    <dependency>\n      <groupId>org.springframework.boot</groupId>\n      <artifactId>spring-boot-starter-actuator</artifactId>\n    </dependency>\n    <dependency>\n      <groupId>org.springframework.boot</groupId>\n      <artifactId>spring-boot-starter-test</artifactId>\n      <scope>test</scope>\n    </dependency>\n  </dependencies>\n  <build>\n    <finalName>app</finalName>\n    <plugins>\n      <plugin>\n        <groupId>org.springframework.boot</groupId>\n        <artifactId>spring-boot-maven-plugin</artifactId>\n      </plugin>\n    </plugins>\n  </build>\n</project>\n`,
        'src/main/java/com/example/Application.java': 'package com.example;\n\nimport org.springframework.boot.SpringApplication;\nimport org.springframework.boot.autoconfigure.SpringBootApplication;\n\n@SpringBootApplication\npublic class Application {\n    public static void main(String[] args) {\n        SpringApplication.run(Application.class, args);\n    }\n}\n',
        'src/main/java/com/example/HelloController.java': 'package com.example;\n\nimport java.util.Map;\nimport org.springframework.web.bind.annotation.GetMapping;\nimport org.springframework.web.bind.annotation.RestController;\n\n@RestController\npublic class HelloController {\n    @GetMapping("/")\n    public Map<String, String> hello() {\n        return Map.of("message", "Hello from Spring Boot on Nativity Studio");\n    }\n}\n',
        'src/main/resources/application.properties': 'server.port=${PORT:8080}\nmanagement.endpoints.web.exposure.include=health,info\nmanagement.endpoint.health.probes.enabled=true\n',
        'src/test/java/com/example/HelloControllerTest.java': 'package com.example;\n\nimport static org.junit.jupiter.api.Assertions.assertEquals;\n\nimport org.junit.jupiter.api.Test;\n\nclass HelloControllerTest {\n    @Test\n    void returnsMessage() {\n        assertEquals("Hello from Spring Boot on Nativity Studio", new HelloController().hello().get("message"));\n    }\n}\n',
        Dockerfile: container('app.jar'),
        '.dockerignore': 'target\n.git\n.env\n',
        '.gitignore': GI_JAVA,
        'README.md': readme(name, 'Spring Boot 3 (Java 17+).\n\n```\nmvn spring-boot:run\n```\n\nHealth: http://localhost:8080/actuator/health'),
      };
    },
  });

  ctx.templates.register({
    id: 'quarkus', name: 'Quarkus REST service', language: 'Java', cloud: 'any',
    description: 'Quarkus 3 REST service with dev mode (live reload), a test and a Dockerfile.',
    files: (name) => {
      const a = slug(name);
      return {
        'pom.xml': `<?xml version="1.0"?>\n<project xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd" xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n  <modelVersion>4.0.0</modelVersion>\n  <groupId>com.example</groupId>\n  <artifactId>${a}</artifactId>\n  <version>1.0.0</version>\n  <properties>\n    <compiler-plugin.version>3.13.0</compiler-plugin.version>\n    <maven.compiler.release>${JAVA_VER}</maven.compiler.release>\n    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>\n    <quarkus.platform.artifact-id>quarkus-bom</quarkus.platform.artifact-id>\n    <quarkus.platform.group-id>io.quarkus.platform</quarkus.platform.group-id>\n    <quarkus.platform.version>3.15.1</quarkus.platform.version>\n    <surefire-plugin.version>3.5.1</surefire-plugin.version>\n  </properties>\n  <dependencyManagement>\n    <dependencies>\n      <dependency>\n        <groupId>\${quarkus.platform.group-id}</groupId>\n        <artifactId>\${quarkus.platform.artifact-id}</artifactId>\n        <version>\${quarkus.platform.version}</version>\n        <type>pom</type>\n        <scope>import</scope>\n      </dependency>\n    </dependencies>\n  </dependencyManagement>\n  <dependencies>\n    <dependency>\n      <groupId>io.quarkus</groupId>\n      <artifactId>quarkus-rest</artifactId>\n    </dependency>\n    <dependency>\n      <groupId>io.quarkus</groupId>\n      <artifactId>quarkus-smallrye-health</artifactId>\n    </dependency>\n    <dependency>\n      <groupId>io.quarkus</groupId>\n      <artifactId>quarkus-junit5</artifactId>\n      <scope>test</scope>\n    </dependency>\n    <dependency>\n      <groupId>io.rest-assured</groupId>\n      <artifactId>rest-assured</artifactId>\n      <scope>test</scope>\n    </dependency>\n  </dependencies>\n  <build>\n    <plugins>\n      <plugin>\n        <groupId>\${quarkus.platform.group-id}</groupId>\n        <artifactId>quarkus-maven-plugin</artifactId>\n        <version>\${quarkus.platform.version}</version>\n        <extensions>true</extensions>\n        <executions>\n          <execution>\n            <goals>\n              <goal>build</goal>\n              <goal>generate-code</goal>\n              <goal>generate-code-tests</goal>\n            </goals>\n          </execution>\n        </executions>\n      </plugin>\n      <plugin>\n        <artifactId>maven-compiler-plugin</artifactId>\n        <version>\${compiler-plugin.version}</version>\n        <configuration>\n          <parameters>true</parameters>\n        </configuration>\n      </plugin>\n      <plugin>\n        <artifactId>maven-surefire-plugin</artifactId>\n        <version>\${surefire-plugin.version}</version>\n        <configuration>\n          <systemPropertyVariables>\n            <java.util.logging.manager>org.jboss.logmanager.LogManager</java.util.logging.manager>\n          </systemPropertyVariables>\n        </configuration>\n      </plugin>\n    </plugins>\n  </build>\n</project>\n`,
        'src/main/java/com/example/GreetingResource.java': 'package com.example;\n\nimport jakarta.ws.rs.GET;\nimport jakarta.ws.rs.Path;\nimport jakarta.ws.rs.Produces;\nimport jakarta.ws.rs.core.MediaType;\n\n@Path("/")\npublic class GreetingResource {\n    @GET\n    @Produces(MediaType.TEXT_PLAIN)\n    public String hello() {\n        return "Hello from Quarkus on Nativity Studio";\n    }\n}\n',
        'src/main/resources/application.properties': 'quarkus.http.port=${PORT:8080}\nquarkus.http.host=0.0.0.0\n',
        'src/test/java/com/example/GreetingResourceTest.java': 'package com.example;\n\nimport static io.restassured.RestAssured.given;\nimport static org.hamcrest.CoreMatchers.containsString;\n\nimport io.quarkus.test.junit.QuarkusTest;\nimport org.junit.jupiter.api.Test;\n\n@QuarkusTest\nclass GreetingResourceTest {\n    @Test\n    void helloEndpoint() {\n        given().when().get("/").then().statusCode(200).body(containsString("Quarkus"));\n    }\n}\n',
        Dockerfile: `FROM eclipse-temurin:${JAVA_VER}-jre\nWORKDIR /app\nCOPY target/quarkus-app/ ./\nENV PORT=8080\nEXPOSE 8080\nUSER 1000\nCMD ["java","-jar","quarkus-run.jar"]\n`,
        '.dockerignore': '.git\n.env\n',
        '.gitignore': GI_JAVA,
        'README.md': readme(name, 'Quarkus 3 (Java 17+).\n\n```\nmvn quarkus:dev\n```\n\nDev mode reloads on save. Health: http://localhost:8080/q/health'),
      };
    },
  });

  ctx.templates.register({
    id: 'java-war-tomcat', name: 'Java web app (WAR for Tomcat)', language: 'Java', cloud: 'any',
    description: 'Jakarta Servlet application packaged as a WAR for Apache Tomcat 10.1+. Use Run > Servers to start Tomcat and deploy.',
    files: (name) => {
      const a = slug(name);
      return {
        'pom.xml': `<?xml version="1.0" encoding="UTF-8"?>\n<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">\n  <modelVersion>4.0.0</modelVersion>\n  <groupId>com.example</groupId>\n  <artifactId>${a}</artifactId>\n  <version>1.0.0</version>\n  <packaging>war</packaging>\n  <properties>\n    <maven.compiler.release>${JAVA_VER}</maven.compiler.release>\n    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>\n  </properties>\n  <dependencies>\n    <dependency>\n      <groupId>jakarta.servlet</groupId>\n      <artifactId>jakarta.servlet-api</artifactId>\n      <version>6.0.0</version>\n      <scope>provided</scope>\n    </dependency>\n  </dependencies>\n  <build>\n    <finalName>${a}</finalName>\n    <plugins>\n      <plugin>\n        <groupId>org.apache.maven.plugins</groupId>\n        <artifactId>maven-war-plugin</artifactId>\n        <version>3.4.0</version>\n        <configuration>\n          <failOnMissingWebXml>false</failOnMissingWebXml>\n        </configuration>\n      </plugin>\n    </plugins>\n  </build>\n</project>\n`,
        'src/main/java/com/example/HelloServlet.java': 'package com.example;\n\nimport jakarta.servlet.annotation.WebServlet;\nimport jakarta.servlet.http.HttpServlet;\nimport jakarta.servlet.http.HttpServletRequest;\nimport jakarta.servlet.http.HttpServletResponse;\nimport java.io.IOException;\n\n@WebServlet("/hello")\npublic class HelloServlet extends HttpServlet {\n    @Override\n    protected void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException {\n        resp.setContentType("text/plain");\n        resp.getWriter().println("Hello from a servlet on Tomcat");\n    }\n}\n',
        'src/main/webapp/index.html': `<!doctype html>\n<html><head><meta charset="utf-8"><title>${a}</title></head>\n<body><h1>${a}</h1><p><a href="hello">/hello</a></p></body></html>\n`,
        '.gitignore': GI_JAVA,
        'README.md': readme(name, 'Servlet WAR for Tomcat 10.1+ (Jakarta namespace).\n\nRun > Servers > "Package and deploy to Tomcat", then open http://localhost:8080/' + a + '/'),
      };
    },
  });

  ctx.templates.register({
    id: 'react-vite', name: 'React web app (Vite)', language: 'JavaScript', cloud: 'any',
    description: 'React 18 single-page app with Vite (hot reload). Deploy the built site to Cloud Storage/CDN, S3/CloudFront, Static Web Apps, or a container.',
    files: (name) => ({
      'package.json': json({ name: slug(name), private: true, version: '1.0.0', type: 'module', scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' }, dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' }, devDependencies: { '@vitejs/plugin-react': '^4.3.3', vite: '^5.4.10' } }),
      'vite.config.js': "import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\n\nexport default defineConfig({ plugins: [react()] });\n",
      'index.html': `<!doctype html>\n<html lang="en">\n  <head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>${slug(name)}</title></head>\n  <body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body>\n</html>\n`,
      'src/main.jsx': "import React from 'react';\nimport { createRoot } from 'react-dom/client';\nimport App from './App.jsx';\n\ncreateRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);\n",
      'src/App.jsx': "import { useState } from 'react';\n\nexport default function App() {\n  const [count, setCount] = useState(0);\n  return (\n    <main style={{ fontFamily: 'sans-serif', padding: 24 }}>\n      <h1>Hello from React</h1>\n      <button onClick={() => setCount(count + 1)}>Clicked {count} times</button>\n    </main>\n  );\n}\n",
      '.gitignore': GI_NODE,
      'README.md': readme(name, 'React + Vite.\n\n```\nnpm install\nnpm run dev\n```'),
    }),
  });

  ctx.templates.register({
    id: 'vue-vite', name: 'Vue web app (Vite)', language: 'JavaScript', cloud: 'any',
    description: 'Vue 3 single-page app with Vite.',
    files: (name) => ({
      'package.json': json({ name: slug(name), private: true, version: '1.0.0', type: 'module', scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' }, dependencies: { vue: '^3.5.12' }, devDependencies: { '@vitejs/plugin-vue': '^5.1.4', vite: '^5.4.10' } }),
      'vite.config.js': "import { defineConfig } from 'vite';\nimport vue from '@vitejs/plugin-vue';\n\nexport default defineConfig({ plugins: [vue()] });\n",
      'index.html': `<!doctype html>\n<html lang="en">\n  <head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>${slug(name)}</title></head>\n  <body><div id="app"></div><script type="module" src="/src/main.js"></script></body>\n</html>\n`,
      'src/main.js': "import { createApp } from 'vue';\nimport App from './App.vue';\n\ncreateApp(App).mount('#app');\n",
      'src/App.vue': '<script setup>\nimport { ref } from \'vue\';\nconst count = ref(0);\n</script>\n\n<template>\n  <main style="font-family: sans-serif; padding: 24px">\n    <h1>Hello from Vue</h1>\n    <button @click="count++">Clicked {{ count }} times</button>\n  </main>\n</template>\n',
      '.gitignore': GI_NODE,
      'README.md': readme(name, 'Vue 3 + Vite.\n\n```\nnpm install\nnpm run dev\n```'),
    }),
  });

  ctx.templates.register({
    id: 'angular', name: 'Angular web app (Angular CLI)', language: 'TypeScript', cloud: 'any',
    description: 'Created by the official Angular CLI (needs internet and Node.js). Generation and dependency install take a minute and run in the terminal panel.',
    scaffold: (name) => `npx --yes @angular/cli@latest new ${name} --defaults --skip-git`,
    files: (name) => ({ 'README.md': readme(name, 'Angular.') }),
  });

  ctx.templates.register({
    id: 'dotnet-webapi', name: '.NET Web API', language: 'C#', cloud: 'any',
    description: 'Created by `dotnet new webapi` (needs the .NET SDK).',
    scaffold: (name) => `dotnet new webapi -n ${name}`,
    files: (name) => ({ 'README.md': readme(name, '.NET Web API.') }),
  });

  ctx.templates.register({
    id: 'go-service', name: 'Go web service (container)', language: 'Go', cloud: 'any',
    description: 'Go net/http service with /healthz and a multi-stage Dockerfile.',
    files: (name) => ({
      'go.mod': `module ${slug(name)}\n\ngo 1.22\n`,
      'main.go': 'package main\n\nimport (\n\t"fmt"\n\t"log"\n\t"net/http"\n\t"os"\n)\n\nfunc main() {\n\tport := os.Getenv("PORT")\n\tif port == "" {\n\t\tport = "8080"\n\t}\n\thttp.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, "ok") })\n\thttp.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, "Hello from Go on Nativity Studio") })\n\tlog.Printf("listening on %s", port)\n\tlog.Fatal(http.ListenAndServe(":"+port, nil))\n}\n',
      Dockerfile: 'FROM golang:1.22 AS build\nWORKDIR /src\nCOPY . .\nRUN CGO_ENABLED=0 go build -o /app .\n\nFROM gcr.io/distroless/static\nCOPY --from=build /app /app\nENV PORT=8080\nEXPOSE 8080\nUSER 65532\nENTRYPOINT ["/app"]\n',
      '.gitignore': '*.exe\n.env\n',
      'README.md': readme(name, 'Go.\n\n```\ngo run .\n```'),
    }),
  });
};
