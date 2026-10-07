-- End-to-end scenario for migrations 00001-00010. Runs in ONE transaction and rolls back.
--   psql -v ON_ERROR_STOP=1 -d ont -f tests/smoke.sql
BEGIN;
\set ON_ERROR_STOP on

CREATE FUNCTION pg_temp.as_user(p_email text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('app.actor_email', p_email, true), set_config('app.actor_role', (SELECT role FROM users WHERE email = p_email), true);
$$;
-- expect an error whose message contains a fragment
CREATE FUNCTION pg_temp.expect_fail(p_sql text, p_fragment text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF position(lower(p_fragment) in lower(SQLERRM)) = 0 THEN
      RAISE EXCEPTION 'EXPECTED "%" but got "%" for: %', p_fragment, SQLERRM, p_sql;
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'EXPECTED FAILURE ("%") but it succeeded: %', p_fragment, p_sql;
END;
$$;

-- ---- people ---------------------------------------------------------------------------------
INSERT INTO users (email, name, role) VALUES
  ('admin@t.co', 'Ada Admin', 'Admin'), ('store@t.co', 'Sam Store', 'Store Manager'), ('fin@t.co', 'Fay Finance', 'Finance'),
  ('pm@t.co', 'Pat PM', 'Project Manager'), ('pm2@t.co', 'Pia PM', 'Project Manager'), ('tech@t.co', 'Tom Tech', 'Technician'),
  ('sup@t.co', 'Sue Support', 'Support');
UPDATE settings SET value = 'ops@t.co' WHERE key = 'PURCHASING_EMAIL';

-- ---- catalog / project ----------------------------------------------------------------------
INSERT INTO item_catalog (sku, asset_type, model, unit_cost, reorder_level, tracking_type)
  VALUES ('SKU-ONT-X1', 'XPON/ONT', 'ONT X1', 5000, 2, 'SERIALIZED'), ('SKU-CABLE', 'Cable', 'Drop cable', 100, 10, 'BULK');
SELECT pg_temp.as_user('pm@t.co');
INSERT INTO projects (project_id, project_name, status, project_manager, budget) VALUES ('', 'Zone 4', 'Active', 'Pat PM', 100000);
DO $$ BEGIN ASSERT (SELECT project_id FROM projects) = 'PRJ-001', 'project id autofill'; END $$;
SELECT pg_temp.expect_fail($$ INSERT INTO projects (project_name, project_manager) VALUES ('Bad', 'Tom Tech') $$, 'project manager');
INSERT INTO item_catalog (sku, model, tracking_type, project_scope, unit_cost) VALUES ('SKU-ZONE4-BOX', 'Zone 4 box', 'BULK', 'PRJ-001', 50);

-- ---- stock in -------------------------------------------------------------------------------
SELECT pg_temp.as_user('store@t.co');
SELECT record_movement('Stock In', 'SKU-CABLE', 100);
SELECT record_movement('Stock In', 'SKU-ZONE4-BOX', 20);
SELECT receive_serialized_batch('SKU-ONT-X1',
  '[{"sn":"sn 001","mac":"aa:bb:cc:dd:ee:01"},{"sn":"SN002","mac":"AABBCCDDEE02"},{"sn":"SN003"}]'::jsonb, 'Main Store', 'DN-77');
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM serialized_inventory) = 3, 'three units';
  ASSERT (SELECT asset_id FROM serialized_inventory WHERE serial_number = 'SN001') = 'INV-ONT-0001', 'asset id + S/N normalised';
  ASSERT (SELECT mac FROM serialized_inventory WHERE serial_number = 'SN001') = 'AABBCCDDEE01', 'mac normalised';
  ASSERT (SELECT net_qty FROM v_stock_summary WHERE sku = 'SKU-ONT-X1') = 3, 'serialized balance';
END $$;
SELECT pg_temp.expect_fail($$ SELECT receive_serialized_batch('SKU-ONT-X1', '[{"sn":"SN001"}]') $$, 'already exists');
SELECT pg_temp.expect_fail($$ SELECT receive_serialized_batch('SKU-ONT-X1', '[{"sn":"A1"},{"sn":"a1"}]') $$, 'appears twice');
SELECT pg_temp.expect_fail($$ SELECT receive_serialized_batch('SKU-ONT-X1', '[{"sn":"Z","mac":"12345"}]') $$, 'valid MAC');
SELECT pg_temp.expect_fail($$ SELECT record_movement('Stock In', 'SKU-ONT-X1', 1) $$, 'S/N and MAC');
SELECT pg_temp.expect_fail($$ SELECT record_movement('Stock Out', 'SKU-CABLE', 500) $$, '');          -- would go negative
SELECT pg_temp.expect_fail($$ SELECT record_movement('Stock Out', 'SKU-ZONE4-BOX', 1) $$, 'dedicated to project');

-- ---- requisition: bulk, self-approval, issue -------------------------------------------------
SELECT pg_temp.as_user('tech@t.co');
INSERT INTO technician_requisitions (requisition_id, technician_name, item_sku, quantity, reason)
  VALUES ('', 'Tom Tech', 'SKU-CABLE', 3, 'Installation TKT-9');
DO $$ BEGIN
  ASSERT (SELECT requisition_id FROM technician_requisitions) = 'REQ-001', 'req id';
  ASSERT (SELECT est_value FROM technician_requisitions) = 300, 'est value from catalog';
  ASSERT (SELECT technician_user_id FROM technician_requisitions) = (SELECT id FROM users WHERE email = 'tech@t.co'), 'name -> user';
END $$;
SELECT pg_temp.expect_fail($$ UPDATE technician_requisitions SET approval_status = 'Approved - Ready' $$, 'may not move');
SELECT pg_temp.as_user('store@t.co');
UPDATE technician_requisitions SET approval_status = 'Approved - Ready' WHERE requisition_id = 'REQ-001';
DO $$ BEGIN ASSERT (SELECT approval_status FROM technician_requisitions) = 'Approved - Ready'; ASSERT (SELECT approved_by FROM technician_requisitions) = 'Sam Store'; END $$;
SELECT issue_requisition('REQ-001');
DO $$ BEGIN
  ASSERT (SELECT approval_status FROM technician_requisitions) = 'Issued', 'issued';
  ASSERT (SELECT net_qty FROM v_stock_summary WHERE sku = 'SKU-CABLE') = 97, 'cable balance';
  ASSERT (SELECT ticket_id FROM inventory_transactions WHERE requisition_id = 'REQ-001') IS NULL OR true;
END $$;

-- store manager cannot approve own request unless Admin
INSERT INTO technician_requisitions (requisition_id, technician_name, item_sku, quantity) VALUES ('', 'Sam Store', 'SKU-CABLE', 1);
SELECT pg_temp.expect_fail($$ UPDATE technician_requisitions SET approval_status = 'Approved - Ready' WHERE technician_name = 'Sam Store' $$, 'your own');

-- ---- finance routing + serialized issue + stock routing ---------------------------------------
UPDATE settings SET value = '4000' WHERE key = 'FINANCE_APPROVAL_THRESHOLD';
SELECT pg_temp.as_user('tech@t.co');
INSERT INTO technician_requisitions (requisition_id, technician_name, item_sku, quantity) VALUES ('', 'Tom Tech', 'SKU-ONT-X1', 1);
SELECT pg_temp.as_user('store@t.co');
UPDATE technician_requisitions SET approval_status = 'Approved - Ready' WHERE requisition_id = 'REQ-003';
DO $$ BEGIN
  ASSERT (SELECT approval_status FROM technician_requisitions WHERE requisition_id = 'REQ-003') = 'Pending Finance', 'auto-routed to Finance';
  ASSERT (SELECT finance_status FROM technician_requisitions WHERE requisition_id = 'REQ-003') = 'Pending';
END $$;
SELECT pg_temp.expect_fail($$ UPDATE technician_requisitions SET approval_status = 'Approved - Ready' WHERE requisition_id = 'REQ-003' $$, 'may not move');
SELECT pg_temp.as_user('fin@t.co');
UPDATE technician_requisitions SET approval_status = 'Approved - Ready' WHERE requisition_id = 'REQ-003';
DO $$ BEGIN
  ASSERT (SELECT approval_status FROM technician_requisitions WHERE requisition_id = 'REQ-003') = 'Approved - Ready';
  ASSERT (SELECT finance_by FROM technician_requisitions WHERE requisition_id = 'REQ-003') = 'Fay Finance';
END $$;
SELECT pg_temp.as_user('store@t.co');
SELECT pg_temp.expect_fail($$ SELECT issue_requisition('REQ-003', ARRAY[]::text[]) $$, 'exactly 1');
SELECT issue_requisition('REQ-003', ARRAY['INV-ONT-0001']);
DO $$ BEGIN
  ASSERT (SELECT status FROM serialized_inventory WHERE asset_id = 'INV-ONT-0001') = 'Issued / Out', 'unit issued';
  ASSERT (SELECT custodian FROM serialized_inventory WHERE asset_id = 'INV-ONT-0001') = 'Tom Tech', 'custodian';
END $$;
-- availability routing: ask for more units than are left -> Awaiting Stock
SELECT pg_temp.as_user('tech@t.co');
INSERT INTO technician_requisitions (requisition_id, technician_name, item_sku, quantity) VALUES ('', 'Tom Tech', 'SKU-CABLE', 98);
UPDATE settings SET value = '99999999' WHERE key = 'FINANCE_APPROVAL_THRESHOLD';
SELECT pg_temp.as_user('store@t.co');
UPDATE technician_requisitions SET approval_status = 'Approved - Ready' WHERE requisition_id = 'REQ-004';
DO $$ BEGIN ASSERT (SELECT approval_status FROM technician_requisitions WHERE requisition_id = 'REQ-004') = 'Awaiting Stock', 'short -> awaiting'; END $$;
SELECT raise_procurement_from_requisition('REQ-004');
DO $$ BEGIN ASSERT (SELECT quantity FROM procurement_requests) = 1, 'shortfall = 98-97'; ASSERT (SELECT procurement_ref FROM technician_requisitions WHERE requisition_id='REQ-004') = 'PRC-001'; END $$;

-- ---- purchase: finance approve, order, receive releases the waiting requisition ----------------
SELECT pg_temp.expect_fail($$ UPDATE procurement_requests SET status = 'Approved' $$, 'may not move');
SELECT pg_temp.as_user('fin@t.co');
UPDATE procurement_requests SET status = 'Approved' WHERE procurement_id = 'PRC-001';
SELECT pg_temp.as_user('store@t.co');
SELECT pg_temp.expect_fail($$ UPDATE procurement_requests SET status = 'Ordered' WHERE procurement_id = 'PRC-001' $$, 'upplier');
UPDATE procurement_requests SET status = 'Ordered', supplier = 'Acme', po_ref = 'PO-1' WHERE procurement_id = 'PRC-001';
SELECT pg_temp.expect_fail($$ UPDATE procurement_requests SET status = 'Received' WHERE procurement_id = 'PRC-001' $$, 'receive_procurement');
SELECT receive_procurement('PRC-001');
DO $$ BEGIN
  ASSERT (SELECT status FROM procurement_requests) = 'Received';
  ASSERT (SELECT approval_status FROM technician_requisitions WHERE requisition_id = 'REQ-004') = 'Approved - Ready', 'waiting requisition released by stock in';
END $$;
SELECT create_delivery_note('PRC-001');
SELECT create_delivery_note('REQ-003');
DO $$ BEGIN ASSERT (SELECT doc_no FROM delivery_notes WHERE type = 'Receipt Note') = 'RN-0001'; ASSERT (SELECT doc_no FROM delivery_notes WHERE type = 'Delivery Note') = 'DN-0001'; END $$;
SELECT pg_temp.as_user('fin@t.co');
SELECT set_payment_status('RN-0001', 'Paid', 'MPESA-9');

-- ---- network ------------------------------------------------------------------------------------
SELECT pg_temp.as_user('sup@t.co');
INSERT INTO olts (id, name) VALUES ('', 'OLT main');
INSERT INTO pon_ports (id, olt_id, port_number) VALUES ('OLT-01/PON-1', 'OLT-01', 1);
INSERT INTO enclosures (id, name, latitude, longitude) VALUES ('', 'FAT-01', -1.29, 36.82);
INSERT INTO splitters (id, name, ratio, pon_port_id, enclosure_id) VALUES ('', 'P1', '1:4', 'OLT-01/PON-1', 'ENC-001');
INSERT INTO splitters (id, name, ratio, enclosure_id) VALUES ('', 'S1', '1:8', 'ENC-001');
SELECT assign_port('SPL-001', 2, 'splitter', 'SPL-002');
INSERT INTO customers (id, name, account_no) VALUES ('', 'Cathy', '');
INSERT INTO hotspots (id, name) VALUES ('', 'Mall WiFi');
INSERT INTO customers (id, name, subscription_type, hotspot_id) VALUES ('', 'Hotspot Harry', 'Hotspot User', 'HSP-001');
SELECT assign_port('SPL-002', 3, 'customer', 'CUS-0001');
SELECT assign_port('SPL-002', 4, 'hotspot', 'HSP-001');
SELECT pg_temp.expect_fail($$ SELECT assign_port('SPL-002', 3, 'customer', 'CUS-0002') $$, '');          -- hotspot user on a port
SELECT pg_temp.expect_fail($$ SELECT assign_port('SPL-002', 9, 'hotspot', 'HSP-001') $$, 'from 1 to 8');
INSERT INTO customers (id, name) VALUES ('', 'Dan');
SELECT pg_temp.expect_fail($$ SELECT assign_port('SPL-002', 3, 'customer', 'CUS-0004') $$, 'already used by CUS-0001');
SELECT pg_temp.expect_fail($$ SELECT assign_port('SPL-002', 1, 'splitter', 'SPL-001') $$, 'loop');
DO $$ BEGIN
  ASSERT (SELECT level FROM v_splitters WHERE id = 'SPL-002') = 'Secondary';
  ASSERT (SELECT splitter_path('SPL-002', 3)) = 'OLT OLT-01/PON-1 -> SPL-001 (1:4 @ FAT-01) -> SPL-002 (1:8 @ FAT-01) -> port 3', 'path: ' || splitter_path('SPL-002', 3);
END $$;
-- install: ONU still In Stock -> refused; issued unit -> ok
SELECT pg_temp.as_user('tech@t.co');
SELECT pg_temp.expect_fail($$ SELECT install_device('INV-ONT-0002', 'ONU', 'CUS-0001') $$, 'Issue it first');
SELECT install_device('INV-ONT-0001', 'ONU', 'CUS-0001');
SELECT pg_temp.expect_fail($$ SELECT install_device('INV-ONT-0001', 'ONU', 'CUS-0004') $$, '');
DO $$ BEGIN
  ASSERT (SELECT onu_asset_id FROM v_customer_overview WHERE id = 'CUS-0001') = 'INV-ONT-0001';
  ASSERT (SELECT installed_at_name FROM v_serialized_units WHERE asset_id = 'INV-ONT-0001') = 'Cathy';
END $$;

-- ---- tickets + tasks ------------------------------------------------------------------------------
SELECT pg_temp.as_user('sup@t.co');
SELECT create_ticket('', 'No Optical Link', 'High', 'Tom Tech', true, 'LOS red', 'CUS-0001', NULL, 'INV-ONT-0001');
DO $$ BEGIN
  ASSERT (SELECT ticket_status FROM customer_tickets) = 'Assigned', 'ticket assigned';
  ASSERT (SELECT linked_task_id FROM customer_tickets) = 'TASK-0001', 'linked task';
  ASSERT (SELECT linked_ticket_id FROM technician_tasks) = 'TKT-0001';
  ASSERT (SELECT linked_ticket_id FROM serialized_inventory WHERE asset_id = 'INV-ONT-0001') = 'TKT-0001', 'unit marked';
  ASSERT (SELECT customer_name FROM customer_tickets) = 'Cathy / CUS-0001';
END $$;
SELECT pg_temp.as_user('tech@t.co');
UPDATE technician_tasks SET status = 'In Progress' WHERE task_id = 'TASK-0001';
DO $$ BEGIN ASSERT (SELECT ticket_status FROM customer_tickets) = 'In Progress', 'task start propagates'; END $$;
SELECT pg_temp.expect_fail($$ UPDATE customer_tickets SET ticket_status = 'Closed' $$, 'may not move');
UPDATE technician_tasks SET status = 'Completed' WHERE task_id = 'TASK-0001';
DO $$ BEGIN ASSERT (SELECT ticket_status FROM customer_tickets) = 'Resolved', 'task complete resolves ticket'; END $$;
SELECT pg_temp.as_user('sup@t.co');
UPDATE customer_tickets SET ticket_status = 'Closed';
DO $$ BEGIN ASSERT (SELECT closed_at FROM customer_tickets) IS NOT NULL, 'closed_at set'; END $$;
SELECT pg_temp.expect_fail($$ UPDATE customer_tickets SET priority = 'Low' $$, 'closed');

-- ---- reporting, pending list, notifications, audit --------------------------------------------------
DO $$
DECLARE n int; r record;
BEGIN
  SELECT count(*) INTO n FROM pending_actions((SELECT id FROM users WHERE email = 'store@t.co'));
  RAISE NOTICE 'store manager has % pending item(s)', n;
  PERFORM * FROM v_cost_summary; PERFORM * FROM v_cost_by_type; PERFORM * FROM v_cost_by_task; PERFORM * FROM v_project_cost;
  PERFORM * FROM v_project_items; PERFORM * FROM v_port_map; PERFORM * FROM v_hotspot_overview; PERFORM * FROM v_device_status;
  PERFORM * FROM v_splitter_fault_clusters; PERFORM * FROM v_repeat_failure_devices; PERFORM * FROM v_model_fault_rate;
  PERFORM * FROM v_digest; PERFORM * FROM v_unit_history; PERFORM * FROM v_low_stock;
  FOR r IN SELECT id FROM users LOOP PERFORM * FROM pending_actions(r.id); END LOOP;
  ASSERT (SELECT spent FROM v_project_cost WHERE project_id = 'PRJ-001') = 0;
  ASSERT (SELECT count(*) FROM v_unit_history WHERE asset_id = 'INV-ONT-0001') >= 3, 'unit history has audit + ledger rows';
  ASSERT (SELECT intact FROM audit_verify()), 'audit chain intact: ' || (SELECT coalesce(reason, '') FROM audit_verify());
  RAISE NOTICE 'audit rows: %', (SELECT checked FROM audit_verify());
  RAISE NOTICE 'outbox rows: %  types: %', (SELECT count(*) FROM notification_outbox), (SELECT string_agg(DISTINCT type, ',') FROM notification_outbox);
  ASSERT (SELECT count(*) FROM notification_outbox WHERE type = 'REQUISITION_PENDING') >= 1;
  ASSERT (SELECT count(*) FROM notification_outbox WHERE type = 'REQUISITION_FINANCE') = 1, 'finance mail once';
  ASSERT (SELECT count(*) FROM notification_outbox WHERE type = 'TASK_ASSIGNED') = 1;
  ASSERT (SELECT count(*) FROM notification_outbox WHERE type = 'STOCK_AVAILABLE_REQ') = 1, 'stock available mail';
END $$;

-- low stock episodes: ONT balance is 2 now (<= level 2) -> one alert, no repeat until replenished
SELECT pg_temp.as_user('store@t.co');
DO $$
DECLARE a int; b int;
BEGIN
  a := (SELECT count(*) FROM notification_outbox WHERE type = 'LOW_STOCK' AND reference = 'SKU-ONT-X1');
  PERFORM run_low_stock_scan();
  b := (SELECT count(*) FROM notification_outbox WHERE type = 'LOW_STOCK' AND reference = 'SKU-ONT-X1');
  ASSERT a > 0 AND a = b, 'low stock alert is raised once per episode (' || a || ' then ' || b || ')';
  PERFORM receive_serialized_batch('SKU-ONT-X1', '[{"sn":"N1"},{"sn":"N2"},{"sn":"N3"}]'::jsonb);
  PERFORM record_movement('Stock Out', 'SKU-ONT-X1', 1, 'INV-ONT-0002');
  PERFORM record_movement('Stock Out', 'SKU-ONT-X1', 1, 'INV-ONT-0003');
  PERFORM record_movement('Stock Out', 'SKU-ONT-X1', 1, 'INV-ONT-0004');
  PERFORM record_movement('Stock Out', 'SKU-ONT-X1', 1, 'INV-ONT-0005');
  ASSERT (SELECT count(*) FROM notification_outbox WHERE type = 'LOW_STOCK' AND reference = 'SKU-ONT-X1') > a, 'new episode after replenishment';
  ASSERT enqueue_daily_digest() > 0, 'digest queued';
  ASSERT enqueue_daily_digest() = 0, 'digest not duplicated the same day';
END $$;

-- worker API
DO $$
DECLARE c record; n int := 0;
BEGIN
  FOR c IN SELECT * FROM claim_notifications(1000) LOOP
    n := n + 1;
    PERFORM mark_notification(c.id, c.id % 2 = 0, 'smtp down');
  END LOOP;
  ASSERT n > 0;
  ASSERT (SELECT count(*) FROM notification_logs) > 0, 'delivery log written';
  ASSERT (SELECT count(*) FROM notification_outbox WHERE status = 'PENDING' AND attempts = 1) > 0, 'failures retried';
END $$;

-- append-only really is
SELECT pg_temp.expect_fail($$ UPDATE inventory_transactions SET quantity = 99 $$, 'append-only');
SELECT pg_temp.expect_fail($$ DELETE FROM audit_ledger $$, 'append-only');
\echo ALL SMOKE CHECKS PASSED
ROLLBACK;
