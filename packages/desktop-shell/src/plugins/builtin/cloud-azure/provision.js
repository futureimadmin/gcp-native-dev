/**
 * Azure landing zone: one RESOURCE GROUP per environment, inside one subscription.
 *   Subscription
 *     ├─ <app>-dev-rg    Container Apps environment, Log Analytics, Container Registry, Key Vault, 2 managed identities
 *     ├─ <app>-uat-rg    same template
 *     └─ <app>-prod-rg   same template + purge protection, Standard registry, longer logs, READ-ONLY access for you
 * A resource group is the unit Azure scopes access (RBAC), policy, tags, cost and deletion to. Access is granted AT the group, so a
 * developer can have Contributor on dev and Reader on prod. Resources authenticate with MANAGED IDENTITIES (no passwords or keys).
 * For hard isolation of production use a separate subscription under a management group; this template works there unchanged.
 */
const fs = require('fs');
const path = require('path');

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROVIDERS = ['Microsoft.App', 'Microsoft.OperationalInsights', 'Microsoft.ContainerRegistry', 'Microsoft.KeyVault', 'Microsoft.ManagedIdentity'];

exports.build = (ctx, helpers) => {
  const { exec } = ctx;
  const { REGION_RE } = helpers;
  const TEMPLATE_PATH = 'infra/cnd-environments/azure/environment.bicep';

  async function discover() {
    const r = await exec('az', ['account', 'show', '-o', 'json'], { timeout: 40000 });
    if (!r.ok) return { signedIn: false, subscription: '', groups: [] };
    let a = {};
    try { a = JSON.parse(r.out); } catch { /* ignore */ }
    const [oid, groups] = await Promise.all([
      exec('az', ['ad', 'signed-in-user', 'show', '--query', 'id', '-o', 'tsv'], { timeout: 40000 }),
      exec('az', ['group', 'list', '--query', '[].{n:name,l:location}', '-o', 'json'], { timeout: 60000 }),
    ]);
    let gs = [];
    try { gs = JSON.parse(groups.out || '[]'); } catch { gs = []; }
    return {
      signedIn: true, subscription: a.id || '', subscriptionName: a.name || '', tenant: a.tenantId || '', user: (a.user && a.user.name) || '', userType: (a.user && a.user.type) || 'user',
      objectId: oid.ok && GUID_RE.test(oid.out.trim()) ? oid.out.trim() : '', groups: gs.map((g) => g.n),
    };
  }

  async function plan(spec, disc) {
    const { app, envs } = spec;
    const region = REGION_RE.test(spec.region) ? spec.region : 'eastus';
    const sub = disc.subscription;
    const blockers = GUID_RE.test(sub) ? [] : ['No Azure subscription is selected. Pick one in the Clouds view.'];
    const warnings = [];
    if (!disc.objectId) warnings.push('Could not read your Azure AD object id, so your access (Contributor / Reader) on each resource group will not be assigned automatically. Assign it in the portal, or run az login again.');
    const steps = [{ id: 'template', title: `Write the Bicep template to ${TEMPLATE_PATH}`, cmd: 'az', args: ['--version'], writeFile: { path: TEMPLATE_PATH, content: fs.readFileSync(path.join(__dirname, 'templates', 'environment.bicep'), 'utf8') } }];
    for (const ns of PROVIDERS) {
      steps.push({ id: `provider-${ns}`, mutating: true, title: `Register resource provider ${ns}`, cmd: 'az', args: ['provider', 'register', `--namespace=${ns}`, '--wait', `--subscription=${sub}`], timeout: 600000,
        check: { cmd: 'az', args: ['provider', 'show', `--namespace=${ns}`, '--query', 'registrationState', '-o', 'tsv', `--subscription=${sub}`], match: '^Registered$' } });
    }
    const targets = {};
    const have = new Set(disc.groups || []);
    for (const e of envs) {
      const rg = `${app}-${e.name}-rg`;
      steps.push({ id: `rg-${e.name}`, env: e.name, mutating: true, title: `${have.has(rg) ? 'Update tags on' : 'Create'} resource group ${rg}`, cmd: 'az', args: ['group', 'create', `--name=${rg}`, `--location=${region}`, '--tags', `environment=${e.name}`, `app=${app}`, 'managed-by=nativity-studio', `--subscription=${sub}`] });
      steps.push({ id: `deploy-${e.name}`, env: e.name, mutating: true, timeout: 1500000, title: `Deploy the environment into ${rg}`, cmd: 'az',
        args: ['deployment', 'group', 'create', `--name=cnd-${e.name}`, `--resource-group=${rg}`, `--template-file=${TEMPLATE_PATH}`, '--parameters', `appName=${app}`, `envName=${e.name}`, `location=${region}`, `protectedEnv=${e.protected ? 'true' : 'false'}`, `--subscription=${sub}`] });
      if (disc.objectId) {
        const role = e.protected ? 'Reader' : 'Contributor';
        steps.push({ id: `rbac-${e.name}`, env: e.name, mutating: true, optional: true, title: `You: ${role} on ${rg}${e.protected ? ' (read-only; changes through the pipeline identity)' : ''}`, cmd: 'az',
          args: ['role', 'assignment', 'create', `--assignee-object-id=${disc.objectId}`, `--assignee-principal-type=${disc.userType === 'servicePrincipal' ? 'ServicePrincipal' : 'User'}`, `--role=${role}`, `--scope=/subscriptions/${sub}/resourceGroups/${rg}`], okIf: 'already exists' });
      }
      targets[e.name] = { scope: sub, group: rg, region };
    }
    const architecture = {
      title: 'Azure: one resource group per environment',
      summary: 'Each environment is a resource group, created from the same Bicep template. Azure applies access (RBAC), policy, tags, cost reports and deletion at the resource group, so you can be Contributor on dev and only Reader on prod. Everything authenticates with managed identities, so there are no passwords or keys to store.',
      root: {
        kind: 'account', label: `Subscription ${disc.subscriptionName || ''}`, sub: sub, status: 'exists',
        children: [{
          kind: 'group', label: app, sub: 'Bicep template: environment.bicep', status: 'new',
          children: envs.map((e) => ({
            kind: 'rg', label: `Resource group ${app}-${e.name}-rg`, sub: '', status: have.has(`${app}-${e.name}-rg`) ? 'exists' : 'new', protected: e.protected,
            items: ['Container Apps environment', 'Log Analytics workspace', `Container Registry (${e.protected ? 'Standard' : 'Basic'})`, `Key Vault${e.protected ? ' (purge protection)' : ''}`, 'Managed identity: runtime', 'Managed identity: deployer',
              e.protected ? 'You: Reader (read-only)' : 'You: Contributor'],
          })),
        }],
      },
      access: [
        { who: 'You', how: 'Contributor on dev-like resource groups, Reader on protected ones (assigned at the group)', what: 'can only change what you are allowed to change' },
        { who: '<app>-<env>-deployer (managed identity)', how: 'AcrPush on the registry, Contributor on its own resource group', what: 'used by pipelines to deploy; cannot touch other environments' },
        { who: '<app>-<env>-runtime (managed identity)', how: 'AcrPull on the registry, Key Vault Secrets User', what: 'identity of the running container app; no secrets in config' },
      ],
      why: [
        'Resource group per environment: access, policy, tags, cost and deletion all scope to it.',
        'Managed identities: the cloud issues and rotates credentials; nothing for you to store.',
        'Same Bicep template everywhere: environments differ only in parameters.',
        'For hard isolation, move prod to its own subscription under a management group; nothing here changes.',
      ],
    };
    return { architecture, steps, targets, warnings, blockers, prerequisites: ['Owner (or Contributor + User Access Administrator) on the subscription: the template creates role assignments'], summary: `${envs.length} resource group(s) in ${region}` };
  }

  return { discover, plan };
};
