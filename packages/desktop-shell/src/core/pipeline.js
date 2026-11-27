/**
 * Starter CI/CD pipeline for a Cloud Native project: build ONE image, deploy it to the first environment, then promote the same
 * image through the others in order. Provision (the wizard) only builds the places things run in; this file is how code gets there.
 * It is a starting point: the values it reads (project ids, service accounts, regions) come from the GitHub "Environments" the
 * team creates, one per environment, so approvals for protected environments are GitHub's own protection rules.
 */
const NAME_RE = /^[a-z][a-z0-9-]{0,40}$/;

const yamlStr = (s) => JSON.stringify(String(s));

function deployStep(cloud, app) {
  if (cloud === 'gcp') {
    return [
      '      - uses: google-github-actions/auth@v2',
      '        with:',
      '          workload_identity_provider: ${{ vars.GCP_WORKLOAD_IDENTITY_PROVIDER }}',
      '          service_account: ${{ vars.GCP_DEPLOYER_SERVICE_ACCOUNT }}   # cnd-<environment>-sa, created by the Nativity wizard',
      '      - uses: google-github-actions/setup-gcloud@v2',
      '      - uses: docker/login-action@v3   # read the image that the build job pushed',
      '        with: { registry: ghcr.io, username: "${{ github.actor }}", password: "${{ secrets.GITHUB_TOKEN }}" }',
      '      - name: Copy the image into this environment',
      '        run: |',
      '          gcloud auth configure-docker ${{ vars.GCP_REGION }}-docker.pkg.dev --quiet',
      '          docker buildx imagetools create --tag "${{ vars.GCP_REGION }}-docker.pkg.dev/${{ vars.GCP_PROJECT }}/' + app + '-images/' + app + ':${{ github.sha }}" "$IMAGE"',
      '      - name: Deploy to Cloud Run',
      '        run: |',
      '          gcloud run deploy ' + app + ' --project "${{ vars.GCP_PROJECT }}" --region "${{ vars.GCP_REGION }}" \\',
      '            --image "${{ vars.GCP_REGION }}-docker.pkg.dev/${{ vars.GCP_PROJECT }}/' + app + '-images/' + app + ':${{ github.sha }}" \\',
      '            --service-account "${{ vars.GCP_RUNTIME_SERVICE_ACCOUNT }}"',
    ];
  }
  if (cloud === 'aws') {
    return [
      '      - uses: aws-actions/configure-aws-credentials@v4',
      '        with:',
      '          role-to-assume: ${{ vars.AWS_DEPLOY_ROLE_ARN }}   # ' + app + '-<environment>-deployer, in the AWS account of this environment',
      '          aws-region: ${{ vars.AWS_REGION }}',
      '      - id: ecr',
      '        uses: aws-actions/amazon-ecr-login@v2',
      '      - uses: docker/login-action@v3   # read the image that the build job pushed',
      '        with: { registry: ghcr.io, username: "${{ github.actor }}", password: "${{ secrets.GITHUB_TOKEN }}" }',
      '      - name: Copy the image into this environment',
      '        run: |',
      '          REPO="' + app + '-${{ github.job }}"',
      '          if aws ecr describe-images --repository-name "$REPO" --image-ids imageTag=${{ github.sha }} >/dev/null 2>&1; then echo "already there"; else',
      '            docker buildx imagetools create --tag "${{ steps.ecr.outputs.registry }}/$REPO:${{ github.sha }}" "$IMAGE"',
      '          fi',
      '      - name: Deploy (starter - replace with your ECS / App Runner / Lambda deploy)',
      '        run: echo "Deploy ${{ steps.ecr.outputs.registry }}/' + app + '-${{ github.job }}:${{ github.sha }} in ${{ vars.AWS_REGION }}"',
    ];
  }
  if (cloud === 'azure') {
    return [
      '      - uses: azure/login@v2',
      '        with:',
      '          client-id: ${{ vars.AZURE_CLIENT_ID }}   # the deployer identity of this environment',
      '          tenant-id: ${{ vars.AZURE_TENANT_ID }}',
      '          subscription-id: ${{ vars.AZURE_SUBSCRIPTION_ID }}   # the subscription of this environment',
      '      - uses: docker/login-action@v3   # read the image that the build job pushed',
      '        with: { registry: ghcr.io, username: "${{ github.actor }}", password: "${{ secrets.GITHUB_TOKEN }}" }',
      '      - name: Copy the image into this environment',
      '        run: |',
      '          az acr login --name "${{ vars.AZURE_ACR_NAME }}"',
      '          docker buildx imagetools create --tag "${{ vars.AZURE_ACR_NAME }}.azurecr.io/' + app + ':${{ github.sha }}" "$IMAGE"',
      '      - name: Deploy (starter - replace with your Container Apps / App Service deploy)',
      '        run: echo "Deploy ${{ vars.AZURE_ACR_NAME }}.azurecr.io/' + app + ':${{ github.sha }} to resource group ${{ vars.AZURE_RESOURCE_GROUP }}"',
    ];
  }
  return [
    '      - name: Deploy (starter - replace with kubectl / helm for your cluster)',
    '        run: echo "Deploy image $IMAGE to the ${{ github.job }} namespace"',
  ];
}

