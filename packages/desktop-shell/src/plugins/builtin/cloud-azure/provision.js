/**
 * Azure landing zone: one RESOURCE GROUP per environment, from one reviewable Bicep template.
 *
 *   Default - one Azure subscription per environment (you choose the subscription of each):
 *     dev subscription  -> <app>-dev-rg
 *     sit subscription  -> <app>-sit-rg
 *     prod subscription -> <app>-prod-rg   (purge protection, Standard registry, longer logs, READ-ONLY access for you)
 *   Option - all environments in one subscription (a resource group each).
 *
 * The IDE does not create subscriptions (that is a billing and management-group decision): you pick existing ones.
 * Environments are promoted by YOUR pipeline: the generated workflow builds one image and copies it through the stages, signing in
 * to each subscription as that environment's deployer identity (federated credential from GitHub, no secrets).
 *
 * A resource group is the unit Azure scopes access (RBAC), policy, tags, cost and deletion to; resources use MANAGED IDENTITIES.
 */
const fs = require('fs');
const path = require('path');
const { environmentsDoc } = require('../../../core/envdoc');
const { pipelineFiles } = require('../../../core/pipeline');

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REPO_RE = /^[A-Za-z0-9_.-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/;
const PROVIDERS = ['Microsoft.App', 'Microsoft.OperationalInsights', 'Microsoft.ContainerRegistry', 'Microsoft.KeyVault', 'Microsoft.ManagedIdentity'];

exports.build = (ctx, helpers) => {
  const { exec } = ctx;
  const { REGION_RE } = helpers;
  const TEMPLATE_PATH = 'infra/cnd-environments/azure/environment.bicep';
  const DOC_PATH = 'infra/cnd-environments/azure/ENVIRONMENTS.md';
  const PIPELINE_PATH = '.github/workflows/promote.yml';
  const PIPELINE_EXAMPLE = 'infra/cnd-environments/azure/promote.example.yml';

  /** Every subscription this sign-in can see (id, name, tenant). */
  async function subscriptions() {
    const r = await exec('az', ['account', 'list', '--query', '[?state==\'Enabled\'].{id:id,name:name,tenant:tenantId}', '-o', 'json'], { timeout: 60000 });
    try { return JSON.parse(r.out || '[]').filter((s) => GUID_RE.test(s.id)).slice(0, 100); } catch { return []; }
  }

  async function discover() {
    const r = await exec('az', ['account', 'show', '-o', 'json'], { timeout: 40000 });
    if (!r.ok) return { signedIn: false, subscription: '', groups: [], subscriptions: [] };
    let a = {};
    try { a = JSON.parse(r.out); } catch { /* ignore */ }
    const [oid, groups, subs] = await Promise.all([
      exec('az', ['ad', 'signed-in-user', 'show', '--query', 'id', '-o', 'tsv'], { timeout: 40000 }),
      exec('az', ['group', 'list', '--query', '[].{n:name,l:location}', '-o', 'json'], { timeout: 60000 }),
      subscriptions(),
    ]);
    let gs = [];
    try { gs = JSON.parse(groups.out || '[]'); } catch { gs = []; }
    return {
      signedIn: true, subscription: a.id || '', subscriptionName: a.name || '', tenant: a.tenantId || '', user: (a.user && a.user.name) || '', userType: (a.user && a.user.type) || 'user',
      objectId: oid.ok && GUID_RE.test(oid.out.trim()) ? oid.out.trim() : '', groups: gs.map((g) => g.n), subscriptions: subs,
    };
  }

  async function plan(spec, disc) {
    const { app, envs } = spec;
    const o = spec.options || {};
    const layout = o.layout === 'single' ? 'single' : 'perEnv';
    const githubRepo = REPO_RE.test(String(o.githubRepo || '')) ? String(o.githubRepo) : '';
    const region = REGION_RE.test(spec.region) ? spec.region : 'eastus';
    const ws = spec.workspace || '';
    const chosen = o.targets && typeof o.targets === 'object' ? o.targets : {};
    const known = new Map((disc.subscriptions || []).map((s) => [s.id.toLowerCase(), s]));
    const blockers = [];
    const warnings = [];
    if (!disc.objectId) warnings.push('Could not read your Azure AD object id, so your access (Contributor / Reader) on each resource group will not be assigned automatically. Assign it in the portal, or run az login again.');

    // which subscription does each environment go to?
    const rows = [];
    for (const e of envs) {
      let sub = layout === 'single' ? String(disc.subscription || '') : String((chosen[e.name] || {}).subscription || '').trim();
      if (!sub) { blockers.push(layout === 'single' ? 'No Azure subscription is selected. Pick one in the Clouds view.' : `Choose the Azure subscription for ${e.name}. The default is one subscription per environment; pick "All environments in one subscription" to use a single one.`); continue; }
      if (!GUID_RE.test(sub)) { blockers.push(`"${sub}" is not a subscription id.`); continue; }
      sub = sub.toLowerCase();
      if (layout === 'perEnv' && known.size && !known.has(sub)) { blockers.push(`Your Azure sign-in cannot see subscription ${sub} (${e.name}). Run az login with an account that can, or choose another subscription.`); continue; }
      const info = known.get(sub) || { id: sub, name: sub === String(disc.subscription).toLowerCase() ? disc.subscriptionName : '', tenant: disc.tenant };
      rows.push({ env: e, sub, name: info.name || '', tenant: info.tenant || disc.tenant || '' });
    }
    if (layout === 'perEnv') {
      const bySub = new Map();
      for (const r of rows) bySub.set(r.sub, [...(bySub.get(r.sub) || []), r.env.name]);
      for (const [s, names] of bySub) if (names.length > 1) blockers.push(`${names.join(' and ')} would share subscription ${s}. The default is one subscription per environment: choose a different one for each, or pick "All environments in one subscription".`);
    } else if (envs.length > 1) {
      warnings.push('All environments share one Azure subscription. That is fine for development; for stronger isolation (especially production) use one subscription per environment.');
    }

    // resource groups that already exist, per subscription
    const have = {};
    await Promise.all([...new Set(rows.map((r) => r.sub))].map(async (s) => {
      if (layout === 'single' && s === String(disc.subscription).toLowerCase()) { have[s] = new Set(disc.groups || []); return; }
      const g = await exec('az', ['group', 'list', '--query', '[].name', '-o', 'json', `--subscription=${s}`], { timeout: 60000 });
      try { have[s] = new Set(JSON.parse(g.out || '[]')); } catch { have[s] = new Set(); }
    }));

    const steps = [{ id: 'template', title: `Write the Bicep template to ${TEMPLATE_PATH}`, cmd: 'az', args: ['--version'], writeFile: { path: TEMPLATE_PATH, content: fs.readFileSync(path.join(__dirname, 'templates', 'environment.bicep'), 'utf8') } }];
    for (const s of [...new Set(rows.map((r) => r.sub))]) {
      for (const ns of PROVIDERS) {
        steps.push({ id: `provider-${s.slice(0, 8)}-${ns}`, mutating: true, title: `Register resource provider ${ns}${layout === 'perEnv' ? ` in subscription ${s.slice(0, 8)}…` : ''}`, cmd: 'az', args: ['provider', 'register', `--namespace=${ns}`, '--wait', `--subscription=${s}`], timeout: 600000,
          check: { cmd: 'az', args: ['provider', 'show', `--namespace=${ns}`, '--query', 'registrationState', '-o', 'tsv', `--subscription=${s}`], match: '^Registered$' } });
      }
    }
    const targets = {};
    const docRows = [];
    for (const r of rows) {
      const e = r.env;
      const sub = r.sub;
      const rg = `${app}-${e.name}-rg`;
      const exists = have[sub] && have[sub].has(rg);
      steps.push({ id: `verify-${e.name}`, env: e.name, title: `Check that subscription ${sub.slice(0, 8)}… is available for ${e.name}`, cmd: 'az', args: ['account', 'show', `--subscription=${sub}`, '--query', 'id', '-o', 'tsv'], expect: `^${sub}$`,
        expectMessage: `Subscription ${sub} is not available to your Azure sign-in. Run az login and re-run.` });
      steps.push({ id: `rg-${e.name}`, env: e.name, mutating: true, title: `${exists ? 'Update tags on' : 'Create'} resource group ${rg}`, cmd: 'az', args: ['group', 'create', `--name=${rg}`, `--location=${region}`, '--tags', `environment=${e.name}`, `app=${app}`, 'managed-by=nativity-studio', `--subscription=${sub}`] });
      steps.push({ id: `deploy-${e.name}`, env: e.name, mutating: true, timeout: 1500000, title: `Deploy the environment into ${rg}`, cmd: 'az',
        args: ['deployment', 'group', 'create', `--name=cnd-${e.name}`, `--resource-group=${rg}`, `--template-file=${TEMPLATE_PATH}`, '--parameters', `appName=${app}`, `envName=${e.name}`, `location=${region}`, `protectedEnv=${e.protected ? 'true' : 'false'}`, ...(githubRepo ? [`githubRepo=${githubRepo}`] : []), `--subscription=${sub}`] });
      if (disc.objectId) {
        const role = e.protected ? 'Reader' : 'Contributor';
        steps.push({ id: `rbac-${e.name}`, env: e.name, mutating: true, optional: true, title: `You: ${role} on ${rg}${e.protected ? ' (read-only; changes through the pipeline identity)' : ''}`, cmd: 'az',
          args: ['role', 'assignment', 'create', `--assignee-object-id=${disc.objectId}`, `--assignee-principal-type=${disc.userType === 'servicePrincipal' ? 'ServicePrincipal' : 'User'}`, `--role=${role}`, `--scope=/subscriptions/${sub}/resourceGroups/${rg}`], okIf: 'already exists' });
      }
      // the two values the pipeline needs that only exist after the deployment: shown in the step log
      steps.push({ id: `ids-${e.name}`, env: e.name, optional: true, title: `Show the pipeline values of ${e.name} (client id, registry name)`, cmd: 'az',
        args: ['deployment', 'group', 'show', `--name=cnd-${e.name}`, `--resource-group=${rg}`, '--query', 'properties.outputs.[deployerClientId.value,registryName.value]', '-o', 'tsv', `--subscription=${sub}`] });
      const link = `https://portal.azure.com/${r.tenant ? `#@${r.tenant}` : '#'}/resource/subscriptions/${sub}/resourceGroups/${rg}/overview`;
      targets[e.name] = { scope: sub, group: rg, region, account: sub, tenant: r.tenant, consoleUrl: link.length <= 200 ? link : '' };
      docRows.push({ env: e.name, protected: e.protected, id: sub, idLabel: `${r.name ? `${r.name} ` : ''}\`${sub}\``, unit: `\`${rg}\``, region, link,
        vars: [['AZURE_TENANT_ID', r.tenant || '<tenant id>'], ['AZURE_SUBSCRIPTION_ID', sub], ['AZURE_RESOURCE_GROUP', rg],
          ['AZURE_CLIENT_ID', `<deployer client id: shown by the step "Show the pipeline values of ${e.name}" or: az identity show -g ${rg} -n ${app}-${e.name}-deployer --subscription ${sub} --query clientId -o tsv>`],
          ['AZURE_ACR_NAME', `<registry name: az acr list -g ${rg} --subscription ${sub} --query [0].name -o tsv>`]] });
    }

    if (docRows.length) {
      steps.push({ id: 'environments-doc', title: `Write ${DOC_PATH} (subscriptions, portal links, pipeline variables)`, cmd: 'az', args: ['--version'], writeFile: { path: DOC_PATH, content: environmentsDoc({ cloud: 'azure', app, layout, githubRepo }, docRows) } });
      const files = pipelineFiles({ cloud: 'azure', envs, name: app });
      const hasOne = ws && fs.existsSync(path.join(ws, PIPELINE_PATH));
      steps.push({ id: 'pipeline', title: hasOne ? `Write the reference pipeline to ${PIPELINE_EXAMPLE} (your ${PIPELINE_PATH} is left as it is)` : `Write the promotion pipeline ${PIPELINE_PATH}`, cmd: 'az', args: ['--version'], writeFile: { path: hasOne ? PIPELINE_EXAMPLE : PIPELINE_PATH, content: files['.github/workflows/promote.yml'] } });
    }

    const rgNode = (r) => ({
      kind: 'rg', label: `Resource group ${app}-${r.env.name}-rg`, sub: '', status: have[r.sub] && have[r.sub].has(`${app}-${r.env.name}-rg`) ? 'exists' : 'new', protected: r.env.protected,
      items: ['Container Apps environment', 'Log Analytics workspace', `Container Registry (${r.env.protected ? 'Standard' : 'Basic'})`, `Key Vault${r.env.protected ? ' (purge protection)' : ''}`, 'Managed identity: runtime', 'Managed identity: deployer',
        r.env.protected ? 'You: Reader (read-only)' : 'You: Contributor'],
    });
    const root = layout === 'perEnv'
      ? { kind: 'account', label: 'Your Azure subscriptions', sub: 'one per environment', status: 'exists', children: rows.map((r) => ({ kind: 'group', label: `${r.env.name}: ${r.name || 'subscription'}`, sub: r.sub, status: 'exists', children: [rgNode(r)] })) }
      : { kind: 'account', label: `Subscription ${(rows[0] && rows[0].name) || disc.subscriptionName || ''}`, sub: (rows[0] && rows[0].sub) || disc.subscription, status: 'exists', children: [{ kind: 'group', label: app, sub: 'Bicep template: environment.bicep', status: 'new', children: rows.map(rgNode) }] };
    const architecture = {
      title: layout === 'perEnv' ? 'Azure: one subscription per environment' : 'Azure: one resource group per environment, in one subscription',
      summary: `${layout === 'perEnv' ? 'Each environment lives in its own Azure subscription, so access, cost and mistakes stop at the subscription border. ' : 'Each environment is a resource group in one subscription. '}Every environment is made from the same Bicep template. Azure applies access (RBAC), policy, tags, cost reports and deletion at the resource group, so you can be Contributor on dev and only Reader on prod. Everything authenticates with managed identities, so there are no passwords or keys to store. Your CI/CD pipeline promotes one build through the environments in order.`,
      root,
      access: [
        { who: 'You', how: 'Contributor on dev-like resource groups, Reader on protected ones (assigned at the group)', what: 'can only change what you are allowed to change' },
        ...(githubRepo ? [{ who: `GitHub: ${githubRepo}`, how: 'federated credential on each deployer identity, bound to the GitHub environment of the same name', what: 'no secrets; one environment cannot use another’s identity' }] : []),
        { who: '<app>-<env>-deployer (managed identity)', how: 'AcrPush on the registry, Contributor on its own resource group', what: 'used by pipelines to deploy; cannot touch other environments' },
        { who: '<app>-<env>-runtime (managed identity)', how: 'AcrPull on the registry, Key Vault Secrets User', what: 'identity of the running container app; no secrets in config' },
      ],
      why: [
        layout === 'perEnv' ? 'Subscription per environment: the strongest isolation Azure offers; a dev mistake cannot reach prod.' : 'Resource group per environment: access, policy, tags, cost and deletion all scope to it.',
        'Managed identities: the cloud issues and rotates credentials; nothing for you to store.',
        'Same Bicep template everywhere: environments differ only in parameters.',
        'Your pipeline owns promotion: the same image moves through every stage, each with its own identity.',
      ],
      notes: ['The IDE does not create Azure subscriptions. Create or choose them (for example under a management group), then pick the subscription of each environment here.',
        'Whether environments share a subscription is your decision. Either way the pipeline promotes the same build through them.'],
    };
    return { architecture, steps, targets, warnings, blockers, prerequisites: ['Owner (or Contributor + User Access Administrator) on each subscription: the template creates role assignments', ...(layout === 'perEnv' ? ['Access to every subscription you choose, with one az login'] : [])], summary: `${rows.length} resource group(s) in ${new Set(rows.map((r) => r.sub)).size} subscription(s)` };
  }

  return { discover, plan };
};
