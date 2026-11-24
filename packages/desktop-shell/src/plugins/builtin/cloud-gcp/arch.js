/**
 * Cloud Native architecture for Google Cloud: pick services, get an architecture (network, identities, data flow), Terraform for it,
 * and the steps that provision the first (development) environment. The other environments run the same Terraform from CI/CD.
 *
 * Nothing here runs a command: build() returns descriptions (a model, files, steps). The IDE shows them and runs the steps itself.
 */
const fs = require('fs');
const path = require('path');

const TF_DIR = path.join(__dirname, 'tf');
const APP_RE = /^[a-z][a-z0-9-]{1,19}[a-z0-9]$/;
const ENV_RE = /^[a-z][a-z0-9]{0,11}$/;
const PROJECT_RE = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const REGION_RE = /^[a-z]+-[a-z]+[0-9]$/;

/* ------------------------------------------------------------------ catalog */

const CATEGORIES = [
  ['gateway', 'API gateway'], ['compute', 'Compute'], ['data', 'Data'], ['messaging', 'Messaging'], ['security', 'Security and edge'],
];

/**
 * tf:        where the Terraform comes from (a whole file, or a #@section of one)
 * apis:      Google APIs that must be on before Terraform runs
 * tfRoles:   what the Terraform service account needs to create this service (it is a separate identity from the application's)
 * grants:    what the APPLICATION's service account is given for this service, as narrowly as Google allows (resource level where possible)
 * needs:     services this one cannot work without (added automatically)
 */
