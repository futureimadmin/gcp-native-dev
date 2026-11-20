/**
 * Google Cloud landing zone wizard (organisation-wide, shared by every application).
 *
 *   Organization
 *     ├─ dev        folder, type STANDARD      └─ orders-dev-xxxxxx, payments-dev-xxxxxx ...   (projects, billing linked)
 *     ├─ sit        folder, type STANDARD
 *     ├─ uat        folder, type COMPLIANT     (an Assured Workloads folder: regulatory / regional controls apply to everything inside)
 *     ├─ preprod    folder, type COMPLIANT
 *     └─ prod       folder, type COMPLIANT
 *
 * An environment IS a folder. Google Cloud offers two kinds of folder when you create one:
 *   Standard   a regular folder                                  gcloud resource-manager folders create
 *   Compliant  an Assured Workloads folder (compliance package)  gcloud assured workloads create   (the workload creates the folder)
 * The folders are created ONCE for the organisation. Every application you open then gets its own project in each environment folder
 * (or shares one project per environment, or is linked to a project that already exists).
 *
 * Without an organisation (a personal Google account) folders cannot exist: projects are created side by side and labelled with their type.
 */
const crypto = require('crypto');

const ORG_RE = /^\d{6,20}$/;
const FOLDER_RE = /^\d{6,20}$/;
const PROJECT_RE = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const BILLING_RE = /^[A-Z0-9]{6}-[A-Z0-9]{6}-[A-Z0-9]{6}$/;
const APP_RE = /^[a-z][a-z0-9-]{1,19}[a-z0-9]$/;
const ENV_RE = /^[a-z][a-z0-9]{0,11}$/;
const REGION_RE = /^[a-z]+(-[a-z0-9]+)*[0-9]?$/;
const TIERS = ['standard', 'compliant'];
const COMPLIANT_DEFAULT = new Set(['uat', 'preprod', 'pprod', 'prod', 'production', 'dr', 'staging', 'stage']);

/** Assured Workloads compliance packages (gcloud assured workloads create --compliance-regime), from Google's reference. */
const REGIMES = {
  'regional-controls': 'Regional controls (data location)', 'regional-data-boundary': 'Regional data boundary', 'us-data-boundary-and-support': 'US data boundary and support', 'us-regional-access': 'US regional access',
  'eu-data-boundary-and-support': 'EU data boundary and support', 'eu-regions-and-support': 'EU regions and support', 'fedramp-moderate': 'FedRAMP Moderate', 'fedramp-high': 'FedRAMP High', 'data-boundary-for-fedramp-moderate': 'FedRAMP Moderate (data boundary)', 'data-boundary-for-fedramp-high': 'FedRAMP High (data boundary)',
  hipaa: 'HIPAA', hitrust: 'HITRUST', 'healthcare-and-life-sciences-controls': 'Healthcare and life sciences controls', 'us-data-boundary-for-healthcare-and-life-sciences': 'US healthcare data boundary', cjis: 'CJIS', 'data-boundary-for-cjis': 'CJIS (data boundary)', 'irs-1075': 'IRS 1075', itar: 'ITAR',
  il2: 'DoD IL2', il4: 'DoD IL4', il5: 'DoD IL5', 'canada-data-boundary-and-support': 'Canada data boundary', 'ca-protected-b': 'Canada Protected B', 'ca-regions-and-support': 'Canada regions and support', 'australia-data-boundary-and-support': 'Australia data boundary', 'au-regions-and-us-support': 'Australia regions and US support',
  'japan-data-boundary': 'Japan data boundary', 'jp-regions-and-support': 'Japan regions and support', 'israel-data-boundary-and-support': 'Israel data boundary', 'isr-regions-and-support': 'Israel regions and support', 'switzerland-data-boundary-with-access-justifications': 'Switzerland data boundary',
  'ksa-data-boundary-with-access-justifications': 'Saudi Arabia data boundary', 'ksa-regions-and-support-with-sovereignty-controls': 'Saudi Arabia regions, sovereignty controls',
};
const DEFAULT_REGIME = 'regional-controls';

