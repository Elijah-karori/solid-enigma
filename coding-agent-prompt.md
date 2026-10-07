# Task: finish the ONT Network Inventory Portal (Go + PostgreSQL + React)

You are taking over a half-built application. Build it out until every feature below works end to end, in the real
database, behind real authentication, with tests. Read this whole brief before writing code.

## 0. What this is

A web portal for an ISP/fibre operator, replacing a Google Apps Script + Google Sheets system. It manages stock
(bulk, non-serialized and serialized ONT/router/FAT-box units), projects, requisitions, purchasing with Finance
approval, technician tasks, customer tickets, customers and hotspots, the fibre network (OLT -> PON port ->
splitter -> port -> customer/hotspot), delivery/receipt notes, costs, audit, and email notifications.

Roles: **Admin, Store Manager, Finance, Project Manager, Support, Technician.**

## 1. Inputs you have

| Path | What it is |
|---|---|
| `solid-enigma-migrated/` (zip) | Go 1.22+/Echo v4 backend, React + TypeScript + Vite + Tailwind frontend. Already has JWT login with jti + rotating refresh cookie, emailed-OTP (2FA), forgot/reset password, RBAC middleware, SMTP sender, hash-chained audit package, user admin screen. **Its Go models still target an older GORM schema and must be realigned (section 3).** |
| `migrations/00001..00010_*.sql` | **The authoritative database schema** (goose, PostgreSQL 16). 00001-00006 define identity/RBAC/workflow tables, catalog, serialized units, network topology, customers/hotspots/installations, ledger and audit. 00007-00010 add id generators, settings, reporting views, business-rule triggers and operation functions, DB-side audit, and a notification outbox. All apply cleanly; `tests/smoke.sql` passes. |
| `tools/extract_workbook.py`, `tools/load_bundle.py` | Extract the legacy workbook to JSON and load it (verified on the real workbook). |
| `Code.gs`, `improves.html` | The legacy backend and UI. **They are the behavioural specification.** When this brief is silent, do what they do. |
| `serialized_ONT_inventory_register.xlsx` | The legacy data, already loadable with the loader. |

## 2. Non-negotiable rules

