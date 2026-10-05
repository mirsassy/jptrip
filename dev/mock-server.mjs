// Local stand-in for the deployed Apps Script web app: runs the real Code.gs
// against an in-memory copy of the trip Sheet.
//   npm run mock            -> http://localhost:8787  (sign in as avery@example.com, PIN 24681357)
// POST /reset restores the seed data; GET /state returns the raw fake Sheet.
import http from 'node:http';
import { createGas } from './gas-fake.mjs';

export function startMockServer({ port = 8787, delayMs = 0 } = {}) {
  // The fake Claude needs a key to be set, as in the real Sheet menu
  const fresh = () => { const g = createGas(); g.props.set('ANTHROPIC_API_KEY', 'sk-ant-fake-key-for-local-tests-only'); return g; };
  let gas = fresh();
  const server = http.createServer((req, res) => {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json',
    };
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const send = (status, obj) => setTimeout(() => { res.writeHead(status, cors); res.end(JSON.stringify(obj)); }, delayMs);
      if (req.method === 'POST' && req.url === '/reset') { gas = fresh(); return send(200, { ok: true }); }
      // Same as "Trip app → Remove a person's access" in the Sheet
      if (req.method === 'POST' && req.url.startsWith('/revoke?email=')) return send(200, gas.ctx.adminRemoveUser_(decodeURIComponent(req.url.slice(14))));
      if (req.method === 'GET' && req.url === '/state') return send(200, gas.ss.sheets);
      if (req.method === 'POST' && req.url === '/claude-off') { gas.props.delete('ANTHROPIC_API_KEY'); return send(200, { ok: true }); }
      if (req.method === 'POST' && req.url === '/claude-on') { gas.props.set('ANTHROPIC_API_KEY', 'sk-ant-fake-key-for-local-tests-only'); return send(200, { ok: true }); }
      if (req.method === 'GET') return send(200, { ok: true, app: 'japan-trip' });
      if (req.method !== 'POST') return send(405, { ok: false });
      // Apps Script cannot answer CORS preflights; make sure the app never triggers one.
      if (req.headers['content-type'] && !/^text\/plain/.test(req.headers['content-type'])) {
        return send(400, { ok: false, error: 'content type must be text/plain to avoid preflight' });
      }
      try {
        send(200, gas.post(JSON.parse(body || '{}')));
      } catch (e) {
        send(500, { ok: false, error: String(e) });
      }
    });
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT || 8787);
  startMockServer({ port, delayMs: Number(process.env.DELAY || 300) }).then(() => {
    console.log(`Mock Apps Script on http://localhost:${port} (administrator: avery@example.com, PIN 24681357)`);
  });
}
