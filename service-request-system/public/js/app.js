/* Huduma Desk – single-page frontend (vanilla JS, no build step).
 *
 * Sections:
 *  1. Helpers        – api(), esc(), formatting, toasts, modal
 *  2. State & router – hash-based routing, role guards
 *  3. Views          – login, register, citizen dashboard, new request,
 *                      request detail, admin dashboard
 */

/* ============================== 1. HELPERS ============================== */
const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');

const CATEGORY_ICONS = {
  'Streetlight': '💡', 'Water Issue': '🚰', 'Garbage Collection': '🗑️',
  'Road Damage': '🛣️', 'Drainage/Sewage': '🌊', 'Other': '📌',
};
const STATUS_CLASS = { 'Pending': 'badge-pending', 'In Progress': 'badge-progress', 'Resolved': 'badge-resolved' };
const STATUS_FLOW = ['Pending', 'In Progress', 'Resolved'];

// Escape any user-supplied text before putting it into HTML (prevents XSS).
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// SQLite stores UTC as "YYYY-MM-DD HH:MM:SS" – convert to a friendly local string.
function fmtDate(s, withTime = false) {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T') + 'Z');
  const opts = withTime
    ? { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'short', year: 'numeric' };
  return d.toLocaleString('en-KE', opts);
}

const badge = (status) => `<span class="badge ${STATUS_CLASS[status]}">${esc(status)}</span>`;

// Thin wrapper around fetch that adds the token and throws readable errors.
async function api(path, { method = 'GET', body, form } = {}) {
  const headers = {};
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  let payload;
  if (form) payload = form; // FormData (file upload) – browser sets content-type
  else if (body) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }

  const res = await fetch('/api' + path, { method, headers, body: payload });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && session.token) { logout(true); throw new Error(data.error || 'Session expired.'); }
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

function toast(message, type = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function openModal(html) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="overlay" data-close><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
  root.querySelector('.overlay').addEventListener('mousedown', (e) => { if (e.target.hasAttribute('data-close')) closeModal(); });
  document.addEventListener('keydown', escClose);
  return root.querySelector('.modal');
}
function closeModal() { $('#modal-root').innerHTML = ''; document.removeEventListener('keydown', escClose); }
function escClose(e) { if (e.key === 'Escape') closeModal(); }

const loading = () => (app.innerHTML = '<div class="spinner" aria-label="Loading"></div>');

/* ========================== 2. STATE & ROUTER =========================== */
const session = {
  token: localStorage.getItem('token'),
  user: JSON.parse(localStorage.getItem('user') || 'null'),
};
let options = { categories: [], statuses: [] };

function saveSession(token, user) {
  session.token = token; session.user = user;
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
}
function logout(expired = false) {
  session.token = null; session.user = null;
  localStorage.removeItem('token'); localStorage.removeItem('user');
  location.hash = '#/login';
  if (expired) toast('Your session expired. Please log in again.', 'err');
}
const home = () => (session.user?.role === 'admin' ? '#/admin' : '#/dashboard');

function renderTopbar(route) {
  const u = session.user;
  const link = (href, label) => `<a href="${href}" class="${route.startsWith(href.slice(1)) ? 'active' : ''}">${label}</a>`;
  $('#topbar').innerHTML = `
    <div class="topbar-inner">
      <a class="brand" href="${u ? home() : '#/login'}">
        <span class="brand-mark"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg></span>
        Huduma Desk
      </a>
      <nav class="nav">
        ${!u ? link('#/login', 'Log in') + link('#/register', 'Register') : ''}
        ${u && u.role === 'citizen' ? link('#/dashboard', 'My requests') + link('#/new', 'New request') : ''}
        ${u && u.role === 'admin' ? link('#/admin', 'Admin dashboard') : ''}
        ${u ? `<span class="user-chip">${esc(u.name)}${u.role === 'admin' ? ' · Admin' : ''}</span><button class="link" id="logout">Log out</button>` : ''}
      </nav>
    </div>`;
  $('#logout')?.addEventListener('click', () => logout());
}

