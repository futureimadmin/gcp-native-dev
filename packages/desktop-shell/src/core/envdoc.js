/**
 * ENVIRONMENTS.md for AWS and Azure: where each environment lives, how to open it, and the exact values the CI/CD pipeline needs.
 * The IDE builds the places things run in; the customer's pipeline moves the code through them, so this file is the hand-over.
 * Pure text, no I/O.
 */

/**
 * rows: [{ env, protected, id, idLabel, unit, unitLabel, region, link, vars: [[NAME, value], ...] }]
 * opts: { cloud: 'aws' | 'azure', app, layout: 'perEnv' | 'single', githubRepo }
 */
function environmentsDoc(opts, rows) {
  const aws = opts.cloud === 'aws';
  const cloudName = aws ? 'AWS' : 'Azure';
  const idName = aws ? 'AWS account' : 'Azure subscription';
  const unitName = aws ? 'CloudFormation stack' : 'Resource group';
  const L = [];
  L.push(`# ${opts.app}: environments on ${cloudName}`, '');
  L.push(opts.layout === 'single'
    ? `All environments are in **one ${idName}**. Each environment is its own ${unitName}, so access, tags, cost and deletion are kept apart, but a person or pipeline with broad rights on the ${idName} can reach every environment.`
    : `Each environment is in **its own ${idName}** (the default). Access, cost and blast radius stop at the ${idName} border: a mistake in dev cannot touch prod.`);
  L.push('', 'You can change this choice at any time; the templates are the same either way. Account structure, access and approvals are yours to decide: the IDE creates the environments and your CI/CD pipeline promotes the code through them.', '');
  L.push(`| Environment | ${idName} | ${unitName} | Region | Open in the console |`, '|---|---|---|---|---|');
  for (const r of rows) L.push(`| ${r.env}${r.protected ? ' (protected)' : ''} | ${r.idLabel} | ${r.unit} | ${r.region} | ${r.link ? `[open](${r.link})` : ''} |`);
  L.push('', '## About addresses', '',
    `${cloudName} does not give each environment its own console address: everyone uses the same console, and the ${idName} you are signed in to is what differs. ${aws
      ? 'For a clear address per environment, give each account an alias (IAM, Account alias) and use `https://<alias>.signin.aws.amazon.com/console`, for example `https://' + opts.app + '-sit.signin.aws.amazon.com/console`.'
      : 'The links above open the resource group of each environment directly in the Azure portal.'}`,
    `The addresses of your own application (for example \`sit.${opts.app}.example.com\`) are set with a custom domain on the service you deploy, not here.`, '');
  L.push('## Pipeline', '',
    'The generated workflow `.github/workflows/promote.yml` (or `infra/cnd-environments/' + opts.cloud + '/promote.example.yml` when you already had a pipeline) builds the image once and promotes the same image from the first environment to the last. It is a starting point: replace the "Deploy" step with your own, add tests, and use any CI system you like.', '',
    '1. In GitHub, create one **Environment** per name in the table (Settings, Environments). Add required reviewers on protected environments: that is the approval gate.',
    `2. Set these variables on each GitHub environment${opts.githubRepo ? '' : ' (the pipeline signs in with them)'}:`, '');
  for (const r of rows) {
    L.push(`**${r.env}**`, '```', ...r.vars.map(([k, v]) => `gh variable set ${k} --env ${r.env} --body "${v}"`), '```', '');
  }
  L.push(opts.githubRepo
    ? `3. Sign-in uses OpenID Connect for \`${opts.githubRepo}\`: no secrets are stored. Only a job running in the GitHub environment named like the stage can assume that stage's deployer.`
    : '3. Sign-in: the deployer of each environment can be assumed by your pipeline. For passwordless sign-in from GitHub, run Provision again with your repository (owner/name) filled in.',
  '', '## Promotion in one line', '', '`build` once, then `' + rows.map((r) => r.env).join('` then `') + '`: the same image, never rebuilt, each stage with its own identity.', '');
  return `${L.join('\n')}\n`;
}

module.exports = { environmentsDoc };