const SERVICES = [
  { id: 'octopus', cat: 'gateway', name: 'Octopus API Gateway', badge: 'Recommended', recommended: true,
    desc: 'FutureIM’s multi-tenant API gateway for GKE: authentication, rate limits, WAF rules and routing in one 8-layer pipeline. Installed from Google Cloud Marketplace.',
    note: 'Cost-effective: Octopus runs in your own GKE cluster and is billed by the compute it uses, with no per-request charge. Apigee is priced by edition, call volume and environments.',
    tf: ['gateway.tf', 'octopus'], needs: ['gke', 'firestore', 'redis', 'edge'], apis: ['container.googleapis.com'], tfRoles: [],
    conflicts: ['apigee'], serviceAccount: 'octopus' },
  { id: 'apigee', cat: 'gateway', name: 'Apigee X', badge: 'Google-managed',
    desc: 'Google’s own API management product, fully managed and peered into your VPC.',
    note: 'Takes 30 minutes or more to create and is priced by edition, API call volume and environments. Choose it for existing Apigee proxies or Apigee-only features; Octopus is the cost-effective option.',
    tf: ['gateway.tf', 'apigee'], needs: ['edge'], psa: true, apis: ['apigee.googleapis.com'], tfRoles: ['roles/apigee.admin'], conflicts: ['octopus'] },
  { id: 'cloudrun', cat: 'compute', name: 'Cloud Run', desc: 'Serverless containers with no cluster to run. Reaches private IPs through your VPC.',
    tf: ['cloudrun.tf', 'cloudrun'], apis: ['run.googleapis.com'], tfRoles: ['roles/run.admin'] },
  { id: 'gke', cat: 'compute', name: 'GKE Autopilot', desc: 'Managed Kubernetes: private nodes, workload identity, Google runs the nodes.',
    tf: ['gke.tf', 'gke'], apis: ['container.googleapis.com'], tfRoles: ['roles/container.admin'] },
  { id: 'cloudsql', cat: 'data', name: 'Cloud SQL (PostgreSQL)', desc: 'Relational database on a private IP only, with IAM sign-in (no passwords) and automatic backups.',
    tf: ['data.tf', 'cloudsql'], psa: true, apis: ['sqladmin.googleapis.com', 'servicenetworking.googleapis.com'], tfRoles: ['roles/cloudsql.admin', 'roles/servicenetworking.networksAdmin'],
    grants: [{ role: 'roles/cloudsql.client', scope: 'project', why: 'connect to the database' }, { role: 'roles/cloudsql.instanceUser', scope: 'project', why: 'sign in with its own identity' }] },
  { id: 'redis', cat: 'data', name: 'Memorystore (Redis)', desc: 'Managed Redis cache on a private IP, with authentication on.',
    tf: ['data.tf', 'redis'], psa: true, apis: ['redis.googleapis.com', 'servicenetworking.googleapis.com'], tfRoles: ['roles/redis.admin', 'roles/servicenetworking.networksAdmin'], grants: [] },
  { id: 'firestore', cat: 'data', name: 'Firestore', desc: 'Serverless document database in native mode.',
    tf: ['data.tf', 'firestore'], apis: ['firestore.googleapis.com'], tfRoles: ['roles/datastore.owner'],
    grants: [{ role: 'roles/datastore.user', scope: 'project', why: 'read and write documents' }] },
  { id: 'storage', cat: 'data', name: 'Cloud Storage', desc: 'A private, versioned bucket (public access blocked).',
    tf: ['data.tf', 'storage'], apis: ['storage.googleapis.com'], tfRoles: ['roles/storage.admin'],
    grants: [{ role: 'roles/storage.objectUser', scope: 'this bucket', why: 'read and write objects in it, nothing else' }] },
  { id: 'bigquery', cat: 'data', name: 'BigQuery', desc: 'A dataset for analytics.',
    tf: ['data.tf', 'bigquery'], apis: ['bigquery.googleapis.com'], tfRoles: ['roles/bigquery.admin'],
    grants: [{ role: 'roles/bigquery.dataEditor', scope: 'this dataset', why: 'edit tables in it' }, { role: 'roles/bigquery.jobUser', scope: 'project', why: 'run queries' }] },
  { id: 'pubsub', cat: 'messaging', name: 'Pub/Sub', desc: 'An events topic with a subscription and a dead-letter topic.',
    tf: ['messaging.tf', 'pubsub'], apis: ['pubsub.googleapis.com'], tfRoles: ['roles/pubsub.admin'],
    grants: [{ role: 'roles/pubsub.publisher', scope: 'this topic', why: 'publish events' }, { role: 'roles/pubsub.subscriber', scope: 'this subscription', why: 'receive events' }] },
  { id: 'secrets', cat: 'security', name: 'Secret Manager', desc: 'A place for configuration secrets; the value never enters Terraform state.',
    tf: ['security.tf', 'secrets'], apis: ['secretmanager.googleapis.com'], tfRoles: ['roles/secretmanager.admin'],
    grants: [{ role: 'roles/secretmanager.secretAccessor', scope: 'this secret', why: 'read its value' }] },
  { id: 'kms', cat: 'security', name: 'Cloud KMS', desc: 'An encryption key with 90-day rotation (for customer-managed encryption).',
    tf: ['security.tf', 'kms'], apis: ['cloudkms.googleapis.com'], tfRoles: ['roles/cloudkms.admin'],
    grants: [{ role: 'roles/cloudkms.cryptoKeyEncrypterDecrypter', scope: 'this key', why: 'encrypt and decrypt with it' }] },
  { id: 'edge', cat: 'security', name: 'Edge: static IP and Cloud Armor', desc: 'A reserved global IP and a Cloud Armor policy with the OWASP rules, for the public entry point.',
    tf: ['security.tf', 'edge'], apis: ['compute.googleapis.com'], tfRoles: ['roles/compute.securityAdmin', 'roles/compute.loadBalancerAdmin'] },
];
const BY_ID = new Map(SERVICES.map((s) => [s.id, s]));

const PRESETS = [
  { id: 'api-run', name: 'API on Cloud Run', desc: 'A containerised API with a database, a bucket and secrets.', services: ['cloudrun', 'cloudsql', 'storage', 'secrets', 'pubsub'] },
  { id: 'octopus-gke', name: 'Microservices behind Octopus', desc: 'GKE with the Octopus API Gateway in front, Firestore and Redis behind it.', services: ['octopus', 'gke', 'firestore', 'redis', 'edge', 'cloudsql', 'pubsub', 'secrets'] },
  { id: 'event', name: 'Event-driven', desc: 'Cloud Run services that exchange events.', services: ['cloudrun', 'pubsub', 'firestore', 'storage', 'secrets'] },
  { id: 'data', name: 'Data platform', desc: 'Events into BigQuery and storage.', services: ['cloudrun', 'pubsub', 'bigquery', 'storage', 'kms', 'secrets'] },
];

/* ------------------------------------------------------------------ helpers */

