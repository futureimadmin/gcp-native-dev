/**
 * Kubernetes connector for private / on-prem / hybrid clouds (OpenShift, Tanzu, Rancher, bare-metal, and managed
 * EKS/GKE/AKS). Identity comes from kubeconfig; scope = kube context. Authentication is whatever the context uses
 * (OIDC, exec plugins, client certs), so there is no IDE sign-in to manage.
 */
const fs = require('fs');
const path = require('path');

exports.activate = (ctx) => {
  const { exec, commandLine, isMissing } = ctx;

  const CTX_RE = /^[A-Za-z0-9_.:@/-]{1,200}$/;
  const NAME_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
  const kc = (proj, args) => commandLine('kubectl', [...args, `--context=${proj.scope}`]);

  async function count(scope, resource, extra = []) {
    const r = await exec('kubectl', ['get', resource, ...extra, '-o', 'name', `--context=${scope}`, '--request-timeout=10s'], { timeout: 20000 });
    if (!r.ok) return /forbidden|Forbidden/.test(r.err) ? null : { error: r.err.split(/\r?\n/)[0].slice(0, 140) };
    return { n: r.out ? r.out.split(/\r?\n/).filter(Boolean).length : 0 };
  }

  ctx.cloud.register({
    id: 'k8s', name: 'Kubernetes (private cloud)', short: 'K8s', kind: 'private', color: '#326ce5',
    cli: { cmd: 'kubectl', install: 'https://kubernetes.io/docs/tasks/tools/' },
    scopeLabel: 'Cluster context',
    defaultRegion: 'default',
    regions: ['default'],
    validateScope: (s) => CTX_RE.test(s),
    validateRegion: () => true,
    consoleUrl: () => 'https://kubernetes.io/docs/tasks/access-application-cluster/web-ui-dashboard/',

    async status() {
      const r = await exec('kubectl', ['config', 'current-context'], { timeout: 15000 });
      if (isMissing(r)) return { installed: false, signedIn: false, identity: '', scope: '', detail: 'kubectl not found' };
      if (!r.ok || !r.out) return { installed: true, signedIn: false, identity: '', scope: '', detail: 'No kubeconfig context configured' };
      return { installed: true, signedIn: true, identity: r.out, scope: r.out, detail: 'kubeconfig context (authentication handled by your cluster login)' };
    },

    login(emit) {
      emit('log', 'Private clusters authenticate through kubeconfig. Sign in with your platform tool (for example "oc login", "kubectl oidc-login", or your Rancher/Tanzu CLI), then click Refresh.');
      emit('done', 0);
    },

    async logout() { /* nothing to revoke: kubeconfig is owned by the user */ },

    async scopes() {
      const r = await exec('kubectl', ['config', 'get-contexts', '-o', 'name'], { timeout: 15000 });
      if (!r.ok) throw new Error(isMissing(r) ? 'kubectl not found.' : r.err.split(/\r?\n/)[0]);
      return r.out.split(/\r?\n/).map((s) => s.trim()).filter((s) => CTX_RE.test(s)).map((s) => ({ id: s, name: s, detail: 'kube context' }));
    },

    async setScope(id) {
      if (!CTX_RE.test(id)) throw new Error('Invalid context name.');
      const r = await exec('kubectl', ['config', 'use-context', id], { timeout: 15000 });
      if (!r.ok) throw new Error(r.err.split(/\r?\n/)[0]);
      return {};
    },

    async inventory(scope) {
      if (!CTX_RE.test(scope)) throw new Error('Select a cluster context first.');
      const probes = [
        ['Cluster', 'Nodes', 'nodes', []], ['Cluster', 'Namespaces', 'namespaces', []],
        ['Workloads', 'Deployments', 'deployments', ['-A']], ['Workloads', 'StatefulSets', 'statefulsets', ['-A']],
        ['Workloads', 'Pods', 'pods', ['-A']], ['Networking', 'Services', 'services', ['-A']], ['Networking', 'Ingresses', 'ingresses', ['-A']],
        ['Storage', 'PersistentVolumeClaims', 'pvc', ['-A']],
      ];
      const out = await Promise.all(probes.map(async ([c, t, res, extra]) => {
        const r = await count(scope, res, extra);
        if (r === null) return null; // forbidden: hidden
        if (r.error) return { category: c, title: t, detail: 'unavailable', error: r.error, url: '' };
        return { category: c, title: t, detail: `${r.n} found`, count: r.n, url: '' };
      }));
      return out.filter(Boolean);
    },

    actions: {
      // Applies manifests in ./k8s to the selected cluster context.
      deploy: (proj, ws) => {
        if (!fs.existsSync(path.join(ws, 'k8s'))) throw new Error('No k8s/ folder with manifests in this project.');
        return { title: `kubectl apply (${proj.env})`, command: kc(proj, ['apply', '-f', 'k8s/', `--namespace=${proj.service}-${proj.env}`]) };
      },

      resourceKinds: (proj) => [{ id: 'namespace', label: 'Namespace', defaultName: `${proj.service}-${proj.env}` }],

      resource: (proj, params) => {
        if (params.type !== 'namespace') throw new Error('Unknown resource type.');
        const name = String(params.name || '').trim();
        if (!NAME_RE.test(name)) throw new Error('Namespace must be a DNS label (lowercase letters, digits, "-").');
        return { title: `Create namespace ${name}`, command: kc(proj, ['create', 'namespace', name]) };
      },
    },
  });
};
