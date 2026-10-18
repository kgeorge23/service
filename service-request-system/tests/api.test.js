// End-to-end API test using Node's built-in test runner (no extra deps).
// Run with:  npm test
process.env.DB_PATH = require('path').join(require('os').tmpdir(), `sr-test-${Date.now()}.db`);

const test = require('node:test');
const assert = require('node:assert');
const app = require('../server');

let server, base;
const state = {};

test.before(() => new Promise((resolve) => {
  server = app.listen(0, () => { base = `http://localhost:${server.address().port}/api`; resolve(); });
}));
test.after(() => server.close());

async function call(path, { method = 'GET', body, token, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + path, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  return { status: res.status, data: await res.json() };
}

test('citizen can register and is rejected on duplicates / bad input', async () => {
  let r = await call('/auth/register', { method: 'POST', body: { name: 'Test User', email: 'Test@Example.com', password: 'secret1' } });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.data.user.role, 'citizen');
  state.citizen = r.data.token;

  r = await call('/auth/register', { method: 'POST', body: { name: 'Dup', email: 'test@example.com', password: 'secret1' } });
  assert.strictEqual(r.status, 409);
  r = await call('/auth/register', { method: 'POST', body: { name: 'X', email: 'bad', password: '1' } });
  assert.strictEqual(r.status, 400);
});

test('login works and wrong password fails', async () => {
  let r = await call('/auth/login', { method: 'POST', body: { email: 'test@example.com', password: 'wrong' } });
  assert.strictEqual(r.status, 401);
  r = await call('/auth/login', { method: 'POST', body: { email: 'admin@example.com', password: 'Admin@123' } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.user.role, 'admin');
  state.admin = r.data.token;
});

test('citizen submits a request (with optional image) and sees it listed', async () => {
  const form = new FormData();
  form.append('category', 'Streetlight');
  form.append('location', 'Moi Avenue');
  form.append('description', 'Light is broken for a week now.');
  form.append('image', new Blob([Buffer.from('89504e470d0a1a0a', 'hex')], { type: 'image/png' }), 'x.png');
  let r = await call('/requests', { method: 'POST', token: state.citizen, form });
  assert.strictEqual(r.status, 201);
  assert.match(r.data.request.ref_code, /^SR-\d{4}-\d{6}$/);
  assert.ok(r.data.request.image_path);
  state.reqId = r.data.request.id;

  r = await call('/requests', { token: state.citizen });
  assert.strictEqual(r.data.requests.length, 1);
});

test('validation: bad category, short description, non-image upload', async () => {
  let f = new FormData(); f.append('category', 'Nope'); f.append('location', 'abc'); f.append('description', 'long enough text');
  assert.strictEqual((await call('/requests', { method: 'POST', token: state.citizen, form: f })).status, 400);

  f = new FormData(); f.append('category', 'Other'); f.append('location', 'abc'); f.append('description', 'short');
  assert.strictEqual((await call('/requests', { method: 'POST', token: state.citizen, form: f })).status, 400);

  f = new FormData(); f.append('category', 'Other'); f.append('location', 'abc'); f.append('description', 'long enough text');
  f.append('image', new Blob(['hi'], { type: 'text/plain' }), 'a.txt');
  assert.strictEqual((await call('/requests', { method: 'POST', token: state.citizen, form: f })).status, 400);
});

test('access control: unauthenticated, citizen-on-admin, other citizen', async () => {
  assert.strictEqual((await call('/requests')).status, 401);
  assert.strictEqual((await call('/admin/analytics', { token: state.citizen })).status, 403);

  const other = await call('/auth/register', { method: 'POST', body: { name: 'Other Person', email: 'other@example.com', password: 'secret1' } });
  assert.strictEqual((await call(`/requests/${state.reqId}`, { token: other.data.token })).status, 403);
  assert.strictEqual((await call(`/requests/${state.reqId}`, { token: state.admin })).status, 200);
});

test('admin moves status Pending → In Progress → Resolved with timeline', async () => {
  let r = await call(`/admin/requests/${state.reqId}/status`, { method: 'PATCH', token: state.admin, body: { status: 'In Progress', note: 'Team assigned' } });
  assert.strictEqual(r.status, 200);
  r = await call(`/admin/requests/${state.reqId}/status`, { method: 'PATCH', token: state.admin, body: { status: 'Resolved' } });
  assert.strictEqual(r.data.request.status, 'Resolved');

  r = await call(`/admin/requests/${state.reqId}/status`, { method: 'PATCH', token: state.admin, body: { status: 'Bogus' } });
  assert.strictEqual(r.status, 400);

  r = await call(`/requests/${state.reqId}`, { token: state.citizen });
  assert.deepStrictEqual(r.data.history.map((h) => h.status), ['Pending', 'In Progress', 'Resolved']);
});

test('analytics counts open vs resolved correctly; admin filters work', async () => {
  const f = new FormData(); f.append('category', 'Water Issue'); f.append('location', 'Kilimani'); f.append('description', 'No water since Monday.');
  await call('/requests', { method: 'POST', token: state.citizen, form: f });

  let r = await call('/admin/analytics', { token: state.admin });
  assert.strictEqual(r.data.total, 2);
  assert.strictEqual(r.data.open, 1);
  assert.strictEqual(r.data.resolved, 1);
  assert.strictEqual(r.data.resolutionRate, 50);

  r = await call('/admin/requests?status=Pending', { token: state.admin });
  assert.strictEqual(r.data.requests.length, 1);
  r = await call('/admin/requests?q=Kilimani', { token: state.admin });
  assert.strictEqual(r.data.requests.length, 1);
});
