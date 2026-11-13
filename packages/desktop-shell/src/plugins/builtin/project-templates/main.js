/** New Project templates. Each returns { 'relative/path': 'content' } for a given project name. */

const GITIGNORE = 'node_modules/\n.env\n.env.*\n*.log\ndist/\n__pycache__/\n.venv/\n.aws-sam/\nlocal.settings.json\n';
const slug = (n) => String(n).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '') || 'app';
const json = (o) => `${JSON.stringify(o, null, 2)}\n`;

const readme = (name, body) => `# ${name}\n\n${body}\n\nCreated with Nativity Studio. Right-click the project > **Enable Cloud Native Development** to connect it to a cloud.\n`;

exports.activate = (ctx) => {
  require('./more').register(ctx);

  ctx.templates.register({
    id: 'node-container', name: 'Node.js web service (container)', language: 'JavaScript', cloud: 'any',
    description: 'Express service with /healthz and a Dockerfile. Runs on Cloud Run, ECS/App Runner, Azure Container Apps or Kubernetes.',
    files: (name) => ({
      'package.json': json({ name: slug(name), version: '1.0.0', main: 'server.js', scripts: { start: 'node server.js' }, dependencies: { express: '^4.19.2' } }),
      'server.js': "const express = require('express');\nconst app = express();\n\napp.get('/healthz', (_req, res) => res.json({ status: 'ok' }));\napp.get('/', (_req, res) => res.send('Hello from Nativity Studio'));\n\nconst port = process.env.PORT || 8080;\napp.listen(port, () => console.log(`listening on ${port}`));\n",
      Dockerfile: 'FROM node:22-slim\nWORKDIR /app\nCOPY package*.json ./\nRUN npm install --omit=dev\nCOPY . .\nENV PORT=8080\nEXPOSE 8080\nUSER node\nCMD ["node", "server.js"]\n',
      '.dockerignore': 'node_modules\n.git\n.env\n',
      '.gitignore': GITIGNORE,
      'README.md': readme(name, 'Node.js (Express) service.\n\n```\nnpm install\nnpm start\n```'),
    }),
  });

  ctx.templates.register({
    id: 'python-container', name: 'Python FastAPI service (container)', language: 'Python', cloud: 'any',
    description: 'FastAPI app with /healthz and a Dockerfile.',
    files: (name) => ({
      'requirements.txt': 'fastapi>=0.110\nuvicorn[standard]>=0.29\n',
      'main.py': "from fastapi import FastAPI\n\napp = FastAPI()\n\n\n@app.get('/healthz')\ndef healthz():\n    return {'status': 'ok'}\n\n\n@app.get('/')\ndef index():\n    return {'message': 'Hello from Nativity Studio'}\n",
      Dockerfile: 'FROM python:3.12-slim\nWORKDIR /app\nCOPY requirements.txt .\nRUN pip install --no-cache-dir -r requirements.txt\nCOPY . .\nENV PORT=8080\nEXPOSE 8080\nRUN useradd -m app\nUSER app\nCMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]\n',
      '.dockerignore': '.venv\n__pycache__\n.git\n.env\n',
      '.gitignore': GITIGNORE,
      'README.md': readme(name, 'FastAPI service.\n\n```\npip install -r requirements.txt\nuvicorn main:app --reload\n```'),
    }),
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
