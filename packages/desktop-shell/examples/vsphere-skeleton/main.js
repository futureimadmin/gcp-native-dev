/**
 * Example plugin: a private-cloud connector for VMware vSphere using the `govc` CLI.
 * Configure govc with environment variables (GOVC_URL, GOVC_USERNAME, GOVC_PASSWORD) outside the IDE;
 * the plugin never asks for or stores a password. Copy this folder to the IDE's plugins folder and enable it in Settings.
 */
exports.activate = (ctx) => {
  const SCOPE_RE = /^[\w .\/-]{1,120}$/;

  ctx.cloud.register({
    id: 'vsphere', name: 'VMware vSphere', short: 'vSphere', kind: 'private', color: '#78be20',
    cli: { cmd: 'govc', install: 'https://github.com/vmware/govmomi/tree/main/govc' },
    scopeLabel: 'Datacenter', defaultRegion: 'default', regions: ['default'],
    validateScope: (s) => SCOPE_RE.test(s),
    validateRegion: () => true,
    consoleUrl: () => 'https://vcenter.example.com/ui',

    async status() {
      const r = await ctx.exec('govc', ['about'], { timeout: 20000 });
      if (ctx.isMissing(r)) return { installed: false, signedIn: false, identity: '', scope: '', detail: 'govc not found' };
      if (!r.ok) return { installed: true, signedIn: false, identity: '', scope: '', detail: 'Set GOVC_URL / GOVC_USERNAME / GOVC_PASSWORD, then Refresh' };
      const name = (r.out.split(/\r?\n/).find((l) => /^Name:/.test(l)) || '').replace(/^Name:\s*/, '');
      return { installed: true, signedIn: true, identity: process.env.GOVC_USERNAME || 'vSphere session', scope: '', detail: name };
    },

    login(emit) {
      emit('log', 'vSphere uses govc environment variables. Set GOVC_URL, GOVC_USERNAME and GOVC_PASSWORD in your user environment, restart the IDE, then click Refresh.');
      emit('done', 0);
    },

    async logout() {},

    async scopes() {
      const r = await ctx.exec('govc', ['ls', '/'], { timeout: 20000 });
      if (!r.ok) throw new Error(r.err.split(/\r?\n/)[0]);
      return r.out.split(/\r?\n/).filter(Boolean).map((p) => ({ id: p.replace(/^\//, ''), name: p.replace(/^\//, ''), detail: 'datacenter' }));
    },

    async setScope() {},

    async inventory(scope) {
      if (!SCOPE_RE.test(scope)) throw new Error('Select a datacenter first.');
      const vms = await ctx.exec('govc', ['ls', `/${scope}/vm`], { timeout: 30000 });
      const hosts = await ctx.exec('govc', ['ls', `/${scope}/host`], { timeout: 30000 });
      const n = (r) => (r.ok && r.out ? r.out.split(/\r?\n/).filter(Boolean).length : 0);
      return [
        { category: 'Compute', title: 'Virtual machines', detail: `${n(vms)} found`, count: n(vms), url: '' },
        { category: 'Compute', title: 'Hosts / clusters', detail: `${n(hosts)} found`, count: n(hosts), url: '' },
      ];
    },

    actions: {},
  });
};