/** Which type an environment name belongs to when the user has not chosen: dev, sit, test ... Standard; uat, preprod, prod ... Compliant. */
const defaultTier = (name) => (COMPLIANT_DEFAULT.has(name) ? 'compliant' : 'standard');
const GUARDRAILS = ['constraints/compute.skipDefaultNetworkCreation'];

exports.build = (ctx, shared) => {
  const { exec } = ctx;
  const { APIS, DEPLOYER_ROLES, RUNTIME_ROLES, CICD_ROLES } = shared;
  const parseJson = (r) => { try { return JSON.parse(r.out || '[]'); } catch { return []; } };

  /* ------------------------------ discovery helpers (read-only) ------------------------------ */

  /** Top-level folders of the organisation (an environment that already has a folder of its name is reused). */
  async function tree(_ctx, orgId) {
    if (!ORG_RE.test(String(orgId))) throw new Error('Invalid organization id.');
    const top = await exec('gcloud', ['resource-manager', 'folders', 'list', `--organization=${orgId}`, '--format=json'], { timeout: 60000 });
    if (!top.ok) throw new Error((top.err || 'Could not list the folders of this organization.').split(/\r?\n/).filter((l) => !/Python was not found/.test(l))[0] || 'Could not list the folders of this organization.');
    return { folders: parseJson(top).map((f) => ({ id: String(f.name || '').replace('folders/', ''), name: f.displayName || '' })).filter((f) => FOLDER_RE.test(f.id)) };
  }

  /** Projects the signed-in account can see (for "use an existing project"). */
  async function projects() {
    const r = await exec('gcloud', ['projects', 'list', '--filter=lifecycleState=ACTIVE', '--format=json', '--limit=500'], { timeout: 90000 });
    if (!r.ok) throw new Error((r.err || 'Could not list projects.').split(/\r?\n/)[0]);
    // which projects are billed: one list per open billing account (a project without billing cannot use the APIs the IDE needs)
    const accts = await exec('gcloud', ['billing', 'accounts', 'list', '--filter=open=true', '--format=value(name)'], { timeout: 40000 });
    const billed = new Set();
    let known = accts.ok;
    for (const a of accts.ok ? accts.out.split(/[\r\n]+/).map((x) => x.trim().replace('billingAccounts/', '')).filter(Boolean) : []) {
      const l = await exec('gcloud', ['billing', 'projects', 'list', `--billing-account=${a}`, '--format=value(projectId)'], { timeout: 60000 });
      if (l.ok) l.out.split(/[\r\n]+/).forEach((x) => x.trim() && billed.add(x.trim())); else known = false;
    }
    return parseJson(r).map((p) => ({ id: p.projectId, name: p.name || '', parent: p.parent ? `${p.parent.type}/${p.parent.id}` : '', labels: p.labels || {}, billed: known ? billed.has(p.projectId) : null })).filter((p) => PROJECT_RE.test(p.id));
  }

  /* ------------------------------ the plan ------------------------------ */

  const hashId = (org, name, env) => crypto.createHash('sha1').update(`${org}|${name}|${env}`).digest('hex').slice(0, 6);
  function projectId(org, name, env) {
    const rand = hashId(org, name, env);
    const room = 30 - env.length - rand.length - 2;
    return `${name.slice(0, room).replace(/-+$/, '')}-${env}-${rand}`;
  }
  /** Folder name for an environment. Assured Workloads folders need at least 4 characters, so "uat" becomes "uat-env". */
  const folderName = (e) => (e.tier === 'compliant' && e.name.length < 4 ? `${e.name}-env` : e.name);

  async function plan(spec, disc) {
    const blockers = [];
    const warnings = [];
    const must = (c, m) => { if (!c) blockers.push(m); return !!c; };
    spec = spec || {};
    const orgId = spec.org && ORG_RE.test(String(spec.org.id)) ? String(spec.org.id) : '';
    const orgName = (spec.org && spec.org.name) || (disc.orgs.find((o) => o.id === orgId) || {}).name || orgId;
    const flat = !orgId;
    const region = /^[a-z]+-[a-z0-9]+[0-9]$/.test(String(spec.region)) ? spec.region : 'us-central1';
    const cmp = spec.compliance || {};
    const defRegime = REGIMES[cmp.regime] ? cmp.regime : DEFAULT_REGIME;
    const awLocation = REGION_RE.test(String(cmp.location || '')) ? cmp.location : region;
    const adminProject = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(String(spec.adminProject || disc.currentProject || '')) ? String(spec.adminProject || disc.currentProject) : '';

    // ---- environments and their type ----
    const seen = new Set();
    const envs = [];
    for (const e of Array.isArray(spec.envs) ? spec.envs : []) {
      const name = String(e && e.name || '').trim().toLowerCase();
      if (!ENV_RE.test(name) || seen.has(name)) { blockers.push(`"${name}" is not a valid or unique environment name (1-12 lower-case letters and digits, starting with a letter).`); continue; }
      seen.add(name);
      const tier = TIERS.includes(e.tier) ? e.tier : defaultTier(name);
      envs.push({ name, tier, protected: e.protected != null ? !!e.protected : tier === 'compliant', regime: tier === 'compliant' ? (REGIMES[e.regime] ? e.regime : defRegime) : '' });
    }
    must(envs.length > 0 && envs.length <= 10, 'Choose between 1 and 10 environments.');
    const usedTiers = TIERS.filter((t) => envs.some((e) => e.tier === t));
    const billing = {};
    for (const t of TIERS) { const b = String(((spec.billing || {})[t]) || ''); billing[t] = BILLING_RE.test(b) ? b : ''; }
    const envFolders = {};
    for (const [e, id] of Object.entries(spec.envFolders || {})) if (ENV_RE.test(e) && FOLDER_RE.test(String(id))) envFolders[e] = String(id);

    // ---- applications ----
    const apps = [];
    const appSeen = new Set();
    for (const a of Array.isArray(spec.apps) ? spec.apps : []) {
      const name = String(a && a.name || '').trim().toLowerCase();
      if (!APP_RE.test(name) || appSeen.has(name)) { blockers.push(`"${name}" is not a valid or unique application name (3-21 characters: lower-case letters, digits, "-").`); continue; }
      appSeen.add(name);
      const m = a.mapping || {};
      const mode = ['create', 'shared', 'existing'].includes(m.mode) ? m.mode : 'create';
      const ex = {};
      for (const [e, p] of Object.entries(m.projects || {})) if (ENV_RE.test(e) && PROJECT_RE.test(String(p))) ex[e] = String(p);
      const none = !!m.linkOnly; // "just link": change nothing
      apps.push({ name, dir: typeof a.dir === 'string' && a.dir.length < 400 ? a.dir : '', mode, existing: ex, prepare: !none && m.prepare !== false, access: !none && m.access !== false, move: !none && !!m.move && !flat });
    }
    must(apps.length > 0, 'Select at least one application.');
    const sharedName = APP_RE.test(String(spec.sharedName || '')) ? String(spec.sharedName) : 'platform';

    const known = (name, env) => (disc.projects || []).find((p) => p.app === name && p.env === env);
    const steps = [];
    const add = (s) => steps.push({ mutating: true, ...s });

    // ---- environment folders (once for the organisation) ----
    const envRef = {};
    const compliantNew = [];
    if (!flat) {
      const needsAw = envs.some((e) => e.tier === 'compliant' && !envFolders[e.name]);
      if (needsAw) {
        if (!adminProject) blockers.push('Compliant folders use the Assured Workloads API, which needs a Google Cloud project to run from. Select a project in the Clouds view first.');
        else add({ id: 'aw-api', title: `Turn on the Assured Workloads API in ${adminProject}`, cmd: 'gcloud', args: ['services', 'enable', 'assuredworkloads.googleapis.com', `--project=${adminProject}`], timeout: 300000, retries: 1,
          check: { cmd: 'gcloud', args: ['services', 'list', '--enabled', '--filter=config.name=assuredworkloads.googleapis.com', `--project=${adminProject}`, '--format=value(config.name)'] } });
      }
      for (const e of envs) {
        if (envFolders[e.name]) { envRef[e.name] = envFolders[e.name]; continue; }
        const fname = folderName(e);
        const findFolder = { cmd: 'gcloud', args: ['resource-manager', 'folders', 'list', `--organization=${orgId}`, `--filter=displayName=${fname}`, '--format=value(name.basename())'] };
        if (e.tier === 'standard') {
          add({ id: `envfolder-${e.name}`, env: e.name, group: 'folders', title: `Create folder “${fname}” (Standard)`, cmd: 'gcloud', args: ['resource-manager', 'folders', 'create', `--display-name=${fname}`, `--organization=${orgId}`, '--format=value(name.basename())'], capture: `fe_${e.name}`, check: findFolder });
        } else {
          const bill = billing.compliant;
          if (!bill) blockers.push('Choose a billing account for the Compliant environments (Assured Workloads needs one).');
          compliantNew.push(e);
          add({ id: `envfolder-${e.name}`, env: e.name, group: 'folders', title: `Create Compliant folder “${fname}” (Assured Workloads: ${REGIMES[e.regime]})`, cmd: 'gcloud',
            args: ['assured', 'workloads', 'create', `--organization=${orgId}`, `--location=${awLocation}`, `--display-name=${fname}`, `--compliance-regime=${e.regime}`, `--billing-account=billingAccounts/${bill || 'MISSING'}`, '--labels=managed-by=nativity-studio', '--quiet'], timeout: 1200000,
            check: { cmd: 'gcloud', args: ['assured', 'workloads', 'list', `--organization=${orgId}`, `--location=${awLocation}`, `--filter=displayName=${fname}`, '--format=value(name)'] } });
          // the workload creates the folder: find its id
          add({ id: `envfolder-id-${e.name}`, env: e.name, group: 'folders', mutating: false, title: `Find the id of folder “${fname}”`, cmd: 'gcloud', args: ['resource-manager', 'folders', 'list', `--organization=${orgId}`, `--filter=displayName=${fname}`, '--format=value(name.basename())'], capture: `fe_${e.name}`, retries: 4, retryDelay: 8000 });
        }
        envRef[e.name] = `{{fe_${e.name}}}`;
      }
      if (spec.guardrails) {
        for (const e of envs.filter((x) => x.tier === 'standard')) {
          for (const c of GUARDRAILS) add({ id: `guard-${e.name}-${c.split('/')[1]}`, env: e.name, group: 'folders', optional: true, title: `Guardrail on folder “${e.name}”: ${c.split('/')[1]}`, cmd: 'gcloud', args: ['resource-manager', 'org-policies', 'enable-enforce', c, `--folder=${envRef[e.name]}`] });
        }
      }
    }

    // ---- projects per application / environment ----
    const member = /\.iam\.gserviceaccount\.com$/.test(disc.account) ? `serviceAccount:${disc.account}` : `user:${disc.account}`;
    const sa = (env, kind) => (kind === 'deployer' ? `cnd-${env}-sa` : kind === 'runtime' ? 'cnd-runtime-sa' : 'cnd-cicd-sa');
    const email = (p, name) => `${name}@${p}.iam.gserviceaccount.com`;

    function prepare(p, e, g, repoOwner, opt = { infra: true, access: true }) {
      const base = { env: e.name, group: g };
      const sid = (x) => `${g}-${x}-${e.name}`;
      if (opt.infra) {
        add({ ...base, id: sid('apis'), title: `Turn on APIs in ${p} (${APIS.length})`, cmd: 'gcloud', args: ['services', 'enable', ...APIS, `--project=${p}`], timeout: 900000, retries: 2, retryDelay: 15000 });
        for (const kind of ['deployer', 'runtime', 'cicd']) {
          add({ ...base, id: sid(`sa-${kind}`), title: `Create service account ${sa(e.name, kind)}`, cmd: 'gcloud', args: ['iam', 'service-accounts', 'create', sa(e.name, kind), `--display-name=Nativity ${kind} (${e.name})`, `--project=${p}`], okIf: 'already exists', retries: 2,
            check: { cmd: 'gcloud', args: ['iam', 'service-accounts', 'describe', email(p, sa(e.name, kind)), `--project=${p}`, '--format=value(email)'] } });
        }
        const bind = (kind, roles) => roles.forEach((role) => add({ ...base, id: sid(`iam-${kind}-${role.split('/')[1]}`), title: `${sa(e.name, kind)}: ${role}`, cmd: 'gcloud', args: ['projects', 'add-iam-policy-binding', p, `--member=serviceAccount:${email(p, sa(e.name, kind))}`, `--role=${role}`, '--condition=None', '--quiet'], retries: 3, retryDelay: 8000 }));
        bind('deployer', DEPLOYER_ROLES); bind('runtime', RUNTIME_ROLES); bind('cicd', CICD_ROLES);
        for (const kind of ['deployer', 'cicd']) add({ ...base, id: sid(`actas-${kind}`), title: `${sa(e.name, kind)} may run services as cnd-runtime-sa`, cmd: 'gcloud', args: ['iam', 'service-accounts', 'add-iam-policy-binding', email(p, sa(e.name, 'runtime')), `--member=serviceAccount:${email(p, sa(e.name, kind))}`, '--role=roles/iam.serviceAccountUser', `--project=${p}`, '--quiet'], retries: 3 });
      }
      if (opt.access) {
        add({ ...base, id: sid('you-viewer'), title: `You: ${spec.devEditor && e.tier === 'standard' ? 'Editor' : 'read-only (Viewer)'} on ${p}`, cmd: 'gcloud', args: ['projects', 'add-iam-policy-binding', p, `--member=${member}`, `--role=${spec.devEditor && e.tier === 'standard' ? 'roles/editor' : 'roles/viewer'}`, '--condition=None', '--quiet'], retries: 2 });
        add({ ...base, id: sid('you-impersonate'), optional: !opt.infra, title: `You: may impersonate ${sa(e.name, 'deployer')} (Token Creator)`, cmd: 'gcloud', args: ['iam', 'service-accounts', 'add-iam-policy-binding', email(p, sa(e.name, 'deployer')), `--member=${member}`, '--role=roles/iam.serviceAccountTokenCreator', `--project=${p}`, '--quiet'], retries: 3 });
      }
      if (opt.infra) add({ ...base, id: sid('registry'), title: `Create Artifact Registry repository ${repoOwner}-images`, cmd: 'gcloud', args: ['artifacts', 'repositories', 'create', `${repoOwner}-images`, '--repository-format=docker', `--location=${region}`, `--labels=environment=${e.name}`, `--project=${p}`], okIf: 'already exists',
        check: { cmd: 'gcloud', args: ['artifacts', 'repositories', 'describe', `${repoOwner}-images`, `--location=${region}`, `--project=${p}`, '--format=value(name)'] } });
    }

    function createProject(p, e, g, label) {
      const b = billing[e.tier];
      if (!b) blockers.push(`No billing account chosen for the ${e.tier === 'standard' ? 'Standard' : 'Compliant'} environments.`);
      add({ env: e.name, group: g, id: `${g}-project-${e.name}`, title: `Create project ${p}`, cmd: 'gcloud', args: ['projects', 'create', p, ...(flat ? [] : [`--folder=${envRef[e.name]}`]), `--name=${label} ${e.name}`, `--labels=app=${label},environment=${e.name},tier=${e.tier},managed-by=nativity-studio`, '--quiet'],
        check: { cmd: 'gcloud', args: ['projects', 'describe', p, '--format=value(projectId)'] }, timeout: 120000 });
      add({ env: e.name, group: g, id: `${g}-billing-${e.name}`, title: `Link billing account to ${p}`, cmd: 'gcloud', args: ['billing', 'projects', 'link', p, `--billing-account=${b || 'MISSING'}`], retries: 3,
        check: { cmd: 'gcloud', args: ['billing', 'projects', 'describe', p, '--format=value(billingEnabled)'], match: '^True$' } });
    }

    const record = { apps: {}, landing: { org: orgId ? { id: orgId, name: orgName } : null, envFolders, billing, compliance: { regime: defRegime, location: awLocation }, envs: envs.map((e) => ({ name: e.name, tier: e.tier, protected: e.protected, regime: e.regime })), mode: flat ? 'flat' : 'folders' } };
    const projectNodes = {}; // env -> [{ label, id, status }]
    const sharedDone = new Set();
    for (const a of apps) {
      record.apps[a.name] = { dir: a.dir, targets: {} };
      for (const e of envs) {
        let p;
        let g = `app:${a.name}`;
        let created = false;
        let link = false;
        let doMove = false;
        if (a.mode === 'existing') {
          p = a.existing[e.name];
          if (!p) { blockers.push(`${a.name}: choose an existing project for ${e.name}, or switch it to "create".`); continue; }
          link = !a.prepare && !a.access && !a.move;
          doMove = a.move;
        } else if (a.mode === 'shared') {
          g = 'shared';
          p = (known(sharedName, e.name) || {}).id || projectId(orgId || disc.account, sharedName, e.name);
        } else {
          p = (known(a.name, e.name) || {}).id || projectId(orgId || disc.account, a.name, e.name);
        }
        created = a.mode !== 'existing' && !known(a.mode === 'shared' ? sharedName : a.name, e.name);
        const key = `${g}|${e.name}`;
        if (!link && !sharedDone.has(key)) {
          sharedDone.add(key);
          if (a.mode !== 'existing') createProject(p, e, g, a.mode === 'shared' ? sharedName : a.name);
          if (doMove) {
            // moving a project changes what it inherits (roles, organization policies) from its parent: only when asked for
            add({ env: e.name, group: g, id: `${g}-move-${e.name}`, title: `Move ${p} into the “${folderName(e)}” folder`, cmd: 'gcloud', args: ['projects', 'move', p, `--folder=${envRef[e.name]}`], timeout: 120000, retries: 1,
              check: { cmd: 'gcloud', args: ['projects', 'describe', p, '--format=value(parent.id)'], ...(/^\d+$/.test(String(envRef[e.name])) ? { match: `^${envRef[e.name]}$` } : { matchVar: `fe_${e.name}` }) } });
          }
          if (a.mode !== 'existing' || a.prepare || a.access) prepare(p, e, g, a.mode === 'shared' ? sharedName : a.name, { infra: a.mode !== 'existing' || a.prepare, access: a.mode !== 'existing' || a.access });
        }
        record.apps[a.name].targets[e.name] = { scope: p, impersonate: link || (a.mode === 'existing' && !a.prepare) ? '' : email(p, sa(e.name, 'deployer')), region, tier: e.tier, mode: a.mode, needs: link ? [] : [`folders|${e.name}`, key] };
        (projectNodes[e.name] = projectNodes[e.name] || []);
        if (!projectNodes[e.name].some((n) => n.id === p)) projectNodes[e.name].push({ label: a.mode === 'shared' ? `${sharedName} (shared)` : a.name, id: p, status: created ? 'new' : 'exists', link, moved: doMove });
      }
    }

    // ---- diagram ----
    const envNode = (e) => ({
      kind: flat ? 'group' : 'folder', label: flat ? `Environment ${e.name}` : `Folder: ${folderName(e)}`,
      sub: flat ? `label tier=${e.tier}` : e.tier === 'standard' ? 'Standard folder' : `Compliant folder · ${REGIMES[e.regime]}`,
      status: envFolders[e.name] ? 'exists' : 'new', protected: e.protected,
      children: (projectNodes[e.name] || []).map((n) => ({ kind: 'project', label: `Project: ${n.label}`, sub: n.id, status: n.status, protected: e.protected, items: n.link ? ['Linked only: nothing is changed'] : n.moved ? ['Moved into this folder'] : [] })),
    });
    const architecture = {
      title: flat ? 'Google Cloud: projects per application and environment (no organization)' : 'Google Cloud landing zone: one folder per environment (Standard or Compliant), one project per application and environment',
      summary: flat
        ? 'No organization is visible to this account, so folders cannot exist (Google Cloud folders need an organization). Each application gets a project per environment, labelled with its type. Add an organization (Google Workspace or Cloud Identity) to get real folders; Compliant folders also need Assured Workloads.'
        : 'Every environment is a folder in the organization, created once and shared by all applications. Standard folders (dev, sit …) are regular folders. Compliant folders (uat, preprod, prod …) are Assured Workloads folders: the chosen compliance package restricts data locations and allowed services for everything inside and turns on Access Transparency. Each application then gets its own project in each environment folder, with billing linked. Changes are made by impersonating each project’s deployer service account: no keys.',
      root: flat ? { kind: 'account', label: disc.account, sub: 'your Google account', status: 'exists', children: envs.map(envNode) } : { kind: 'org', label: 'Organization', sub: orgName, status: 'exists', children: envs.map(envNode) },
      access: [
        { who: 'You', how: spec.devEditor ? 'Editor on Standard projects, Viewer on Compliant' : 'Viewer (read-only) on every project', what: 'look; changes go through the deployer account' },
        { who: 'You', how: 'Service Account Token Creator on cnd-<env>-sa', what: 'gcloud --impersonate-service-account: short-lived tokens, audited, no keys' },
        { who: 'cnd-<env>-sa', how: 'Cloud Run Admin, Artifact Registry Writer, Cloud Build Editor, Secret Accessor', what: 'deploys to that one project only' },
        { who: 'cnd-cicd-sa / cnd-runtime-sa', how: 'build + deploy / log + metrics + secrets', what: 'the pipeline and the running service' },
        ...(usedTiers.includes('compliant') && !flat ? [{ who: 'Compliant folders', how: 'compliance package: allowed regions and services, Access Transparency', what: 'enforced by Assured Workloads on every project inside' }] : []),
        ...(spec.guardrails && !flat ? [{ who: 'Standard folders', how: 'no default network on new projects', what: 'organization policy inherited by every project inside' }] : []),
      ],
      why: [
        'Environments are folders: policy and access are set once per environment and every application inherits them.',
        'Standard vs Compliant is a folder type in Google Cloud: a Compliant folder is an Assured Workloads folder with regulatory controls (data location, allowed services).',
        'A project per application and environment is the real isolation wall (IAM, quotas, billing, APIs).',
        'Impersonation instead of keys: nothing to leak or rotate; every change is logged against a named service account.',
      ],
    };
    const prerequisites = [
      flat ? 'Permission to create projects (Project Creator)' : 'On the organization: Folder Admin (or Folder Creator) and Project Creator',
      'Billing Account User on the billing account(s) you choose',
      ...(compliantNew.length ? ['Assured Workloads Administrator (roles/assuredworkloads.admin) on the organization, and the Assured Workloads API enabled in a project you can use'] : []),
    ];
    if (compliantNew.length) warnings.push('Compliant folders are created with Assured Workloads. Some compliance packages need a paid Assured Workloads plan (Google lists pricing and a free trial on the Assured Workloads pages): if your organization does not have access, that step fails with a clear message and the other environments still run.');
    if (apps.some((a) => a.mode === 'existing' && a.move)) warnings.push('Moving an existing project into a folder changes what it inherits from its parent: the folder’s roles and organization policies apply from then on (for a Compliant folder, the compliance package too). Roles granted on the project itself, custom roles and existing service accounts are not touched.');
    if (apps.some((a) => a.mode === 'existing' && a.move && !flat)) prerequisites.push('To move projects: Project Mover on each project and Folder Admin on the destination folder');
    if (flat) warnings.push('No Google Cloud organization is visible to this account (personal accounts have none), so no folders are created.');
    return { envs, region, architecture, steps, record, targets: null, warnings, blockers: [...new Set(blockers)], prerequisites, summary: `${apps.length} application(s) × ${envs.length} environment(s)${flat ? '' : `, ${envs.length} folder(s)${compliantNew.length ? ` (${compliantNew.length} Compliant)` : ''}`}` };
  }

  const regimes = async () => REGIMES;
  return { tree, projects, regimes, plan, defaultTier, REGIMES };
};
