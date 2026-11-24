/** New Project templates. Each returns { 'relative/path': 'content' } for a given project name. */

const GITIGNORE = 'node_modules/\n.env\n.env.*\n*.log\ndist/\n__pycache__/\n.venv/\n.aws-sam/\nlocal.settings.json\n';
const slug = (n) => String(n).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '') || 'app';
const json = (o) => `${JSON.stringify(o, null, 2)}\n`;

const readme = (name, body) => `# ${name}\n\n${body}\n\nCreated with Nativity Studio. Right-click the project > **Enable Cloud Native Development** to connect it to a cloud.\n`;

exports.activate = (ctx) => {
  require('./more').register(ctx);

  // Node and Python take a package name from the dialog (form: 'node' / 'python') and start with a real folder layout.
  ctx.templates.register({
    id: 'node-container', name: 'Node.js web service (container)', language: 'JavaScript', cloud: 'any', form: 'node',
    description: 'Express service with routes, services, /healthz and a Dockerfile. Runs on Cloud Run, ECS/App Runner, Azure Container Apps or Kubernetes.',
    files: (name, opts) => {
      const pkg = String((opts && opts.packageName) || slug(name)).trim();
      if (!/^(@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/.test(pkg)) throw new Error('Package name: lower-case letters, digits, "-", "." or "_", optionally with a scope like @acme/orders.');
      return {
        'package.json': json({ name: pkg, version: '1.0.0', private: true, main: 'src/server.js', scripts: { start: 'node src/server.js', dev: 'node --watch src/server.js' }, engines: { node: '>=20' }, dependencies: { express: '^4.19.2' } }),
        'src/server.js': "const express = require('express');\nconst health = require('./routes/health');\nconst hello = require('./routes/hello');\n\nconst app = express();\napp.use('/healthz', health);\napp.use('/', hello);\n\nconst port = process.env.PORT || 8080;\napp.listen(port, () => console.log(`listening on ${port}`));\n",
        'src/routes/health.js': "const { Router } = require('express');\n\nconst router = Router();\nrouter.get('/', (_req, res) => res.json({ status: 'ok' }));\n\nmodule.exports = router;\n",
        'src/routes/hello.js': "const { Router } = require('express');\nconst { greet } = require('../services/greeting');\n\nconst router = Router();\nrouter.get('/', (_req, res) => res.send(greet()));\n\nmodule.exports = router;\n",
        'src/services/greeting.js': "function greet() {\n  return 'Hello from Nativity Studio';\n}\n\nmodule.exports = { greet };\n",
        Dockerfile: 'FROM node:22-slim\nWORKDIR /app\nCOPY package*.json ./\nRUN npm install --omit=dev\nCOPY . .\nENV PORT=8080\nEXPOSE 8080\nUSER node\nCMD ["node", "src/server.js"]\n',
        '.dockerignore': 'node_modules\n.git\n.env\n',
        '.gitignore': GITIGNORE,
        'README.md': readme(name, `Node.js (Express) service \`${pkg}\`.\n\n\`\`\`\nnpm install\nnpm start\n\`\`\``),
      };
    },
  });

  ctx.templates.register({
    id: 'python-container', name: 'Python FastAPI service (container)', language: 'Python', cloud: 'any', form: 'python',
    description: 'FastAPI app in its own Python package with routes, services, a test, /healthz and a Dockerfile.',
    files: (name, opts) => {
      const pkg = String((opts && opts.pythonPackage) || String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')).trim();
      if (!/^[a-z_][a-z0-9_]*$/.test(pkg) || ['test', 'tests', 'app', 'main', 'src'].includes(pkg)) throw new Error('Python package: lower-case letters, digits and "_", starting with a letter, and not test, tests, app, main or src.');
      return {
        'requirements.txt': 'fastapi>=0.110\nuvicorn[standard]>=0.29\n',
        'requirements-dev.txt': '-r requirements.txt\npytest>=8\nhttpx>=0.27\n',
        [`${pkg}/__init__.py`]: '',
        [`${pkg}/main.py`]: `from fastapi import FastAPI\n\nfrom ${pkg}.api.routes import router\n\napp = FastAPI(title="${pkg}")\napp.include_router(router)\n`,
        [`${pkg}/api/__init__.py`]: '',
        [`${pkg}/api/routes.py`]: `from fastapi import APIRouter\n\nfrom ${pkg}.services.greeting import greet\n\nrouter = APIRouter()\n\n\n@router.get("/healthz")\ndef healthz():\n    return {"status": "ok"}\n\n\n@router.get("/")\ndef index():\n    return {"message": greet()}\n`,
        [`${pkg}/services/__init__.py`]: '',
        [`${pkg}/services/greeting.py`]: 'def greet() -> str:\n    return "Hello from Nativity Studio"\n',
        'tests/test_health.py': `from fastapi.testclient import TestClient\n\nfrom ${pkg}.main import app\n\n\ndef test_healthz():\n    assert TestClient(app).get("/healthz").json() == {"status": "ok"}\n`,
        Dockerfile: `FROM python:3.12-slim\nWORKDIR /app\nCOPY requirements.txt .\nRUN pip install --no-cache-dir -r requirements.txt\nCOPY ${pkg} ./${pkg}\nENV PORT=8080\nEXPOSE 8080\nRUN useradd -m app\nUSER app\nCMD ["sh", "-c", "uvicorn ${pkg}.main:app --host 0.0.0.0 --port $PORT"]\n`,
        '.dockerignore': '.venv\n__pycache__\n.git\n.env\ntests\n',
        '.gitignore': GITIGNORE,
        'README.md': readme(name, `FastAPI service, package \`${pkg}\`.\n\n\`\`\`\npip install -r requirements-dev.txt\nuvicorn ${pkg}.main:app --reload\npytest\n\`\`\``),
      };
    },
  });

  ctx.templates.register({
    id: 'aws-lambda-sam', name: 'AWS Lambda (SAM, Node.js)', language: 'JavaScript', cloud: 'aws',
    description: 'Serverless function with an API Gateway endpoint, deployable with `sam deploy`.',
    files: (name) => ({
      'template.yaml': [
        'AWSTemplateFormatVersion: "2010-09-09"', 'Transform: AWS::Serverless-2016-10-31', `Description: ${slug(name)}`,
        'Resources:', '  HelloFunction:', '    Type: AWS::Serverless::Function', '    Properties:', '      Handler: src/handler.handler', '      Runtime: nodejs20.x', '      Timeout: 10',
        '      Events:', '        Api:', '          Type: Api', '          Properties:', '            Path: /hello', '            Method: get',
        'Outputs:', '  ApiUrl:', '    Value: !Sub "https://${ServerlessRestApi}.execute-api.${AWS::Region}.amazonaws.com/Prod/hello"', '',
      ].join('\n'),
      'src/handler.js': "exports.handler = async () => ({\n  statusCode: 200,\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify({ message: 'Hello from AWS Lambda' }),\n});\n",
      'package.json': json({ name: slug(name), version: '1.0.0', private: true }),
      '.gitignore': GITIGNORE,
      'README.md': readme(name, 'AWS SAM application.\n\n```\nsam build\nsam deploy --guided\n```'),
    }),
  });

  ctx.templates.register({
    id: 'azure-functions-node', name: 'Azure Functions (Node.js)', language: 'JavaScript', cloud: 'azure',
    description: 'HTTP-triggered Azure Function (programming model v4).',
    files: (name) => ({
      'host.json': json({ version: '2.0', extensionBundle: { id: 'Microsoft.Azure.Functions.ExtensionBundle', version: '[4.*, 5.0.0)' } }),
      'package.json': json({ name: slug(name), version: '1.0.0', main: 'src/functions/*.js', dependencies: { '@azure/functions': '^4.0.0' } }),
      'src/functions/hello.js': "const { app } = require('@azure/functions');\n\napp.http('hello', {\n  methods: ['GET'],\n  authLevel: 'function',\n  handler: async () => ({ jsonBody: { message: 'Hello from Azure Functions' } }),\n});\n",
      'local.settings.json': json({ IsEncrypted: false, Values: { FUNCTIONS_WORKER_RUNTIME: 'node', AzureWebJobsStorage: 'UseDevelopmentStorage=true' } }),
      '.gitignore': GITIGNORE,
      'README.md': readme(name, 'Azure Functions app.\n\n```\nnpm install\nfunc start\n```'),
    }),
  });

  ctx.templates.register({
    id: 'static-site', name: 'Static website (nginx container)', language: 'HTML', cloud: 'any',
    description: 'A static site served by nginx. Good first migration target.',
    files: (name) => ({
      'index.html': `<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><title>${slug(name)}</title></head>\n<body><h1>${slug(name)}</h1><p>Hello from Nativity Studio.</p></body>\n</html>\n`,
      Dockerfile: 'FROM nginx:alpine\nCOPY index.html /usr/share/nginx/html/index.html\nEXPOSE 80\n',
      '.gitignore': GITIGNORE,
      'README.md': readme(name, 'Static site.'),
    }),
  });

  ctx.templates.register({
    id: 'empty', name: 'Empty project', language: '', cloud: 'any',
    description: 'Just a README. Bring your own code, then assess it under Modernize.',
    files: (name) => ({ 'README.md': readme(name, 'Empty project.'), '.gitignore': GITIGNORE }),
  });
};
