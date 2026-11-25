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
  ['gateway', 'API gateway'], ['compute', 'Compute'], ['data', 'Data'], ['messaging', 'Messaging'], ['security', 'Security and edge'], ['ai', 'AI'], ['devops', 'Delivery and operations'],
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
    tf: ['data.tf', 'cloudsql'], apis: ['sqladmin.googleapis.com', 'compute.googleapis.com'], tfRoles: ['roles/cloudsql.admin'],
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
// What lives in which part of the network. gke / run: their own private subnets; data: the database's private subnet;
// psa: Google-managed services peered into the VPC; google: Google APIs reached over Private Google Access.
const ZONE = { octopus: 'gke', gke: 'gke', cloudrun: 'run', functions: 'run', cloudsql: 'data', redis: 'psa', apigee: 'psa' };
for (const s of SERVICES) s.zone = ZONE[s.id] || (s.id === 'edge' ? 'edge' : 'google');

/** More services the user can add. Their APIs are always enabled; resources are generated where noted, otherwise add them in Terraform yourself. */
const EXTRAS = [
  { id: 'functions', cat: 'compute', name: 'Cloud Run functions', desc: 'Event-driven functions (2nd gen). They run in the Cloud Run subnet.', apis: ['cloudfunctions.googleapis.com', 'run.googleapis.com', 'cloudbuild.googleapis.com', 'eventarc.googleapis.com'], apiOnly: true },
  { id: 'appengine', cat: 'compute', name: 'App Engine', desc: 'Fully managed platform for web apps.', apis: ['appengine.googleapis.com'], apiOnly: true },
  { id: 'batch', cat: 'compute', name: 'Batch', desc: 'Managed batch jobs on Compute Engine.', apis: ['batch.googleapis.com', 'compute.googleapis.com'], apiOnly: true },
  { id: 'workflows', cat: 'compute', name: 'Workflows', desc: 'Orchestrate services and APIs.', apis: ['workflows.googleapis.com'], apiOnly: true },
  { id: 'scheduler', cat: 'messaging', name: 'Cloud Scheduler', desc: 'Cron jobs that call your services.', apis: ['cloudscheduler.googleapis.com'], apiOnly: true },
  { id: 'cloudtasks', cat: 'messaging', name: 'Cloud Tasks', desc: 'A queue for work to run later, with an enqueue-only grant for the application.', apis: ['cloudtasks.googleapis.com'], tf: ['extras.tf', 'cloudtasks'], tfRoles: ['roles/cloudtasks.admin'], grants: [{ role: 'roles/cloudtasks.enqueuer', scope: 'this queue', why: 'add tasks to it' }] },
  { id: 'eventarc', cat: 'messaging', name: 'Eventarc', desc: 'Route events from Google services to your code.', apis: ['eventarc.googleapis.com'], apiOnly: true },
  { id: 'spanner', cat: 'data', name: 'Cloud Spanner', desc: 'Globally scalable relational database.', apis: ['spanner.googleapis.com'], apiOnly: true },
  { id: 'bigtable', cat: 'data', name: 'Bigtable', desc: 'Wide-column NoSQL for large analytical and operational workloads.', apis: ['bigtable.googleapis.com', 'bigtableadmin.googleapis.com'], apiOnly: true },
  { id: 'alloydb', cat: 'data', name: 'AlloyDB for PostgreSQL', desc: 'PostgreSQL-compatible database for demanding workloads. Sits in the data subnet.', apis: ['alloydb.googleapis.com', 'servicenetworking.googleapis.com'], apiOnly: true, zone: 'data' },
  { id: 'dataflow', cat: 'data', name: 'Dataflow', desc: 'Stream and batch data processing.', apis: ['dataflow.googleapis.com'], apiOnly: true },
  { id: 'vertexai', cat: 'ai', name: 'Vertex AI', desc: 'Models, training and prediction (Gemini, custom models).', apis: ['aiplatform.googleapis.com'], apiOnly: true },
  { id: 'dns', cat: 'security', name: 'Cloud DNS', desc: 'Managed DNS zones.', apis: ['dns.googleapis.com'], apiOnly: true },
  { id: 'iap', cat: 'security', name: 'Identity-Aware Proxy', desc: 'Sign-in in front of web apps without a VPN.', apis: ['iap.googleapis.com'], apiOnly: true },
  { id: 'identityplatform', cat: 'security', name: 'Identity Platform', desc: 'Customer sign-in and sign-up.', apis: ['identitytoolkit.googleapis.com'], apiOnly: true },
  { id: 'artifactregistry', cat: 'devops', name: 'Artifact Registry', desc: 'Container images and packages.', apis: ['artifactregistry.googleapis.com'], apiOnly: true },
  { id: 'cloudbuild', cat: 'devops', name: 'Cloud Build', desc: 'Build and test in the cloud.', apis: ['cloudbuild.googleapis.com'], apiOnly: true },
  { id: 'clouddeploy', cat: 'devops', name: 'Cloud Deploy', desc: 'Continuous delivery to GKE and Cloud Run.', apis: ['clouddeploy.googleapis.com'], apiOnly: true },
  { id: 'trace', cat: 'devops', name: 'Cloud Trace and Error Reporting', desc: 'Request traces and grouped errors.', apis: ['cloudtrace.googleapis.com', 'clouderrorreporting.googleapis.com'], apiOnly: true },
];
for (const e of EXTRAS) { e.extra = true; e.zone = e.zone || ZONE[e.id] || 'google'; e.tfRoles = e.tfRoles || []; e.grants = e.grants || []; }
SERVICES.push(...EXTRAS);
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