const routes = [
  { path: /^\/login$/, view: viewLogin, guest: true },
  { path: /^\/register$/, view: viewRegister, guest: true },
  { path: /^\/dashboard$/, view: viewCitizenDashboard, role: 'citizen' },
  { path: /^\/new$/, view: viewNewRequest, role: 'citizen' },
  { path: /^\/request\/(\d+)$/, view: viewRequestDetail, role: 'any' },
  { path: /^\/admin$/, view: viewAdmin, role: 'admin' },
];

async function router() {
  closeModal();
  const path = location.hash.slice(1) || '/login';
  renderTopbar(path);
  window.scrollTo(0, 0);

  const match = routes.map((r) => ({ r, m: path.match(r.path) })).find((x) => x.m);
  if (!match) { location.hash = session.user ? home() : '#/login'; return; }

  const { r, m } = match;
  if (r.guest && session.user) { location.hash = home(); return; }
  if (!r.guest && !session.user) { location.hash = '#/login'; return; }
  if (r.role && r.role !== 'any' && session.user?.role !== r.role) { location.hash = home(); return; }

  if (!options.categories.length) {
    try { options = await api('/requests/meta/options'); } catch { /* ignore, retry next route */ }
  }
  loading();
  try { await r.view(...m.slice(1)); }
  catch (err) { app.innerHTML = `<div class="card empty"><div class="big">⚠️</div><h2>Something went wrong</h2><p class="muted">${esc(err.message)}</p><a class="btn btn-ghost" href="${home()}">Go back</a></div>`; }
}
window.addEventListener('hashchange', router);

/* ================================ 3. VIEWS ============================== */

/* ---------- Login ---------- */
function authHero() {
  return `
    <section class="hero">
      <h1>Report it. Track it. See it fixed.</h1>
      <p class="lead">Huduma Desk lets residents report public service problems straight to the county and follow progress in real time.</p>
      <ul>
        <li><span class="tick">✓</span><div><strong>Report in under a minute</strong><br><span class="muted">Pick a category, add the location and an optional photo.</span></div></li>
        <li><span class="tick">✓</span><div><strong>Know where your request stands</strong><br><span class="muted">Pending → In Progress → Resolved, with a full timeline.</span></div></li>
        <li><span class="tick">✓</span><div><strong>Accountable service</strong><br><span class="muted">Admins see open vs resolved cases at a glance.</span></div></li>
      </ul>
    </section>`;
}

async function viewLogin() {
  app.innerHTML = `
    <div class="auth-wrap">
      ${authHero()}
      <div class="card auth-card">
        <h2>Welcome back</h2>
        <p class="muted">Log in to submit and track your requests.</p>
        <div id="err"></div>
        <form id="f" novalidate>
          <div class="field"><label for="email">Email</label><input id="email" type="email" autocomplete="email" required placeholder="you@example.com"></div>
          <div class="field"><label for="password">Password</label><input id="password" type="password" autocomplete="current-password" required></div>
          <button class="btn btn-primary btn-block" id="go">Log in</button>
        </form>
        <p class="small muted" style="margin:1rem 0 0">New here? <a href="#/register">Create a citizen account</a></p>
        <p class="small muted" style="margin:.4rem 0 0">Demo admin: <code>admin@example.com</code> / <code>Admin@123</code></p>
      </div>
    </div>`;

  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#go'); btn.disabled = true; btn.textContent = 'Logging in…';
    try {
      const { token, user } = await api('/auth/login', { method: 'POST', body: { email: $('#email').value, password: $('#password').value } });
      saveSession(token, user);
      location.hash = home();
    } catch (err) {
      $('#err').innerHTML = `<div class="form-error">${esc(err.message)}</div>`;
      btn.disabled = false; btn.textContent = 'Log in';
    }
  });
}

