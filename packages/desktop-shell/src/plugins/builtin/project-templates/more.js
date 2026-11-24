/** More New Project templates: Java, Spring Boot, Quarkus, Tomcat WAR, React, Vue, Angular, Go, .NET. */

const slug = (n) => String(n).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '') || 'app';
const json = (o) => `${JSON.stringify(o, null, 2)}\n`;
const readme = (name, body) => `# ${name}\n\n${body}\n\nCreated with Nativity Studio. Use the Run menu (Build, Run, Debug), or right-click the project > **Enable Cloud Native Development** to connect it to a cloud.\n`;
const GI_JAVA = 'target/\nbuild/\n.gradle/\n*.class\n*.log\n.idea/\n*.iml\n.env\n';
const GI_NODE = 'node_modules/\ndist/\n.env\n.env.*\n*.log\n.angular/\n';

const JAVA_VER = '17';

const container = (jar, ver) => `FROM eclipse-temurin:${ver || JAVA_VER}-jre\nWORKDIR /app\nCOPY target/${jar} app.jar\nENV PORT=8080\nEXPOSE 8080\nUSER 1000\nENTRYPOINT ["sh","-c","java -Dserver.port=$PORT -jar app.jar"]\n`;

exports.register = (ctx) => {
  // The Java templates take Maven coordinates, a base package and an optional parent POM from the New Project dialog (form: 'maven').
  // Nothing is assumed: there is no default group id.
  const jv = require('./javagen');

  ctx.templates.register({
    id: 'java-maven', name: 'Java application (Maven)', language: 'Java', cloud: 'any', form: 'maven',
    description: 'Plain Java console application built with Maven and JUnit 5, with your base package.',
    files: (name, opts) => {
      const { o, files } = jv.generate('java-maven', name, opts);
      return {
        ...files,
        '.gitignore': GI_JAVA,
        'README.md': readme(name, `Java (Maven). Base package \`${o.pkg}\`.\n\n\`\`\`\nmvn package\njava -cp target/classes ${o.pkg}.App\n\`\`\``),
      };
    },
  });

  ctx.templates.register({
    id: 'spring-boot', name: 'Spring Boot REST service', language: 'Java', cloud: 'any', form: 'maven',
    description: 'Spring Boot 3 web service with Actuator health, layered packages (controller, service, model, repository, config), a test and a Dockerfile. Runs on Cloud Run, ECS, Container Apps or Kubernetes.',
    files: (name, opts) => {
      const { o, files } = jv.generate('spring-boot', name, opts);
      return {
        ...files,
        'src/main/resources/application.properties': 'server.port=${PORT:8080}\nmanagement.endpoints.web.exposure.include=health,info\nmanagement.endpoint.health.probes.enabled=true\n',
        Dockerfile: container('app.jar', o.java),
        '.dockerignore': 'target\n.git\n.env\n',
        '.gitignore': GI_JAVA,
        'README.md': readme(name, `Spring Boot ${jv.SPRING_BOOT} (Java ${o.java}). Base package \`${o.pkg}\`.\n\n\`\`\`\nmvn spring-boot:run\n\`\`\`\n\nHealth: http://localhost:8080/actuator/health`),
      };
    },
  });

  ctx.templates.register({
    id: 'quarkus', name: 'Quarkus REST service', language: 'Java', cloud: 'any', form: 'maven',
    description: 'Quarkus 3 REST service with dev mode (live reload), layered packages, a test and a Dockerfile.',
    files: (name, opts) => {
      const { o, files } = jv.generate('quarkus', name, opts);
      return {
        ...files,
        'src/main/resources/application.properties': 'quarkus.http.port=${PORT:8080}\nquarkus.http.host=0.0.0.0\n',
        Dockerfile: `FROM eclipse-temurin:${o.java}-jre\nWORKDIR /app\nCOPY target/quarkus-app/ ./\nENV PORT=8080\nEXPOSE 8080\nUSER 1000\nCMD ["java","-jar","quarkus-run.jar"]\n`,
        '.dockerignore': '.git\n.env\n',
        '.gitignore': GI_JAVA,
        'README.md': readme(name, `Quarkus ${jv.QUARKUS} (Java ${o.java}). Base package \`${o.pkg}\`.\n\n\`\`\`\nmvn quarkus:dev\n\`\`\`\n\nDev mode reloads on save. Health: http://localhost:8080/q/health`),
      };
    },
  });

  ctx.templates.register({
    id: 'java-war-tomcat', name: 'Java web app (WAR for Tomcat)', language: 'Java', cloud: 'any', form: 'maven',
    description: 'Jakarta Servlet application packaged as a WAR for Apache Tomcat 10.1+. Use Run > Servers to start Tomcat and deploy.',
    files: (name, opts) => {
      const { o, files } = jv.generate('java-war-tomcat', name, opts);
      const a = o.artifactId;
      return {
        ...files,
        'src/main/webapp/index.html': `<!doctype html>\n<html><head><meta charset="utf-8"><title>${a}</title></head>\n<body><h1>${a}</h1><p><a href="hello">/hello</a></p></body></html>\n`,
        '.gitignore': GI_JAVA,
        'README.md': readme(name, `Servlet WAR for Tomcat 10.1+ (Jakarta namespace). Base package \`${o.pkg}\`.\n\nRun > Servers > "Package and deploy to Tomcat", then open http://localhost:8080/${a}/`),
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
    id: 'dotnet-webapi', name: '.NET Web API', language: 'C#', cloud: 'any', form: 'dotnet',
    description: 'Created by `dotnet new webapi` with your root namespace (needs the .NET SDK).',
    scaffold: (name, opts) => {
      const ns = String((opts && opts.namespace) || '').trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(ns)) throw new Error('Root namespace looks like Acme.Orders (letters, digits and "_", separated by dots).');
      return `dotnet new webapi -n ${ns} -o ${name}`;
    },
    files: (name) => ({ 'README.md': readme(name, '.NET Web API.') }),
  });

  ctx.templates.register({
    id: 'go-service', name: 'Go web service (container)', language: 'Go', cloud: 'any', form: 'go',
    description: 'Go net/http service with your module path, internal packages, /healthz and a multi-stage Dockerfile.',
    files: (name, opts) => {
      const mod = String((opts && opts.modulePath) || '').trim();
      if (!mod) throw new Error('Enter the Go module path (for example github.com/acme/orders). There is no default.');
      if (!/^[a-z0-9][a-z0-9.-]*(\/[A-Za-z0-9._~-]+)*$/.test(mod)) throw new Error(`Module path "${mod}" should look like github.com/acme/orders.`);
      return {
        'go.mod': `module ${mod}\n\ngo 1.22\n`,
        'cmd/server/main.go': `package main\n\nimport (\n\t"log"\n\t"net/http"\n\t"os"\n\n\t"${mod}/internal/handler"\n)\n\nfunc main() {\n\tport := os.Getenv("PORT")\n\tif port == "" {\n\t\tport = "8080"\n\t}\n\tlog.Printf("listening on %s", port)\n\tlog.Fatal(http.ListenAndServe(":"+port, handler.New()))\n}\n`,
        'internal/handler/handler.go': `package handler\n\nimport (\n\t"fmt"\n\t"net/http"\n\n\t"${mod}/internal/service"\n)\n\n// New returns the HTTP routes of the service.\nfunc New() http.Handler {\n\tmux := http.NewServeMux()\n\tmux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {\n\t\tfmt.Fprint(w, \`{"status":"ok"}\`)\n\t})\n\tmux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {\n\t\tfmt.Fprint(w, service.Greet())\n\t})\n\treturn mux\n}\n`,
        'internal/service/greeting.go': 'package service\n\n// Greet is the business logic behind the root route.\nfunc Greet() string {\n\treturn "Hello from Nativity Studio"\n}\n',
        Dockerfile: 'FROM golang:1.22 AS build\nWORKDIR /src\nCOPY . .\nRUN CGO_ENABLED=0 go build -o /app ./cmd/server\n\nFROM gcr.io/distroless/static\nCOPY --from=build /app /app\nENV PORT=8080\nEXPOSE 8080\nUSER 65532\nENTRYPOINT ["/app"]\n',
        '.gitignore': '*.exe\n.env\n',
        'README.md': readme(name, `Go module \`${mod}\`.\n\n\`\`\`\ngo run ./cmd/server\n\`\`\``),
      };
    },
  });
};
