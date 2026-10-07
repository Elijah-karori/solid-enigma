-- +goose Up
-- Read models behind every screen of the portal: stock summary, low stock, costs, project spend,
-- network tree helpers, customer / hotspot overviews, troubleshooting insights, the daily digest
-- and the per-user "Waiting on you" list. Nothing here stores data: it is all derived.

-- +goose StatementBegin
CREATE FUNCTION has_perm(p_role text, p_perm text) RETURNS boolean
  LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM role_permissions WHERE role = p_role AND permission = p_perm);
$$;
-- +goose StatementEnd

-- ---------------------------------------------------------------------------------------------
-- stock
-- ---------------------------------------------------------------------------------------------
CREATE VIEW v_stock_summary AS
SELECT c.sku,
       c.model,
       c.asset_type,
       c.tracking_type,
       c.project_scope,
       c.is_active,
       coalesce(sum(t.quantity) FILTER (WHERE t.direction = 'Stock In'),  0) AS total_in,
       coalesce(sum(t.quantity) FILTER (WHERE t.direction = 'Stock Out'), 0) AS total_out,
       coalesce(sum(CASE t.direction WHEN 'Stock In' THEN t.quantity ELSE -t.quantity END), 0) AS net_qty,
       reserved_qty(c.sku)                                                   AS reserved_qty,
       coalesce(sum(CASE t.direction WHEN 'Stock In' THEN t.quantity ELSE -t.quantity END), 0) - reserved_qty(c.sku) AS available_qty,
       c.reorder_level,
       -- the alert threshold the sheet used: the item's own level, else the default setting, else 3
       coalesce(nullif(c.reorder_level, 0), get_setting('DEFAULT_REORDER_LEVEL', '3')::int) AS alert_level,
       c.unit_cost,
       greatest(coalesce(sum(CASE t.direction WHEN 'Stock In' THEN t.quantity ELSE -t.quantity END), 0), 0) * c.unit_cost AS stock_value,
       CASE
         WHEN coalesce(sum(CASE t.direction WHEN 'Stock In' THEN t.quantity ELSE -t.quantity END), 0) <= 0 THEN 'Out of Stock'
         WHEN c.reorder_level > 0 AND coalesce(sum(CASE t.direction WHEN 'Stock In' THEN t.quantity ELSE -t.quantity END), 0) <= c.reorder_level THEN 'Low Stock'
         ELSE 'In Stock'
       END AS status
  FROM item_catalog c
  LEFT JOIN inventory_transactions t ON t.sku = c.sku
 GROUP BY c.sku;

CREATE VIEW v_low_stock AS
SELECT s.*
  FROM v_stock_summary s
 WHERE s.is_active AND s.net_qty <= s.alert_level;

-- Stock Out cost per project (project spend is never stored on the project row)
CREATE VIEW v_project_cost AS
SELECT p.project_id,
       p.project_name,
       p.status,
       p.manager_user_id,
       p.budget,
       coalesce(sum(t.total_cost), 0)                       AS spent,
       p.budget - coalesce(sum(t.total_cost), 0)            AS remaining,
       CASE WHEN p.budget > 0 THEN round(coalesce(sum(t.total_cost), 0) / p.budget * 100, 1) END AS pct_used,
       p.budget > 0 AND coalesce(sum(t.total_cost), 0) > p.budget AS over_budget
  FROM projects p
  LEFT JOIN inventory_transactions t ON t.project_id = p.project_id AND t.direction = 'Stock Out'
 GROUP BY p.project_id;

CREATE VIEW v_project_items AS
SELECT t.project_id, t.sku, max(t.item_name) AS model, sum(t.quantity) AS qty, sum(t.total_cost) AS cost
  FROM inventory_transactions t
 WHERE t.direction = 'Stock Out' AND t.project_id IS NOT NULL
 GROUP BY t.project_id, t.sku;

