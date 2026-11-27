/**
 * AWS landing zone: one CloudFormation STACK per environment, all from one reviewable template (infra/cnd-environments/aws/environment.yaml).
 *
 *   Default - one AWS account per environment (you choose the CLI profile that signs in to each account):
 *     dev account  -> stack <app>-dev-env
 *     sit account  -> stack <app>-sit-env
 *     prod account -> stack <app>-prod-env   (immutable image tags, versioned bucket, 1-year logs, termination protection)
 *   Option - all environments in one account (a stack each).
 *
 * The IDE does not create AWS accounts (that is an AWS Organizations decision with billing behind it): you pick existing ones.
 * The environments are promoted by YOUR pipeline: the generated workflow builds one image and copies it through the stages, signing in
 * to each account with that environment's deployer role (OpenID Connect from GitHub, no stored keys).
 *
 * Access: each environment has a DEPLOYER ROLE you (or the pipeline) assume instead of keys, and a separate RUNTIME ROLE for the app.
 */
const fs = require('fs');
const path = require('path');
const { environmentsDoc } = require('../../../core/envdoc');
const { pipelineFiles } = require('../../../core/pipeline');

const PROFILE_RE = /^[\w.@:+=,-]{1,64}$/;
const REPO_RE = /^[A-Za-z0-9_.-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/;

exports.build = (ctx, helpers) => {
  const { exec } = ctx;
  const { pArg, regionOf, profile, REGION_RE } = helpers;
  const TEMPLATE_PATH = 'infra/cnd-environments/aws/environment.yaml';
  const DOC_PATH = 'infra/cnd-environments/aws/ENVIRONMENTS.md';
  const PIPELINE_PATH = '.github/workflows/promote.yml';
  const PIPELINE_EXAMPLE = 'infra/cnd-environments/aws/promote.example.yml';

  async function profiles() {
    const r = await exec('aws', ['configure', 'list-profiles'], { timeout: 15000 });
    return r.ok ? r.out.split(/\r?\n/).map((x) => x.trim()).filter((x) => PROFILE_RE.test(x)).slice(0, 60) : [];
  }

  async function discover() {
    const p = profile();
    const known = await profiles();
    const r = await exec('aws', ['sts', 'get-caller-identity', '--output', 'json', ...pArg(p)], { timeout: 30000 });
    if (!r.ok) return { signedIn: false, account: '', arn: '', profile: p, profiles: known, stacks: [] };
    let id = {};
    try { id = JSON.parse(r.out); } catch { /* ignore */ }
    const region = await regionOf(p);
    let stacks = [];
    if (region) {
      const s = await exec('aws', ['cloudformation', 'describe-stacks', '--query', 'Stacks[].{n:StackName,s:StackStatus,t:Tags}', '--output', 'json', ...pArg(p), `--region=${region}`], { timeout: 40000 });
      try { stacks = JSON.parse(s.out || '[]'); } catch { stacks = []; }
    }
    return { signedIn: true, account: id.Account || '', arn: id.Arn || '', profile: p, profiles: known, region, stacks: stacks.filter((x) => /-env$/.test(x.n)).map((x) => ({ name: x.n, status: x.s })) };
  }

  /** The account a CLI profile signs in to ('' when it cannot sign in). */
  async function accountOf(p) {
    const r = await exec('aws', ['sts', 'get-caller-identity', '--output', 'json', ...pArg(p)], { timeout: 30000 });
    if (!r.ok) return '';
    try { const a = JSON.parse(r.out).Account; return /^\d{12}$/.test(a) ? a : ''; } catch { return ''; }
  }

  async function plan(spec, disc) {
    const { app, envs } = spec;
    const o = spec.options || {};
    const layout = o.layout === 'single' ? 'single' : 'perEnv';
    const githubRepo = REPO_RE.test(String(o.githubRepo || '')) ? String(o.githubRepo) : '';
    const region = REGION_RE.test(spec.region) ? spec.region : (disc.region || 'us-east-1');
    const ws = spec.workspace || '';
    const blockers = [];
    const warnings = [];
    const chosen = o.targets && typeof o.targets === 'object' ? o.targets : {};

    // which account does each environment go to?
    const accounts = new Map();
    const lookups = new Map();
    const rows = [];
    for (const e of envs) {
      const prof = layout === 'single' ? (disc.profile || '') : String((chosen[e.name] || {}).profile || '').trim();
      if (layout === 'perEnv' && !prof) { blockers.push(`Choose the AWS profile (account) for ${e.name}. The default is one account per environment; pick "All environments in one account" to use a single one.`); rows.push({ env: e, prof: '', acct: '' }); continue; }
      if (prof && !PROFILE_RE.test(prof)) { blockers.push(`"${prof}" is not a valid AWS profile name.`); rows.push({ env: e, prof: '', acct: '' }); continue; }
      if (!lookups.has(prof)) lookups.set(prof, layout === 'single' ? Promise.resolve(disc.account || '') : accountOf(prof));
      rows.push({ env: e, prof, acct: '' });
    }
    for (const [p, pr] of lookups) accounts.set(p, await pr);
    for (const r of rows) {
      if (!r.prof && layout === 'perEnv') continue;
      r.acct = accounts.get(r.prof) || '';
      if (!/^\d{12}$/.test(r.acct)) blockers.push(layout === 'single' ? 'Could not read your AWS account id. Sign in and refresh.' : `Could not sign in with profile "${r.prof}" for ${r.env.name}. Run: aws sso login --profile ${r.prof}`);
    }
    if (layout === 'perEnv') {
      const byAcct = new Map();
      for (const r of rows) if (r.acct) byAcct.set(r.acct, [...(byAcct.get(r.acct) || []), r.env.name]);
      for (const [a, names] of byAcct) if (names.length > 1) blockers.push(`${names.join(' and ')} would share account ${a}. The default is one account per environment: choose a different profile for each, or pick "All environments in one account".`);
    } else if (envs.length > 1) {
      warnings.push('All environments share one AWS account. That is fine for development; for stronger isolation (especially production) use one account per environment.');
    }

    const template = fs.readFileSync(path.join(__dirname, 'templates', 'environment.yaml'), 'utf8');
    const steps = [{ id: 'template', title: `Write the CloudFormation template to ${TEMPLATE_PATH}`, cmd: 'aws', args: ['--version'], writeFile: { path: TEMPLATE_PATH, content: template } }];
    const targets = {};
    const docRows = [];
    const stackExists = {};
    await Promise.all(rows.map(async (r) => {
      if (!r.acct) return;
      const stack = `${app}-${r.env.name}-env`;
      if (layout === 'single') { stackExists[r.env.name] = (disc.stacks || []).some((s) => s.name === stack); return; }
      const d = await exec('aws', ['cloudformation', 'describe-stacks', `--stack-name=${stack}`, '--query', 'Stacks[0].StackStatus', '--output', 'text', ...pArg(r.prof), `--region=${region}`], { timeout: 40000 });
      stackExists[r.env.name] = d.ok;
    }));

    let first = true;
    for (const r of rows) {
      const e = r.env;
      if (!r.acct) continue;
      const stack = `${app}-${e.name}-env`;
      const pa = pArg(r.prof);
      const provider = githubRepo && !o.oidcExists && (layout === 'perEnv' || first);
      first = false;
      steps.push({
        id: `verify-${e.name}`, env: e.name, title: `Check that ${r.prof ? `profile ${r.prof}` : 'your sign-in'} is account ${r.acct} (for ${e.name})`,
        cmd: 'aws', args: ['sts', 'get-caller-identity', '--query', 'Account', '--output', 'text', ...pa], expect: `^${r.acct}$`,
        expectMessage: `${r.prof ? `Profile ${r.prof}` : 'Your sign-in'} no longer points at account ${r.acct}. Sign in again${r.prof ? ` (aws sso login --profile ${r.prof})` : ''} and re-run.`,
      });
      steps.push({
        id: `stack-${e.name}`, env: e.name, mutating: true, timeout: 1200000,
        title: `${stackExists[e.name] ? 'Update' : 'Create'} stack ${stack} in account ${r.acct}`,
        cmd: 'aws', args: ['cloudformation', 'deploy', `--template-file=${TEMPLATE_PATH}`, `--stack-name=${stack}`, '--capabilities', 'CAPABILITY_NAMED_IAM', '--no-fail-on-empty-changeset',
          '--parameter-overrides', `AppName=${app}`, `EnvName=${e.name}`, `TrustedPrincipalArn=arn:aws:iam::${r.acct}:root`, `Protected=${e.protected ? 'true' : 'false'}`,
          ...(githubRepo ? [`GitHubRepo=${githubRepo}`, `CreateGitHubOidcProvider=${provider ? 'true' : 'false'}`] : []),
          '--tags', `environment=${e.name}`, `app=${app}`, 'managed-by=nativity-studio', ...pa, `--region=${region}`],
      });
      if (e.protected) steps.push({ id: `protect-${e.name}`, env: e.name, mutating: true, title: `Turn on termination protection for ${stack}`, cmd: 'aws', args: ['cloudformation', 'update-termination-protection', '--enable-termination-protection', `--stack-name=${stack}`, ...pa, `--region=${region}`] });
      const roleArn = `arn:aws:iam::${r.acct}:role/${app}-${e.name}-deployer`;
      const link = `https://${region}.console.aws.amazon.com/cloudformation/home?region=${region}#/stacks?filteringText=${stack}`;
      targets[e.name] = { stack, roleArn, region, scope: r.prof, account: r.acct, consoleUrl: link };
      docRows.push({ env: e.name, protected: e.protected, id: r.acct, idLabel: `\`${r.acct}\`${r.prof ? ` (profile \`${r.prof}\`)` : ''}`, unit: `\`${stack}\``, region, link, vars: [['AWS_DEPLOY_ROLE_ARN', roleArn], ['AWS_REGION', region]] });
    }

    // the hand-over: ENVIRONMENTS.md and the pipeline (never over a pipeline you already have)
    if (docRows.length) {
      steps.push({ id: 'environments-doc', title: `Write ${DOC_PATH} (accounts, console links, pipeline variables)`, cmd: 'aws', args: ['--version'], writeFile: { path: DOC_PATH, content: environmentsDoc({ cloud: 'aws', app, layout, githubRepo }, docRows) } });
      const files = pipelineFiles({ cloud: 'aws', envs, name: app });
      const have = ws && fs.existsSync(path.join(ws, PIPELINE_PATH));
      steps.push({ id: 'pipeline', title: have ? `Write the reference pipeline to ${PIPELINE_EXAMPLE} (your ${PIPELINE_PATH} is left as it is)` : `Write the promotion pipeline ${PIPELINE_PATH}`, cmd: 'aws', args: ['--version'], writeFile: { path: have ? PIPELINE_EXAMPLE : PIPELINE_PATH, content: files['.github/workflows/promote.yml'] } });
    }

    const stackNode = (r) => ({
      kind: 'stack', label: `Stack ${app}-${r.env.name}-env`, sub: '', status: stackExists[r.env.name] ? 'exists' : 'new', protected: r.env.protected,
      items: [`ECR repository ${app}-${r.env.name}${r.env.protected ? ' (immutable tags)' : ''}`, `S3 data bucket (private, encrypted${r.env.protected ? ', versioned' : ''})`, `Log group /${app}/${r.env.name} (${r.env.protected ? '1 year' : '30 days'})`,
        `Role ${app}-${r.env.name}-runtime  (the app)`, `Role ${app}-${r.env.name}-deployer  (you or the pipeline assume it)`, ...(r.env.protected ? ['Termination protection ON'] : [])],
    });
    const good = rows.filter((r) => r.acct);
    const root = layout === 'perEnv'
      ? { kind: 'account', label: 'Your AWS accounts', sub: 'one per environment', status: 'exists', children: good.map((r) => ({ kind: 'group', label: `${r.env.name}: account ${r.acct}`, sub: r.prof ? `profile ${r.prof}` : '', status: 'exists', children: [stackNode(r)] })) }
      : { kind: 'account', label: `AWS account ${(good[0] && good[0].acct) || disc.account || ''}`, sub: `${region}${disc.profile ? ` · profile ${disc.profile}` : ''}`, status: 'exists', children: [{ kind: 'group', label: app, sub: 'CloudFormation template: environment.yaml', status: 'new', children: good.map(stackNode) }] };
    const architecture = {
      title: layout === 'perEnv' ? 'AWS: one account per environment' : 'AWS: one stack per environment, in one account',
      summary: `${layout === 'perEnv' ? 'Each environment lives in its own AWS account, so access, cost and mistakes stop at the account border. ' : 'Every environment is a CloudFormation stack in one account. '}Every environment is made from the same template, so dev and prod are identical in shape and differ only in parameters. You (or your pipeline) get short-lived credentials by assuming each environment’s deployer role; the application runs as its own runtime role. Your CI/CD pipeline promotes one build through the environments in order.`,
      root,
      access: [
        { who: 'You', how: `sts:AssumeRole on ${app}-<env>-deployer`, what: 'short-lived credentials (1 hour), nothing stored on disk' },
        ...(githubRepo ? [{ who: `GitHub: ${githubRepo}`, how: 'OpenID Connect into the deployer role of the environment with the same name', what: 'no stored keys; one environment cannot use another’s role' }] : []),
        { who: `${app}-<env>-deployer`, how: 'push images to its own repository, read/write its own bucket, read its own logs, pass the runtime role, update its own stack', what: 'cannot touch other environments' },
        { who: `${app}-<env>-runtime`, how: 'write its own logs, read/write its own bucket', what: 'identity of the running service (Lambda, ECS, App Runner)' },
      ],
      why: [
        layout === 'perEnv' ? 'Account per environment: the strongest isolation AWS offers; a dev mistake cannot reach prod.' : 'Stack per environment: create, change, tag and delete an environment as one thing; re-running is safe.',
        'One template for all environments: dev and prod cannot drift apart in shape.',
        'Roles instead of keys: assume a role for an hour; nothing to leak or rotate.',
        'Your pipeline owns promotion: the same image moves through every stage, each with its own identity.',
      ],
      notes: ['The IDE does not create AWS accounts. Create or choose them in AWS Organizations (or use accounts you already have), then pick the CLI profile of each here.',
        'Whether environments share an account is your decision. Either way the pipeline promotes the same build through them.'],
    };
    return { architecture, steps, targets, warnings, blockers, prerequisites: ['CloudFormation, IAM (create roles), ECR, S3 and CloudWatch Logs permissions in each account (for example PowerUserAccess plus IAM role creation)', ...(layout === 'perEnv' ? ['A signed-in AWS CLI profile for each environment (aws sso login --profile <name>)'] : [])], summary: `${good.length} stack(s) in ${layout === 'perEnv' ? `${new Set(good.map((r) => r.acct)).size} account(s)` : region}` };
  }

  return { discover, plan };
};
