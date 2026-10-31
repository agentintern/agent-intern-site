import { createServer } from 'node:http';
import { connect } from 'node:net';

// A CONNECT proxy with a fixed list. Deny by default. There's no way to add to the list at runtime,
// and traffic stays TLS end to end, so the proxy can't read it either.
const ALLOWED = new Set([
  'api.anthropic.com',
  'claude.ai',
  'platform.claude.com',
  'registry.npmjs.org',
]);

const server = createServer((_req, res) => {
  res.writeHead(403).end('plain http is not allowed\n');
});

server.on('connect', (req, client, head) => {
  const [host, port] = String(req.url).split(':');
  if (!ALLOWED.has(host) || port !== '443') {
    console.log(`denied ${String(req.url).slice(0, 120)}`);
    client.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    return;
  }
  const upstream = connect(443, host, () => {
    client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head.length) upstream.write(head);
    upstream.pipe(client);
    client.pipe(upstream);
  });
  const drop = () => { upstream.destroy(); client.destroy(); };
  upstream.on('error', drop);
  client.on('error', drop);
});

server.listen(3128, '0.0.0.0', () => console.log('proxy ready'));
