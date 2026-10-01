// Read-only deployment smoke test. A SPA 200 is NOT an available auth endpoint.
const origin = process.argv[2] || 'https://staging.example.invalid';
let failed = false;
for (const suffix of ['read-grant', 'read-grant/exchange']) {
  const response = await fetch(`${origin}/api/classroom-agent/${suffix}`, {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: '{}', signal: AbortSignal.timeout(15000),
  });
  const json = (response.headers.get('content-type') || '').includes('application/json');
  const ok = response.status === 401 && json;
  console.log(JSON.stringify({ path: suffix, expected: '401 JSON for unauthenticated request', status: response.status, json, ok }));
  if (!ok) failed = true;
}
process.exitCode = failed ? 1 : 0;