/** Address plan of one environment: a /16 of its own, so environments never overlap and can be connected later. Every tier has its own subnet. */
function cidrPlan(index, custom, k = 0) {
  const base0 = /^\d{1,3}\.\d{1,3}$/.test(String(custom || '')) ? String(custom) : `10.${10 * (index + 1)}`;
  // a second, third ... VPC of the same environment takes the next /16 (10.10 -> 10.11), so they can be peered
  const [a, b] = base0.split('.').map(Number);
  const base = k ? `${a}.${b + k}` : base0;
  return {
    env: `${base}.0.0/16`, gke: `${base}.0.0/20`, data: `${base}.16.0/24`, gkeMaster: `${base}.20.0/28`, run: `${base}.32.0/24`,
    gkePods: `${base}.64.0/18`, gkeServices: `${base}.128.0/20`, psaAddress: `${base}.240.0`, psaPrefix: 20, psa: `${base}.240.0/20`,
    service: (i) => `${base}.${48 + i}.0/24`,
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

const slugId = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
const API_RE = /^[a-z][a-z0-9-]*\.googleapis\.com$/;
const ROLE_RE = /^roles\/[A-Za-z0-9._]+$/;

/** `strict`: the project choices are checked too (when planning). While drawing, only the architecture matters. */
function normalize(spec, strict) {
  const s = spec || {};
  const app = String(s.app || '').trim().toLowerCase();
  if (!APP_RE.test(app)) throw new Error('The application name must be 3-21 characters: lower-case letters, digits and "-", starting with a letter.');
  const region = REGION_RE.test(String(s.region || '')) ? s.region : 'us-central1';
  // an environment's project is either one that exists or one to create now (with a billing account)
  const createOf = (c, name) => {
    if (!c) return null;
    if (!strict) return { id: String(c.id || ''), billing: '', org: '', name: '' };
    const id = String(c.id || '');
    if (!PROJECT_RE.test(id)) throw new Error(`The new project id "${id}" is not valid: 6-30 characters, lower-case letters, digits and "-", starting with a letter.`);
    const billing = String(c.billing || '');
    if (!/^[A-Z0-9]{6}-[A-Z0-9]{6}-[A-Z0-9]{6}$/.test(billing)) throw new Error(`Choose a billing account for the new project of ${name}.`);
    const org = String(c.org || '');
    if (org && !/^\d{6,20}$/.test(org)) throw new Error('The organization id is not valid.');
    return { id, billing, org, name: String(c.name || id).replace(/[^A-Za-z0-9 '!-]/g, '').slice(0, 30) || id };
  };
  const envs = (Array.isArray(s.envs) && s.envs.length ? s.envs : [{ name: 'dev' }]).map((e) => { const name = String(e.name || '').toLowerCase(); const create = createOf(e.create, name); return { name, protected: !!e.protected, project: create ? create.id : String(e.project || ''), create }; });
  for (const e of envs) if (!ENV_RE.test(e.name)) throw new Error(`"${e.name}" is not a valid environment name.`);
  if (new Set(envs.map((e) => e.name)).size !== envs.length) throw new Error('Each environment name must be unique.');
  const { list, added } = resolveServices(s.services);
  // services the user adds that are not in the catalog: a name, the Google API to enable, where it lives, optionally a role for the application
  const custom = [];
  for (const c of (Array.isArray(s.custom) ? s.custom : []).slice(0, 12)) {
    const name = String(c.name || '').trim().slice(0, 40);
    const api = String(c.api || '').trim();
    if (!name) throw new Error('Give each added service a name.');
    if (!API_RE.test(api)) throw new Error(`"${api}" is not a Google API name (for example translate.googleapis.com).`);
    const tier = ['app', 'data', 'google'].includes(c.tier) ? c.tier : 'google';
    const role = String(c.role || '').trim();
    if (role && !ROLE_RE.test(role)) throw new Error(`"${role}" is not a role name (for example roles/translate.user).`);
    const id = `x-${slugId(name) || 'service'}`;
    if (custom.some((x) => x.id === id) || BY_ID.has(id)) throw new Error(`"${name}" is added twice.`);
    custom.push({ id, cat: 'custom', name, desc: `Added by you · ${api}`, apis: [api], tfRoles: [], custom: true, apiOnly: true, tier, zone: tier === 'app' ? `svc:${id}` : tier === 'data' ? 'data' : 'google',
      grants: role ? [{ role, scope: 'project', why: 'added by you' }] : [] });
  }
  const services = [...list, ...custom];
  const opts = { nat: s.options ? s.options.nat !== false : true, ...(s.options || {}) };
  const first = envs.find((e) => e.name === s.env) || envs[0];
  const edges = Array.isArray(s.edges) ? s.edges.slice(0, 80).map((e) => ({ from: String(e.from || ''), to: String(e.to || ''), label: String(e.label || '').slice(0, 30) })) : null;
  const design = s.design && typeof s.design === 'object' ? s.design : null;
  const canvas = s.canvas && typeof s.canvas === 'object' && JSON.stringify(s.canvas).length < 200000 ? s.canvas : null;
  return { app, region, envs, services, added, custom, options: opts, env: first.name, project: String(s.project || first.project || ''), edges, notes: String(s.notes || '').slice(0, 2000), design, canvas };
}

/** Services that need a VPC and which VPC of the design each one is in. No such service: no VPC is created. Several VPCs are allowed. */
function vpcsOf(n) {
  const needs = (s) => s.zone === 'gke' || s.zone === 'run' || String(s.zone).startsWith('svc:') || s.zone === 'data' || s.zone === 'psa';
  const needing = n.services.filter(needs);
  const d = n.design;
  let list = [];
  if (d && Array.isArray(d.vpcs) && d.vpcs.length) list = d.vpcs.slice(0, 6).map((v, k) => ({ id: String(v.id), k }));
  else if (needing.length || (d && d.vpc)) list = [{ id: 'v1', k: 0 }];
  const subnetVpc = new Map(((d && d.subnets) || []).map((x) => [x.id, x.vpc || 'v1']));
  const where = new Map();
  for (const node of (d && d.nodes) || []) { const vid = node.subnet ? subnetVpc.get(node.subnet) : node.vpc; if (vid && vid !== true) where.set(node.type, String(vid)); else if (node.vpc === true && list.length) where.set(node.type, list[0].id); }
  for (const x of needing) if (!where.has(x.id) && list.length) where.set(x.id, list[0].id);
  for (const v of list) v.services = needing.filter((x) => where.get(x.id) === v.id);
  return { list, where };
}

/* ------------------------------------------------------------------ the model (diagram, identities, network) */

function model(n) {
  const has = (id) => n.services.some((s) => s.id === id);
  const inZone = (z) => n.services.filter((s) => s.zone === z);
  const idx = Math.max(0, n.envs.findIndex((e) => e.name === n.env));
  const gw = has('octopus') ? 'octopus' : has('apigee') ? 'apigee' : '';
  const psa = n.services.some((s) => s.psa || s.zone === 'psa');
  const hasGke = inZone('gke').length > 0;
  const { list: vlist, where } = vpcsOf(n);

  // one network per VPC; inside each, one private subnet per tier: nothing shares
  const vpcs = vlist.map((v) => {
    const c = cidrPlan(idx, (n.options.cidr || {})[n.env], v.k);
    const N = v.k ? `-${v.k + 1}` : '';
    const vs = v.services;
    const subnets = [];
    if (vs.some((x) => x.zone === 'gke')) subnets.push({ id: 'gke', tier: 'application', name: `${n.app}-${n.env}${N}-gke`, cidr: c.gke, purpose: 'GKE nodes (private)', secondary: [{ name: 'pods', cidr: c.gkePods }, { name: 'services', cidr: c.gkeServices }] });
    if (vs.some((x) => x.zone === 'run')) subnets.push({ id: 'run', tier: 'application', name: `${n.app}-${n.env}${N}-run`, cidr: c.run, purpose: 'Cloud Run and functions (Direct VPC egress)', secondary: [] });
    vs.filter((x) => x.custom && x.tier === 'app').forEach((x, i) => subnets.push({ id: `svc:${x.id}`, tier: 'application', name: `${n.app}-${n.env}${N}-${x.id}`, cidr: c.service(i), purpose: `${x.name}`, secondary: [] }));
    if (vs.some((x) => x.zone === 'data')) subnets.push({ id: 'data', tier: 'data', name: `${n.app}-${n.env}${N}-data`, cidr: c.data, purpose: 'The database’s private endpoint. Nothing else lives here.', secondary: [] });
    const hasPsa = vs.some((x) => x.zone === 'psa');
    return { id: v.id, k: v.k, vpc: `${n.app}-${n.env}${N}-vpc`, region: n.region, cidr: c.env, subnets, nat: !!n.options.nat, psa: hasPsa ? { cidr: c.psa, purpose: 'Private service range for Memorystore and Apigee' } : null, gkeMaster: vs.some((x) => x.zone === 'gke') ? c.gkeMaster : '' };
  });
  const network = vpcs[0] || { id: '', k: 0, vpc: '', region: n.region, cidr: '', subnets: [], nat: false, psa: null, gkeMaster: '' };

  // identities, each with only what it needs
  const accounts = [];
  const appGrants = [{ role: 'roles/logging.logWriter', scope: 'project', why: 'write logs' }, { role: 'roles/monitoring.metricWriter', scope: 'project', why: 'write metrics' }];
  for (const s of n.services) for (const g of s.grants || []) appGrants.push(g);
  accounts.push({ id: 'app', email: `${n.app}-${n.env}-app`, title: 'Application', purpose: 'What your code runs as. One identity per workload, no keys.', roles: appGrants });
  if (hasGke) accounts.push({ id: 'nodes', email: `${n.app}-${n.env}-nodes`, title: 'GKE nodes', purpose: 'The cluster’s machines: logs, metrics and pulling images only.', roles: ['roles/logging.logWriter', 'roles/monitoring.metricWriter', 'roles/monitoring.viewer', 'roles/stackdriver.resourceMetadata.writer', 'roles/artifactregistry.reader'].map((r) => ({ role: r, scope: 'project', why: '' })) });
  if (gw === 'octopus') accounts.push({ id: 'octopus', email: `${n.app}-${n.env}-octopus`, title: 'Octopus API Gateway', purpose: 'The gateway’s own identity through workload identity.', roles: [{ role: 'roles/datastore.user', scope: 'project', why: 'its configuration and audit data' }, { role: 'roles/logging.logWriter', scope: 'project', why: '' }, { role: 'roles/monitoring.metricWriter', scope: 'project', why: '' }] });
  const tfRoles = [...new Set(['roles/compute.networkAdmin', 'roles/iam.serviceAccountAdmin', 'roles/iam.serviceAccountUser', 'roles/serviceusage.serviceUsageConsumer', ...n.services.flatMap((s) => s.tfRoles || [])])].sort();
  const grantable = [...new Set([...accounts.flatMap((a) => a.roles.map((r) => r.role)), 'roles/iam.workloadIdentityUser'])].sort();
  accounts.push({ id: 'terraform', email: 'cnd-tf-sa', title: 'Terraform', purpose: 'Creates and changes the infrastructure. Used only for provisioning, never by the application.', roles: tfRoles.map((r) => ({ role: r, scope: 'project', why: '' })), grantable });

  // the picture: nodes
  const nodes = [{ id: 'users', kind: 'users', label: 'Users and clients', zone: 'outside' }];
  if (has('edge')) nodes.push({ id: 'edge', kind: 'edge', label: 'Cloud Armor + HTTPS entry', sub: 'static IP · OWASP rules', zone: 'edge' });
  for (const s of n.services) {
    if (s.id === 'edge') continue;
    const sub = { octopus: 'runs on GKE · from Marketplace', apigee: 'Google-managed, peered', gke: 'private nodes · workload identity', cloudrun: 'Direct VPC egress', cloudsql: 'private endpoint (PSC)', redis: 'private IP only', secrets: 'value kept out of state', functions: 'in the Cloud Run subnet' }[s.id] || (s.custom ? s.apis[0] : s.apiOnly ? 'API enabled' : '');
    nodes.push({ id: s.id, kind: s.custom ? 'custom' : s.id, label: s.name, sub, zone: s.zone, sa: ['octopus'].includes(s.id) ? 'octopus' : (s.zone === 'gke' || s.zone === 'run' || (s.custom && s.tier === 'app')) ? 'app' : '', custom: !!s.custom, apiOnly: !!s.apiOnly });
  }
  nodes.push({ id: 'ops', kind: 'ops', label: 'Cloud Logging and Monitoring', sub: 'always on', zone: 'ops' });

  // the picture: connections. A first guess; the user describes the real ones and regenerates.
  const suggested = [];
  const nodeIds = new Set(nodes.map((x) => x.id));
  const link = (arr, from, to, label, kind) => { if (nodeIds.has(from) && nodeIds.has(to)) arr.push({ from, to, label: label || '', kind: kind || 'private' }); };
  const compute = nodes.filter((x) => (x.zone === 'gke' || x.zone === 'run' || String(x.zone).startsWith('svc:')) && x.id !== gw).map((x) => x.id);
  const front = has('edge') ? 'edge' : 'users';
  if (has('edge')) link(suggested, 'users', 'edge', 'HTTPS', 'public');
  const entry = gw || compute[0];
  if (entry) link(suggested, front, entry, has('edge') ? '' : 'HTTPS', has('edge') ? 'private' : 'public');
  const zoneOf0 = (id) => (nodes.find((x) => x.id === id) || {}).zone;
  // Octopus runs on GKE, so it only routes to workloads outside its own cluster; Apigee routes to all of them
  if (gw) for (const id of compute) if (!(gw === 'octopus' && zoneOf0(id) === 'gke')) link(suggested, gw, id, 'routes to', 'private');
  const workers = [...(gw === 'octopus' ? ['octopus'] : []), ...compute];
  for (const w of workers) {
    for (const x of nodes) {
      // the gateway itself needs only its configuration store and its cache
      if (w === 'octopus' && !['firestore', 'redis'].includes(x.id)) continue;
      if (x.zone === 'data') link(suggested, w, x.id, 'private endpoint', 'private');
      else if (x.zone === 'psa' && x.id !== gw) link(suggested, w, x.id, 'private IP', 'private');
      else if (x.zone === 'google') link(suggested, w, x.id, 'Google APIs', 'google');
    }
  }
  const zoneOf = (id) => (nodes.find((x) => x.id === id) || {}).zone;
  const kindOf = (a, b) => (b === 'users' || a === 'users' ? 'public' : zoneOf(b) === 'google' ? 'google' : 'private');
  let edges = suggested;
  const customEdges = Array.isArray(n.edges); // null: the suggestion; a list (even an empty one): the user's own connections
  if (customEdges) {
    edges = [];
    for (const e of n.edges) { if (e.from !== e.to) link(edges, e.from, e.to, e.label, kindOf(e.from, e.to)); }
  }
  for (const w of workers) link(edges, w, 'ops', '', 'ops');

  // two VPCs that have a connection between them are peered (their address ranges never overlap)
  const vk = new Map(vlist.map((v) => [v.id, v.k]));
  const peerings = [];
  for (const e of edges) {
    const a = where.get(e.from);
    const b = where.get(e.to);
    if (a && b && a !== b) { const key = [vk.get(a), vk.get(b)].sort().join('-'); if (!peerings.some((p) => p.key === key)) peerings.push({ key, a: Math.min(vk.get(a), vk.get(b)), b: Math.max(vk.get(a), vk.get(b)) }); }
  }
  // every API each service needs: this is exactly what the provisioning step turns on
  const baseApis = ['serviceusage.googleapis.com', 'cloudresourcemanager.googleapis.com', 'iam.googleapis.com', 'iamcredentials.googleapis.com', 'compute.googleapis.com', 'logging.googleapis.com', 'monitoring.googleapis.com', 'artifactregistry.googleapis.com'];
  const apiTable = [{ service: 'Foundation (network, identities, logs, Terraform)', apis: baseApis }];
  if (psa) apiTable.push({ service: 'Private service range', apis: ['servicenetworking.googleapis.com'] });
  for (const s of n.services) if ((s.apis || []).length) apiTable.push({ service: s.name, apis: s.apis });
  const allApis = [...new Set(apiTable.flatMap((r) => r.apis))].sort();

  const warnings = [];
  if (!n.services.length) warnings.push('Nothing is drawn yet, so this creates a blank Terraform scaffold: the provider, remote state, the application identity and one variable file per environment. Add your resources in infra/terraform (or draw them and generate again).');
  if (n.options.nat && vlist.length) warnings.push('Cloud NAT lets private workloads reach the internet outbound; nothing can reach them inbound.');
  if (has('apigee')) warnings.push('Apigee takes 30 minutes or more to create and is billed per its edition. Octopus API Gateway is the cost-effective alternative.');
  if (has('gke')) warnings.push('GKE Autopilot is billed for the pods you run; an idle cluster is cheap but not free.');
  if (has('cloudsql') || has('redis')) warnings.push('Cloud SQL and Memorystore are billed while they exist, even when idle. Use the smallest sizes in development.');
  if (vpcs.length > 1) warnings.push(`${vpcs.length} VPCs: ${peerings.length ? `VPC peering is created between the ones that have a connection (${peerings.map((p) => `${vpcs[p.a].vpc} ↔ ${vpcs[p.b].vpc}`).join(', ')}).` : 'they are isolated from each other until you connect services across them.'} Tip: one VPC per environment is the usual recommendation; extra VPCs add peering to manage.`);
  const apiOnly = n.services.filter((s) => s.apiOnly).map((s) => s.name);
  if (apiOnly.length) warnings.push(`${apiOnly.join(', ')}: the API is enabled and the service appears in the diagram, but no Terraform resource is generated for it. Add the resources you need in infra/terraform.`);

  return { app: n.app, env: n.env, region: n.region, gateway: gw, network, vpcs, cidr: { env: network.cidr, psa: network.psa ? network.psa.cidr : '' }, accounts, nodes, edges, suggestedEdges: suggested, customEdges, apis: apiTable, allApis, warnings, added: n.added, services: n.services.map((s) => s.id), grantable, peerings, notes: n.notes,
    nodeChoices: nodes.filter((x) => x.id !== 'ops').map((x) => ({ id: x.id, label: x.label })) };
}

/* ------------------------------------------------------------------ Terraform */

function files(n, m) {
  const out = {};
  const has = (id) => n.services.some((s) => s.id === id);
  const { list: vlist, where } = vpcsOf(n);
  const kOf = (id) => { const v = vlist.find((x) => x.id === where.get(id)); return v ? v.k : 0; };
  // one block of the network template per VPC: __S__ suffixes the resource names, __N__ the names, __P__ the variables
  const tok = (text, k) => text.replace(/__S__/g, k ? `_${k + 1}` : '').replace(/__N__/g, k ? `-${k + 1}` : '').replace(/__P__/g, k ? `v${k + 1}_` : '');
  out['main.tf'] = fs.readFileSync(path.join(TF_DIR, 'core.tf'), 'utf8').replace(/\r\n/g, '\n');
  if (vlist.length) {
    const tpl = fs.readFileSync(path.join(TF_DIR, 'network.tf'), 'utf8').replace(/\r\n/g, '\n');
    const head = tpl.slice(0, tpl.indexOf('\n') + 1);
    const body = tpl.slice(head.length);
    out['network.tf'] = vlist.map((v) => `# ---------------------------------------------------------------- VPC ${v.k + 1}: ${m.vpcs[v.k] ? m.vpcs[v.k].vpc : ''}\n${tok(body, v.k)}`).join('\n');
  }
  // the Terraform of each service, bound to the network of the VPC it was drawn in
  const byFile = new Map();
  for (const sv of n.services) {
    if (!sv.tf) continue;
    const [file, sec] = sv.tf;
    const all = sections(file);
    if (!all[sec]) continue;
    byFile.set(file, [...(byFile.get(file) || []), tok(all[sec], kOf(sv.id))]);
  }
  for (const [file, parts] of byFile) { const body = parts.join('\n'); out[file] = body.endsWith('\n') ? body : `${body}\n`; }
  // nothing drawn (or nothing with Terraform behind it): a scaffold to build on, not an empty folder
  if (!byFile.size) out['services.tf'] = [
    '# Your resources go here (or in files next to this one).',
    '#',
    '# The scaffold already gives you: the provider and remote state (main.tf), the application identity with log and metric access,',
    '# one variable file per environment (envs/*.tfvars) and the pipeline (.github/workflows/infra.yml).',
    '#',
    '# Example: a private bucket the application may read and write, and nothing else.',
    '#',
    '# resource "google_storage_bucket" "data" {',
    '#   name                        = "${var.project_id}-${var.app}-data"',
    '#   location                    = var.region',
    '#   uniform_bucket_level_access = true',
    '#   public_access_prevention    = "enforced"',
    '# }',
    '#',
    '# resource "google_storage_bucket_iam_member" "app_objects" {',
    '#   bucket = google_storage_bucket.data.name',
    '#   role   = "roles/storage.objectUser"',
    '#   member = "serviceAccount:${google_service_account.app.email}"',
    '# }',
    '',
  ].join('\n');
  let outputs = fs.readFileSync(path.join(TF_DIR, 'outputs.tf'), 'utf8').replace(/\r\n/g, '\n');
  for (const v of vlist) {
    const S = v.k ? `_${v.k + 1}` : '';
    outputs += `\noutput "network${S}" {\n  value       = google_compute_network.vpc${S}.name\n  description = "A VPC of this environment"\n}\n\noutput "subnets${S}" {\n  value = {\n    gke  = one(google_compute_subnetwork.gke${S}[*].ip_cidr_range)\n    run  = one(google_compute_subnetwork.run${S}[*].ip_cidr_range)\n    data = one(google_compute_subnetwork.data${S}[*].ip_cidr_range)\n  }\n}\n`;
  }
  out['outputs.tf'] = outputs;
  if (has('octopus')) out['outputs.tf'] += '\noutput "octopus_service_account" {\n  value = google_service_account.octopus.email\n}\n\noutput "edge_ip" {\n  value = google_compute_global_address.edge.address\n}\n';
  if (has('gke')) out['outputs.tf'] += '\noutput "gke_cluster" {\n  value = google_container_cluster.gke.name\n}\n';
  if (has('cloudrun')) out['outputs.tf'] += '\noutput "cloud_run_url" {\n  value = google_cloud_run_v2_service.app.uri\n}\n';
  // VPCs that talk to each other are peered, in both directions
  if (m.peerings && m.peerings.length) {
    const sfx = (k) => (k ? `_${k + 1}` : '');
    out['peering.tf'] = '# VPC peering between the VPCs that have a connection between them. Both directions are needed.\n' + m.peerings.map((p) => `resource "google_compute_network_peering" "peer_${p.a + 1}_to_${p.b + 1}" {\n  name         = "\${local.name}-peer-${p.a + 1}-to-${p.b + 1}"\n  network      = google_compute_network.vpc${sfx(p.a)}.self_link\n  peer_network = google_compute_network.vpc${sfx(p.b)}.self_link\n}\n\nresource "google_compute_network_peering" "peer_${p.b + 1}_to_${p.a + 1}" {\n  name         = "\${local.name}-peer-${p.b + 1}-to-${p.a + 1}"\n  network      = google_compute_network.vpc${sfx(p.b)}.self_link\n  peer_network = google_compute_network.vpc${sfx(p.a)}.self_link\n  depends_on   = [google_compute_network_peering.peer_${p.a + 1}_to_${p.b + 1}]\n}\n`).join('\n');
  }
  // one variable file per environment, each with its own address ranges (one /16 per VPC)
  n.envs.forEach((e, i) => {
    const gateway = has('apigee') || has('octopus');
    const lines = [
      `project_id = ${q(e.project || '<project-id-of-' + e.name + '>')}`, `region     = ${q(n.region)}`, `app        = ${q(n.app)}`, `env        = ${q(e.name)}`,
      `deletion_protection = ${e.protected || e.name === 'prod' ? 'true' : 'false'}`,
    ];
    for (const v of vlist) {
      const c = cidrPlan(i, (n.options.cidr || {})[e.name], v.k);
      const P = v.k ? `v${v.k + 1}_` : '';
      const vs = v.services;
      const customApps = vs.filter((x) => x.custom && x.tier === 'app');
      const gke = vs.some((x) => x.zone === 'gke');
      const run = vs.some((x) => x.zone === 'run');
      const data = vs.some((x) => x.zone === 'data');
      const psa = vs.some((x) => x.zone === 'psa');
      const app = gke || run || customApps.length;
      lines.push('', `# VPC ${v.k + 1}`, `${P}cidr_env = ${q(c.env)}`,
        ...(gke ? [`${P}cidr_gke = ${q(c.gke)}`, `${P}cidr_gke_master = ${q(c.gkeMaster)}`, `${P}cidr_gke_pods = ${q(c.gkePods)}`, `${P}cidr_gke_services = ${q(c.gkeServices)}`] : []),
        ...(run ? [`${P}cidr_run = ${q(c.run)}`] : []),
        ...(data ? [`${P}cidr_data = ${q(c.data)}`] : []),
        ...(psa ? [`${P}psa_address = ${q(c.psaAddress)}`, `${P}psa_prefix_length = ${c.psaPrefix}`] : []),
        ...(customApps.length ? [`${P}service_subnets = {`, ...customApps.map((x, k) => `  ${q(x.id)} = ${q(c.service(k))}`), '}'] : []),
        `${P}enable_nat = ${n.options.nat ? 'true' : 'false'}`, `${P}enable_psa = ${psa ? 'true' : 'false'}`, `${P}enable_gke = ${gke ? 'true' : 'false'}`, `${P}enable_run = ${run ? 'true' : 'false'}`, `${P}enable_data = ${data ? 'true' : 'false'}`, `${P}enable_lb_edge = ${has('edge') && app ? 'true' : 'false'}`);
    }
    if (has('cloudrun') && (gateway || has('edge'))) lines.push('', 'cloudrun_ingress = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"');
    out[`envs/${e.name}.tfvars`] = `${lines.join('\n')}\n`;
  });
  out['README.md'] = [
    `# ${n.app}: infrastructure`, '',
    'Generated by Nativity Studio from your architecture. Edit it like any Terraform; the wizard writes these files again only when you ask.', '',
    '| File | What it holds |', '|---|---|', '| `main.tf` | provider, variables and the application identity |', ...(out['network.tf'] ? ['| `network.tf` | each VPC with its private subnets (one per tier), NAT, private service range and firewall |'] : []), ...(out['peering.tf'] ? ['| `peering.tf` | peering between VPCs that have a connection between them |'] : []),
    ...Object.keys(out).filter((f) => f.endsWith('.tf') && !['main.tf', 'outputs.tf', 'network.tf', 'peering.tf'].includes(f)).map((f) => `| \`${f}\` | ${n.services.filter((s) => s.tf && s.tf[0] === f).map((s) => s.name).join(', ')} |`),
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
  // projects to create first: the first environment's project is part of this run, the other ones are only created (nothing is built in them)
  for (const e of n.envs) {
    if (!e.create) continue;
    const c = e.create;
    const own = { env: e.name, group: g };
    steps.push({ ...own, id: `project-create-${e.name}`, title: `Create project ${c.id} for ${e.name}`, cmd: 'gcloud', args: ['projects', 'create', c.id, `--name=${c.name}`, `--labels=app=${n.app},environment=${e.name},managed-by=nativity-studio`, ...(c.org ? [`--organization=${c.org}`] : []), '--quiet'], okIf: 'already exists', retries: 2, retryDelay: 8000,
      check: { cmd: 'gcloud', args: ['projects', 'describe', c.id, '--format=value(projectId)'], match: `^${c.id}$` } });
    steps.push({ ...own, id: `project-billing-${e.name}`, title: `Link billing account ${c.billing} to ${c.id}`, cmd: 'gcloud', args: ['billing', 'projects', 'link', c.id, `--billing-account=${c.billing}`], retries: 4, retryDelay: 8000 });
  }
  const bucket = `${project}-tfstate`;
  const tfSa = `cnd-tf-sa@${project}.iam.gserviceaccount.com`;
  const userMember = n.options.userMember || '';
  const apis = m.allApis; // every API of every selected service, foundation included

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
  add({ id: 'file-state', title: 'Remember the architecture in .nativity/architecture.json', cmd: 'echo', args: ['write'], writeFile: { path: '.nativity/architecture.json', content: `${JSON.stringify({ app: n.app, region: n.region, services: n.services.filter((s) => !s.custom).map((s) => s.id), custom: n.custom.map((c) => ({ name: c.name, api: c.apis[0], tier: c.tier, role: (c.grants[0] || {}).role || '' })), edges: n.edges, notes: n.notes, canvas: n.canvas, options: { nat: n.options.nat }, envs: n.envs.map((e) => ({ name: e.name, protected: e.protected, project: e.project })), env }, null, 2)}\n` } });
  return steps;
}

/* ------------------------------------------------------------------ rules for the canvas design */

/** Application services and databases need a VPC and a private subnet; one application platform per subnet. Mirrors the canvas. */
function designProblems(n) {
  const d = n.design;
  if (!d) return [];
  const out = [];
  const vids = new Set((d.vpcs || []).map((v) => String(v.id)));
  if (d.vpc && !vids.size) vids.add('v1');
  const subnets = new Map((d.subnets || []).map((x) => [x.id, { kind: x.kind, vpc: x.vpc || 'v1' }]));
  const platforms = new Map();
  for (const node of d.nodes || []) {
    const svc = n.services.find((s) => s.id === node.type);
    if (!svc) continue;
    const z = svc.zone;
    const app = z === 'gke' || z === 'run' || String(z).startsWith('svc:');
    const sn = node.subnet ? subnets.get(node.subnet) : null;
    if ((app || z === 'data' || z === 'psa') && !vids.size) out.push(`${svc.name} needs a VPC.`);
    if (app && !(sn && sn.kind === 'app' && vids.has(sn.vpc))) out.push(`${svc.name} must run in a private application subnet of a VPC.`);
    if (z === 'data' && !(sn && sn.kind === 'data' && vids.has(sn.vpc))) out.push(`${svc.name} must sit in a private database subnet of a VPC.`);
    if (app && node.subnet) platforms.set(node.subnet, [...(platforms.get(node.subnet) || []), node.type]);
  }
  for (const [id, types] of platforms) if (types.filter((t) => t !== 'octopus' && t !== 'gke').length > 1) out.push(`Subnet ${id}: each application service runs in its own private subnet.`);
  return out;
}

/* ------------------------------------------------------------------ public */

function build(ctx) {
  return {
    catalog: () => ({ categories: CATEGORIES, services: SERVICES.map(({ id, cat, name, badge, recommended, desc, note, needs, conflicts, psa, extra, apiOnly, apis, zone }) => ({ id, cat, name, badge: badge || '', recommended: !!recommended, desc, note: note || '', needs: needs || [], conflicts: conflicts || [], psa: !!psa, extra: !!extra, apiOnly: !!apiOnly, apis: apis || [], zone })), presets: PRESETS }),
    /** Pure: the architecture and the Terraform for a selection. No sign-in needed. */
    preview(spec) {
      const n = normalize(spec, false);
      const m = model(n);
      const tf = files(n, m);
      return { model: m, files: Object.entries(tf).map(([p, content]) => ({ path: p, content })), workflow: infraWorkflow(n) };
    },
    /** The steps that provision the first environment (the others come from the pipeline). */
    async plan(spec, disc, ws) {
      const n = normalize(spec, true);
      const project = n.project;
      const bad = designProblems(n);
      const made = n.envs.filter((e) => e.create).map((e) => e.name);
      if (bad.length) throw new Error(`The architecture breaks a rule: ${bad[0]}`);
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
        region: n.region, envs: [{ name: n.env, protected: !!(env && env.protected) }], steps, blockers, warnings, prerequisites: ['Terraform 1.6 or newer', n.envs.some((e) => e.create) ? 'Permission to create projects (Project Creator) and to link the billing account (Billing Account User)' : `The project ${project} exists and has billing`, 'Owner or Project IAM Admin on the project to create the Terraform identity'],
        summary: `${steps.length} steps in ${n.env}: ${made.length ? `create the project${made.length > 1 ? 's' : ''} of ${made.join(', ')}, then ` : ''}${n.services.map((s) => s.name).join(', ') || 'a blank Terraform scaffold'}`,
        architecture: { title: `${n.app} · ${n.env}`, summary: `${n.services.length} services in ${project}`, model: m },
      };
    },
  };
}

module.exports = { build };