/* ---------- Register ---------- */
async function viewRegister() {
  app.innerHTML = `
    <div class="auth-wrap">
      ${authHero()}
      <div class="card auth-card">
        <h2>Create your account</h2>
        <p class="muted">Free, and takes less than a minute.</p>
        <div id="err"></div>
        <form id="f" novalidate>
          <div class="field"><label for="name">Full name</label><input id="name" type="text" autocomplete="name" required></div>
          <div class="field"><label for="email">Email</label><input id="email" type="email" autocomplete="email" required></div>
          <div class="field"><label for="phone">Phone <span class="opt">(optional)</span></label><input id="phone" type="tel" autocomplete="tel" placeholder="07XX XXX XXX"></div>
          <div class="field"><label for="password">Password</label><input id="password" type="password" autocomplete="new-password" required><div class="hint">At least 6 characters.</div></div>
          <button class="btn btn-primary btn-block" id="go">Create account</button>
        </form>
        <p class="small muted" style="margin:1rem 0 0">Already registered? <a href="#/login">Log in</a></p>
      </div>
    </div>`;

  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#go'); btn.disabled = true; btn.textContent = 'Creating…';
    try {
      const { token, user } = await api('/auth/register', {
        method: 'POST',
        body: { name: $('#name').value, email: $('#email').value, phone: $('#phone').value, password: $('#password').value },
      });
      saveSession(token, user);
      toast('Account created. Welcome!');
      location.hash = home();
    } catch (err) {
      $('#err').innerHTML = `<div class="form-error">${esc(err.message)}</div>`;
      btn.disabled = false; btn.textContent = 'Create account';
    }
  });
}

/* ---------- Citizen dashboard ---------- */
async function viewCitizenDashboard() {
  const { requests } = await api('/requests');
  const count = (s) => requests.filter((r) => r.status === s).length;

  app.innerHTML = `
    <div class="page-head">
      <div><h1>Hello, ${esc(session.user.name.split(' ')[0])} 👋</h1><p class="muted">Here are the requests you've submitted.</p></div>
      <a class="btn btn-primary" href="#/new">+ New request</a>
    </div>
    <div class="grid grid-4" style="margin-bottom:1.5rem">
      <div class="card stat"><div class="num">${requests.length}</div><div class="lbl">Total submitted</div></div>
      <div class="card stat s-open"><div class="num">${count('Pending')}</div><div class="lbl">Pending</div></div>
      <div class="card stat s-prog"><div class="num">${count('In Progress')}</div><div class="lbl">In progress</div></div>
      <div class="card stat s-res"><div class="num">${count('Resolved')}</div><div class="lbl">Resolved</div></div>
    </div>
    ${requests.length ? `<div class="req-list">${requests.map(reqCard).join('')}</div>` : `
      <div class="card empty"><div class="big">📭</div><h2>No requests yet</h2>
      <p class="muted">Spotted a broken streetlight or a water problem? Let us know.</p>
      <a class="btn btn-primary" href="#/new">Submit your first request</a></div>`}`;
}

function reqCard(r) {
  return `
    <a class="card req" href="#/request/${r.id}">
      <div class="req-icon">${CATEGORY_ICONS[r.category] || '📌'}</div>
      <div class="req-main">
        <div class="req-title">${esc(r.category)} ${badge(r.status)}</div>
        <div class="req-meta">📍 ${esc(r.location)} · <span class="ref">${esc(r.ref_code)}</span> · ${fmtDate(r.created_at)}</div>
      </div>
      <span class="muted" aria-hidden="true">›</span>
    </a>`;
}

