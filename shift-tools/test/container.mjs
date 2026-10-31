import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { containerArgs, ensureImages, EGRESS_NETWORK, INTERN_IMAGE, startNetwork, stopNetwork } from '../lib/docker.mjs';
import { git } from '../lib/git.mjs';

// Real attacks from inside the real container, using the same arguments shift:open uses. Every
// "blocked" check has a positive control, so a broken probe can't pass as a working wall.
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const base = mkdtempSync(join(process.env.TMPDIR_FOR_DOCKER ?? join(process.env.HOME, '.agent-intern-test-')));
const workspace = join(base, 'workspace');
mkdirSync(workspace, { recursive: true });
git(workspace, ['init', '--quiet', '--template=', '-b', 'main']);
writeFileSync(join(workspace, 'file.txt'), 'x\n');
git(workspace, ['add', '--all']);
git(workspace, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'base']);
const taskFile = join(base, 'TASK.md');
writeFileSync(taskFile, 'task\n');
writeFileSync(join(workspace, 'TASK.md'), 'task\n');

// A canary on this machine, so reaching the host would be plain to see.
const canary = createServer((socket) => socket.end('host-reached\n'));
await new Promise((done) => canary.listen(0, '0.0.0.0', done));
const hostPort = canary.address().port;

const PROBE = String.raw`
const net = require('net');
const fs = require('fs');
const { execSync } = require('child_process');
const out = {};
const tcp = (host, port, ms = 2500) => new Promise((done) => {
  const s = net.connect({ host, port });
  const end = (v) => { s.destroy(); done(v); };
  s.setTimeout(ms, () => end('timeout'));
  s.on('connect', () => end('connected'));
  s.on('data', () => end('connected'));
  s.on('error', (e) => end(e.code || 'error'));
});
const viaProxy = (target) => new Promise((done) => {
  const s = net.connect({ host: 'proxy', port: 3128 });
  s.setTimeout(20000, () => { s.destroy(); done('timeout'); });
  s.on('error', (e) => done(e.code));
  s.on('connect', () => s.write('CONNECT ' + target + ' HTTP/1.1\r\nHost: ' + target + '\r\n\r\n'));
  s.on('data', (d) => { s.destroy(); done(String(d).split('\r\n')[0]); });
});
const shell = (cmd) => { try { return { ok: true, out: execSync(cmd, { stdio: 'pipe', timeout: 15000 }).toString() }; } catch (e) { return { ok: false, out: String(e.stderr || e.message) }; } };
(async () => {
  out.paths = Object.fromEntries(['/Users', '/host', '/host_mnt', '/var/run/docker.sock', '/run/docker.sock', '/root/.ssh', '/home/intern/.ssh', '/home/intern/.aws', '/home/intern/.config/gh', '/home/intern/.gitconfig'].map((p) => [p, fs.existsSync(p)]));
  out.mounts = fs.readFileSync('/proc/self/mountinfo', 'utf8').split('\n').filter((l) => /workspace|\.claude|Users|host_mnt/.test(l)).map((l) => l.split(' ')[4]);
  out.env = Object.keys(process.env).filter((k) => /TOKEN|SECRET|KEY|PASSWORD|CREDENTIAL|CLOUDFLARE|GITHUB|GH_|WATCHER|SHIFT_/i.test(k));
  out.uid = process.getuid();
  out.capEff = /CapEff:\s*(\S+)/.exec(fs.readFileSync('/proc/self/status', 'utf8'))[1];
  out.noNewPrivs = /NoNewPrivs:\s*(\d)/.exec(fs.readFileSync('/proc/self/status', 'utf8'))[1];
  out.sudo = shell('command -v sudo').ok;
  out.writeRoot = shell('touch /etc/x').ok;
  out.writeUsr = shell('touch /usr/local/bin/x').ok;
  out.writeWorkspace = shell('touch /workspace/ok').ok;
  out.writeTask = shell('sh -c "echo changed > /workspace/TASK.md"').ok;
  out.dnsExample = shell('getent hosts example.com').ok;
  out.dnsGithub = shell('getent hosts github.com').ok;
  out.dnsProxy = shell('getent hosts proxy').ok;
  out.directIp = await tcp('1.1.1.1', 443);
  out.directIp80 = await tcp('8.8.8.8', 53);
  out.direct = await tcp('github.com', 443);
  out.hostInternal = await tcp('host.docker.internal', ${hostPort});
  out.gatewayInternal = await tcp('gateway.docker.internal', ${hostPort});
  out.vmHost = await tcp('192.168.65.254', ${hostPort});
  out.vmGateway = await tcp('192.168.65.1', ${hostPort});
  const gw = fs.readFileSync('/proc/net/route', 'utf8').split('\n')[1];
  out.defaultRoute = /\b00000000\b/.test((gw || '').split('\t')[1] || '') ;
  out.proxyDenied = {};
  for (const t of ['github.com:443', 'example.com:443', 'api.cloudflare.com:443', 'evil.example:443', 'api.anthropic.com:80', 'api.anthropic.com:22', 'host.docker.internal:${hostPort}', '169.254.169.254:80', '[::1]:443']) out.proxyDenied[t] = await viaProxy(t);
  out.proxyAllowed = {};
  for (const t of ['api.anthropic.com:443', 'claude.ai:443', 'platform.claude.com:443', 'registry.npmjs.org:443']) out.proxyAllowed[t] = await viaProxy(t);
  out.npmLocked = shell('cd /tmp && npm view esbuild version');
  out.push = shell('cd /workspace && git remote -v && git push https://github.com/example/example.git HEAD:refs/heads/shift/9999');
  out.remotes = shell('cd /workspace && git remote').out.trim();
  out.ssh = shell('command -v ssh').ok;
  console.log('PROBE:' + JSON.stringify(out));
})();
`;