function resolveServices(ids) {
  const want = new Set((Array.isArray(ids) ? ids : []).filter((id) => BY_ID.has(id)));
  let grew = true;
  while (grew) { grew = false; for (const id of [...want]) for (const n of BY_ID.get(id).needs || []) if (!want.has(n)) { want.add(n); grew = true; } }
  const added = [...want].filter((id) => !(Array.isArray(ids) ? ids : []).includes(id));
  for (const id of want) for (const c of BY_ID.get(id).conflicts || []) if (want.has(c) && id < c) throw new Error(`${BY_ID.get(id).name} and ${BY_ID.get(c).name} are alternatives: choose one API gateway.`);
  return { list: SERVICES.filter((s) => want.has(s.id)), added };
}

/** Address plan of one environment: a /16 of its own, so environments never overlap and can be connected later. */
function cidrPlan(index, custom) {
  const base = /^\d{1,3}\.\d{1,3}$/.test(String(custom || '')) ? String(custom) : `10.${10 * (index + 1)}`;
  return {
    env: `${base}.0.0/16`, app: `${base}.0.0/20`, data: `${base}.16.0/24`, gkeMaster: `${base}.20.0/28`, gkePods: `${base}.64.0/18`, gkeServices: `${base}.128.0/20`,
    psaAddress: `${base}.240.0`, psaPrefix: 20, psa: `${base}.240.0/20`,
  };
}