/* ---------- Submit a new request ---------- */
async function viewNewRequest() {
  app.innerHTML = `
    <div style="max-width:680px;margin:0 auto">
      <div class="page-head"><div><h1>Submit a service request</h1><p class="muted">Tell us what's wrong and where. We'll route it to the right team.</p></div></div>
      <div class="card" id="box">
        <div id="err"></div>
        <form id="f" novalidate>
          <div class="field"><label for="category">Category</label>
            <select id="category" required><option value="">Select a category…</option>
              ${options.categories.map((c) => `<option value="${esc(c)}">${CATEGORY_ICONS[c] || ''} ${esc(c)}</option>`).join('')}
            </select></div>
          <div class="field"><label for="location">Location</label>
            <input id="location" type="text" required placeholder="e.g. Moi Avenue, near the bus stage">
            <div class="hint">Be specific: street, estate, landmark.</div></div>
          <div class="field"><label for="description">Description</label>
            <textarea id="description" required maxlength="1000" placeholder="Describe the problem and how long it has been happening…"></textarea>
            <div class="hint"><span id="count">0</span>/1000</div></div>
          <div class="field"><label>Photo <span class="opt">(optional)</span></label>
            <label class="dropzone" for="image">📷 Click to choose an image<br><span class="small">JPG, PNG, WEBP or GIF · max 3 MB</span>
              <input id="image" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></label>
            <div class="preview" id="preview"><img alt="Selected photo preview"><button type="button" id="rm" aria-label="Remove photo">✕</button></div></div>
          <button class="btn btn-primary btn-block" id="go">Submit request</button>
        </form>
      </div>
    </div>`;

  const input = $('#image'), preview = $('#preview');
  $('#description').addEventListener('input', (e) => ($('#count').textContent = e.target.value.length));
  input.addEventListener('change', () => {
    const f = input.files[0];
    if (!f) return;
    if (f.size > 3 * 1024 * 1024) { toast('Image must be 3 MB or smaller.', 'err'); input.value = ''; return; }
    $('img', preview).src = URL.createObjectURL(f);
    preview.style.display = 'block';
  });
  $('#rm').addEventListener('click', () => { input.value = ''; preview.style.display = 'none'; });

  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#go'); btn.disabled = true; btn.textContent = 'Submitting…';
    const form = new FormData();
    form.append('category', $('#category').value);
    form.append('location', $('#location').value);
    form.append('description', $('#description').value);
    if (input.files[0]) form.append('image', input.files[0]);
    try {
      const { request } = await api('/requests', { method: 'POST', form });
      $('#box').innerHTML = `
        <div class="success-box"><div class="check">✓</div>
          <h2>Request submitted</h2><p class="muted">Keep this reference number to follow up.</p>
          <div class="ref-pill">${esc(request.ref_code)}</div><br>
          <a class="btn btn-primary" href="#/request/${request.id}">Track this request</a>
          <a class="btn btn-ghost" href="#/new">Submit another</a></div>`;
    } catch (err) {
      $('#err').innerHTML = `<div class="form-error">${esc(err.message)}</div>`;
      btn.disabled = false; btn.textContent = 'Submit request';
    }
  });
}

/* ---------- Request detail (citizen + admin) ---------- */
async function viewRequestDetail(id) {
  const { request: r, history } = await api(`/requests/${id}`);
  const isAdmin = session.user.role === 'admin';
  const stepIdx = STATUS_FLOW.indexOf(r.status);

  app.innerHTML = `
    <p><a href="${home()}">‹ Back</a></p>
    <div class="page-head">
      <div><h1>${CATEGORY_ICONS[r.category] || ''} ${esc(r.category)}</h1>
        <p class="muted"><span class="ref">${esc(r.ref_code)}</span> · submitted ${fmtDate(r.created_at, true)}</p></div>
      ${badge(r.status)}
    </div>
    <div class="detail-grid">
      <div class="card">
        <div class="stepper">${STATUS_FLOW.map((s, i) => `<div class="step ${i <= stepIdx ? 'done' : ''}"><div class="dot">${i < stepIdx || r.status === 'Resolved' ? '✓' : i + 1}</div>${s}</div>`).join('')}</div>
        <dl class="kv">
          <dt>Location</dt><dd>${esc(r.location)}</dd>
          <dt>Description</dt><dd style="white-space:pre-wrap">${esc(r.description)}</dd>
          ${isAdmin ? `<dt>Citizen</dt><dd>${esc(r.citizen_name)} · ${esc(r.citizen_email)}${r.citizen_phone ? ' · ' + esc(r.citizen_phone) : ''}</dd>` : ''}
          <dt>Last update</dt><dd>${fmtDate(r.updated_at, true)}</dd>
        </dl>
        ${r.image_path ? `<img class="photo" src="/uploads/${encodeURIComponent(r.image_path)}" alt="Photo attached to the request">` : ''}
      </div>
      <div class="card">
        <h3>Status timeline</h3>
        <ul class="timeline">
          ${history.slice().reverse().map((h) => `
            <li data-s="${esc(h.status)}"><strong>${esc(h.status)}</strong> <span class="muted small">· ${fmtDate(h.changed_at, true)}</span>
              ${h.note ? `<div class="t-note">${esc(h.note)}</div>` : ''}</li>`).join('')}
        </ul>
        ${isAdmin ? `<button class="btn btn-primary btn-block" id="upd">Update status</button>` : ''}
      </div>
    </div>`;

  $('#upd')?.addEventListener('click', () => statusModal(r, () => viewRequestDetail(id)));
}

