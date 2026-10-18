# Huduma Desk – Public Service Request System

A mini **eCitizen-style** web app where citizens report public service problems
(broken streetlight, water issue, garbage collection…) and admins track and
resolve them.

**Stack:** Node.js · Express · SQLite (`better-sqlite3`) · JWT auth · vanilla HTML/CSS/JS (no build step)

---

## Features

| Requirement | Where it lives |
|---|---|
| Citizen registration / login | `src/routes/auth.js`, login & register views |
| Submit request (category, location, description, optional image) | `src/routes/requests.js`, "New request" view |
| Admin dashboard | `src/routes/admin.js`, "Admin dashboard" view |
| Status tracking (Pending → In Progress → Resolved) | `status_history` table, stepper + timeline on request page |
| Basic analytics (open vs resolved) | `GET /api/admin/analytics`, donut + category bars |

Extras: reference numbers (`SR-2026-000001`), search and filters, password hashing,
role-based access control, input validation, image type/size checks, XSS-safe rendering,
responsive layout, automated API tests.

## Quick start

Requires **Node.js 18+** ([download](https://nodejs.org)).

```bash
npm install
npm start
```

Open **http://localhost:3000**

Optional – load demo data so the dashboard has something to show:

```bash
npm run seed
```

### Demo accounts

| Role | Email | Password |
|---|---|---|
| Admin | `admin@example.com` | `Admin@123` |
| Citizen (after `npm run seed`) | `amina@example.com` | `Password1` |

The admin account is created automatically on first run. Citizens register themselves.

### Run the tests

```bash
npm test
```

## Project structure

```
├── server.js              # App entry: middleware, routes, static files
├── src/
│   ├── config.js          # Port, secrets, categories, statuses
│   ├── db.js              # SQLite connection, schema, default admin
│   ├── middleware.js      # requireAuth / requireAdmin
│   ├── seed.js            # Optional demo data
│   └── routes/
│       ├── auth.js        # register, login, me
│       ├── requests.js    # citizen: submit, list, detail
│       └── admin.js       # admin: list/filter, update status, analytics
├── public/                # Frontend (served statically)
│   ├── index.html
│   ├── css/styles.css
│   └── js/app.js          # Hash router + all views
├── tests/api.test.js      # End-to-end API tests
├── uploads/               # Uploaded images (git-ignored)
└── data/                  # SQLite database file (git-ignored)
```

## Database

```
users           id, name, email (unique), phone, password_hash, role (citizen|admin), created_at
requests        id, ref_code, user_id → users, category, location, description,
                image_path, status, created_at, updated_at
status_history  id, request_id → requests, status, note, changed_by → users, changed_at
```

## API reference

All routes are prefixed with `/api`. Protected routes need `Authorization: Bearer <token>`.

| Method | Route | Access | Purpose |
|---|---|---|---|
| POST | `/auth/register` | public | Create citizen account |
| POST | `/auth/login` | public | Log in, returns token |
| GET | `/auth/me` | logged in | Current user |
| GET | `/requests/meta/options` | public | Categories and statuses |
| POST | `/requests` | citizen | Submit request (`multipart/form-data`: category, location, description, image?) |
| GET | `/requests` | citizen | Own requests |
| GET | `/requests/:id` | owner / admin | Request + status timeline |
| GET | `/admin/requests?status=&category=&q=` | admin | All requests, filterable |
| PATCH | `/admin/requests/:id/status` | admin | Body `{ status, note? }` |
| GET | `/admin/analytics` | admin | Totals, open vs resolved, per-category counts |

## Configuration

Set environment variables if needed (all optional for local use):

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `3000` | |
| `JWT_SECRET` | dev value | **Change in production** |
| `DB_PATH` | `data/app.db` | |

Example: `PORT=8080 JWT_SECRET=my-long-random-string npm start`

## Security notes

- Passwords are hashed with bcrypt; they are never stored or returned in plain text.
- Role checks happen on the server for every protected route, not just in the UI.
- Users can only open their own requests; admins can open all.
- Uploads are restricted to images ≤ 3 MB and stored under random file names.
- All user text is escaped before being rendered, to prevent XSS.

## Possible improvements

Email/SMS notifications, map-based location picker, request comments, pagination,
CSV export, rate limiting, and deployment behind HTTPS.
