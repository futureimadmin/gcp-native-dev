/**
 * Modernize & Migrate (main process).
 * assess(): deterministic static scan of the workspace (no code leaves the machine).
 * plan(): maps what was found to each cloud's services and writes a phased, 6R-based migration plan.
 * Extra analyzers can be added by other plugins with ctx.analyzers.register({id, analyze(ws, analysis)}).
 */
const fs = require('fs');
const path = require('path');

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'bin', 'obj', 'target', '.venv', 'venv', '__pycache__', '.idea', '.vscode', 'vendor', '.next', '.terraform', 'coverage', '.aws-sam']);
const LANG = {
  '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.ts': 'TypeScript', '.tsx': 'TypeScript', '.py': 'Python', '.java': 'Java', '.kt': 'Kotlin',
  '.cs': 'C#', '.vb': 'VB.NET', '.go': 'Go', '.rb': 'Ruby', '.php': 'PHP', '.rs': 'Rust', '.cob': 'COBOL', '.cbl': 'COBOL', '.sql': 'SQL', '.scala': 'Scala', '.swift': 'Swift',
};
const MANIFESTS = /^(package\.json|pom\.xml|build\.gradle(\.kts)?|requirements[\w.-]*\.txt|pyproject\.toml|Pipfile|go\.mod|Gemfile|composer\.json|.*\.csproj|.*\.vbproj|packages\.config|docker-compose[\w.-]*\.ya?ml)$/i;

const SIGNATURES = [
  // frameworks / runtimes
  ['framework', 'Spring Boot', /spring-boot/i], ['framework', 'Express', /"express"\s*:/], ['framework', 'NestJS', /@nestjs\/core/], ['framework', 'Next.js', /"next"\s*:/],
  ['framework', 'React', /"react"\s*:/], ['framework', 'Angular', /@angular\/core/], ['framework', 'Django', /^\s*django[=<>~ ]/im], ['framework', 'Flask', /^\s*flask[=<>~ ]/im],
  ['framework', 'FastAPI', /^\s*fastapi[=<>~ ]/im], ['framework', 'ASP.NET', /Microsoft\.AspNetCore|Microsoft\.NET\.Sdk\.Web/], ['framework', 'Laravel', /laravel\/framework/],
  ['framework', 'Rails', /^\s*gem ['"]rails['"]/im], ['framework', 'Hibernate/JPA', /hibernate|spring-boot-starter-data-jpa/i], ['framework', 'Entity Framework', /EntityFramework/],
  // datastores
  ['datastore', 'PostgreSQL', /postgres|psycopg|"pg"\s*:|Npgsql|lib\/pq|pgx/i], ['datastore', 'MySQL / MariaDB', /mysql|mariadb|pymysql/i], ['datastore', 'SQL Server', /mssql|sqlserver|System\.Data\.SqlClient|Microsoft\.Data\.SqlClient|tedious/i],
  ['datastore', 'Oracle', /ojdbc|oracledb|cx_Oracle|Oracle\.ManagedDataAccess/i], ['datastore', 'MongoDB', /mongoose|mongodb|pymongo|MongoDB\.Driver/i], ['datastore', 'Redis', /redis|ioredis|StackExchange\.Redis/i],
  ['datastore', 'Cassandra', /cassandra/i], ['datastore', 'Elasticsearch', /elasticsearch|opensearch/i], ['datastore', 'DynamoDB', /dynamodb/i], ['datastore', 'Firestore', /firestore/i], ['datastore', 'Cosmos DB', /cosmos/i],
  // messaging
  ['messaging', 'Kafka', /kafka/i], ['messaging', 'RabbitMQ / AMQP', /rabbit|amqp|pika/i], ['messaging', 'JMS / ActiveMQ', /activemq|javax\.jms|jakarta\.jms/i], ['messaging', 'SQS / SNS', /sqs|sns/i],
  ['messaging', 'Pub/Sub', /pubsub|pub\/sub/i], ['messaging', 'Service Bus / Event Hubs', /servicebus|eventhub/i], ['messaging', 'NATS', /nats/i],
  // cloud SDKs (lock-in indicators)
  ['cloudsdk', 'aws', /aws-sdk|@aws-sdk|boto3|software\.amazon\.awssdk|AWSSDK/i], ['cloudsdk', 'gcp', /@google-cloud|google-cloud-|com\.google\.cloud|Google\.Cloud/i], ['cloudsdk', 'azure', /@azure\/|azure-(?!pipelines)|com\.azure|Azure\./i],
];

function walk(root, maxFiles = 6000, maxDepth = 8) {
  const out = [];
  const stack = [[root, 0]];
  while (stack.length && out.length < maxFiles) {
    const [dir, depth] = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name.startsWith('.') && !['.github', '.gitlab-ci.yml', '.env', '.env.local'].includes(e.name) && e.isDirectory()) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP.has(e.name) && depth < maxDepth) stack.push([abs, depth + 1]); } else out.push(abs);
    }
  }
  return out;
}

