/**
 * Google Cloud landing zone.
 *   Organization
 *     └─ <app>                (folder)
 *          ├─ dev             (folder)  └─ <app>-dev-xxxxxx   (project)
 *          ├─ uat             (folder)  └─ <app>-uat-xxxxxx   (project)
 *          └─ prod            (folder)  └─ <app>-prod-xxxxxx  (project)
 * One PROJECT per environment (the real isolation boundary: IAM, quotas, billing, APIs), grouped in FOLDERS so policy can be set once per
 * environment. Without an organization (personal Gmail account) folders do not exist, so projects are created side by side and labelled.
 *
 * Access model (least privilege + impersonation):
 *   - you get READ-ONLY (Viewer) on each environment project;
 *   - changes are made as that environment's deployer service account: you hold Service Account Token Creator on it, so the IDE runs
 *     gcloud with --impersonate-service-account (no keys, every action is audited as that account);
 *   - the running app uses a separate runtime service account; the CI/CD pipeline uses its own.
 */
const crypto = require('crypto');

const PROJECT_RE = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const ORG_RE = /^\d{6,20}$/;
const BILLING_RE = /^[A-Z0-9]{6}-[A-Z0-9]{6}-[A-Z0-9]{6}$/;

const APIS = ['run.googleapis.com', 'artifactregistry.googleapis.com', 'cloudbuild.googleapis.com', 'iam.googleapis.com', 'iamcredentials.googleapis.com', 'cloudresourcemanager.googleapis.com', 'secretmanager.googleapis.com', 'logging.googleapis.com', 'monitoring.googleapis.com', 'serviceusage.googleapis.com'];

const DEPLOYER_ROLES = ['roles/run.admin', 'roles/artifactregistry.writer', 'roles/cloudbuild.builds.editor', 'roles/secretmanager.secretAccessor', 'roles/logging.viewer', 'roles/serviceusage.serviceUsageConsumer'];
const RUNTIME_ROLES = ['roles/logging.logWriter', 'roles/monitoring.metricWriter', 'roles/secretmanager.secretAccessor'];
const CICD_ROLES = ['roles/cloudbuild.builds.builder', 'roles/run.developer', 'roles/artifactregistry.writer', 'roles/logging.logWriter'];

