// Optional: fills the database with demo citizens and requests so the
// admin dashboard and analytics look alive. Run with:  npm run seed
const bcrypt = require('bcryptjs');
const db = require('./db');

const citizens = [
  ['Amina Wanjiru', 'amina@example.com', '0712345678'],
  ['Brian Otieno', 'brian@example.com', '0723456789'],
  ['Cynthia Mwangi', 'cynthia@example.com', '0734567890'],
];

const samples = [
  ['Streetlight', 'Moi Avenue, near Total Petrol Station', 'Streetlight has been off for over a week, the road is very dark at night.', 'Resolved'],
  ['Water Issue', 'Kilimani, Argwings Kodhek Rd', 'No water supply in our block since Monday morning.', 'In Progress'],
  ['Garbage Collection', 'Githurai 45 market entrance', 'Garbage has not been collected in two weeks and is overflowing onto the road.', 'Pending'],
  ['Road Damage', 'Thika Road, opposite Garden City', 'Large pothole causing traffic and damaging vehicles.', 'In Progress'],
  ['Drainage/Sewage', 'South B, Plainsview Estate', 'Sewage is leaking onto the footpath near the school gate.', 'Pending'],
  ['Streetlight', 'Ngong Road, Prestige Plaza stage', 'Two streetlights flickering and unsafe at night.', 'Resolved'],
  ['Garbage Collection', 'Kibera, Olympic Estate', 'Illegal dumping site growing near the water point.', 'Pending'],
  ['Water Issue', 'Langata, Karen Road', 'Burst water pipe flooding the roadside.', 'Resolved'],
];

const insertUser = db.prepare("INSERT OR IGNORE INTO users (name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, 'citizen')");
citizens.forEach(([n, e, p]) => insertUser.run(n, e, p, bcrypt.hashSync('Password1', 10)));

const admin = db.prepare("SELECT id FROM users WHERE role = 'admin'").get();
const users = citizens.map(([, e]) => db.prepare('SELECT id FROM users WHERE email = ?').get(e).id);

const insReq = db.prepare('INSERT INTO requests (ref_code, user_id, category, location, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
const insHist = db.prepare('INSERT INTO status_history (request_id, status, note, changed_by, changed_at) VALUES (?, ?, ?, ?, ?)');

db.transaction(() => {
  samples.forEach(([cat, loc, desc, status], i) => {
    const created = `2026-10-${String(1 + i).padStart(2, '0')} 09:${10 + i}:00`;
    const updated = status === 'Pending' ? created : `2026-10-${String(3 + i).padStart(2, '0')} 15:00:00`;
    const tmp = 'TMP-' + i + Date.now();
    const id = insReq.run(tmp, users[i % users.length], cat, loc, desc, status, created, updated).lastInsertRowid;
    db.prepare('UPDATE requests SET ref_code = ? WHERE id = ?').run(`SR-2026-${String(id).padStart(6, '0')}`, id);
    insHist.run(id, 'Pending', 'Request submitted', users[i % users.length], created);
    if (status !== 'Pending') insHist.run(id, 'In Progress', 'Assigned to field team', admin.id, updated);
    if (status === 'Resolved') insHist.run(id, 'Resolved', 'Issue fixed and verified', admin.id, updated);
  });
})();

console.log('Seeded demo data. Citizen logins: amina@example.com / Password1 (also brian@, cynthia@)');
