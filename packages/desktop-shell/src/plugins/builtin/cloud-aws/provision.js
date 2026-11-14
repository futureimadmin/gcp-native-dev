/**
 * AWS landing zone: one CloudFormation STACK per environment, all from one reviewable template (infra/cnd-environments/aws/environment.yaml).
 *   AWS account
 *     ├─ <app>-dev-env    stack: ECR repository, private encrypted S3 bucket, log group, runtime role, deployer role
 *     ├─ <app>-uat-env    stack: same template, different parameters
 *     └─ <app>-prod-env   stack: same template + immutable image tags, bucket versioning, 1-year logs, termination protection
 * A stack is the unit AWS tracks, tags, updates and deletes together, so an environment is created, changed or removed as ONE thing,
 * and "deploy" is idempotent: running it again only applies differences.
 *
 * Access: each environment has a DEPLOYER ROLE you assume (sts:AssumeRole, short-lived credentials) instead of keys, and a separate
 * RUNTIME ROLE for the application. For hard isolation of production use a separate AWS account (AWS Organizations); the same template works there.
 */
const fs = require('fs');
const path = require('path');

exports.build = (ctx, helpers) => {
  const { exec } = ctx;
  const { pArg, regionOf, profile, REGION_RE } = helpers;
  const TEMPLATE_PATH = 'infra/cnd-environments/aws/environment.yaml';

  async function discover() {
    const p = profile();
    const r = await exec('aws', ['sts', 'get-caller-identity', '--output', 'json', ...pArg(p)], { timeout: 30000 });
    if (!r.ok) return { signedIn: false, account: '', arn: '', profile: p, stacks: [] };
    let id = {};
    try { id = JSON.parse(r.out); } catch { /* ignore */ }
    const region = await regionOf(p);
    let stacks = [];
    if (region) {
      const s = await exec('aws', ['cloudformation', 'describe-stacks', '--query', 'Stacks[].{n:StackName,s:StackStatus,t:Tags}', '--output', 'json', ...pArg(p), `--region=${region}`], { timeout: 40000 });
      try { stacks = JSON.parse(s.out || '[]'); } catch { stacks = []; }
    }
    return { signedIn: true, account: id.Account || '', arn: id.Arn || '', profile: p, region, stacks: stacks.filter((x) => /-env$/.test(x.n)).map((x) => ({ name: x.n, status: x.s })) };
  }

  async function plan(spec, disc) {
    const { app, envs } = spec;
    const region = REGION_RE.test(spec.region) ? spec.region : (disc.region || 'us-east-1');
    const blockers = [];
    if (!/^\d{12}$/.test(disc.account)) blockers.push('Could not read your AWS account id. Sign in and refresh.');
    const trusted = `arn:aws:iam::${disc.account}:root`;
    const profileArgs = disc.profile ? [`--profile=${disc.profile}`] : [];
    const template = fs.readFileSync(path.join(__dirname, 'templates', 'environment.yaml'), 'utf8');
    const steps = [{ id: 'template', title: `Write the CloudFormation template to ${TEMPLATE_PATH}`, cmd: 'aws', args: ['--version'], writeFile: { path: TEMPLATE_PATH, content: template } }];
    const targets = {};
    const existingStacks = new Set((disc.stacks || []).map((s) => s.name));
    for (const e of envs) {
      const stack = `${app}-${e.name}-env`;
      steps.push({
        id: `stack-${e.name}`, env: e.name, mutating: true, timeout: 1200000,
        title: `${existingStacks.has(stack) ? 'Update' : 'Create'} stack ${stack}`,
        cmd: 'aws', args: ['cloudformation', 'deploy', `--template-file=${TEMPLATE_PATH}`, `--stack-name=${stack}`, '--capabilities', 'CAPABILITY_NAMED_IAM', '--no-fail-on-empty-changeset',
          '--parameter-overrides', `AppName=${app}`, `EnvName=${e.name}`, `TrustedPrincipalArn=${trusted}`, `Protected=${e.protected ? 'true' : 'false'}`,
          '--tags', `environment=${e.name}`, `app=${app}`, 'managed-by=nativity-studio', ...profileArgs, `--region=${region}`],
      });
      if (e.protected) {
        steps.push({ id: `protect-${e.name}`, env: e.name, mutating: true, title: `Turn on termination protection for ${stack}`, cmd: 'aws', args: ['cloudformation', 'update-termination-protection', '--enable-termination-protection', `--stack-name=${stack}`, ...profileArgs, `--region=${region}`] });
      }
      targets[e.name] = { stack, roleArn: `arn:aws:iam::${disc.account}:role/${app}-${e.name}-deployer`, region };
    }
    const architecture = {
      title: 'AWS: one CloudFormation stack per environment',
      summary: 'Every environment is a CloudFormation stack made from the same template, so dev and prod are identical in shape and differ only in parameters. Stacks are created, updated and deleted as one unit and tagged for cost reports. You get short-lived credentials by assuming each environment’s deployer role; the application runs as its own runtime role.',
      root: {
        kind: 'account', label: `AWS account ${disc.account || ''}`, sub: `${region}${disc.profile ? ` · profile ${disc.profile}` : ''}`, status: 'exists',
        children: [{
          kind: 'group', label: app, sub: 'CloudFormation template: environment.yaml', status: 'new',
          children: envs.map((e) => ({
            kind: 'stack', label: `Stack ${app}-${e.name}-env`, sub: '', status: existingStacks.has(`${app}-${e.name}-env`) ? 'exists' : 'new', protected: e.protected,
            items: [`ECR repository ${app}-${e.name}${e.protected ? ' (immutable tags)' : ''}`, `S3 data bucket (private, encrypted${e.protected ? ', versioned' : ''})`, `Log group /${app}/${e.name} (${e.protected ? '1 year' : '30 days'})`,
              `Role ${app}-${e.name}-runtime  (the app)`, `Role ${app}-${e.name}-deployer  (you assume it)`, ...(e.protected ? ['Termination protection ON'] : [])],
          })),
        }],
      },
      access: [
        { who: 'You', how: `sts:AssumeRole on ${app}-<env>-deployer`, what: 'short-lived credentials (1 hour), nothing stored on disk' },
        { who: `${app}-<env>-deployer`, how: 'push images to its own repository, read/write its own bucket, read its own logs, pass the runtime role, update its own stack', what: 'cannot touch other environments' },
        { who: `${app}-<env>-runtime`, how: 'write its own logs, read/write its own bucket', what: 'identity of the running service (Lambda, ECS, App Runner)' },
      ],
      why: [
        'Stack per environment: create, change, tag and delete an environment as one thing; re-running is safe.',
        'One template for all environments: dev and prod cannot drift apart in shape.',
        'Roles instead of keys: assume a role for an hour; nothing to leak or rotate.',
        'Production-like environments get immutable image tags, versioned data, longer logs and termination protection.',
      ],
    };
    return { architecture, steps, targets, warnings: [], blockers, prerequisites: ['CloudFormation, IAM (create roles), ECR, S3 and CloudWatch Logs permissions in this account (for example PowerUserAccess plus IAM role creation)'], summary: `${envs.length} stack(s) in ${region}` };
  }

  return { discover, plan };
};