-- ---------------------------------------------------------------------------------------------
-- costs (Admin / Finance dashboard)
-- ---------------------------------------------------------------------------------------------
CREATE VIEW v_cost_summary AS
SELECT (SELECT coalesce(sum(stock_value), 0) FROM v_stock_summary)                                          AS stock_value,
       coalesce(sum(total_cost) FILTER (WHERE direction = 'Stock In'),  0)                                  AS stock_in_spend,
       coalesce(sum(total_cost) FILTER (WHERE direction = 'Stock Out'), 0)                                  AS stock_out_cost,
       coalesce(sum(total_cost) FILTER (WHERE direction = 'Stock Out' AND cost_type ILIKE '%replacement%'), 0) AS replacement_cost
  FROM inventory_transactions;

CREATE VIEW v_cost_by_type AS
SELECT cost_type, sum(quantity) AS qty, sum(total_cost) AS cost
  FROM inventory_transactions WHERE direction = 'Stock Out'
 GROUP BY cost_type ORDER BY cost DESC;

-- "Cost by task / ticket": the most specific reference the movement carries
CREATE VIEW v_cost_by_task AS
SELECT coalesce(task_id, requisition_id, ticket_id, nullif(site_reference, '')) AS ref,
       sum(quantity)  AS qty,
       sum(total_cost) AS cost,
       sum(total_cost) FILTER (WHERE cost_type ILIKE '%replacement%') AS replacement_cost,
       max(transaction_date)::date AS last_use
  FROM inventory_transactions
 WHERE direction = 'Stock Out' AND coalesce(task_id, requisition_id, ticket_id, nullif(site_reference, '')) IS NOT NULL
 GROUP BY 1 ORDER BY cost DESC;