function promoteWorkflow({ cloud, envs, app }) {
  const first = envs[0].name;
  const lines = [
    `name: ${yamlStr(`${app}: build once, promote through environments`)}`,
    'on:',
    '  push:',
    '    branches: [main]',
    '  workflow_dispatch:',
    '',
    'permissions:',
    '  contents: read',
    '  id-token: write   # lets the job sign in to the cloud without stored keys',
    '  packages: write',
    '',
    'env:',
    `  IMAGE: ghcr.io/\${{ github.repository }}/${app}:\${{ github.sha }}   # the one build every environment receives`,
    '',
    'jobs:',
    '  build:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '      - uses: docker/login-action@v3',
    '        with: { registry: ghcr.io, username: "${{ github.actor }}", password: "${{ secrets.GITHUB_TOKEN }}" }',
    '      - uses: docker/build-push-action@v6',
    '        with: { context: ., push: true, tags: "${{ env.IMAGE }}" }',
    '      # add your unit tests before the image is built: nothing is promoted when they fail',
    '',
  ];
  let prev = 'build';
  for (const e of envs) {
    lines.push(
      `  ${e.name}:`,
      `    needs: ${prev}`,
      '    runs-on: ubuntu-latest',
      `    environment: ${e.name}${e.protected ? '   # protected: add required reviewers to this GitHub environment' : ''}`,
      '    steps:',
      ...deployStep(cloud, app),
      '',
    );
    prev = e.name;
  }
  lines.push(`# Environments: ${envs.map((e) => e.name).join(' -> ')} (first: ${first}). Create one GitHub Environment per name above and set its variables.`);
  return `${lines.join('\n')}\n`;
}

/** Files that make a new project ready for CI/CD promotion. */
function pipelineFiles({ cloud, envs, name }) {
  const app = String(name || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'app';
  if (!NAME_RE.test(app)) throw new Error('Invalid application name.');
  const list = (Array.isArray(envs) ? envs : []).filter((e) => e && /^[a-z][a-z0-9]{0,11}$/.test(e.name));
  if (!list.length) throw new Error('Choose at least one environment.');
  const cloudKey = ['gcp', 'aws', 'azure', 'k8s'].includes(cloud) ? cloud : 'gcp';
  const readme = [
    '# Deployment',
    '',
    'This project is set up for Cloud Native development:',
    '',
    `- **${list[0].name}** is where you work. Run and debug here, deploy here often.`,
    `- ${list.slice(1).map((e) => `**${e.name}**`).join(', ') || 'No other environments'} ${list.length > 1 ? 'are deployment targets: the same build is promoted, never rebuilt or edited.' : ''}`,
    '',
    '1. Provision the environments once from the IDE (Cloud Native wizard). That creates folders, projects, service accounts and registries. It does not deploy anything.',
    '2. Create one GitHub Environment per environment above and set the variables the workflow reads.',
    '3. Push to `main`: `.github/workflows/promote.yml` builds the image once and promotes it from the first environment to the last.',
    '',
  ].join('\n');
  return { '.github/workflows/promote.yml': promoteWorkflow({ cloud: cloudKey, envs: list, app }), 'deploy/README.md': readme };
}

module.exports = { pipelineFiles };