exports.build = (ctx) => {
  const { exec } = ctx;

  /** Who is signed in and which organizations they can see. Quick, so the wizard can show its first step before the slower lookups finish. */
  async function discoverOrgs() {
    const acct = await exec('gcloud', ['auth', 'list', '--filter=status:ACTIVE', '--format=value(account)'], { timeout: 25000 });
    const account = acct.ok ? acct.out.split(/\r?\n/)[0].trim() : '';
    if (!account) return { signedIn: false, account: '', orgs: [], billing: [], projects: [], currentProject: '' };
    const parse = (r) => { try { return JSON.parse(r.out || '[]'); } catch { return []; } };
    const toOrg = (o) => ({ id: String(o.name || '').replace('organizations/', ''), name: o.displayName || o.name });
    // The organization list is what the wizard hangs on, so it is looked up first, on its own (several gcloud processes at once can
    // trip over each other), retried, and cross-checked against the organization above the current project.
    let orgs = null;
    let orgList = [];
    for (let i = 0; i < 3 && !orgList.length; i++) {
      orgs = await exec('gcloud', ['organizations', 'list', '--format=json'], { timeout: 40000 });
      orgList = parse(orgs).map(toOrg).filter((o) => ORG_RE.test(o.id));
      // the Google session has expired: gcloud cannot ask for a password here, so say so instead of retrying
      if (!orgList.length && orgs && !orgs.ok && /reauthentication|gcloud auth login|invalid_grant/i.test(`${orgs.err || ''} ${orgs.out || ''}`)) return { signedIn: true, reauth: true, account, currentProject: '', orgs: [], billing: [], projects: [] };
      if (!orgList.length && i < 2) await new Promise((r) => setTimeout(r, 1200));
    }
    if (!orgList.length) {
      const cur = await exec('gcloud', ['config', 'get-value', 'project'], { timeout: 20000 });
      const proj = cur.ok ? cur.out.split(/\r?\n/).pop().trim() : '';
      if (/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(proj)) {
        const anc = await exec('gcloud', ['projects', 'get-ancestors', proj, '--format=json'], { timeout: 40000 });
        const org = parse(anc).find((x) => x.type === 'organization' && ORG_RE.test(String(x.id)));
        if (org) {
          const d = await exec('gcloud', ['organizations', 'describe', org.id, '--format=value(displayName)'], { timeout: 30000 });
          orgList = [{ id: String(org.id), name: (d.ok && d.out.trim()) || `organization ${org.id}` }];
        }
      }
    }
    const curP = await exec('gcloud', ['config', 'get-value', 'project'], { timeout: 20000 });
    const currentProject = curP.ok ? curP.out.split(/\r?\n/).pop().trim() : '';
    return { signedIn: true, account, currentProject, orgs: orgList, orgsDenied: !orgList.length && !!orgs && !orgs.ok };
  }

  async function discover() {
    const base = await discoverOrgs();
    if (!base.signedIn) return { ...base, billing: [], projects: [] };
    const { account, currentProject, orgs: orgList, orgsDenied } = base;
    const parse = (r) => { try { return JSON.parse(r.out || '[]'); } catch { return []; } };
    let [billing, projects] = await Promise.all([
      exec('gcloud', ['billing', 'accounts', 'list', '--filter=open=true', '--format=json'], { timeout: 40000 }),
      exec('gcloud', ['projects', 'list', '--filter=labels.managed-by=nativity-studio', '--format=json'], { timeout: 60000 }),
    ]);
    if (!parse(billing).length) { await new Promise((r) => setTimeout(r, 1200)); billing = await exec('gcloud', ['billing', 'accounts', 'list', '--filter=open=true', '--format=json'], { timeout: 40000 }); }
    // how many projects each billing account already holds (Google limits this number)
    const billingRows = parse(billing).map((b) => ({ id: String(b.name || '').replace('billingAccounts/', ''), name: b.displayName || b.name })).filter((b) => BILLING_RE.test(b.id));
    for (const b of billingRows.slice(0, 3)) {
      const l = await exec('gcloud', ['billing', 'projects', 'list', `--billing-account=${b.id}`, '--format=value(projectId)'], { timeout: 60000 });
      b.used = l.ok ? l.out.split(/[\r\n]+/).filter((x) => x.trim()).length : null;
    }
    return {
      signedIn: true, account, currentProject,
      orgs: orgList,
      billing: billingRows,
      projects: parse(projects).map((p) => ({ id: p.projectId, app: (p.labels || {}).app || '', env: (p.labels || {}).environment || '' })),
      billingDenied: !billing.ok,
      orgsDenied,
    };
  }

  // stable for the same account + application + environment, so planning twice shows the same ids (and a re-run finds what it created)
  const pid = (app, env, account) => {
    const rand = crypto.createHash('sha1').update(`${account}|${app}|${env}`).digest('hex').slice(0, 6);
    const room = 30 - env.length - rand.length - 2;
    return `${app.slice(0, room).replace(/-+$/, '')}-${env}-${rand}`;
  };

  async function plan(spec, disc) {
    const { app, envs, region } = spec;
    const o = spec.options || {};
    const org = ORG_RE.test(String(o.orgId || '')) ? String(o.orgId) : (disc.orgs[0] ? disc.orgs[0].id : '');
    const useFolders = !!org && o.mode !== 'flat';
    const billing = BILLING_RE.test(String(o.billingId || '')) ? String(o.billingId) : (disc.billing[0] ? disc.billing[0].id : '');
    const member = /\.iam\.gserviceaccount\.com$/.test(disc.account) ? `serviceAccount:${disc.account}` : `user:${disc.account}`;
    const reuse = (o.existing && typeof o.existing === 'object') ? o.existing : {};
    const steps = [];
    const warnings = [];
    const blockers = [];
    const targets = {};
    const add = (s) => steps.push({ mutating: true, ...s });

    const needsCreate = [];
    const projectOf = {};
    for (const e of envs) {
      const given = reuse[e.name] && PROJECT_RE.test(reuse[e.name]) ? reuse[e.name] : '';
      const known = (spec.existing[e.name] && spec.existing[e.name].scope) || (disc.projects.find((p) => p.app === app && p.env === e.name) || {}).id || '';
      projectOf[e.name] = given || known || pid(app, e.name, disc.account);
      if (!given && !known) needsCreate.push(e.name);
    }
    if (needsCreate.length && !billing) blockers.push('No billing account found. New projects need one to use Cloud Run and Artifact Registry. Ask a billing administrator to give you "Billing Account User", or choose existing projects for these environments.');
    if (!org && !useFolders) warnings.push('No Google Cloud organization is visible to this account (personal accounts have none). Folders only exist inside an organization, so each environment gets its own labelled project without folders. A free Cloud Identity organization adds them later.');

    const sa = (env, kind) => `${kind === 'deployer' ? `cnd-${env}-sa` : kind === 'runtime' ? 'cnd-runtime-sa' : 'cnd-cicd-sa'}`;
    const email = (p, name) => `${name}@${p}.iam.gserviceaccount.com`;

    if (useFolders) {
      add({ id: 'folder-app', title: `Create folder “${app}” in the organization`, cmd: 'gcloud', args: ['resource-manager', 'folders', 'create', `--display-name=${app}`, `--organization=${org}`, '--format=value(name.basename())'], capture: 'appFolder',
        check: { cmd: 'gcloud', args: ['resource-manager', 'folders', 'list', `--organization=${org}`, `--filter=displayName=${app}`, '--format=value(name.basename())'] } });
    }
    for (const e of envs) {
      const p = projectOf[e.name];
      const exists = !needsCreate.includes(e.name);
      if (useFolders) {
        add({ id: `folder-${e.name}`, env: e.name, title: `Create folder “${e.name}”`, cmd: 'gcloud', args: ['resource-manager', 'folders', 'create', `--display-name=${e.name}`, '--folder={{appFolder}}', '--format=value(name.basename())'], capture: `f_${e.name}`,
          check: { cmd: 'gcloud', args: ['resource-manager', 'folders', 'list', '--folder={{appFolder}}', `--filter=displayName=${e.name}`, '--format=value(name.basename())'] } });
      }
      if (!exists) {
        add({ id: `project-${e.name}`, env: e.name, title: `Create project ${p}`, cmd: 'gcloud', args: ['projects', 'create', p, ...(useFolders ? [`--folder={{f_${e.name}}}`] : org ? [`--organization=${org}`] : []), `--name=${app} ${e.name}`, `--labels=app=${app},environment=${e.name},managed-by=nativity-studio`, '--quiet'],
          check: { cmd: 'gcloud', args: ['projects', 'describe', p, '--format=value(projectId)'] }, timeout: 120000 });
        add({ id: `billing-${e.name}`, env: e.name, title: `Link billing account to ${p}`, cmd: 'gcloud', args: ['billing', 'projects', 'link', p, `--billing-account=${billing}`], retries: 3,
          check: { cmd: 'gcloud', args: ['billing', 'projects', 'describe', p, '--format=value(billingEnabled)'], match: '^True$' } });
      }
      add({ id: `apis-${e.name}`, env: e.name, title: `Turn on APIs in ${p} (${APIS.length})`, cmd: 'gcloud', args: ['services', 'enable', ...APIS, `--project=${p}`], timeout: 900000, retries: 2, retryDelay: 15000 });
      for (const kind of ['deployer', 'runtime', 'cicd']) {
        const name = sa(e.name, kind);
        add({ id: `sa-${kind}-${e.name}`, env: e.name, title: `Create service account ${name}`, cmd: 'gcloud', args: ['iam', 'service-accounts', 'create', name, `--display-name=Nativity ${kind} (${e.name})`, `--project=${p}`], okIf: 'already exists', retries: 2,
          check: { cmd: 'gcloud', args: ['iam', 'service-accounts', 'describe', email(p, name), `--project=${p}`, '--format=value(email)'] } });
      }
      const bind = (kind, roles) => roles.forEach((role) => add({ id: `iam-${kind}-${role.split('/')[1]}-${e.name}`, env: e.name, title: `${sa(e.name, kind)}: ${role}`, cmd: 'gcloud', args: ['projects', 'add-iam-policy-binding', p, `--member=serviceAccount:${email(p, sa(e.name, kind))}`, `--role=${role}`, '--condition=None', '--quiet'], retries: 3, retryDelay: 8000 }));
      bind('deployer', DEPLOYER_ROLES);
      bind('runtime', RUNTIME_ROLES);
      bind('cicd', CICD_ROLES);
      // the deployer and the pipeline may attach the runtime account to Cloud Run services, nothing more
      for (const kind of ['deployer', 'cicd']) {
        add({ id: `iam-actas-${kind}-${e.name}`, env: e.name, title: `${sa(e.name, kind)} may run services as cnd-runtime-sa`, cmd: 'gcloud', args: ['iam', 'service-accounts', 'add-iam-policy-binding', email(p, sa(e.name, 'runtime')), `--member=serviceAccount:${email(p, sa(e.name, kind))}`, '--role=roles/iam.serviceAccountUser', `--project=${p}`, '--quiet'], retries: 3 });
      }
      // you: read-only on the project, and the right to impersonate the deployer account
      add({ id: `iam-you-viewer-${e.name}`, env: e.name, title: `You: read-only access (Viewer) to ${p}`, cmd: 'gcloud', args: ['projects', 'add-iam-policy-binding', p, `--member=${member}`, '--role=roles/viewer', '--condition=None', '--quiet'], retries: 2 });
      add({ id: `iam-you-impersonate-${e.name}`, env: e.name, title: `You: may impersonate ${sa(e.name, 'deployer')} (Token Creator)`, cmd: 'gcloud', args: ['iam', 'service-accounts', 'add-iam-policy-binding', email(p, sa(e.name, 'deployer')), `--member=${member}`, '--role=roles/iam.serviceAccountTokenCreator', `--project=${p}`, '--quiet'], retries: 3 });
      add({ id: `ar-${e.name}`, env: e.name, title: `Create Artifact Registry repository ${spec.app}-images`, cmd: 'gcloud', args: ['artifacts', 'repositories', 'create', `${app}-images`, '--repository-format=docker', `--location=${region}`, `--labels=environment=${e.name}`, `--project=${p}`], okIf: 'already exists',
        check: { cmd: 'gcloud', args: ['artifacts', 'repositories', 'describe', `${app}-images`, `--location=${region}`, `--project=${p}`, '--format=value(name)'] } });
      targets[e.name] = { scope: p, impersonate: email(p, sa(e.name, 'deployer')), region };
    }

    const envNode = (e) => {
      const p = projectOf[e.name];
      const have = !needsCreate.includes(e.name);
      return {
        kind: useFolders ? 'folder' : 'project', label: useFolders ? `Folder: ${e.name}` : `Project: ${e.name}`, sub: useFolders ? '' : p, status: have ? 'exists' : 'new', protected: e.protected,
        children: useFolders ? [{ kind: 'project', label: `Project: ${e.name}`, sub: p, status: have ? 'exists' : 'new', protected: e.protected, items: [
          'APIs: Cloud Run, Artifact Registry, Cloud Build, Secret Manager, Logging, Monitoring',
          `Artifact Registry: ${app}-images`,
          `${sa(e.name, 'deployer')}  (deploys)`, 'cnd-runtime-sa  (runs the app)', 'cnd-cicd-sa  (pipeline)',
          e.protected ? 'Viewer for you; changes only by impersonation' : 'Viewer for you; changes by impersonation',
        ] }] : [],
        items: useFolders ? [] : [`APIs: Cloud Run, Artifact Registry, Cloud Build, Secret Manager`, `Artifact Registry: ${app}-images`, `${sa(e.name, 'deployer')}, cnd-runtime-sa, cnd-cicd-sa`, 'Viewer for you; changes by impersonation'],
      };
    };
    const appNode = useFolders
      ? { kind: 'folder', label: `Folder: ${app}`, sub: 'one folder for the whole application', status: 'new', children: envs.map(envNode) }
      : { kind: 'group', label: app, sub: 'projects side by side (no organization)', status: 'new', children: envs.map(envNode) };
    const architecture = {
      title: 'Google Cloud: one project per environment' + (useFolders ? ', grouped in folders' : ''),
      summary: useFolders
        ? 'Each environment is its own project (a hard wall for IAM, quotas, billing and APIs) inside its own folder, so you can set policy once per environment. You can only look at an environment; changes go through that environment’s deployer service account, which you impersonate. No keys are ever created.'
        : 'Each environment is its own project (a hard wall for IAM, quotas, billing and APIs). Without an organization there are no folders, so projects are labelled app / environment instead. Changes go through each environment’s deployer service account, which you impersonate. No keys are ever created.',
      root: useFolders ? { kind: 'org', label: 'Organization', sub: (disc.orgs.find((x) => x.id === org) || {}).name || org, status: 'exists', children: [appNode] } : { kind: 'account', label: disc.account, sub: 'your Google account', status: 'exists', children: [appNode] },
      access: [
        { who: 'You', how: 'Viewer (read-only) on every environment project', what: 'look, never change directly' },
        { who: 'You', how: 'Service Account Token Creator on cnd-<env>-sa', what: 'gcloud --impersonate-service-account: short-lived tokens, audited as the service account' },
        { who: 'cnd-<env>-sa', how: 'Cloud Run Admin, Artifact Registry Writer, Cloud Build Editor, Secret Accessor', what: 'deploys to that one project only' },
        { who: 'cnd-cicd-sa', how: 'Cloud Build Builder, Run Developer, Artifact Registry Writer', what: 'runs the pipeline' },
        { who: 'cnd-runtime-sa', how: 'Log Writer, Metric Writer, Secret Accessor', what: 'identity of the running service' },
      ],
      why: [
        'Project per environment: a mistake or leaked credential in dev cannot touch prod.',
        useFolders ? 'Folders per environment: org policies and group access are set once and inherited by every project inside.' : 'Folders need an organization; labels keep the environments identifiable until you have one.',
        'Impersonation instead of keys: nothing to leak or rotate; every change is logged against a named service account.',
      ],
    };
    const prerequisites = [
      useFolders ? 'On the organization (or its parent folder): Folder Creator and Project Creator' : 'Permission to create projects (Project Creator)',
      needsCreate.length ? `Billing Account User on ${billing || 'a billing account'}` : '',
      'Service Usage Admin on existing projects you reuse',
    ].filter(Boolean);
    return { architecture, steps, targets, warnings, blockers, prerequisites, summary: `${envs.length} project(s)${useFolders ? ', ' + (envs.length + 1) + ' folders' : ''}, ${envs.length * 3} service accounts` };
  }

  const wizard = require('./wizard').build(ctx, { APIS, DEPLOYER_ROLES, RUNTIME_ROLES, CICD_ROLES });
  return { discover, discoverOrgs, plan, wizard };
};
