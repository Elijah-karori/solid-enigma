#!/usr/bin/env python3
"""
Load out/import_bundle.json (from extract_workbook.py) into the PostgreSQL schema built by migrations 00001-00010.

  python3 tools/load_bundle.py out/import_bundle.json --dsn postgresql://user:pass@host/db            # dry run (rolls back)
  python3 tools/load_bundle.py out/import_bundle.json --dsn ... --commit

* ONE transaction. Any error, or any stock balance that differs from the workbook, rolls everything back.
* Runs with app.import_mode = 'on': business-rule, audit and notification triggers stand down so history is
  loaded as it was (the schema's constraints, foreign keys and the append-only ledger still apply).
* Refuses to run into a database that already has ledger rows (the ledger is append-only).
* No password is imported: every user must_reset_password and signs in through the emailed-code flow.
"""
import argparse, json, re, sys
import psycopg2, psycopg2.extras

COND_OK = {"New", "Used", "Good", "Needs Repair", "Damaged", "Faulty", "Not Recorded"}


def nz(v):
    """'' -> None"""
    if v is None:
        return None
    if isinstance(v, str) and v.strip() == "":
        return None
    return v


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("bundle")
    ap.add_argument("--dsn", required=True)
    ap.add_argument("--commit", action="store_true")
    ap.add_argument("--sku-map", action="append", default=[], metavar="ASSET=SKU",
                    help="supply the SKU for a unit the workbook left blank, e.g. INV-ONT-0002=SKU-ONT-HG8546M (repeatable)")
    a = ap.parse_args()
    b = json.load(open(a.bundle, encoding="utf-8"))
    skumap = dict(x.split("=", 1) for x in a.sku_map)
    for u in b["serialized"]:
        if not u["sku"] and u["asset_id"] in skumap:
            u["sku"] = skumap[u["asset_id"]].strip().upper()
    missing = [u["asset_id"] for u in b["serialized"] if not u["sku"]]
    if missing:
        sys.exit("These units have no SKU in the workbook: " + ", ".join(missing) + "\nPass --sku-map ASSET=SKU for each (the model is unknown, so it needs a human decision).")

    conn = psycopg2.connect(a.dsn)
    conn.autocommit = False
    cur = conn.cursor()
    ex = lambda sql, args=None: cur.execute(sql, args)

    def many(sql, rows):
        if rows:
            psycopg2.extras.execute_batch(cur, sql, rows, page_size=200)

    try:
        ex("SET LOCAL app.import_mode = 'on'")
        ex("SET CONSTRAINTS ALL DEFERRED")
        ex("SELECT count(*) FROM inventory_transactions")
        if cur.fetchone()[0]:
            raise SystemExit("inventory_transactions is not empty: refusing to import into a live ledger.")

        # ---- settings
        many("INSERT INTO settings (key, value) VALUES (%s, %s) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
             [(s["key"], s["value"]) for s in b["settings"]])

        # ---- users (no credentials)
        many("""INSERT INTO users (email, name, role, status, site_station, contact_info, legacy_id, must_reset_password)
                VALUES (%s,%s,%s,%s,%s,%s,%s,true) ON CONFLICT (lower(email)) DO NOTHING""",
             [(u["email"], u["name"], u["role"], u["status"], nz(u["site_station"]), nz(u["contact_info"]), nz(u["legacy_id"])) for u in b["users"]])

        # ---- projects first (catalog scope references them)
        many("""INSERT INTO projects (project_id, project_name, type, status, location_fat, project_manager, budget, start_date, end_date, notes, created_by)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
             [(p["project_id"], p["project_name"], p["type"] or "Deployment", p["status"], nz(p["location_fat"]), nz(p["project_manager"]), p["budget"],
               nz(p["start_date"]), nz(p["end_date"]), nz(p["notes"]), nz(p["created_by"])) for p in b["projects"]])

        # ---- catalog
        many("""INSERT INTO item_catalog (sku, asset_type, manufacturer, model, access_tech, unit_cost, description, reorder_level, tracking_type, project_scope, is_active)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
             [(c["sku"], nz(c["asset_type"]), nz(c["manufacturer"]), c["model"], nz(c["access_tech"]), c["unit_cost"], nz(c["description"]),
               c["reorder_level"], c["tracking_type"], nz(c["project_scope"]), c["is_active"]) for c in b["catalog"]])

        # ---- serialized units
        rows = []
        for u in b["serialized"]:
            notes = u["notes"] or ""
            cond = u["condition"] if u["condition"] in COND_OK else "Not Recorded"
            if cond != u["condition"]:
                notes = (notes + " | " if notes else "") + f"Condition in source: {u['condition']}"
            if u.get("customer_name"):
                notes = (notes + " | " if notes else "") + f"Source customer: {u['customer_name']} {u.get('customer_account','')}".strip()
            rows.append((u["asset_id"], u["sku"], nz(u["asset_type"]), nz(u["manufacturer"]), nz(u["model"]), nz(u["access_tech"]), nz(u["product_id"]),
                         nz(u["mac"]), u["serial_number"], u["status"], cond, nz(u["location"]), nz(u["custodian"]), nz(notes)))
        many("""INSERT INTO serialized_inventory (asset_id, sku, asset_type, manufacturer, model, access_tech, product_id, mac, serial_number,
                                                 status, condition, location, custodian, notes)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""", rows)

        # ---- tasks / tickets (circular FKs are deferred)
        many("""INSERT INTO technician_tasks (task_id, created_at, task_title, task_type, assigned_to, assignee_email, priority, status, required_sku,
                                              required_qty, customer_site, reference, notes, created_by, stock_ready_at, linked_ticket_id, project_id)
                VALUES (%s,COALESCE(%s::timestamptz, now()),%s,COALESCE(%s,'Field / Operations'),%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
             [(t["task_id"], nz(t["created_at"]), t["task_title"], nz(t["task_type"]), nz(t["assigned_personnel"]), nz(t["assignee_email"]), t["priority"], t["status"],
               nz(t["required_sku"]), t["required_qty"] if nz(t["required_sku"]) else 0, nz(t["customer_site"]), nz(t["reference"]), nz(t["notes"]), nz(t["created_by"]),
               nz(t["stock_ready_at"]), nz(t["linked_ticket_id"]), nz(t["project_id"])) for t in b["tasks"]])
        many("""INSERT INTO customer_tickets (ticket_id, date_logged, customer_name, issue_category, assigned_to, old_device_sn, new_device_sn, ticket_status,
                                              logged_by, resolution_notes, linked_task_id, priority, closed_at, device_asset_id)
                VALUES (%s,COALESCE(%s::timestamptz, now()),%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
             [(t["ticket_id"], nz(t["date_logged"]), t["customer_account"] or "Unknown", t["issue_category"], nz(t["assigned_technician"]),
               nz(t["device_swapped_old_sn"]), nz(t["replacement_device_new_sn"]), t["ticket_status"], nz(t["logged_by"]), nz(t["resolution_notes"]),
               nz(t["linked_task_id"]), t["priority"], nz(t["closed_at"]), nz(t["device_asset_id"])) for t in b["tickets"]])
        many("UPDATE serialized_inventory SET linked_ticket_id = %s WHERE asset_id = %s AND EXISTS (SELECT 1 FROM customer_tickets WHERE ticket_id = %s)",
             [(u["linked_ticket_id"], u["asset_id"], u["linked_ticket_id"]) for u in b["serialized"] if nz(u["linked_ticket_id"])])

        # ---- requisitions, purchases
        many("""INSERT INTO technician_requisitions (requisition_id, date_requested, technician_name, item_sku, quantity, reason, project_id, approval_status,
                                                      approved_by, action_date, issued_by, decision_note, finance_status, est_value)
                VALUES (%s,COALESCE(%s::timestamptz, now()),%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
             [(r["requisition_id"], nz(r["date_requested"]), r["technician_name"], r["item_sku"], int(r["quantity_requested"]), nz(r["reason_job_ticket"]),
               nz(r["project_id"]), r["approval_status"], nz(r["approved_by"]), nz(r["issue_date"]), nz(r["issued_by"]), nz(r["decision_note"]),
               r["finance_status"] or "N/A", r["est_value"]) for r in b["requisitions"]])
        units = []
        for r in b["requisitions"]:
            for asset in [x.strip().upper() for x in (r["issued_units"] or "").split(",") if x.strip()]:
                units.append((r["requisition_id"], asset))
        many("INSERT INTO requisition_units (requisition_id, asset_id) VALUES (%s,%s) ON CONFLICT DO NOTHING", units)
        many("""INSERT INTO procurement_requests (procurement_id, date_requested, requested_by, item_sku, quantity, est_unit_cost, project_id, linked_requisition_id, status,
                                                   finance_by, finance_date, supplier, po_ref, ordered_date, received_date, notes)
                VALUES (%s,COALESCE(%s::timestamptz, now()),%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
             [(p["procurement_id"], nz(p["date_requested"]), p["requested_by"], p["item_sku"], int(p["quantity"]), p["est_unit_cost"], nz(p["project_id"]),
               nz(p["linked_requisition_id"]), p["status"], nz(p["finance_by"]), nz(p["finance_date"]), nz(p["supplier"]), nz(p["po_ref"]), nz(p["ordered_date"]),
               nz(p["received_date"]), nz(p["notes"])) for p in b["procurement"]])

        # ---- delivery notes
        for d in b["delivery_notes"]:
            is_dn = d["type"] == "Delivery Note"
            ex("""INSERT INTO delivery_notes (doc_no, type, reference, requisition_id, procurement_id, project_id, recipient, file_name, drive_url, created_by, created_at,
                                              value_kes, payment_status, paid_date, payment_ref)
                  VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,COALESCE(%s::timestamptz, now()),%s,%s,%s,%s)""",
               (d["doc_no"], d["type"], d["reference"], d["reference"] if is_dn else None, None if is_dn else d["reference"], nz(d["project_id"]), nz(d["recipient"]),
                nz(d["file_name"]), nz(d["drive_url"]), nz(d["created_by"]), nz(d["created_at"]), d["value_kes"], d["payment_status"] or "Tracking only",
                nz(d["paid_date"]), nz(d["payment_ref"])))

        # ---- ledger (the Task/Ticket column of the sheet is free text: map it to the right reference when it is one)
        ex("SELECT task_id FROM technician_tasks"); tasks = {r[0] for r in cur.fetchall()}
        ex("SELECT ticket_id FROM customer_tickets"); tickets = {r[0] for r in cur.fetchall()}
        ex("SELECT requisition_id FROM technician_requisitions"); reqs = {r[0] for r in cur.fetchall()}
        ex("SELECT procurement_id FROM procurement_requests"); procs = {r[0] for r in cur.fetchall()}
        ex("SELECT code FROM cost_types"); ctypes = {r[0] for r in cur.fetchall()}
        ex("SELECT project_id FROM projects"); projs = {r[0] for r in cur.fetchall()}
        led, unmapped = [], 0
        for t in b["transactions"]:
            ref = (t["task_id"] or "").strip().upper()
            task = ref if ref in tasks else None
            tkt = ref if ref in tickets else None
            rq = ref if ref in reqs else None
            pr = ref if ref in procs else None
            notes = t["notes"] or ""
            if ref and not (task or tkt or rq or pr):
                unmapped += 1
                notes = (notes + " | " if notes else "") + f"Source reference: {t['task_id']}"
            led.append((t["transaction_date"], t["direction"], t["sku"], nz(t["item_name"]), t["quantity"], nz(t["requested_by"]), nz(t["role"]), nz(t["site_reference"]),
                        t["unit_cost"], t["cost_type"] if t["cost_type"] in ctypes else "Other", nz(t["asset_id"]), t["project_id"] if t["project_id"] in projs else None,
                        task, rq, pr, tkt, nz(notes)))
        many("""INSERT INTO inventory_transactions (transaction_date, direction, sku, item_name, quantity, requested_by, role, site_reference, unit_cost, cost_type,
                                                    asset_id, project_id, task_id, requisition_id, procurement_id, ticket_id, notes)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""", led)

        # ---- histories
        many("INSERT INTO notification_logs (timestamp, type, reference, recipient, subject, status, error, legacy) VALUES (COALESCE(%s::timestamptz, now()),%s,%s,%s,%s,%s,%s,true)",
             [(nz(n["timestamp"]), n["type"], n["reference"], n["recipient"], n["subject"], "FAILED" if n["status"].upper().startswith("FAIL") else "SENT", n["error"]) for n in b["notification_log"]])
        many("""INSERT INTO legacy_audit_entries (audit_id, timestamp, entity_type, entity_id, action, actor, role, previous_state, new_state, details, legacy_hash)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (audit_id) DO NOTHING""",
             [(x["audit_id"], x["timestamp"], x["entity_type"], x["entity_id"], x["action"], x["user"], x["role"], x["previous_state"], x["new_state"], x["details"], x["hash"]) for x in b["audit_legacy"]])

        # ---- counters, reconciliation, genesis audit row
        ex("SELECT reseed_id_counters()")
        ex("SELECT sku, net_qty FROM v_stock_summary")
        got = {s: int(q) for s, q in cur.fetchall()}
        bad = [f"{k}: database {got.get(k, 0)}, workbook {v}" for k, v in b["expected_balances"].items() if got.get(k, 0) != v]
        bad += [f"{k}: negative balance {v}" for k, v in got.items() if v < 0]
        if bad:
            raise SystemExit("Balance reconciliation FAILED:\n  - " + "\n  - ".join(bad))
        ex("SELECT s.sku, s.net_qty, u.n FROM v_stock_summary s JOIN (SELECT sku, count(*) n FROM serialized_inventory WHERE status = 'In Stock' GROUP BY sku) u USING (sku) WHERE s.net_qty <> u.n")
        drift = cur.fetchall()
        ex("SELECT audit_append('migration','System','Migration',%s,'Workbook imported',%s,%s,%s,'')",
           (b["meta"]["source_file"], "", json.dumps(b["meta"]["counts"]), "legacy audit rows kept in legacy_audit_entries"))
        ex("SELECT intact, checked FROM audit_verify()")
        intact, checked = cur.fetchone()
        assert intact, "audit chain verification failed"

        print("Loaded:", {k: len(v) if isinstance(v, list) else v for k, v in b.items() if k in ("users", "catalog", "serialized", "transactions", "requisitions", "tasks", "tickets", "procurement")})
        print(f"Ledger references that were free text and kept in notes: {unmapped}")
        print("Balances reconcile with the workbook for", len(b["expected_balances"]), "SKUs.")
        for sku, net, n in drift:
            print(f"NOTE {sku}: ledger balance {net} but {n} unit(s) In Stock - review")
        if a.commit:
            conn.commit(); print("COMMITTED. Users must set a password via Forgot password (email code).")
        else:
            conn.rollback(); print("Dry run complete - rolled back. Re-run with --commit to write.")
    except SystemExit:
        conn.rollback(); raise
    except Exception as e:
        conn.rollback(); print("ROLLED BACK:", type(e).__name__, e); sys.exit(1)


if __name__ == "__main__":
    main()