function sections(file) {
  const text = fs.readFileSync(path.join(TF_DIR, file), 'utf8').replace(/\r\n/g, '\n');
  if (!/^#@/m.test(text)) return { [file.replace(/\.tf$/, '')]: text };
  const out = {};
  let id = null;
  let buf = [];
  const flush = () => { if (id) out[id] = buf.join('\n').trim() + '\n'; };
  for (const line of text.split('\n')) {
    const m = /^#@(\w+)\s*(.*)$/.exec(line);
    if (m) { flush(); id = m[1]; buf = [m[2] ? `# ================================================================ ${m[2]}` : '']; } else buf.push(line);
  }
  flush();
  return out;
}

const q = (s) => JSON.stringify(String(s));

function normalize(spec) {
  const s = spec || {};
  const app = String(s.app || '').trim().toLowerCase();
  if (!APP_RE.test(app)) throw new Error('The application name must be 3-21 characters: lower-case letters, digits and "-", starting with a letter.');
  const region = REGION_RE.test(String(s.region || '')) ? s.region : 'us-central1';
  const envs = (Array.isArray(s.envs) && s.envs.length ? s.envs : [{ name: 'dev' }]).map((e) => ({ name: String(e.name || '').toLowerCase(), protected: !!e.protected, project: String(e.project || '') }));
  for (const e of envs) if (!ENV_RE.test(e.name)) throw new Error(`"${e.name}" is not a valid environment name.`);
  if (new Set(envs.map((e) => e.name)).size !== envs.length) throw new Error('Each environment name must be unique.');
  const { list, added } = resolveServices(s.services);
  if (!list.length) throw new Error('Choose at least one service.');
  const opts = { nat: s.options ? s.options.nat !== false : true, ...(s.options || {}) };
  const first = envs.find((e) => e.name === s.env) || envs[0];
  return { app, region, envs, services: list, added, options: opts, env: first.name, project: String(s.project || first.project || '') };
}

/* ------------------------------------------------------------------ the model (diagram, identities, network) */

function model(n) {
  const has = (id) => n.services.some((s) => s.id === id);
  const idx = Math.max(0, n.envs.findIndex((e) => e.name === n.env));
  const c = cidrPlan(idx, (n.options.cidr || {})[n.env]);
  const gw = has('octopus') ? 'octopus' : has('apigee') ? 'apigee' : '';
  const compute = [has('cloudrun') ? 'cloudrun' : '', has('gke') ? 'gke' : ''].filter(Boolean);
  const psa = n.services.some((s) => s.psa);

  const subnets = [
    { id: 'app', name: `${n.app}-${n.env}-app`, cidr: c.app, purpose: 'Workloads and private access to Google APIs', secondary: has('gke') ? [{ name: 'pods', cidr: c.gkePods }, { name: 'services', cidr: c.gkeServices }] : [] },
    { id: 'data', name: `${n.app}-${n.env}-data`, cidr: c.data, purpose: 'Reserved for private endpoints of data services', secondary: [] },
  ];
  const network = { vpc: `${n.app}-${n.env}-vpc`, region: n.region, cidr: c.env, subnets, nat: !!n.options.nat, psa: psa ? { cidr: c.psa, purpose: 'Private service range for Cloud SQL, Memorystore and Apigee' } : null, gkeMaster: has('gke') ? c.gkeMaster : '' };

  // identities, each with only what it needs
  const accounts = [];
  const appGrants = [
    { role: 'roles/logging.logWriter', scope: 'project', why: 'write logs' }, { role: 'roles/monitoring.metricWriter', scope: 'project', why: 'write metrics' },
  ];
  for (const s of n.services) for (const g of s.grants || []) appGrants.push(g);
  accounts.push({ id: 'app', email: `${n.app}-${n.env}-app`, title: 'Application', purpose: 'What your code runs as. One identity per workload, no keys.', roles: appGrants });
  if (has('gke')) accounts.push({ id: 'nodes', email: `${n.app}-${n.env}-nodes`, title: 'GKE nodes', purpose: 'The cluster’s machines: logs, metrics and pulling images only.', roles: ['roles/logging.logWriter', 'roles/monitoring.metricWriter', 'roles/monitoring.viewer', 'roles/stackdriver.resourceMetadata.writer', 'roles/artifactregistry.reader'].map((r) => ({ role: r, scope: 'project', why: '' })) });
  if (gw === 'octopus') accounts.push({ id: 'octopus', email: `${n.app}-${n.env}-octopus`, title: 'Octopus API Gateway', purpose: 'The gateway’s own identity through workload identity.', roles: [{ role: 'roles/datastore.user', scope: 'project', why: 'its configuration and audit data' }, { role: 'roles/logging.logWriter', scope: 'project', why: '' }, { role: 'roles/monitoring.metricWriter', scope: 'project', why: '' }] });
  const tfRoles = [...new Set(['roles/compute.networkAdmin', 'roles/iam.serviceAccountAdmin', 'roles/iam.serviceAccountUser', 'roles/serviceusage.serviceUsageConsumer', ...n.services.flatMap((s) => s.tfRoles || [])])].sort();
  const grantable = [...new Set([...accounts.flatMap((a) => a.roles.map((r) => r.role)), 'roles/iam.workloadIdentityUser'])].sort();
  accounts.push({ id: 'terraform', email: `cnd-tf-sa`, title: 'Terraform', purpose: 'Creates and changes the infrastructure. Used only for provisioning, never by the application.', roles: tfRoles.map((r) => ({ role: r, scope: 'project', why: '' })), grantable });

  // the picture
  const nodes = [{ id: 'users', kind: 'users', label: 'Users and clients', zone: 'outside' }];
  if (has('edge')) nodes.push({ id: 'edge', kind: 'edge', label: 'Cloud Armor + HTTPS entry', sub: 'static IP · OWASP rules', zone: 'edge' });
  if (gw === 'octopus') nodes.push({ id: 'octopus', kind: 'octopus', label: 'Octopus API Gateway', sub: 'runs on GKE · from Marketplace', zone: 'app', sa: 'octopus' });
  if (gw === 'apigee') nodes.push({ id: 'apigee', kind: 'apigee', label: 'Apigee X', sub: 'Google-managed, peered', zone: 'peered' });
  for (const id of compute) nodes.push({ id, kind: id, label: BY_ID.get(id).name, sub: id === 'gke' ? 'private nodes · workload identity' : 'Direct VPC egress', zone: 'app', sa: 'app' });
  for (const id of ['cloudsql', 'redis']) if (has(id)) nodes.push({ id, kind: id, label: BY_ID.get(id).name, sub: 'private IP only', zone: 'psa' });
  for (const id of ['firestore', 'storage', 'bigquery', 'pubsub', 'secrets', 'kms']) if (has(id)) nodes.push({ id, kind: id, label: BY_ID.get(id).name, sub: id === 'secrets' ? 'value kept out of state' : '', zone: 'google' });
  nodes.push({ id: 'ops', kind: 'ops', label: 'Cloud Logging and Monitoring', sub: 'always on', zone: 'ops' });

  const edges = [];
  const link = (from, to, label, kind) => { if (nodes.some((x) => x.id === from) && nodes.some((x) => x.id === to)) edges.push({ from, to, label: label || '', kind: kind || 'private' }); };
  const front = has('edge') ? 'edge' : 'users';
  if (has('edge')) link('users', 'edge', 'HTTPS', 'public');
  const entry = gw || compute[0];
  if (entry) link(front, entry, has('edge') ? '' : 'HTTPS', has('edge') ? 'private' : 'public');
  if (gw) for (const id of compute) link(gw, id, 'routes to', 'private');
  const workers = gw === 'octopus' ? ['octopus', ...compute] : compute;
  for (const w of workers) {
    for (const id of ['cloudsql', 'redis']) link(w, id, 'private IP', 'private');
    for (const id of ['firestore', 'storage', 'bigquery', 'pubsub', 'secrets', 'kms']) link(w, id, 'Google APIs, private access', 'google');
  }
  for (const w of workers) link(w, 'ops', '', 'ops');

  const warnings = [];
  if (n.options.nat) warnings.push('Cloud NAT lets private workloads reach the internet outbound; nothing can reach them inbound.');
  if (has('apigee')) warnings.push('Apigee takes 30 minutes or more to create and is billed per its edition. Octopus API Gateway is the cost-effective alternative.');
  if (has('gke')) warnings.push('GKE Autopilot is billed for the pods you run; an idle cluster is cheap but not free.');
  if (has('cloudsql') || has('redis')) warnings.push('Cloud SQL and Memorystore are billed while they exist, even when idle. Use the smallest sizes in development.');

  return { app: n.app, env: n.env, region: n.region, gateway: gw, network, cidr: c, accounts, nodes, edges, warnings, added: n.added, services: n.services.map((s) => s.id), grantable };
}

/* ------------------------------------------------------------------ Terraform */

function files(n, m) {
  const out = {};
  const has = (id) => n.services.some((s) => s.id === id);
  let main = fs.readFileSync(path.join(TF_DIR, 'core.tf'), 'utf8').replace(/\r\n/g, '\n');
  out['main.tf'] = main;
  const byFile = new Map();
  for (const s of n.services) {
    if (!s.tf) continue;
    const [file, sec] = s.tf;
    if (!byFile.has(file)) byFile.set(file, new Set());
    byFile.get(file).add(sec);
  }
  for (const [file, secs] of byFile) {
    const all = sections(file);
    const body = [...secs].map((id) => all[id]).filter(Boolean).join('\n');
    if (body.trim()) out[file === 'cloudrun.tf' ? 'cloudrun.tf' : file] = body.endsWith('\n') ? body : `${body}\n`;
  }
  out['outputs.tf'] = fs.readFileSync(path.join(TF_DIR, 'outputs.tf'), 'utf8').replace(/\r\n/g, '\n');
  if (has('octopus')) out['outputs.tf'] += '\noutput "octopus_service_account" {\n  value = google_service_account.octopus.email\n}\n\noutput "edge_ip" {\n  value = google_compute_global_address.edge.address\n}\n';
  if (has('gke')) out['outputs.tf'] += '\noutput "gke_cluster" {\n  value = google_container_cluster.gke.name\n}\n';
  if (has('cloudrun')) out['outputs.tf'] += '\noutput "cloud_run_url" {\n  value = google_cloud_run_v2_service.app.uri\n}\n';
  // one variable file per environment, each with its own address range
  n.envs.forEach((e, i) => {
    const c = cidrPlan(i, (n.options.cidr || {})[e.name]);
    const gateway = has('apigee') || has('octopus');
    const lines = [
      `project_id = ${q(e.project || '<project-id-of-' + e.name + '>')}`, `region     = ${q(n.region)}`, `app        = ${q(n.app)}`, `env        = ${q(e.name)}`,
      `deletion_protection = ${e.protected || e.name === 'prod' ? 'true' : 'false'}`, '',
      `cidr_env          = ${q(c.env)}`, `cidr_app          = ${q(c.app)}`, `cidr_data         = ${q(c.data)}`,
      ...(has('gke') ? [`cidr_gke_master   = ${q(c.gkeMaster)}`, `cidr_gke_pods     = ${q(c.gkePods)}`, `cidr_gke_services = ${q(c.gkeServices)}`] : []),
      ...(n.services.some((s) => s.psa) ? [`psa_address       = ${q(c.psaAddress)}`, `psa_prefix_length = ${c.psaPrefix}`] : []),
      '', `enable_nat      = ${n.options.nat ? 'true' : 'false'}`, `enable_psa      = ${n.services.some((s) => s.psa) ? 'true' : 'false'}`, `enable_gke      = ${has('gke') ? 'true' : 'false'}`, `enable_lb_edge  = ${has('edge') ? 'true' : 'false'}`,
      ...(has('cloudrun') && (gateway || has('edge')) ? ['', 'cloudrun_ingress = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"'] : []),
    ];
    out[`envs/${e.name}.tfvars`] = `${lines.join('\n')}\n`;
  });
  out['README.md'] = [
    `# ${n.app}: infrastructure`, '',
    'Generated by Nativity Studio from your architecture. Edit it like any Terraform; the wizard writes these files again only when you ask.', '',
    '| File | What it holds |', '|---|---|', '| `main.tf` | provider, variables, the VPC and its subnets, NAT, private service range, firewall and the application identity |',
    ...Object.keys(out).filter((f) => f.endsWith('.tf') && f !== 'main.tf' && f !== 'outputs.tf').map((f) => `| \`${f}\` | ${n.services.filter((s) => s.tf && s.tf[0] === f).map((s) => s.name).join(', ')} |`),
    '| `envs/*.tfvars` | one file per environment, each with its own address range |', '',
    '## Run it', '',
    'Development is provisioned from the IDE. The other environments run this same code from the pipeline (`.github/workflows/infra.yml`), in order, with approval for protected ones.', '',
    '```', 'terraform init -backend-config="bucket=<project>-tfstate" -backend-config="prefix=<env>" -backend-config="impersonate_service_account=cnd-tf-sa@<project>.iam.gserviceaccount.com"',
    'terraform plan -var-file=envs/<env>.tfvars -out=<env>.tfplan', 'terraform apply <env>.tfplan', '```', '',
    '## Who can do what', '', 'The application runs as its own service account with only the roles in `iam` sections of each file. Terraform runs as `cnd-tf-sa`, which can grant only those roles and no others.', '',
  ].join('\n');
  out['.gitignore'] = '.terraform/\n*.tfplan\n*.tfstate\n*.tfstate.*\ncrash.log\n.bootstrap/\n';
  return out;
}

function infraWorkflow(n) {
  const L = ['name: "Infrastructure: plan and apply each environment in order"', 'on:', '  pull_request:', '    paths: ["infra/terraform/**"]', '  push:', '    branches: [main]', '    paths: ["infra/terraform/**"]', '  workflow_dispatch:', '',
    'permissions:', '  contents: read', '  id-token: write', '', 'defaults:', '  run:', '    working-directory: infra/terraform', '', 'jobs:'];
  let prev = '';
  for (const e of n.envs) {
    L.push(`  ${e.name}:`, ...(prev ? [`    needs: ${prev}`] : []), '    runs-on: ubuntu-latest',
      `    environment: ${e.name}${e.protected ? '   # protected: require reviewers on this GitHub environment' : ''}`,
      '    steps:', '      - uses: actions/checkout@v4',
      '      - uses: google-github-actions/auth@v2',
      '        with:', '          workload_identity_provider: ${{ vars.GCP_WORKLOAD_IDENTITY_PROVIDER }}', '          service_account: ${{ vars.GCP_TF_SERVICE_ACCOUNT }}   # cnd-tf-sa of this environment',
      '      - uses: hashicorp/setup-terraform@v3',
      '      - run: terraform init -input=false -backend-config="bucket=${{ vars.GCP_PROJECT }}-tfstate" -backend-config="prefix=' + e.name + '"',
      `      - run: terraform plan -input=false -var-file=envs/${e.name}.tfvars -out=${e.name}.tfplan`,
      `      - if: github.event_name != 'pull_request'`, `        run: terraform apply -input=false ${e.name}.tfplan`, '');
    prev = e.name;
  }
  L.push('# Create one GitHub environment per name above and set GCP_PROJECT, GCP_WORKLOAD_IDENTITY_PROVIDER and GCP_TF_SERVICE_ACCOUNT in it.',
    '# Pull requests only plan; a push to main applies, one environment after the other.');
  return `${L.join('\n')}\n`;
}

/* ------------------------------------------------------------------ steps (what Provision runs for the first environment) */

function buildSteps(n, m, tfFiles, project) {
  const env = n.env;
  const steps = [];
  const g = 'architecture';
  const add = (s) => steps.push({ env, group: g, ...s });
  const bucket = `${project}-tfstate`;
  const tfSa = `cnd-tf-sa@${project}.iam.gserviceaccount.com`;
  const userMember = n.options.userMember || '';
  const apis = [...new Set(['serviceusage.googleapis.com', 'cloudresourcemanager.googleapis.com', 'iam.googleapis.com', 'iamcredentials.googleapis.com', 'compute.googleapis.com', 'logging.googleapis.com', 'monitoring.googleapis.com', ...n.services.flatMap((s) => s.apis || [])])].sort();

  // 1. the code, in your project
  for (const [rel, content] of Object.entries(tfFiles)) add({ id: `file-${rel.replace(/[^\w]/g, '-')}`, title: `Write infra/terraform/${rel}`, cmd: 'echo', args: ['write'], writeFile: { path: `infra/terraform/${rel}`, content } });
  add({ id: 'file-workflow', title: 'Write .github/workflows/infra.yml', cmd: 'echo', args: ['write'], writeFile: { path: '.github/workflows/infra.yml', content: infraWorkflow(n) } });
  add({ id: 'file-condition', title: 'Write the grant limit for Terraform', cmd: 'echo', args: ['write'], writeFile: { path: 'infra/terraform/.bootstrap/grant-condition.json', content: `${JSON.stringify({ title: 'Only the roles this architecture needs', description: 'Terraform may grant only the roles listed here', expression: `api.getAttribute('iam.googleapis.com/modifiedGrantsByRole', []).hasOnly([${m.grantable.map((r) => `'${r}'`).join(', ')}])` }, null, 2)}\n` } });

  // 2. what must exist before Terraform: APIs, a state bucket, a Terraform identity that can only do this job
  add({ id: 'apis', title: `Turn on ${apis.length} Google APIs`, cmd: 'gcloud', args: ['services', 'enable', ...apis, `--project=${project}`], timeout: 900000, retries: 2, retryDelay: 15000 });
  add({ id: 'state-bucket', title: `Create the Terraform state bucket gs://${bucket}`, cmd: 'gcloud', args: ['storage', 'buckets', 'create', `gs://${bucket}`, `--project=${project}`, `--location=${n.region}`, '--uniform-bucket-level-access', '--public-access-prevention', '--quiet'], okIf: 'already exists|409',
    check: { cmd: 'gcloud', args: ['storage', 'buckets', 'describe', `gs://${bucket}`, '--format=value(name)'], match: `^${bucket}$` } });
  add({ id: 'state-versioning', title: 'Keep every version of the state', cmd: 'gcloud', args: ['storage', 'buckets', 'update', `gs://${bucket}`, '--versioning'] });
  add({ id: 'tf-sa', title: 'Create the Terraform service account cnd-tf-sa', cmd: 'gcloud', args: ['iam', 'service-accounts', 'create', 'cnd-tf-sa', '--display-name=Nativity Terraform', `--project=${project}`], okIf: 'already exists', retries: 2 });
  add({ id: 'tf-sa-state', title: 'cnd-tf-sa: manage objects in the state bucket only', cmd: 'gcloud', args: ['storage', 'buckets', 'add-iam-policy-binding', `gs://${bucket}`, `--member=serviceAccount:${tfSa}`, '--role=roles/storage.objectAdmin', '--quiet'], retries: 3, retryDelay: 8000 });
  const tf = m.accounts.find((a) => a.id === 'terraform');
  for (const r of tf.roles) add({ id: `tf-role-${r.role.split('/')[1]}`, title: `cnd-tf-sa: ${r.role}`, cmd: 'gcloud', args: ['projects', 'add-iam-policy-binding', project, `--member=serviceAccount:${tfSa}`, `--role=${r.role}`, '--condition=None', '--quiet'], retries: 3, retryDelay: 8000 });
  add({ id: 'tf-role-grant', title: 'cnd-tf-sa: may grant only the roles of this architecture', cmd: 'gcloud', args: ['projects', 'add-iam-policy-binding', project, `--member=serviceAccount:${tfSa}`, '--role=roles/resourcemanager.projectIamAdmin', '--condition-from-file=infra/terraform/.bootstrap/grant-condition.json', '--quiet'], retries: 3, retryDelay: 8000 });
  if (userMember) add({ id: 'tf-sa-you', title: 'You: may run Terraform as cnd-tf-sa (impersonation)', cmd: 'gcloud', args: ['iam', 'service-accounts', 'add-iam-policy-binding', tfSa, `--member=${userMember}`, '--role=roles/iam.serviceAccountTokenCreator', `--project=${project}`, '--quiet'], retries: 3 });

  // 3. Terraform
  const base = ['-chdir=infra/terraform'];
  add({ id: 'tf-init', title: 'terraform init', cmd: 'terraform', args: [...base, 'init', '-input=false', '-reconfigure', `-backend-config=bucket=${bucket}`, `-backend-config=prefix=${env}`, `-backend-config=impersonate_service_account=${tfSa}`], timeout: 600000, retries: 3, retryDelay: 15000 });
  add({ id: 'tf-validate', title: 'terraform validate', cmd: 'terraform', args: [...base, 'validate'], timeout: 120000 });
  add({ id: 'tf-plan', title: `terraform plan (${env})`, cmd: 'terraform', args: [...base, 'plan', '-input=false', '-lock-timeout=60s', `-var-file=envs/${env}.tfvars`, `-var=impersonate_service_account=${tfSa}`, `-out=${env}.tfplan`], timeout: 900000 });
  add({ id: 'tf-apply', title: `terraform apply (${env}): creates the architecture`, cmd: 'terraform', args: [...base, 'apply', '-input=false', '-lock-timeout=60s', `${env}.tfplan`], timeout: 3600000 });
  add({ id: 'file-state', title: 'Remember the architecture in .nativity/architecture.json', cmd: 'echo', args: ['write'], writeFile: { path: '.nativity/architecture.json', content: `${JSON.stringify({ app: n.app, region: n.region, services: n.services.map((s) => s.id), options: { nat: n.options.nat }, envs: n.envs, env }, null, 2)}\n` } });
  return steps;
}

/* ------------------------------------------------------------------ public */

function build(ctx) {
  return {
    catalog: () => ({ categories: CATEGORIES, services: SERVICES.map(({ id, cat, name, badge, recommended, desc, note, needs, conflicts, psa }) => ({ id, cat, name, badge: badge || '', recommended: !!recommended, desc, note: note || '', needs: needs || [], conflicts: conflicts || [], psa: !!psa })), presets: PRESETS }),
    /** Pure: the architecture and the Terraform for a selection. No sign-in needed. */
    preview(spec) {
      const n = normalize(spec);
      const m = model(n);
      const tf = files(n, m);
      return { model: m, files: Object.entries(tf).map(([p, content]) => ({ path: p, content })), workflow: infraWorkflow(n) };
    },
    /** The steps that provision the first environment (the others come from the pipeline). */
    async plan(spec, disc, ws) {
      const n = normalize(spec);
      const project = n.project;
      if (!PROJECT_RE.test(project)) throw new Error(`Enter the Google Cloud project of the ${n.env} environment (set it up first with the Cloud Native wizard).`);
      n.options.userMember = disc && disc.account ? `user:${disc.account}` : '';
      const m = model(n);
      const tfFiles = files(n, m);
      const steps = buildSteps(n, m, tfFiles, project);
      const blockers = [];
      const warnings = [...m.warnings];
      const t = ctx && ctx.exec ? await ctx.exec('terraform', ['version'], { timeout: 20000 }) : { ok: true };
      if (!t.ok) blockers.push('Terraform is not installed. Install it from developer.hashicorp.com/terraform/install, then try again.');
      const env = n.envs.find((e) => e.name === n.env);
      return {
        region: n.region, envs: [{ name: n.env, protected: !!(env && env.protected) }], steps, blockers, warnings, prerequisites: ['Terraform 1.6 or newer', `The Cloud Native wizard has set up the project ${project}`, 'Owner or Project IAM Admin on the project to create the Terraform identity'],
        summary: `${steps.length} steps in ${n.env}: ${n.services.map((s) => s.name).join(', ')}`,
        architecture: { title: `${n.app} · ${n.env}`, summary: `${n.services.length} services in ${project}`, model: m },
      };
    },
  };
}

module.exports = { build };
