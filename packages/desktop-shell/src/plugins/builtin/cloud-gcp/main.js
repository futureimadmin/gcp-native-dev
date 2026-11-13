/** Google Cloud connector. Identity = Application Default Credentials (ADC). */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

exports.activate = (ctx) => {
  const { exec, commandLine, isMissing } = ctx;

  let sdk = null;
  try { sdk = require('@cnd-ide/core-sdk'); } catch (e) { ctx.log('core-sdk unavailable:', e.message); }

  const PROJECT_RE = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
  const REGION_RE = /^[a-z]+-[a-z0-9]+[0-9]$/;
  const NAME_RE = /^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/;

  const adcPath = () => {
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return process.env.GOOGLE_APPLICATION_CREDENTIALS;
    return process.platform === 'win32'
      ? path.join(process.env.APPDATA || '', 'gcloud', 'application_default_credentials.json')
      : path.join(os.homedir(), '.config', 'gcloud', 'application_default_credentials.json');
  };

  function readAdc() {
    const p = adcPath();
    if (!fs.existsSync(p)) return null;
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      return { path: p, type: j.type || 'unknown', quotaProject: j.quota_project_id || '', clientEmail: j.client_email || '' };
    } catch {
      return { path: p, type: 'unreadable', quotaProject: '', clientEmail: '' };
    }
  }

  const gcloud = (proj, args) => {
    const a = [...args, `--project=${proj.scope}`];
    if (proj.impersonate) a.push(`--impersonate-service-account=${proj.impersonate}`);
    return commandLine('gcloud', a);
  };

  async function catalogFor(opts) {
    if (!sdk) throw new Error('The bundled core SDK is missing; rebuild packages/core-sdk.');
    let source;
    if (opts && opts.impersonate) {
      const client = await sdk.createImpersonatedAuth({ targetPrincipal: opts.impersonate });
      source = { async getAccessToken() { const r = await client.getAccessToken(); return r && r.token; } };
    }
    return new sdk.ServiceCatalog(source);
  }


  /* ---------- in-IDE resource explorer (read-only: list, describe, logs) ---------- */
  const ID_OK = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,200}$/;
  const loc = (s) => String(s || '').split('/').pop();
  const LISTERS = {
    run: {
      title: 'Cloud Run services', list: () => ['run', 'services', 'list'],
      map: (x) => ({ id: x.metadata.name, name: x.metadata.name, region: (x.metadata.labels || {})['cloud.googleapis.com/location'] || '', url: (x.status || {}).url || '',
        status: (((x.status || {}).conditions || []).find((c) => c.type === 'Ready') || {}).status === 'True' ? 'Ready' : 'Not ready', detail: (x.status || {}).url || '' }),
      describe: (p, it) => ['run', 'services', 'describe', it.name, `--region=${it.region}`],
      logs: (p, it) => ['run', 'services', 'logs', 'read', it.name, `--region=${it.region}`, '--limit=100'],
    },
    cloudfunctions: {
      title: 'Cloud Functions', list: () => ['functions', 'list'],
      map: (x) => ({ id: x.name, name: loc(x.name), region: String(x.name).split('/')[3] || '', status: x.state || x.status || '', detail: x.environment || '', url: (x.serviceConfig || {}).uri || x.url || '' }),
      describe: (p, it) => ['functions', 'describe', it.name, `--region=${it.region}`],
      logs: (p, it) => ['functions', 'logs', 'read', it.name, `--region=${it.region}`, '--limit=100'],
    },
    container: {
      title: 'GKE clusters', list: () => ['container', 'clusters', 'list'],
      map: (x) => ({ id: x.name, name: x.name, region: x.location, status: x.status, detail: `${x.currentNodeCount || 0} nodes · ${x.currentMasterVersion || ''}` }),
      describe: (p, it) => ['container', 'clusters', 'describe', it.name, `--location=${it.region}`],
    },
    storage: {
      title: 'Cloud Storage buckets', list: () => ['storage', 'buckets', 'list'],
      map: (x) => ({ id: x.name, name: x.name, region: x.location || '', status: x.storage_class || x.storageClass || '', detail: x.location_type || '' }),
      describe: (p, it) => ['storage', 'buckets', 'describe', `gs://${it.name}`],
    },
    sqladmin: {
      title: 'Cloud SQL instances', list: () => ['sql', 'instances', 'list'],
      map: (x) => ({ id: x.name, name: x.name, region: x.region, status: x.state, detail: x.databaseVersion }),
      describe: (p, it) => ['sql', 'instances', 'describe', it.name],
    },
    bigquery: {
      title: 'BigQuery datasets', list: () => ['alpha', 'bq', 'datasets', 'list'], raw: true,
    },
    secretmanager: {
      title: 'Secrets (names only)', list: () => ['secrets', 'list'],
      map: (x) => ({ id: loc(x.name), name: loc(x.name), region: '', status: '', detail: x.createTime || '' }),
      describe: (p, it) => ['secrets', 'describe', it.name],
    },
    artifactregistry: {
      title: 'Artifact Registry repositories', list: () => ['artifacts', 'repositories', 'list'],
      map: (x) => ({ id: loc(x.name), name: loc(x.name), region: String(x.name).split('/')[3] || '', status: x.format || '', detail: x.description || '' }),
      describe: (p, it) => ['artifacts', 'repositories', 'describe', it.name, `--location=${it.region}`],
    },
    cloudbuild: {
      title: 'Recent Cloud Build runs', list: () => ['builds', 'list', '--limit=25'],
      map: (x) => ({ id: x.id, name: String(x.id).slice(0, 8), region: '', status: x.status, detail: `${x.createTime || ''} ${(x.substitutions || {})._SERVICE || ''}`.trim() }),
      describe: (p, it) => ['builds', 'describe', it.id],
      logs: (p, it) => ['builds', 'log', it.id],
    },
    pubsub: {
      title: 'Pub/Sub topics', list: () => ['pubsub', 'topics', 'list'],
      map: (x) => ({ id: loc(x.name), name: loc(x.name), region: '', status: '', detail: '' }),
      describe: (p, it) => ['pubsub', 'topics', 'describe', it.name],
    },
  };

  const PROJ_OK = (s) => PROJECT_RE.test(String(s));
  const item_ok = (it) => it && ID_OK.test(String(it.id || '')) && ID_OK.test(String(it.name || '')) && (!it.region || /^[a-z0-9-]{2,40}$/.test(it.region));
  const gc = async (scope, args, timeout = 60000) => {
    const r = await exec('gcloud', [...args, `--project=${scope}`, '--quiet'], { timeout });
    if (!r.ok) throw new Error((r.err || r.out || 'gcloud failed').split(/\r?\n/).filter(Boolean).slice(-3).join(' '));
    return r.out;
  };

  const withDockerfile = (ws) => fs.existsSync(path.join(ws, 'Dockerfile'));

  function cloudBuildYaml(docker) {
    const image = '${_REGION}-docker.pkg.dev/$PROJECT_ID/${_REPO}/${_SERVICE}-${_ENV}:$BUILD_ID';
    const common = [
      "      - '${_SERVICE}-${_ENV}'",
      "      - '--region=${_REGION}'",
      "      - '--labels=environment=${_ENV},managed-by=cloud-native-studio'",
      "      - '--no-allow-unauthenticated'",
    ];
    const tail = ['substitutions:', '  _ENV: dev', '  _SERVICE: app', '  _REGION: us-central1', '  _REPO: cnd-apps', 'options:', '  logging: CLOUD_LOGGING_ONLY', ''].join('\n');
    if (docker) {
      return ['# Generated by Nativity Studio', 'steps:',
        '  - id: build', '    name: gcr.io/cloud-builders/docker', `    args: ['build', '-t', '${image}', '.']`,
        '  - id: push', '    name: gcr.io/cloud-builders/docker', `    args: ['push', '${image}']`,
        '  - id: deploy', '    name: gcr.io/google.com/cloudsdktool/cloud-sdk', '    entrypoint: gcloud', '    args:', '      - run', '      - deploy', ...common, `      - '--image=${image}'`,
        'images:', `  - '${image}'`, tail].join('\n');
    }
    return ['# Generated by Nativity Studio (no Dockerfile found: deploys from source with buildpacks)', 'steps:',
      '  - id: deploy', '    name: gcr.io/google.com/cloudsdktool/cloud-sdk', '    entrypoint: gcloud', '    args:', '      - run', '      - deploy', ...common, "      - '--source=.'", tail].join('\n');
  }

  const RESOURCES = {
    bucket: { label: 'Cloud Storage bucket', name: (p) => `${p.scope}-${p.env}-${p.service}-data`, args: (p, n) => ['storage', 'buckets', 'create', `gs://${n}`, `--location=${p.region}`, '--uniform-bucket-level-access'] },
    registry: { label: 'Artifact Registry (Docker) repository', name: (p) => p.repo, args: (p, n) => ['artifacts', 'repositories', 'create', n, '--repository-format=docker', `--location=${p.region}`] },
    topic: { label: 'Pub/Sub topic', name: (p) => `${p.service}-${p.env}-events`, args: (p, n) => ['pubsub', 'topics', 'create', n, `--labels=environment=${p.env}`] },
    secret: { label: 'Secret Manager secret', name: (p) => `${p.service}-${p.env}-secret`, args: (p, n) => ['secrets', 'create', n, '--replication-policy=automatic', `--labels=environment=${p.env}`] },
  };

  ctx.cloud.register({
    id: 'gcp', name: 'Google Cloud', short: 'GCP', kind: 'public', color: '#4285f4',
    cli: { cmd: 'gcloud', install: 'https://cloud.google.com/sdk/docs/install' },
    scopeLabel: 'Project',
    defaultRegion: 'us-central1',
    regions: ['us-central1', 'us-east1', 'us-west1', 'europe-west1', 'europe-west4', 'asia-south1', 'asia-southeast1', 'australia-southeast1'],
    validateScope: (s) => PROJECT_RE.test(s),
    validateRegion: (r) => REGION_RE.test(r),
    consoleUrl: (scope) => `https://console.cloud.google.com/home/dashboard?project=${scope}`,

    async status() {
      const adc = readAdc();
      const gc = await exec('gcloud', ['auth', 'list', '--filter=status:ACTIVE', '--format=value(account)'], { timeout: 25000 });
      const installed = !isMissing(gc);
      let project = adc ? adc.quotaProject : '';
      if (!project && installed) {
        const r = await exec('gcloud', ['config', 'get-value', 'project'], { timeout: 25000 });
        if (r.ok && r.out && !/unset/i.test(r.out)) project = r.out.split(/\r?\n/).pop().trim();
      }
      const account = gc.ok ? gc.out.split(/\r?\n/)[0].trim() : '';
      return {
        installed,
        signedIn: !!adc,
        identity: account || (adc && adc.clientEmail) || (adc ? 'Application Default Credentials' : ''),
        scope: project,
        detail: adc ? `ADC: ${adc.path}` : 'No Application Default Credentials found',
      };
    },

    login(emit) {
      // --update-adc refreshes Application Default Credentials too, so the gcloud CLI and SDK calls share one identity.
      const child = spawn('gcloud auth login --update-adc', { shell: true, windowsHide: false });
      child.stdout.on('data', (d) => emit('log', d.toString()));
      child.stderr.on('data', (d) => emit('log', d.toString()));
      child.on('error', (e) => emit('log', `gcloud error: ${e.message}`));
      child.on('close', (code) => emit('done', code));
    },

    async logout(identity) {
      if (identity && /^[^\s"&|<>^%]+$/.test(identity)) await exec('gcloud', ['auth', 'revoke', identity, '--quiet']);
      await exec('gcloud', ['auth', 'application-default', 'revoke', '--quiet']);
    },

    async scopes() {
      const list = await (await catalogFor()).listAccessibleProjects();
      return list.map((p) => ({ id: p.projectId, name: p.displayName, detail: p.projectId }));
    },

    // Selecting a project also writes it to ADC (quota project) so "the project in ADC" matches the IDE.
    async setScope(id) {
      if (!PROJECT_RE.test(id)) throw new Error('Invalid project id.');
      await exec('gcloud', ['config', 'set', 'project', id], { timeout: 25000 });
      const q = await exec('gcloud', ['auth', 'application-default', 'set-quota-project', id], { timeout: 30000 });
      return { adcUpdated: q.ok, note: q.ok ? '' : 'Project set for gcloud; could not update the ADC quota project.' };
    },

    async inventory(scope, opts) {
      const list = await (await catalogFor(opts)).listAccessibleServices(scope);
      return list.map((s) => ({ category: s.category, title: s.title, detail: s.name.replace('.googleapis.com', ''), url: s.consoleUrl(scope) }));
    },


    /** Read-only resource explorer so developers can work with services inside the IDE. */
    async resources(scope, key) {
      if (!PROJ_OK(scope)) throw new Error('Select a project first.');
      const l = LISTERS[key];
      if (!l || l.raw) return { supported: false, title: key };
      const out = await gc(scope, [...l.list(), '--format=json']);
      const items = (JSON.parse(out || '[]') || []).map(l.map).filter((i) => i && i.id);
      return { supported: true, title: l.title, items, canLogs: !!l.logs };
    },
    async resourceInfo(scope, key, it) {
      const l = LISTERS[key];
      if (!PROJ_OK(scope) || !l || !l.describe || !item_ok(it)) throw new Error('Invalid request.');
      return gc(scope, [...l.describe(scope, it), '--format=yaml']);
    },
    async resourceLogs(scope, key, it) {
      const l = LISTERS[key];
      if (!PROJ_OK(scope) || !l || !l.logs || !item_ok(it)) throw new Error('Logs are not available for this resource.');
      return gc(scope, l.logs(scope, it), 90000);
    },

    actions: {
      generatePipeline: (_proj, ws) => ({ path: 'cloudbuild.yaml', content: cloudBuildYaml(withDockerfile(ws)) }),

      pipeline: (proj) => ({
        title: `CI/CD ${proj.service}-${proj.env}`,
        command: gcloud(proj, ['builds', 'submit', '--config=cloudbuild.yaml', `--substitutions=_ENV=${proj.env},_SERVICE=${proj.service},_REGION=${proj.region},_REPO=${proj.repo}`, '.']),
      }),

      deploy: (proj) => ({
        title: `Deploy ${proj.service}-${proj.env}`,
        command: gcloud(proj, ['run', 'deploy', `${proj.service}-${proj.env}`, '--source=.', `--region=${proj.region}`, `--labels=environment=${proj.env},managed-by=cloud-native-studio`, '--no-allow-unauthenticated', '--quiet']),
      }),

      resourceKinds: (proj) => Object.entries(RESOURCES).map(([id, r]) => ({ id, label: r.label, defaultName: r.name(proj) })),

      resource: (proj, params) => {
        const r = RESOURCES[params.type];
        if (!r) throw new Error('Unknown resource type.');
        const name = String(params.name || '').trim();
        if (!NAME_RE.test(name)) throw new Error('Name must be 3-63 characters: lowercase letters, digits, ".", "_" or "-".');
        return { title: `Create ${name}`, command: gcloud(proj, r.args(proj, name)) };
      },

      bootstrap: (proj, envs) => {
        let content;
        if (sdk) content = sdk.createBootstrapPlan({ projectId: proj.scope, environments: envs, region: proj.region, createDefaultEnvironments: true, enableDefaultServices: true }).terraformSnippet;
        else content = `# Generated by Nativity Studio\nvariable "project_id" { default = "${proj.scope}" }\n${envs.map((e) => `resource "google_service_account" "${e}" {\n  account_id   = "cnd-${e}-sa"\n  display_name = "CND ${e}"\n  project      = var.project_id\n}\n`).join('\n')}`;
        return { path: 'infra/cnd-bootstrap/gcp/main.tf', content };
      },
    },
  });
};