const read = (f, max = 300000) => { try { return fs.readFileSync(f, 'utf8').slice(0, max); } catch { return ''; } };

function assess(ws, analyzers) {
  if (!ws || !fs.existsSync(ws)) throw new Error('Open a project folder first.');
  const files = walk(ws);
  const rel = (f) => path.relative(ws, f).split(path.sep).join('/');
  const langs = new Map();
  const found = { framework: new Set(), datastore: new Set(), messaging: new Set(), cloudsdk: new Set() };
  const infra = { docker: false, compose: false, kubernetes: false, helm: false, terraform: false, cloudformation: false, bicep: false, serverless: false, ansible: false };
  const cicd = new Set();
  const findings = [];
  const sourceClouds = new Set();
  let legacyDotNet = false;
  let oldJava = false;

  for (const f of files) {
    const base = path.basename(f);
    const ext = path.extname(f).toLowerCase();
    const r = rel(f);
    if (LANG[ext]) langs.set(LANG[ext], (langs.get(LANG[ext]) || 0) + 1);

    if (/^Dockerfile/i.test(base)) infra.docker = true;
    if (/^docker-compose.*\.ya?ml$/i.test(base)) infra.compose = true;
    if (base === 'Chart.yaml') infra.helm = true;
    if (ext === '.tf') { infra.terraform = true; const t = read(f, 60000); for (const [c, re] of [['aws', /provider\s+"aws"/], ['gcp', /provider\s+"google/], ['azure', /provider\s+"azurerm"/]]) if (re.test(t)) sourceClouds.add(c); }
    if (ext === '.bicep') { infra.bicep = true; sourceClouds.add('azure'); }
    if (base === 'serverless.yml' || base === 'serverless.yaml') infra.serverless = true;
    if (/\.ya?ml$/.test(ext)) {
      const t = read(f, 40000);
      if (/AWSTemplateFormatVersion|AWS::Serverless/.test(t)) { infra.cloudformation = true; sourceClouds.add('aws'); }
      else if (/^apiVersion:/m.test(t) && /^kind:\s*(Deployment|StatefulSet|DaemonSet|Service|Ingress|CronJob)/m.test(t)) infra.kubernetes = true;
      else if (/^\s*-?\s*hosts:/m.test(t) && /^\s*(tasks|roles):/m.test(t)) infra.ansible = true;
    }
    if (base === 'Jenkinsfile') cicd.add('Jenkins');
    if (r.startsWith('.github/workflows/')) cicd.add('GitHub Actions');
    if (base === '.gitlab-ci.yml') cicd.add('GitLab CI');
    if (base === 'cloudbuild.yaml') cicd.add('Google Cloud Build');
    if (base === 'buildspec.yml') cicd.add('AWS CodeBuild');
    if (base === 'azure-pipelines.yml') cicd.add('Azure Pipelines');
    if (base === 'bitbucket-pipelines.yml') cicd.add('Bitbucket Pipelines');

    if (/^\.env(\..+)?$/.test(base) && !/example|sample|template/i.test(base)) findings.push({ severity: 'high', title: 'Environment file committed', detail: `${r} may contain secrets. Move them to a secret manager before migrating.` });
    if (/\.(pem|key|pfx|p12)$/i.test(base) || base === 'id_rsa') findings.push({ severity: 'high', title: 'Private key material in the repository', detail: r });

    if (MANIFESTS.test(base)) {
      const t = read(f);
      for (const [kind, label, re] of SIGNATURES) if (re.test(t)) found[kind].add(label);
      if (/\.csproj$/i.test(base) && /<TargetFramework>net(4|35)/i.test(t)) legacyDotNet = true;
      if (base === 'pom.xml' && /<(java\.version|maven\.compiler\.(source|target))>\s*(1\.)?[5-8]\s*</.test(t)) oldJava = true;
      if (/^docker-compose/i.test(base)) {
        for (const [, name, re] of [[0, 'PostgreSQL', /image:\s*postgres/i], [0, 'MySQL / MariaDB', /image:\s*(mysql|mariadb)/i], [0, 'MongoDB', /image:\s*mongo/i], [0, 'Redis', /image:\s*redis/i], [0, 'Kafka', /image:.*kafka/i], [0, 'RabbitMQ / AMQP', /image:\s*rabbitmq/i], [0, 'Elasticsearch', /image:.*(elasticsearch|opensearch)/i]]) {
          if (re.test(t)) found[['Kafka', 'RabbitMQ / AMQP'].includes(name) ? 'messaging' : 'datastore'].add(name);
        }
      }
    }
  }

  for (const c of found.cloudsdk) sourceClouds.add(c);

  if (!infra.docker) findings.push({ severity: 'medium', title: 'Not containerized', detail: 'No Dockerfile found. Containerizing is the first step for most targets.' });
  if (!cicd.size) findings.push({ severity: 'low', title: 'No CI/CD pipeline detected', detail: 'Generate one from the Cloud view once a target cloud is chosen.' });
  if (found.datastore.has('Oracle')) findings.push({ severity: 'high', title: 'Oracle database dependency', detail: 'Plan licensing and a data-migration path (managed Oracle, or convert to PostgreSQL with ora2pg / cloud DMS).' });
  if (found.datastore.has('SQL Server')) findings.push({ severity: 'medium', title: 'SQL Server dependency', detail: 'Managed SQL Server exists on all three clouds; check CLR, linked servers and SQL Agent usage.' });
  if (legacyDotNet) findings.push({ severity: 'high', title: 'Legacy .NET Framework', detail: 'Targets .NET Framework 4.x. Rehost on Windows VMs first, then port to modern .NET.' });
  if (oldJava) findings.push({ severity: 'medium', title: 'Old Java version (8 or earlier)', detail: 'Upgrade to Java 17/21 before or during replatforming.' });
  if (langs.has('COBOL')) findings.push({ severity: 'high', title: 'COBOL code', detail: 'Consider a mainframe rehost/emulation service or a staged rewrite.' });
  if (found.cloudsdk.size) findings.push({ severity: 'medium', title: `Provider-specific SDK usage (${[...found.cloudsdk].join(', ')})`, detail: 'Wrap cloud calls behind interfaces; each use must be remapped when changing cloud.' });

  const languages = [...langs.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, files: n }));
  const strategies = [];
  const containerized = infra.docker || infra.kubernetes;
  strategies.push({
    component: 'Application',
    strategy: legacyDotNet || langs.has('COBOL') ? 'Rehost, then refactor' : containerized ? 'Replatform' : 'Replatform (containerize first)',
    why: legacyDotNet || langs.has('COBOL') ? 'Legacy runtime: move as-is to VMs to exit the data centre, then modernize.' : containerized ? 'Already containerized: move to managed container hosting with little code change.' : 'Add a Dockerfile and run on managed containers; refactor later where it pays off.',
  });
  for (const d of found.datastore) {
    const managed = !['Cassandra', 'Elasticsearch'].includes(d);
    strategies.push({ component: d, strategy: managed ? 'Replatform to a managed service' : 'Rehost (self-managed) or managed equivalent', why: managed ? 'Use the cloud-managed engine; migrate data with the provider\'s database migration service.' : 'Check managed-service fit and version compatibility before choosing.' });
  }
  for (const m of found.messaging) strategies.push({ component: m, strategy: m === 'Kafka' ? 'Replatform to managed Kafka-compatible' : 'Replatform to a managed queue/broker', why: 'Run brokers as a managed service; keep client protocol where possible to avoid code changes.' });
  if (cicd.size) strategies.push({ component: `CI/CD (${[...cicd].join(', ')})`, strategy: 'Retain or retarget', why: 'Keep the existing pipeline and add deployment stages for the target cloud, or move to the cloud-native pipeline.' });

  const analysis = {
    root: ws, name: path.basename(ws), fileCount: files.length, truncated: files.length >= 6000,
    languages, frameworks: [...found.framework], datastores: [...found.datastore], messaging: [...found.messaging],
    cloudSdks: [...found.cloudsdk], sourceClouds: [...sourceClouds], infra, cicd: [...cicd],
    findings: findings.slice(0, 60), strategies,
  };
  for (const a of analyzers) {
    try { a.analyze(ws, analysis); } catch (e) { analysis.findings.push({ severity: 'low', title: `Analyzer ${a.id} failed`, detail: String(e.message || e) }); }
  }
  return analysis;
}

/* ------------------------------ target mapping ------------------------------ */

const TARGETS = {
  gcp: { name: 'Google Cloud', ci: 'Cloud Build', iac: 'Terraform (google provider)', registry: 'Artifact Registry', secrets: 'Secret Manager', obs: 'Cloud Logging / Monitoring', network: 'VPC + Cloud Load Balancing', identity: 'IAM + Workload Identity',
    map: { app: ['Cloud Run (or GKE for complex workloads)'], PostgreSQL: ['Cloud SQL for PostgreSQL / AlloyDB'], 'MySQL / MariaDB': ['Cloud SQL for MySQL'], 'SQL Server': ['Cloud SQL for SQL Server'], Oracle: ['Bare Metal Solution for Oracle, or migrate to AlloyDB/Cloud SQL'], MongoDB: ['MongoDB Atlas on GCP (or Firestore with refactor)'], Redis: ['Memorystore for Redis'], Cassandra: ['Bigtable (refactor) or self-managed on GKE'], Elasticsearch: ['Elastic Cloud on GCP'], Kafka: ['Google Cloud Managed Service for Apache Kafka'], 'RabbitMQ / AMQP': ['Pub/Sub (refactor) or RabbitMQ on GKE'], 'JMS / ActiveMQ': ['Pub/Sub (refactor) or ActiveMQ on GKE'], 'SQS / SNS': ['Pub/Sub'], 'Service Bus / Event Hubs': ['Pub/Sub'], DynamoDB: ['Firestore / Bigtable'], 'Cosmos DB': ['Firestore / Spanner'], storage: ['Cloud Storage'], functions: ['Cloud Functions / Cloud Run functions'] },
    dms: 'Database Migration Service', vm: 'Compute Engine (Migrate to Virtual Machines)' },
  aws: { name: 'AWS', ci: 'CodeBuild + CodePipeline', iac: 'Terraform (aws provider) or CloudFormation/CDK', registry: 'ECR', secrets: 'Secrets Manager', obs: 'CloudWatch / X-Ray', network: 'VPC + ALB', identity: 'IAM roles (least privilege) + IAM Identity Center',
    map: { app: ['ECS on Fargate or App Runner (EKS for complex workloads)'], PostgreSQL: ['Amazon RDS / Aurora PostgreSQL'], 'MySQL / MariaDB': ['Amazon RDS / Aurora MySQL'], 'SQL Server': ['Amazon RDS for SQL Server'], Oracle: ['Amazon RDS for Oracle, or migrate to Aurora PostgreSQL (SCT + DMS)'], MongoDB: ['Amazon DocumentDB (compatibility caveats) or MongoDB Atlas'], Redis: ['Amazon ElastiCache / MemoryDB'], Cassandra: ['Amazon Keyspaces'], Elasticsearch: ['Amazon OpenSearch Service'], Kafka: ['Amazon MSK'], 'RabbitMQ / AMQP': ['Amazon MQ for RabbitMQ'], 'JMS / ActiveMQ': ['Amazon MQ for ActiveMQ'], 'SQS / SNS': ['SQS / SNS'], 'Service Bus / Event Hubs': ['SQS/SNS or MSK'], DynamoDB: ['DynamoDB'], 'Cosmos DB': ['DynamoDB'], storage: ['S3'], functions: ['AWS Lambda'] },
    dms: 'AWS Database Migration Service (+ Schema Conversion Tool)', vm: 'EC2 (AWS Application Migration Service)' },
  azure: { name: 'Microsoft Azure', ci: 'Azure Pipelines / GitHub Actions', iac: 'Bicep or Terraform (azurerm)', registry: 'Azure Container Registry', secrets: 'Key Vault', obs: 'Azure Monitor / Application Insights', network: 'VNet + Application Gateway / Front Door', identity: 'Microsoft Entra ID + managed identities',
    map: { app: ['Azure Container Apps or App Service (AKS for complex workloads)'], PostgreSQL: ['Azure Database for PostgreSQL Flexible Server'], 'MySQL / MariaDB': ['Azure Database for MySQL Flexible Server'], 'SQL Server': ['Azure SQL Database / Managed Instance'], Oracle: ['Oracle Database@Azure, or migrate to PostgreSQL'], MongoDB: ['Azure Cosmos DB for MongoDB'], Redis: ['Azure Cache for Redis'], Cassandra: ['Azure Managed Instance for Apache Cassandra'], Elasticsearch: ['Elastic on Azure'], Kafka: ['Event Hubs (Kafka endpoint) or HDInsight/Confluent'], 'RabbitMQ / AMQP': ['Service Bus'], 'JMS / ActiveMQ': ['Service Bus (AMQP/JMS 2.0)'], 'SQS / SNS': ['Service Bus / Event Grid'], 'Pub/Sub': ['Service Bus / Event Grid'], DynamoDB: ['Cosmos DB'], Firestore: ['Cosmos DB'], storage: ['Blob Storage'], functions: ['Azure Functions'] },
    dms: 'Azure Database Migration Service', vm: 'Azure Migrate (Azure VMs)' },
  k8s: { name: 'Private cloud (Kubernetes)', ci: 'Your existing CI (Jenkins/GitLab/Argo CD)', iac: 'Helm / Kustomize + Terraform', registry: 'Harbor / your private registry', secrets: 'External Secrets / Vault', obs: 'Prometheus + Grafana + Loki', network: 'Ingress controller + service mesh (optional)', identity: 'OIDC / LDAP via your identity provider',
    map: { app: ['Deployments on your Kubernetes cluster'], PostgreSQL: ['CloudNativePG / Crunchy operator, or existing DB servers'], 'MySQL / MariaDB': ['MySQL operator, or existing DB servers'], 'SQL Server': ['SQL Server on VMs/containers'], Oracle: ['Keep on existing Oracle infrastructure'], MongoDB: ['MongoDB Community/Enterprise operator'], Redis: ['Redis operator'], Cassandra: ['K8ssandra operator'], Elasticsearch: ['ECK operator'], Kafka: ['Strimzi operator'], 'RabbitMQ / AMQP': ['RabbitMQ cluster operator'], 'JMS / ActiveMQ': ['ActiveMQ Artemis operator'], storage: ['MinIO / Ceph object storage'], functions: ['Knative / OpenFaaS'] },
    dms: 'Native replication tooling per engine', vm: 'KubeVirt / existing hypervisor' },
};

const SDK_EQUIV = { aws: 'S3, SQS/SNS, DynamoDB, Lambda, Secrets Manager', gcp: 'Cloud Storage, Pub/Sub, Firestore, Cloud Functions, Secret Manager', azure: 'Blob Storage, Service Bus, Cosmos DB, Functions, Key Vault' };

function plan(a, targetId) {
  const t = TARGETS[targetId];
  if (!t) throw new Error('Unknown target.');
  const today = new Date().toISOString().slice(0, 10);
  const components = [['Application', t.map.app[0]]];
  for (const d of [...a.datastores, ...a.messaging]) components.push([d, (t.map[d] || ['Self-managed on the target (no direct managed equivalent)'])[0]]);
  if (a.infra.docker || a.infra.kubernetes) components.push(['Container images', t.registry]);
  components.push(['Secrets', t.secrets], ['Observability', t.obs], ['Networking', t.network], ['Identity & access', t.identity], ['IaC', t.iac], ['CI/CD', t.ci]);

  const lines = [];
  const L = (s = '') => lines.push(s);
  L(`# Migration plan: ${a.name} → ${t.name}`);
  L(`_Generated ${today} by Nativity Studio. This is a starting point from static analysis; validate each step with the owning teams._`);
  L();
  L('## 1. What was found');
  L(`- **Languages:** ${a.languages.slice(0, 6).map((l) => `${l.name} (${l.files})`).join(', ') || 'none detected'}`);
  L(`- **Frameworks:** ${a.frameworks.join(', ') || 'none detected'}`);
  L(`- **Data stores:** ${a.datastores.join(', ') || 'none detected'}`);
  L(`- **Messaging:** ${a.messaging.join(', ') || 'none detected'}`);
  L(`- **Infrastructure as code / packaging:** ${Object.entries(a.infra).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none detected'}`);
  L(`- **CI/CD:** ${a.cicd.join(', ') || 'none detected'}`);
  L(`- **Current cloud footprint:** ${a.sourceClouds.length ? a.sourceClouds.join(', ') : 'none detected (assumed on-premises / unknown)'}`);
  L();
  L('## 2. Risks and findings');
  if (!a.findings.length) L('No blocking findings from the static scan.');
  else { L('| Severity | Finding | Detail |'); L('|---|---|---|'); for (const f of a.findings) L(`| ${f.severity} | ${f.title} | ${String(f.detail).replace(/\|/g, '/')} |`); }
  L();
  L(`## 3. Target architecture on ${t.name}`);
  L('| Component | Target service |'); L('|---|---|');
  for (const [c, s] of components) L(`| ${c} | ${s} |`);
  L();
  L('## 4. Strategy per component (6 Rs)');
  L('| Component | Strategy | Why |'); L('|---|---|---|');
  for (const s of a.strategies) L(`| ${s.component} | ${s.strategy} | ${s.why} |`);
  L();
  L('## 5. Phased plan');
  L('**Phase 0 — Foundation (landing zone)**');
  L(`- Create the ${t.name} account/project/subscription (or cluster namespace) structure for dev, sit, uat and prod.`);
  L(`- Set up ${t.identity} with least-privilege roles per environment; no long-lived keys.`);
  L(`- Provision networking (${t.network}) and the baseline IaC (${t.iac}). In Nativity Studio: **Cloud > Bootstrap Environments (Terraform)**.`);
  L();
  L('**Phase 1 — Build and package**');
  L(`- ${a.infra.docker ? 'Review and harden the existing Dockerfile(s) (non-root user, pinned base image).' : 'Add a Dockerfile (non-root, pinned base image, health endpoint).'}`);
  L(`- Push images to ${t.registry}; build in ${t.ci}. In the IDE: **Cloud > Generate CI/CD Pipeline**.`);
  L(`- Move secrets out of code/config into ${t.secrets}.`);
  L();
  L('**Phase 2 — Data and messaging**');
  L(`- Migrate databases with: ${t.dms}. Run in continuous-replication mode, validate row counts and checksums.`);
  if (a.messaging.length) L('- Stand up the managed broker alongside the old one; dual-publish, then switch consumers.');
  L('- Rehearse the cutover on a copy of production data and record the timing.');
  L();
  L('**Phase 3 — Deploy and verify (dev → sit → uat)**');
  L('- Deploy with the IDE (**Cloud > Deploy**), run smoke, integration and load tests per environment.');
  L(`- Wire ${t.obs}: logs, metrics, traces and alerts before any production traffic.`);
  L();
  L('**Phase 4 — Cutover**');
  L('- Lower DNS TTL, freeze writes, final data sync, switch traffic (blue/green or weighted), keep the old stack for rollback.');
  L();
  L('**Phase 5 — Optimize**');
  L('- Right-size, add autoscaling and budgets/alerts, remove the old environment after the rollback window.');
  L();
  const foreign = a.sourceClouds.filter((c) => TARGETS[c] && c !== targetId);
  if (foreign.length) {
    L('## 6. Cross-cloud notes');
    for (const c of foreign) L(`- The project currently uses **${TARGETS[c].name}** (${SDK_EQUIV[c] || 'cloud services'}). Replace those SDK calls with the ${t.name} equivalents above, or hide them behind an interface first so the swap is mechanical.`);
    L('- Keep IaC cloud-neutral where possible (Terraform modules per cloud) so the same release process works on every target.');
    L();
  }
  L(`## ${foreign.length ? 7 : 6}. Open questions`);
  L('- Compliance, data-residency and licensing constraints for the target region?');
  L('- Acceptable downtime window and rollback criteria?');
  L('- Who owns each data store and each integration endpoint?');
  L('');
  return lines.join('\n');
}

exports.activate = (ctx) => {
  const analyzers = [];
  ctx.ipc.handle('assess', async (ws) => assess(ws || ctx.workspace(), ctx.analyzersList ? ctx.analyzersList() : analyzers));
  ctx.ipc.handle('targets', async () => Object.entries(TARGETS).map(([id, t]) => ({ id, name: t.name })));
  ctx.ipc.handle('plan', async (analysis, target) => ({ markdown: plan(analysis, target) }));
  ctx.ipc.handle('save', async (ws, target, markdown) => {
    if (!ws) throw new Error('Open a project folder first.');
    if (!TARGETS[target]) throw new Error('Unknown target.');
    const file = path.join(ws, 'docs', 'migration', `${target}-plan.md`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, String(markdown), 'utf8');
    return file;
  });
};