let code = 1;
try {
  ensureImages();
  startNetwork();

  const args = containerArgs({ workspace, taskFile, name: 'agent-intern-container-test' });
  const run = spawnSync('docker', ['run', ...args, '--entrypoint', 'node', INTERN_IMAGE, '-e', PROBE], { encoding: 'utf8', timeout: 180_000 });
  if (run.status !== 0) console.log(run.stderr.slice(-2000));
  const line = run.stdout.split('\n').find((l) => l.startsWith('PROBE:'));
  if (!line) throw new Error(`the probe produced nothing: ${run.stdout.slice(-500)} ${run.stderr.slice(-500)}`);
  const p = JSON.parse(line.slice(6));

  // Positive controls: from a normal network the same probes do connect.
  const control = spawnSync('docker', [
    'run', '--rm', '--network', EGRESS_NETWORK, '--entrypoint', 'node', INTERN_IMAGE, '-e',
    `const n=require('net');const t=(h,p)=>new Promise(d=>{const s=n.connect({host:h,port:p});s.setTimeout(4000,()=>{s.destroy();d('timeout')});s.on('connect',()=>{s.destroy();d('connected')});s.on('error',e=>d(e.code))});(async()=>{console.log(JSON.stringify({host:await t('host.docker.internal',${hostPort}),net:await t('1.1.1.1',443)}))})()`,
  ], { encoding: 'utf8', timeout: 60_000 });
  const c = JSON.parse(control.stdout.trim().split('\n').pop() || '{}');
  check('control: the probe reaches this Mac from a normal network', c.host === 'connected', c.host);
  check('control: the probe reaches the internet from a normal network', c.net === 'connected', c.net);

  console.log('\n-- host files --');
  for (const [path, found] of Object.entries(p.paths)) check(`${path} is absent`, found === false);
  check('only the workspace, task and login are mounted', p.mounts.every((m) => /^\/(workspace(\/TASK\.md)?|home\/intern\/\.claude)$/.test(m)), p.mounts.join(' '));

  console.log('\n-- secrets --');
  check('no secret-looking environment variables', p.env.length === 0, p.env.join(' '));

  console.log('\n-- privileges --');
  check('runs as the unprivileged intern user', p.uid === 1001, `uid ${p.uid}`);
  check('holds zero capabilities', /^0+$/.test(p.capEff), p.capEff);
  check('no-new-privileges is on', p.noNewPrivs === '1');
  check('sudo is not installed', p.sudo === false);
  check('the root filesystem is read-only', p.writeRoot === false && p.writeUsr === false);
  check('the workspace is writable', p.writeWorkspace === true);
  check('TASK.md is read-only inside the container', p.writeTask === false);

  console.log('\n-- network: direct --');
  check('no default route out', p.defaultRoute === false);
  check('DNS does not resolve outside names', p.dnsExample === false && p.dnsGithub === false);
  check('control: DNS resolves the proxy', p.dnsProxy === true);
  check('direct connection to 1.1.1.1 fails', p.directIp !== 'connected', p.directIp);
  check('direct connection to 8.8.8.8 fails', p.directIp80 !== 'connected', p.directIp80);
  check('direct connection to github.com fails', p.direct !== 'connected', p.direct);
  check('this Mac is unreachable (host.docker.internal)', p.hostInternal !== 'connected', p.hostInternal);
  check('this Mac is unreachable (gateway.docker.internal)', p.gatewayInternal !== 'connected', p.gatewayInternal);
  check('this Mac is unreachable (Docker VM host address)', p.vmHost !== 'connected', p.vmHost);
  check('this Mac is unreachable (Docker VM gateway)', p.vmGateway !== 'connected', p.vmGateway);

  console.log('\n-- network: through the proxy --');
  for (const [target, answer] of Object.entries(p.proxyDenied)) check(`proxy refuses ${target}`, /403/.test(answer), answer);
  for (const [target, answer] of Object.entries(p.proxyAllowed)) check(`proxy allows ${target}`, /200/.test(answer), answer);
  check('npm reaches the registry through the proxy', p.npmLocked.ok === true, p.npmLocked.out.trim().slice(0, 40));

  console.log('\n-- push --');
  check('the clone has no remote', p.remotes === '', p.remotes);
  check('ssh is not installed', p.ssh === false);
  check('a push to GitHub fails', p.push.ok === false, p.push.out.trim().split('\n').pop()?.slice(0, 90));

  console.log('\n-- host side --');
  check('nothing changed the task file on this Mac', readFileSync(taskFile, 'utf8') === 'task\n');

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} of ${results.length} passed`);
  code = failed.length ? 1 : 0;
} finally {
  stopNetwork();
  canary.close();
  rmSync(base, { recursive: true, force: true });
}
process.exit(code);