/* Modal used by admins to move a request through Pending → In Progress → Resolved */
function statusModal(r, onDone) {
  const m = openModal(`
    <div class="modal-head"><div><h2>Update status</h2><p class="muted small" style="margin:0">${esc(r.ref_code)} · ${esc(r.category)}</p></div><button class="x" id="x" aria-label="Close">✕</button></div>
    <div id="err"></div>
    <form id="sf">
      <div class="field"><label for="st">New status</label>
        <select id="st">${STATUS_FLOW.map((s) => `<option ${s === r.status ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <div class="field"><label for="note">Note to citizen <span class="opt">(optional)</span></label>
        <textarea id="note" style="min-height:80px" placeholder="e.g. Technician assigned, expected fix by Friday"></textarea></div>
      <button class="btn btn-primary btn-block" id="save">Save update</button>
    </form>`);
  $('#x', m).addEventListener('click', closeModal);
  $('#sf', m).addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#save', m); btn.disabled = true; btn.textContent = 'Saving…';
    try {
      await api(`/admin/requests/${r.id}/status`, { method: 'PATCH', body: { status: $('#st', m).value, note: $('#note', m).value } });
      closeModal(); toast('Status updated.'); onDone();
    } catch (err) {
      $('#err', m).innerHTML = `<div class="form-error">${esc(err.message)}</div>`;
      btn.disabled = false; btn.textContent = 'Save update';
    }
  });
}

/* ---------- Admin dashboard ---------- */
async function viewAdmin() {
  const stats = await api('/admin/analytics');

  app.innerHTML = `
    <div class="page-head"><div><h1>Admin dashboard</h1><p class="muted">Overview of all citizen service requests.</p></div></div>

    <div class="grid grid-4" style="margin-bottom:1rem">
      <div class="card stat"><div class="num">${stats.total}</div><div class="lbl">Total requests</div></div>
      <div class="card stat s-open"><div class="num">${stats.open}</div><div class="lbl">Open cases</div></div>
      <div class="card stat s-res"><div class="num">${stats.resolved}</div><div class="lbl">Resolved cases</div></div>
      <div class="card stat s-prog"><div class="num">${stats.avgResolutionHours ?? '–'}${stats.avgResolutionHours !== null ? '<span style="font-size:1rem"> h</span>' : ''}</div><div class="lbl">Avg. time to resolve</div></div>
    </div>

    <div class="grid grid-2" style="margin-bottom:1.5rem">
      <div class="card">
        <h3>Open vs resolved</h3>
        ${analyticsDonut(stats)}
      </div>
      <div class="card">
        <h3>Requests by category</h3>
        ${stats.byCategory.length ? `<div class="bars">${stats.byCategory.map((c) => {
          const t = c.open + c.resolved;
          return `<div class="bar-row"><div class="bar-top"><span>${CATEGORY_ICONS[c.category] || ''} ${esc(c.category)}</span><span class="muted">${c.open} open · ${c.resolved} resolved</span></div>
            <div class="bar-track" title="${t} total"><div class="bar-open" style="width:${(c.open / t) * 100}%"></div><div class="bar-res" style="width:${(c.resolved / t) * 100}%"></div></div></div>`;
        }).join('')}</div>` : '<p class="muted">No data yet.</p>'}
      </div>
    </div>

    <div class="card">
      <h2>All requests</h2>
      <div class="toolbar">
        <input type="search" id="q" placeholder="Search reference, location, citizen…" aria-label="Search requests">
        <select id="fs" aria-label="Filter by status"><option value="">All statuses</option>${STATUS_FLOW.map((s) => `<option>${s}</option>`).join('')}</select>
        <select id="fc" aria-label="Filter by category"><option value="">All categories</option>${options.categories.map((c) => `<option>${esc(c)}</option>`).join('')}</select>
      </div>
      <div class="table-wrap" id="tbl"></div>
    </div>`;

  let timer;
  const reload = async () => {
    const qs = new URLSearchParams({ status: $('#fs').value, category: $('#fc').value, q: $('#q').value });
    const { requests } = await api('/admin/requests?' + qs);
    $('#tbl').innerHTML = requests.length ? `
      <table>
        <thead><tr><th>Ref</th><th>Category</th><th>Location</th><th>Citizen</th><th>Submitted</th><th>Status</th><th></th></tr></thead>
        <tbody>${requests.map((r) => `
          <tr data-id="${r.id}">
            <td class="ref">${esc(r.ref_code)}</td>
            <td>${CATEGORY_ICONS[r.category] || ''} ${esc(r.category)}</td>
            <td class="loc" title="${esc(r.location)}">${esc(r.location)}</td>
            <td>${esc(r.citizen_name)}</td>
            <td>${fmtDate(r.created_at)}</td>
            <td>${badge(r.status)}</td>
            <td><button class="btn btn-ghost btn-sm" data-upd="${r.id}">Update</button></td>
          </tr>`).join('')}</tbody>
      </table>` : '<div class="empty"><div class="big">🔍</div><p class="muted">No requests match your filters.</p></div>';

    $('#tbl').querySelectorAll('tr[data-id]').forEach((tr) => {
      const r = requests.find((x) => x.id == tr.dataset.id);
      tr.addEventListener('click', (e) => {
        if (e.target.closest('[data-upd]')) statusModal(r, () => viewAdmin());
        else location.hash = `#/request/${r.id}`;
      });
    });
  };
  $('#fs').addEventListener('change', reload);
  $('#fc').addEventListener('change', reload);
  $('#q').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(reload, 250); });
  await reload();
}

function analyticsDonut(s) {
  if (!s.total) return '<p class="muted">No requests yet.</p>';
  const pPct = (s.pending / s.total) * 100;
  const iPct = (s.inProgress / s.total) * 100;
  const grad = `conic-gradient(var(--amber-500) 0 ${pPct}%, var(--blue-600) ${pPct}% ${pPct + iPct}%, var(--green-600) ${pPct + iPct}% 100%)`;
  return `
    <div class="donut-wrap">
      <div class="donut" style="background:${grad}" data-center="${s.resolutionRate}%" role="img" aria-label="${s.resolutionRate}% of requests resolved"></div>
      <ul class="legend">
        <li><i style="background:var(--amber-500)"></i>Pending · <strong>${s.pending}</strong></li>
        <li><i style="background:var(--blue-600)"></i>In progress · <strong>${s.inProgress}</strong></li>
        <li><i style="background:var(--green-600)"></i>Resolved · <strong>${s.resolved}</strong></li>
        <li class="muted small">Resolution rate: ${s.resolutionRate}%</li>
      </ul>
    </div>`;
}

/* ================================ BOOT ================================== */
router();
