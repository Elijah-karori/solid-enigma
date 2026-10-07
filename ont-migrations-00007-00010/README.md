# ONT portal - PostgreSQL migrations 00007-00010 (+ tests and loader)

Builds on your 00001-00006 (unchanged except that 00009 replaces `ledger_before_insert()`, see below).

| File | Adds |
|---|---|
| 00007_settings_ids_defaults | the 14 `Inventory Settings` seeds; `get_setting()`; human ids (REQ-001, TKT-0001, TASK-0001, PRC-001, PRJ-001, CUS-0001, HSP-001, SPL-001, ENC-001, DN-/RN-0001, INV-ONT-0001...) via `next_id()`; name/email -> `users.id` resolution; creation defaults (estimated value, task "Awaiting Stock", ticket "Assigned", `closed_at`); project manager must be a Project Manager/Admin |
| 00008_reporting_views | `v_stock_summary`, `v_low_stock`, `v_project_cost/items`, `v_cost_summary/by_type/by_task`, `v_serialized_units`, `v_splitters`, `v_port_map`, `splitter_path()`, `v_customer_overview`, `v_hotspot_overview`, `v_device_status`, the three troubleshooting insights, `v_digest`, `pending_actions(user)` |
| 00009_business_rules_operations | actor context (`app.actor_email/role`), finance routing (threshold / over-budget), stock-availability routing, self-approval bans, PM scoping, ledger rules (serialized needs a unit, project-only items), port rules; functions `record_movement`, `issue_requisition`, `receive_procurement`, `receive_serialized_batch`, `install_device`, `remove_device`, `create_ticket`, `assign_ticket`, `raise_procurement_from_requisition`, `create_delivery_note`, `set_payment_status`, `assign_port`, `release_port` |
| 00010_audit_notifications | DB-side hash-chained audit (`audit_append`, `audit_verify`, row triggers on 16 tables, `v_unit_history`); `notification_outbox` + triggers for every email the Apps Script sent, low-stock episodes, daily digest, `claim_notifications` / `mark_notification` for the Go worker |

## Things you must know
* **00009 replaces `ledger_before_insert()` from 00006.** A unit's first ledger row is its receipt, so "already In Stock" now only
  applies once the unit has history (otherwise no new unit could ever be received). The Down restores the original.
* **New permission `approveProjectReq`** (Admin, Store Manager, Project Manager): the sheet let a Project Manager give the
  operations-stage approval for projects they manage; your `approveReq` transitions could not express that. Add it to the Go `rbac` map.
* **The Go API must set the actor** at the start of every request transaction:
  `SELECT set_config('app.actor_email', $1, true), set_config('app.actor_role', $2, true)`. Without it the actor checks (self-approval,
  "only your own tickets", PM scoping) are skipped. For imports set `app.import_mode = 'on'`.
* The audit hash format is shared with Go (`internal/audit`): the same digest was verified from both sides.
* Notifications are queued in the same transaction as the change. A worker loop must call `claim_notifications(n)`, send with the
  SMTP sender, then `mark_notification(id, ok, err)`, and call `enqueue_daily_digest()` once a day (08:00).

## Verify
    ./all.sh                                   # fresh DB, all migrations
    psql -v ON_ERROR_STOP=1 -d ont -f tests/smoke.sql   # about 70 assertions and expected-failure checks across every workflow, rolls back
Down 00010..00007 and Up again were also run clean.

## Load the workbook
    python3 tools/extract_workbook.py workbook.xlsx --out out --sku-map INV-ONT-0002=<SKU>
    python3 tools/load_bundle.py out/import_bundle.json --dsn postgresql://... [--commit]
Verified against your real workbook: 11 users, 30 catalog items, 23 units, 61 ledger rows, balances reconcile for 28 SKUs.
**INV-ONT-0002 has model "Not stated"**: tell the loader which SKU it is (I used SKU-ONT-XPON only to test).