-- ---------------------------------------------------------------------------------------------
-- serialized units with where they sit now (the sheet's customer / account / ticket columns)
-- ---------------------------------------------------------------------------------------------
CREATE VIEW v_serialized_units AS
SELECT s.asset_id, s.sku, s.model, s.asset_type, s.manufacturer, s.mac, s.serial_number, s.product_id,
       s.status, s.condition, s.location, s.custodian, s.custodian_user_id, s.current_project_id, s.notes,
       s.linked_ticket_id,
       i.role                AS installed_as,
       i.customer_id,
       i.hotspot_id,
       coalesce(c.name, 'Hotspot: ' || h.name)  AS installed_at_name,
       coalesce(c.account_no, h.id)             AS installed_at_account,
       i.installed_at,
       (s.mac IS NULL OR s.serial_number IS NULL) AS missing_details,
       s.status = 'Issued / Out'                  AS deployed
  FROM serialized_inventory s
  LEFT JOIN device_installations i ON i.asset_id = s.asset_id AND i.removed_at IS NULL
  LEFT JOIN customers c ON c.id = i.customer_id
  LEFT JOIN hotspots  h ON h.id = i.hotspot_id;

-- ---------------------------------------------------------------------------------------------
-- network
-- ---------------------------------------------------------------------------------------------
CREATE VIEW v_splitters AS
SELECT s.id, s.name, s.ratio, s.port_count, s.status, s.enclosure_id, e.name AS enclosure_name,
       s.pon_port_id, s.uplink_ref, pp.olt_id,
       up.splitter_id AS parent_splitter_id,
       up.port_no     AS parent_port,
       CASE WHEN up.splitter_id IS NULL THEN 'Primary' ELSE 'Secondary' END AS level,
       occ.used_ports,
       s.port_count - occ.used_ports AS free_ports,
       s.notes
  FROM splitters s
  LEFT JOIN enclosures e ON e.id = s.enclosure_id
  LEFT JOIN pon_ports pp ON pp.id = s.pon_port_id
  LEFT JOIN splitter_ports up ON up.child_splitter_id = s.id
  CROSS JOIN LATERAL (
    SELECT count(*) FILTER (WHERE num_nonnulls(p.customer_id, p.hotspot_id, p.child_splitter_id) > 0)::int AS used_ports
      FROM splitter_ports p WHERE p.splitter_id = s.id) occ;

-- One row per port with its occupant: the data behind the OLT -> splitter -> port -> customer tree.
CREATE VIEW v_port_map AS
SELECT p.splitter_id, p.port_no, p.assigned_at,
       CASE WHEN p.customer_id IS NOT NULL THEN 'customer'
            WHEN p.hotspot_id  IS NOT NULL THEN 'hotspot'
            WHEN p.child_splitter_id IS NOT NULL THEN 'splitter'
            ELSE 'free' END                                   AS occupant_kind,
       coalesce(p.customer_id, p.hotspot_id, p.child_splitter_id) AS occupant_id,
       coalesce(c.name, h.name, cs.name)                      AS occupant_name,
       (SELECT count(*) FROM customer_tickets t
         WHERE (t.customer_id = p.customer_id OR t.hotspot_id = p.hotspot_id)
           AND t.ticket_status IN ('Open', 'Assigned', 'In Progress', 'Resolved'))::int AS open_tickets
  FROM splitter_ports p
  LEFT JOIN customers c  ON c.id  = p.customer_id
  LEFT JOIN hotspots  h  ON h.id  = p.hotspot_id
  LEFT JOIN splitters cs ON cs.id = p.child_splitter_id;

-- "OLT 1/PON-1 -> SPL-001 (1:8 @ FAT-01) -> SPL-004 (1:8 @ FAT-02) -> port 3"
-- +goose StatementBegin
CREATE FUNCTION splitter_path(p_splitter text, p_port int DEFAULT NULL) RETURNS text
  LANGUAGE sql STABLE AS $$
  WITH RECURSIVE up(id, depth) AS (
    SELECT p_splitter, 0
    UNION ALL
    SELECT sp.splitter_id, up.depth + 1
      FROM up JOIN splitter_ports sp ON sp.child_splitter_id = up.id
     WHERE up.depth < 12
  ), chain AS (
    SELECT s.id, s.ratio, e.name AS enc, s.pon_port_id, s.uplink_ref, up.depth
      FROM up JOIN splitters s ON s.id = up.id LEFT JOIN enclosures e ON e.id = s.enclosure_id
  )
  SELECT CASE WHEN p_splitter IS NULL THEN '-' ELSE
         coalesce((SELECT CASE WHEN coalesce(pon_port_id, uplink_ref) IS NOT NULL
                               THEN 'OLT ' || coalesce(pon_port_id, uplink_ref) || ' -> ' ELSE '' END
                     FROM chain ORDER BY depth DESC LIMIT 1), '') ||
         coalesce((SELECT string_agg(id || ' (' || ratio || coalesce(' @ ' || enc, '') || ')', ' -> ' ORDER BY depth DESC) FROM chain), p_splitter) ||
         coalesce(' -> port ' || p_port, '') END;
$$;
-- +goose StatementEnd

CREATE VIEW v_customer_overview AS
SELECT c.id, c.name, c.subscription_type, c.account_no, c.status, c.package, c.contact_person, c.phone, c.email,
       c.plot_no, c.location, c.pppoe_username, c.hotspot_id, h.name AS hotspot_name, c.genieacs_device_id, c.install_date,
       i.asset_id        AS onu_asset_id,
       u.serial_number   AS onu_serial,
       u.mac             AS onu_mac,
       sp.splitter_id, sp.port_no AS splitter_port,
       CASE WHEN sp.splitter_id IS NOT NULL THEN splitter_path(sp.splitter_id, sp.port_no) END AS network_path,
       (SELECT count(*) FROM customer_tickets t WHERE t.customer_id = c.id)::int AS tickets_total,
       (SELECT count(*) FROM customer_tickets t WHERE t.customer_id = c.id
           AND t.ticket_status IN ('Open', 'Assigned', 'In Progress', 'Resolved'))::int AS tickets_open,
       (SELECT count(*) FROM customer_tickets t WHERE t.customer_id = c.id
           AND t.date_logged > now() - interval '90 days')::int AS tickets_90d
  FROM customers c
  LEFT JOIN hotspots h ON h.id = c.hotspot_id
  LEFT JOIN device_installations i ON i.customer_id = c.id AND i.role = 'ONU' AND i.removed_at IS NULL
  LEFT JOIN serialized_inventory u ON u.asset_id = i.asset_id
  LEFT JOIN splitter_ports sp ON sp.customer_id = c.id;

CREATE VIEW v_hotspot_overview AS
SELECT h.id, h.name, h.plots, h.location, h.contact_person, h.phone, h.status, h.ssid, h.genieacs_device_id, h.install_date,
       onu.asset_id AS onu_asset_id,
       coalesce(aps.ap_ids, '')           AS ap_asset_ids,
       coalesce(aps.ap_count, 0)::int     AS ap_count,
       sp.splitter_id, sp.port_no AS splitter_port,
       CASE WHEN sp.splitter_id IS NOT NULL THEN splitter_path(sp.splitter_id, sp.port_no) END AS network_path,
       (SELECT count(*) FROM customers c WHERE c.hotspot_id = h.id)::int AS user_count,
       (SELECT count(*) FROM customer_tickets t WHERE t.hotspot_id = h.id)::int AS tickets_total,
       (SELECT count(*) FROM customer_tickets t WHERE t.hotspot_id = h.id
           AND t.ticket_status IN ('Open', 'Assigned', 'In Progress', 'Resolved'))::int AS tickets_open
  FROM hotspots h
  LEFT JOIN device_installations onu ON onu.hotspot_id = h.id AND onu.role = 'ONU' AND onu.removed_at IS NULL
  LEFT JOIN LATERAL (SELECT string_agg(i.asset_id, ', ' ORDER BY i.asset_id) AS ap_ids, count(*) AS ap_count
                       FROM device_installations i WHERE i.hotspot_id = h.id AND i.role = 'AP' AND i.removed_at IS NULL) aps ON true
  LEFT JOIN splitter_ports sp ON sp.hotspot_id = h.id;

-- TR-069 snapshot joined to the unit and to where it is installed. "Online" = informed within N minutes (setting).
CREATE VIEW v_device_status AS
SELECT g.device_id, g.serial_number, g.product_class, g.ip_address, g.last_inform, g.optical_rx_power, g.optical_tx_power,
       g.firmware_version, g.uptime_seconds, g.wifi_ssid,
       (g.last_inform IS NOT NULL AND g.last_inform > now() - make_interval(mins => get_setting('GENIEACS_ONLINE_MINUTES', '15')::int)) AS online,
       s.asset_id, s.model, i.customer_id, i.hotspot_id
  FROM genieacs_devices g
  LEFT JOIN serialized_inventory s ON upper(s.serial_number) = upper(g.serial_number)
  LEFT JOIN device_installations i ON i.asset_id = s.asset_id AND i.removed_at IS NULL;

-- ---------------------------------------------------------------------------------------------
-- troubleshooting & replacement insights
-- ---------------------------------------------------------------------------------------------
-- 3+ different customers / hotspots with tickets in 30 days under one splitter (counting its ancestors):
-- inspect the splitter, enclosure and feeder before replacing customer equipment.
CREATE VIEW v_splitter_fault_clusters AS
WITH RECURSIVE t AS (
  SELECT ct.ticket_id,
         coalesce(ct.customer_id, ct.hotspot_id, ct.customer_name) AS who,
         coalesce((SELECT sp.splitter_id FROM splitter_ports sp WHERE sp.customer_id = ct.customer_id),
                  (SELECT sp.splitter_id FROM splitter_ports sp WHERE sp.hotspot_id  = ct.hotspot_id)) AS splitter_id
    FROM customer_tickets ct
   WHERE ct.date_logged > now() - interval '30 days'
), anc(ticket_id, who, splitter_id, depth) AS (
  SELECT ticket_id, who, splitter_id, 0 FROM t WHERE splitter_id IS NOT NULL
  UNION ALL
  SELECT a.ticket_id, a.who, sp.splitter_id, a.depth + 1
    FROM anc a JOIN splitter_ports sp ON sp.child_splitter_id = a.splitter_id
   WHERE a.depth < 12
)
SELECT a.splitter_id, s.name, s.enclosure_name,
       count(*)::int AS tickets, count(DISTINCT a.who)::int AS affected
  FROM anc a JOIN v_splitters s ON s.id = a.splitter_id
 GROUP BY a.splitter_id, s.name, s.enclosure_name
HAVING count(DISTINCT a.who) >= 3
 ORDER BY tickets DESC;

-- Devices with 2+ tickets in 180 days: replacement candidates.
CREATE VIEW v_repeat_failure_devices AS
SELECT t.device_asset_id AS asset_id, u.model, u.installed_at_name, count(*)::int AS tickets, max(t.date_logged) AS last_ticket
  FROM customer_tickets t JOIN v_serialized_units u ON u.asset_id = t.device_asset_id
 WHERE t.device_asset_id IS NOT NULL AND t.date_logged > now() - interval '180 days'
 GROUP BY t.device_asset_id, u.model, u.installed_at_name
HAVING count(*) >= 2
 ORDER BY tickets DESC;

-- Fault rate by model: tickets per deployed unit.
CREATE VIEW v_model_fault_rate AS
SELECT m.model, m.deployed_units, coalesce(f.tickets, 0)::int AS tickets,
       round(coalesce(f.tickets, 0)::numeric / greatest(m.deployed_units, 1), 2) AS tickets_per_unit
  FROM (SELECT model, count(*)::int AS deployed_units FROM serialized_inventory WHERE status = 'Issued / Out' GROUP BY model) m
  LEFT JOIN (SELECT s.model, count(*) AS tickets FROM customer_tickets t JOIN serialized_inventory s ON s.asset_id = t.device_asset_id GROUP BY s.model) f
         ON f.model = m.model
 WHERE coalesce(f.tickets, 0) > 0
 ORDER BY tickets_per_unit DESC;

-- ---------------------------------------------------------------------------------------------
-- daily digest (sendDailyDigest): one row per line; the mailer groups by audience + section
-- ---------------------------------------------------------------------------------------------
CREATE VIEW v_digest AS
SELECT 'ops'::text AS audience, 'Low stock'::text AS section, 1 AS sort, sku AS ref,
       sku || ' ' || model || ': ' || net_qty || ' left (reorder at ' || reorder_level || ')' AS line
  FROM v_stock_summary WHERE reorder_level > 0 AND net_qty <= reorder_level
UNION ALL SELECT 'ops', 'Requisitions to approve', 2, requisition_id,
       requisition_id || ' ' || technician_name || ': ' || quantity || ' x ' || item_sku || coalesce(' (' || project_id || ')', '')
  FROM technician_requisitions WHERE approval_status = 'Pending Approval'
UNION ALL SELECT 'ops', 'Approved - ready to issue', 3, requisition_id,
       requisition_id || ' ' || technician_name || ': ' || quantity || ' x ' || item_sku || coalesce(' (' || project_id || ')', '')
  FROM technician_requisitions WHERE approval_status = 'Approved - Ready'
UNION ALL SELECT 'ops', 'Awaiting stock (needs a purchase)', 4, requisition_id,
       requisition_id || ' ' || technician_name || ': ' || quantity || ' x ' || item_sku || coalesce(' (' || project_id || ')', '')
  FROM technician_requisitions WHERE approval_status = 'Awaiting Stock'
UNION ALL SELECT 'ops', 'Purchases to order', 5, procurement_id,
       procurement_id || ' ' || quantity || ' x ' || item_sku || coalesce(' from ' || supplier, '')
  FROM procurement_requests WHERE status = 'Approved'
UNION ALL SELECT 'ops', 'Orders awaiting delivery', 6, procurement_id,
       procurement_id || ' ' || quantity || ' x ' || item_sku || coalesce(' from ' || supplier, '')
  FROM procurement_requests WHERE status = 'Ordered'
UNION ALL SELECT 'finance', 'Requisitions awaiting Finance', 1, requisition_id,
       requisition_id || ' ' || technician_name || ': ' || quantity || ' x ' || item_sku || coalesce(' (' || project_id || ')', '')
  FROM technician_requisitions WHERE approval_status = 'Pending Finance'
UNION ALL SELECT 'finance', 'Purchases awaiting Finance', 2, procurement_id,
       procurement_id || ' ' || quantity || ' x ' || item_sku || coalesce(' from ' || supplier, '')
  FROM procurement_requests WHERE status = 'Pending Finance'
UNION ALL SELECT 'finance', 'Receipt notes awaiting payment', 3, doc_no,
       doc_no || ' for ' || reference
  FROM delivery_notes WHERE payment_status = 'Pending';

-- ---------------------------------------------------------------------------------------------
-- "Waiting on you" (pending_ in Code.gs): everything that needs THIS user, driven by role permissions
-- ---------------------------------------------------------------------------------------------
-- +goose StatementBegin
CREATE FUNCTION pending_actions(p_user uuid)
RETURNS TABLE (action_type text, ref text, message text, tab text)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_role text;
  v_name text;
  all_reqs boolean; ops boolean; fin boolean; view_proc boolean; devices boolean;
  pay boolean; all_tickets boolean; fin_proc boolean; recv_proc boolean;
BEGIN
  SELECT role, name INTO v_role, v_name FROM users WHERE id = p_user AND status = 'active';
  IF v_role IS NULL THEN RETURN; END IF;
  all_reqs := has_perm(v_role, 'viewAllReqs');   ops := has_perm(v_role, 'approveReq');
  fin := has_perm(v_role, 'approveFinance');     view_proc := has_perm(v_role, 'viewProcurement');
  devices := has_perm(v_role, 'manageDevices');  pay := has_perm(v_role, 'managePayments');
  all_tickets := has_perm(v_role, 'viewAllTickets');
  fin_proc := has_perm(v_role, 'approveProcurement'); recv_proc := has_perm(v_role, 'receiveProcurement');

  IF devices THEN
    RETURN QUERY SELECT 'details', 'Units',
      count(*) || ' serialized unit(s) have no S/N or MAC recorded - add the details', 'units'
      FROM serialized_inventory WHERE (serial_number IS NULL OR mac IS NULL) AND status <> 'Decommissioned' HAVING count(*) > 0;
  END IF;

  -- requisitions this user is allowed to see: all, or own, or on a project they manage
  RETURN QUERY
  SELECT x.t, (x.r).requisition_id,
         CASE x.t
           WHEN 'approve' THEN (x.r).technician_name || ' requests ' || (x.r).quantity || ' x ' || (x.r).item_sku || coalesce(' for ' || (x.r).project_id, '')
           WHEN 'finance' THEN 'Clear ' || (x.r).quantity || ' x ' || (x.r).item_sku || coalesce(' (' || (x.r).project_id || ')', '') ||
                               CASE WHEN (x.r).est_value > 0 THEN ' - KES ' || (x.r).est_value ELSE '' END
           WHEN 'issue'   THEN 'Issue ' || (x.r).quantity || ' x ' || (x.r).item_sku || ' to ' || (x.r).technician_name
           WHEN 'waiting' THEN 'Approved, short of ' || (x.r).item_sku ||
                               CASE WHEN (x.r).procurement_ref IS NOT NULL THEN ' (purchase ' || (x.r).procurement_ref || ')' ELSE ' - raise a purchase request' END
           ELSE 'Approved - collect ' || (x.r).quantity || ' x ' || (x.r).item_sku || ' from the store'
         END,
         'reqs'
    FROM (
      SELECT r, CASE
               WHEN r.approval_status = 'Pending Approval' AND r.technician_user_id IS DISTINCT FROM p_user
                    AND (ops OR (v_role = 'Project Manager' AND pr.manager_user_id = p_user)) THEN 'approve'
               WHEN r.approval_status = 'Pending Finance' AND fin THEN 'finance'
               WHEN r.approval_status = 'Approved - Ready' AND ops THEN 'issue'
               WHEN r.approval_status = 'Awaiting Stock' AND ops THEN 'waiting'
               WHEN r.approval_status = 'Approved - Ready' AND NOT ops AND r.technician_user_id = p_user THEN 'collect'
             END AS t
        FROM technician_requisitions r LEFT JOIN projects pr ON pr.project_id = r.project_id
       WHERE all_reqs OR r.technician_user_id = p_user OR (v_role = 'Project Manager' AND pr.manager_user_id = p_user)
    ) x WHERE x.t IS NOT NULL;

  IF view_proc THEN
    RETURN QUERY
    SELECT CASE p.status WHEN 'Pending Finance' THEN 'finance' WHEN 'Approved' THEN 'order' ELSE 'receive' END,
           p.procurement_id,
           CASE p.status
             WHEN 'Pending Finance' THEN 'Approve purchase of ' || p.quantity || ' x ' || p.item_sku || CASE WHEN p.est_total > 0 THEN ' (KES ' || p.est_total || ')' ELSE '' END
             WHEN 'Approved' THEN 'Place order: ' || p.quantity || ' x ' || p.item_sku
             ELSE 'Awaiting delivery: ' || p.quantity || ' x ' || p.item_sku || coalesce(' from ' || p.supplier, '') END,
           'procure'
      FROM procurement_requests p LEFT JOIN projects pr ON pr.project_id = p.project_id
     WHERE (v_role <> 'Project Manager' OR p.requested_by_user_id = p_user OR pr.manager_user_id = p_user)
       AND ((p.status = 'Pending Finance' AND fin_proc) OR (p.status IN ('Approved', 'Ordered') AND recv_proc));
  END IF;

  IF pay THEN
    RETURN QUERY SELECT 'pay', d.doc_no, d.type || ' for ' || d.reference || ' - payment pending', 'docs'
      FROM delivery_notes d WHERE d.payment_status = 'Pending';
  END IF;

  IF ops THEN
    RETURN QUERY SELECT 'low', s.sku, s.model || ': ' || s.net_qty || ' left (reorder at ' || s.reorder_level || ')', 'dashboard'
      FROM v_stock_summary s WHERE s.reorder_level > 0 AND s.net_qty <= s.reorder_level;
  END IF;

  IF all_tickets THEN
    RETURN QUERY SELECT CASE WHEN t.ticket_status = 'Open' THEN 'assign' ELSE 'close' END, t.ticket_id,
           t.customer_name || CASE WHEN t.ticket_status = 'Open' THEN ' - ' || t.issue_category || ' needs a technician' ELSE ' resolved - confirm and close' END,
           'tickets'
      FROM customer_tickets t
     WHERE (t.ticket_status = 'Open' AND coalesce(t.assigned_to, '') = '') OR t.ticket_status = 'Resolved';
    RETURN QUERY SELECT 'waiting', k.task_id, k.task_title || ' waiting for ' || k.required_sku, 'tasks'
      FROM technician_tasks k WHERE k.status = 'Awaiting Stock';
  END IF;

  RETURN QUERY SELECT 'task', k.task_id, k.task_title || ' (' || k.status || ')', 'tasks'
    FROM technician_tasks k WHERE k.assignee_user_id = p_user AND k.status IN ('Assigned', 'Ready', 'In Progress');
  RETURN QUERY SELECT 'ticket', t.ticket_id, t.customer_name || ' - ' || t.issue_category, 'tickets'
    FROM customer_tickets t WHERE t.assigned_user_id = p_user AND t.ticket_status IN ('Open', 'Assigned', 'In Progress');
END;
$$;
-- +goose StatementEnd

-- +goose Down
DROP FUNCTION IF EXISTS pending_actions(uuid);
DROP VIEW IF EXISTS v_digest;
DROP VIEW IF EXISTS v_model_fault_rate;
DROP VIEW IF EXISTS v_repeat_failure_devices;
DROP VIEW IF EXISTS v_splitter_fault_clusters;
DROP VIEW IF EXISTS v_device_status;
DROP VIEW IF EXISTS v_hotspot_overview;
DROP VIEW IF EXISTS v_customer_overview;
DROP FUNCTION IF EXISTS splitter_path(text, int);
DROP VIEW IF EXISTS v_port_map;
DROP VIEW IF EXISTS v_splitters;
DROP VIEW IF EXISTS v_serialized_units;
DROP VIEW IF EXISTS v_cost_by_task;
DROP VIEW IF EXISTS v_cost_by_type;
DROP VIEW IF EXISTS v_cost_summary;
DROP VIEW IF EXISTS v_project_items;
DROP VIEW IF EXISTS v_project_cost;
DROP VIEW IF EXISTS v_low_stock;
DROP VIEW IF EXISTS v_stock_summary;
DROP FUNCTION IF EXISTS has_perm(text, text);