1. **The database is the source of truth for business rules.** Do not re-implement stock math, approval routing,
   self-approval bans, port occupancy, or audit hashing in Go. Call the SQL functions/views and let triggers enforce.
   Translate their exceptions into clean 4xx JSON errors (`check_violation` -> 422, `insufficient_privilege` -> 403,
   unique violation -> 409, with the trigger's message shown to the user).
2. **Every request that writes runs in one transaction that first executes**
   `SELECT set_config('app.actor_email', $1, true), set_config('app.actor_role', $2, true)`
   with the *authenticated* user (never client input). Imports additionally set `app.import_mode = 'on'`.
3. **Authorization is server-side.** Every route is guarded by `rbac.Require(...)` using the permission codes in the
   `role_permissions` table (keep the Go map and the table identical; add `approveProjectReq` to Go). The frontend uses
   the permission flags from `GET /api/auth/me` only to hide UI.
4. **Never log or commit secrets.** No passwords, SMTP credentials, tokens or OTP codes in code, logs, fixtures or
   docs. Config comes from environment variables (`.env.example` lists them). The previous SMTP app password was pasted
   into a chat: tell the owner to revoke and reissue it; never use it.
5. **No default credentials.** The first admin is created from `BOOTSTRAP_ADMIN_EMAIL` and sets a password through the
   emailed-code flow. Imported users have no password and `must_reset_password = true`.
6. **Stock never goes negative; the ledger and audit trail are append-only.** Never UPDATE/DELETE them. Corrections are
   new rows.
7. **Financial fields are role-gated** (`viewCosts`: Admin, Finance): unit cost, stock value, project spend/budget
   (also visible to that project's manager), procurement totals, note values. Strip them in the API response, not only
   in the UI.
8. Keep changes small and committed per feature, with the tests that prove them.

## 3. Step one: realign the Go backend to the SQL schema

The goose migrations replace GORM `AutoMigrate`. Remove AutoMigrate and the SQLite fallback (or keep SQLite only for
unit tests that do not touch business rules; prefer Postgres via testcontainers or a local service).

* Use **pgx v5** (pool) and either **sqlc** or hand-written queries. Do not let an ORM pluralize table names or invent
  columns. If you keep GORM for simple reads, give every model an explicit `TableName()` and column tags.
* Add a small `db.WithActor(ctx, user, func(tx pgx.Tx) error)` helper implementing rule 2 and use it for **every** write
  handler; reads that depend on the caller (`pending_actions`, scoped lists) also use it.
* Add `golang-migrate`/**goose** startup or a `cmd/migrate` command (`goose -dir migrations postgres "$DATABASE_URL" up`).
* Replace the Go importer (`cmd/import`) with the Python loader or a Go port of it; the old one targets the old schema.
* Keep `internal/audit` hash format identical to SQL `audit_hash()` (already aligned and cross-checked). Prefer calling
  `audit_append(...)` from Go for auth events so there is one implementation; `GET /api/audit/verify` calls `audit_verify()`.
* Fix the known security gaps: validate all input with explicit structs (no binding into models = no mass assignment),
  rate-limit auth routes, set strict CORS origins, `COOKIE_SECURE=true` in production, request size limits.

## 4. Features to build (backend API + frontend screen + tests for each)

Legend: **DB** = already exists in the migrations (call it); **NEW** = you build it.

### 4.1 Auth & users  (mostly done: verify, then extend)
* Login -> emailed 6-digit code -> access JWT (15 min, `jti`, `sid`) + httpOnly rotating refresh cookie; forgot/reset
  password; change password; logout revokes the server session; user deactivation/role change ends sessions.
* Admin user management (create, edit role/status/site, sign-out-everywhere). Passwords are never set by admins.
* Tests: lockout after 5 failures, OTP attempt limit and single use, refresh-token reuse kills the session, role change
  takes effect on the next request.

### 4.2 Dashboard
* "Waiting on you" from `pending_actions(user)` (DB); each item deep-links to its tab.
* Cost cards and tables (`v_cost_summary`, `v_cost_by_type`, `v_cost_by_task`) for `viewCosts` only.
* Project budget vs spend (`v_project_cost`), stock summary table with search (`v_stock_summary`).
* Network insights for support roles: `v_splitter_fault_clusters`, `v_repeat_failure_devices`, `v_model_fault_rate`.

### 4.3 Item catalog  (NEW screen + API)
* Create/edit with item type (BULK, NONSER, ONT, RTR, NET, FAT), SKU auto-generation (`SKU-ONT-<MODEL>`; serialized types
  force the matching prefix), reorder level, project scope ("shared" or one project), description. Unit cost editable by
  `viewCosts` roles only. Serialized SKUs cannot be changed to non-serialized.

### 4.4 Stock movements
* **Record Movement** (NEW screen): Stock In/Out for bulk items and for individual serialized units via
  `record_movement(...)`; cost type, task/ticket reference, site, project (required for project-only items). Out lists only
  In-Stock units; In lists units that are not In Stock (returns). Show the DB's error messages.
* **Serialized Stock In** (NEW screen): pick a model, enter or scan many S/N + MAC rows (Enter moves S/N -> MAC -> next
  row; paste-list; scan-in-sequence) -> `receive_serialized_batch(...)`. Reject duplicates inside the list and against
  the database with the row number. MAC accepts any separator, stored as 12 upper-case hex.
* **Serialized Units** (extend): list with filters (all / in stock / not in stock / missing S/N or MAC), edit unit, add
  note, **life-cycle history** from `v_unit_history`.
* **Barcode/QR lookup** (NEW): `GET /api/lookup?code=` matches asset id, S/N, MAC, product id or SKU/model (strip
  non-alphanumerics, case-insensitive) and returns unit or item; customer/ticket info only for roles that may see it.
  Frontend scanner modal: camera (`html5-qrcode`, with the browser `BarcodeDetector` when available), photo upload, and
  typed/USB-scanner entry. Scanner results feed the stock-in rows, movement form, requisition issue picker and unit edit.

### 4.4b Projects
* Create/edit (manager must be Project Manager/Admin; a PM edits only their own), budget, dates, status. "Materials"
  view per project (`v_project_items`); spend from `v_project_cost`.

### 4.5 Requisitions  (extend)
* Request material (project-aware; project-only items appear only for their project; PM only for projects they manage).
* Two-stage approval entirely through status updates: operations stage by Store Manager/Admin/the project's manager,
  then Finance when the DB routes it (`finance_needed`). The DB decides Ready vs Awaiting Stock. Rejection requires a reason.
  Withdraw by requester only.
* **Issue** (NEW): bulk -> confirm quantity; serialized -> pick exactly N In-Stock units of that SKU with scanner support
  -> `issue_requisition(req, assets[])`.
* "Raise purchase" for Awaiting-Stock requisitions -> `raise_procurement_from_requisition`.

### 4.6 Procurement  (NEW workflow screens)
* Request -> Finance approve/reject (not own) -> Mark ordered (supplier required, PO optional) -> Receive
  (`receive_procurement`; serialized items get placeholder units "Awaiting S/N & MAC" that appear in the pending list) ->
  receipt note. Cancel by requester while pending.

### 4.7 Tasks and tickets
* Tasks (NEW screen): assign (stock needed + qty; Awaiting Stock auto), start/complete/cancel with notes, ticket status
  propagation (DB triggers). Technicians see only their own tasks.
* Tickets (extend): log with customer/hotspot/device pickers, optional linked task (`create_ticket`), assign
  (`assign_ticket`), update/resolve (note required), close by Support+.

### 4.8 Customers, hotspots, network  (extend; the schema is richer than the current UI)
* Customers: PPPoE vs Hotspot User, account no. (defaults to id, unique), PPPoE username (unique), package, contact,
  phone/email validation, plot, location, status, install date, GenieACS device id, notes.
* Hotspots: plots, location, contact, SSID, status, ONU (fibre) + several APs (Ethernet/wireless), users list.
* Installs: `install_device` / `remove_device`; a unit can only be installed after it has been issued; ONU once; hotspot
  users have no ONU of their own. Technicians may edit install details (ONU/APs/splitter/port/GenieACS id).
* **Device replacement** (NEW): replace a faulty ONU/AP: old unit -> Under Repair/Faulty, new unit installed, ticket linked,
  all in one DB function you add (`replace_device`, writing `device_replacements`, closing/opening installations, updating
  both units, marking the ticket) with tests. Store roles may pick In-Stock units (issued automatically); technicians pick
  units already issued to them.
* Network map: OLTs, PON ports, enclosures (GPS), splitters (ratio, enclosure, uplink); port assignment with
  `assign_port`/`release_port`; tree view (OLT -> splitter -> port -> occupant, with open-ticket badges) from `v_port_map`
  and `splitter_path()`. Loop prevention and "one port, one occupant" are enforced by the DB.
* GenieACS: link-out, "check online" (read-only NBI call using stored credentials), the sync job filling
  `genieacs_devices`, and a settings screen (URL, NBI URL, online minutes). Remote actions only for `genieacsAct`
  and every action is written to `genieacs_audit_logs`.

### 4.9 Delivery and receipt notes  (NEW)
* `create_delivery_note(ref)` then render a **PDF** server-side (Go, e.g. `maroto` or `gofpdf`/`go-pdf`): company name from
  settings, number, date, recipient, project, item rows (units show asset id, S/N, MAC), total value only for `viewCosts`,
  signature lines. Store the file in object storage or Google Drive (service account, folder id from settings);
  save `file_name`/`drive_url`; optionally email it with Finance copied. Payment status tracking (`set_payment_status`)
  for Admin/Finance. Start with local-disk storage behind an interface so Drive is a drop-in.

### 4.10 Notifications  (NEW worker)
* A worker loop (separate goroutine or `cmd/worker`) runs `claim_notifications(n)`, sends through the SMTP `Sender`,
  then `mark_notification(id, ok, err)`; handles shutdown gracefully. A scheduler calls `enqueue_daily_digest()` daily at
  08:00 Africa/Nairobi and `run_low_stock_scan()` hourly.
* Admin/Finance "Email log" screen from `notification_logs`.
* OTP and password emails keep going straight through the sender and are also logged.

### 4.11 Audit & ledger screens
* Audit trail (Admin/Finance): filter by record type, search, "Verify integrity" (`audit_verify`), diff of previous/new state.
* Transaction ledger (Admin/Finance): searchable, with unit/total cost and references.

### 4.12 Settings (Admin)
* Edit the `settings` table: reorder default, notification emails and switches, finance threshold, Drive folder, company
  name, GenieACS values. Validate values; changes are audited.

## 5. Frontend requirements

* Keep React + TypeScript + Vite + Tailwind. All API calls go through `src/api.ts` (access token in memory, refresh via cookie).
* Every view is wrapped by the permission map in `App.tsx`; sidebar and mobile bottom bar show only permitted views.
* Mobile first for technician/store flows (scanner, stock in, install details). Tables scroll horizontally; forms stack.
* Show server error messages verbatim in a toast; disable submit while pending; confirm destructive actions.
* Accessibility basics: labels on inputs, focus states, keyboard-operable modals.
* Run `tsc --noEmit` and `vite build` clean; add component tests (Vitest + Testing Library) for login/OTP/reset, permission
  hiding, stock-in grid parsing, and the scanner fallback.

## 6. Data migration

* Run the extractor then the loader (`--commit`) into a fresh database. **Unit `INV-ONT-0002` has model "Not stated":
  ask the owner which SKU it is and pass `--sku-map`; do not guess for production.**
* After loading, all 11 users must reset their passwords through the emailed-code flow. No legacy password is imported.
* Re-run is refused once the ledger has rows (append-only). Provide a `make reset-dev` that recreates a dev database.

## 7. Testing and quality gates (all must pass before you say "done")

1. `goose up`, `goose down` x4 (10->7), `goose up` again, then `psql -v ON_ERROR_STOP=1 -f tests/smoke.sql` -> "ALL SMOKE CHECKS PASSED".
2. Go: `go vet ./...`, `go test ./...` with a real Postgres. Write API tests (httptest) per role for **every** route:
   allowed role succeeds, forbidden role gets 403, unauthenticated gets 401, technician cannot see another's records,
   cost fields absent for non-`viewCosts` roles.
3. One end-to-end test per workflow: requisition (incl. Finance routing and Awaiting Stock release), procurement, serialized
   stock-in and issue, ticket + task, replacement, delivery note, payment, low-stock episode, digest, notification worker
   retry, audit verify (and detection after a deliberate tamper in a scratch copy).
4. Frontend: typecheck, build, component tests; a Playwright smoke run (login with OTP read from the dev log sender ->
   stock in 3 units -> requisition -> issue -> delivery note PDF downloads).
5. `gofmt`, `golangci-lint` (default set), `npm audit --omit=dev` with no high severities.
6. Load the real workbook and confirm: 61 ledger rows, balances reconcile for 28 SKUs, `audit_verify()` intact.

## 8. Deliverables

* Working repo with `backend/`, `frontend/`, `migrations/`, `tests/`, `tools/`, `docker-compose.yml` (postgres + api +
  frontend + mailpit for dev email), `Makefile` (`up`, `migrate`, `test`, `seed-dev`, `import`), `.env.example`.
* `docs/` with: architecture (one page), RBAC matrix generated from the database, API reference (OpenAPI), runbook
  (backups, migrations, worker, rotating secrets), and a short "how the DB rules work" note.
* A final report listing every feature in section 4 with its route(s), screen, test name(s) and status. Anything not
  finished must be listed honestly with the reason; do not mark a feature done that you have not exercised.

## 9. Working agreement

* Work in this order: section 3 (realign), 4.1-4.2, 4.3-4.4, 4.5-4.7, 4.8, 4.9-4.10, 4.11-4.12, then hardening and docs.
  Commit after each; run the gates in section 7 for what exists at each step.
* If the migrations are wrong or missing something, **add a new migration** (never edit an applied one) with Up and Down
  and extend `tests/smoke.sql`. Explain why in the commit message.
* If a requirement conflicts with `Code.gs`, prefer the stricter, safer behaviour and note it in the report.
* Ask the owner (do not guess) about: the unknown SKU, Google Drive vs local storage for PDFs, production hostnames, and
  who the first admin is.
