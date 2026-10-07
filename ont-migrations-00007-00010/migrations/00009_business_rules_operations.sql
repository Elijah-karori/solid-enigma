-- +goose Up
-- Business rules from Code.gs that were still application-only: the actor context, finance routing,
-- stock availability routing, self-approval bans, project-manager scoping, ledger rules, port assignment,
-- and the multi-step operations (issue, receive, serialized batch, tickets with linked tasks, notes, payments).
--
-- Every function reads who is acting from  SET LOCAL app.actor_email / app.actor_role  (the Go API sets both
-- at the start of each request transaction). When they are not set (psql, maintenance) the actor checks are
-- skipped but the data rules still apply. app.import_mode = 'on' skips the business-rule triggers (workbook import).

-- +goose StatementBegin
CREATE FUNCTION is_import() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.import_mode', true), '') = 'on';
$$;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE FUNCTION actor_email() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(lower(current_setting('app.actor_email', true)), '');
$$;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE FUNCTION actor_role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.actor_role', true), '');
$$;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE FUNCTION actor_user_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM users WHERE lower(email) = actor_email();
$$;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE FUNCTION actor_name() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT name FROM users WHERE lower(email) = actor_email();
$$;
-- +goose StatementEnd

-- Make the functions below usable by a caller that only passes a user id.
-- +goose StatementBegin
CREATE FUNCTION use_actor(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE e text; r text;
BEGIN
  IF p_user IS NULL THEN RETURN; END IF;
  SELECT email, role INTO e, r FROM users WHERE id = p_user;
  IF e IS NULL THEN RAISE EXCEPTION 'Unknown user %', p_user; END IF;
  PERFORM set_config('app.actor_email', e, true);
  PERFORM set_config('app.actor_role',  r, true);
END;
$$;
-- +goose StatementEnd

-- Is the signed-in user the person named on a record (by user id, else by name / email as typed)?
-- +goose StatementBegin
CREATE FUNCTION requester_is_actor(p_user uuid, p_name text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT actor_email() IS NOT NULL AND (
         p_user IS NOT DISTINCT FROM actor_user_id() AND p_user IS NOT NULL
      OR lower(btrim(coalesce(p_name, ''))) IN (lower(coalesce(actor_name(), '')), actor_email()));
$$;
-- +goose StatementEnd

-- Receiving a NEW unit: its Stock In is the first ledger row for that asset, so 'already In Stock' only applies
-- once the unit has a history (00006 refused every Stock In of an In Stock unit).
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION ledger_before_insert() RETURNS trigger AS $$
DECLARE
  u serialized_inventory%ROWTYPE;
  u_cost numeric;
BEGIN
  IF NEW.unit_cost = 0 AND NEW.cost_type <> 'Adjustment' THEN
    SELECT unit_cost INTO u_cost FROM item_catalog WHERE sku = NEW.sku;   -- the VLOOKUP the sheet used
    NEW.unit_cost := coalesce(u_cost, 0);
  END IF;
  IF coalesce(current_setting('app.import_mode', true), '') = 'on' THEN RETURN NEW; END IF;

  PERFORM pg_advisory_xact_lock(hashtext('stock:' || NEW.sku));

  IF NEW.asset_id IS NOT NULL THEN
    SELECT * INTO u FROM serialized_inventory WHERE asset_id = NEW.asset_id FOR UPDATE;
    IF u.sku <> NEW.sku THEN
      RAISE EXCEPTION 'Unit % is a % unit, not %', NEW.asset_id, u.sku, NEW.sku USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.direction = 'Stock Out' AND u.status <> 'In Stock' THEN
      RAISE EXCEPTION '% is "%", not In Stock', NEW.asset_id, u.status USING ERRCODE = 'check_violation';
    END IF;
    -- a unit's FIRST movement is its receipt into the store (the unit record is created just before it)
    IF NEW.direction = 'Stock In' AND u.status = 'In Stock'
       AND EXISTS (SELECT 1 FROM inventory_transactions WHERE asset_id = NEW.asset_id) THEN
      RAISE EXCEPTION '% is already In Stock', NEW.asset_id USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.direction = 'Stock Out' AND stock_balance(NEW.sku) < NEW.quantity THEN
    RAISE EXCEPTION 'Not enough % in stock (have %, need %)', NEW.sku, stock_balance(NEW.sku), NEW.quantity
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- ---- a Project Manager approves requests for projects they manage -------------------------------
INSERT INTO permissions (code, description) VALUES
  ('approveProjectReq', 'Operations-stage approval of requisitions for projects the user manages');
INSERT INTO role_permissions (role, permission) VALUES
  ('Admin', 'approveProjectReq'), ('Store Manager', 'approveProjectReq'), ('Project Manager', 'approveProjectReq');
UPDATE workflow_transitions SET required_permission = 'approveProjectReq',
       guard = guard || CASE WHEN guard = '' THEN '' ELSE '; ' END || 'Project Managers: only for projects they manage'
 WHERE workflow = 'requisition' AND from_state = 'Pending Approval' AND to_state IN ('Pending Finance', 'Approved - Ready', 'Awaiting Stock', 'Rejected');

-- ---------------------------------------------------------------------------------------------
-- finance routing (financeNeeded_): value at / above the threshold, or the project would go over budget
-- ---------------------------------------------------------------------------------------------
-- +goose StatementBegin
CREATE FUNCTION finance_needed(p_est numeric, p_project text) RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE
  th numeric := get_setting('FINANCE_APPROVAL_THRESHOLD', '50000')::numeric;
  b numeric; spent numeric;
BEGIN
  IF p_est > 0 AND p_est >= th THEN
    RETURN 'value KES ' || p_est || ' is at or above the KES ' || th || ' approval threshold';
  END IF;
  IF p_project IS NOT NULL THEN
    SELECT budget, spent INTO b, spent FROM v_project_cost WHERE project_id = p_project;
    IF b > 0 AND spent + p_est > b THEN RETURN 'it would take ' || p_project || ' over its budget'; END IF;
  END IF;
  RETURN '';
END;
$$;
-- +goose StatementEnd

-- ---------------------------------------------------------------------------------------------
-- requisition rules
-- ---------------------------------------------------------------------------------------------
-- +goose StatementBegin
CREATE FUNCTION reqs_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_role text := actor_role();
  me     uuid := actor_user_id();
  mgr    uuid;
  own    boolean;
  why    text;
BEGIN
  IF is_import() THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.project_id IS NOT NULL AND v_role = 'Project Manager' THEN
      SELECT manager_user_id INTO mgr FROM projects WHERE project_id = NEW.project_id;
      IF mgr IS DISTINCT FROM me THEN
        RAISE EXCEPTION 'You can only request material for projects you manage.' USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.approval_status = OLD.approval_status THEN RETURN NEW; END IF;
  own := requester_is_actor(NEW.technician_user_id, NEW.technician_name);

  IF NEW.approval_status = 'Cancelled' THEN          -- withdraw
    IF actor_email() IS NOT NULL AND NOT own THEN
      RAISE EXCEPTION 'Only the requester can cancel.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.approval_status IN ('Pending Approval', 'Pending Finance') AND own AND v_role IS DISTINCT FROM 'Admin' THEN
    RAISE EXCEPTION 'You cannot approve your own requisition.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF OLD.approval_status = 'Pending Approval' THEN   -- stage 1: operations / the project's manager
    IF v_role IS NOT NULL AND NOT has_perm(v_role, 'approveReq') THEN
      SELECT manager_user_id INTO mgr FROM projects WHERE project_id = NEW.project_id;
      IF NEW.project_id IS NULL OR mgr IS DISTINCT FROM me THEN
        RAISE EXCEPTION 'You cannot approve at this stage.' USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
    NEW.approved_by := coalesce(actor_name(), NEW.approved_by);
    NEW.action_date := now();
    IF NEW.approval_status IN ('Pending Finance', 'Approved - Ready', 'Awaiting Stock') THEN
      why := finance_needed(NEW.est_value, NEW.project_id);
      IF why <> '' THEN
        NEW.approval_status := 'Pending Finance';    -- routed automatically, whatever the caller asked for
      ELSIF NEW.approval_status = 'Pending Finance' THEN
        RAISE EXCEPTION 'Finance clearance is not required for this requisition.' USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.approval_status = 'Pending Finance' THEN NEW.finance_status := 'Pending'; END IF;
    END IF;
  ELSIF OLD.approval_status = 'Pending Finance' THEN  -- stage 2: Finance
    NEW.finance_by := coalesce(actor_name(), NEW.finance_by);
    NEW.finance_status := CASE WHEN NEW.approval_status = 'Rejected' THEN 'Rejected' ELSE 'Approved' END;
    NEW.action_date := now();
  END IF;

  -- ready or short? decided by stock after other reservations (decideRequisition)
  IF NEW.approval_status IN ('Approved - Ready', 'Awaiting Stock') AND OLD.approval_status IN ('Pending Approval', 'Pending Finance') THEN
    NEW.approval_status := CASE WHEN available_qty(NEW.item_sku, NEW.requisition_id) >= NEW.quantity
                                THEN 'Approved - Ready' ELSE 'Awaiting Stock' END;
  END IF;

  IF NEW.approval_status = 'Issued' THEN
    NEW.issued_by := coalesce(NEW.issued_by, actor_name(), 'system');
    NEW.action_date := now();
  END IF;
  RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER t2_reqs_zrules BEFORE INSERT OR UPDATE ON technician_requisitions
  FOR EACH ROW EXECUTE FUNCTION reqs_rules();

-- "Issued" must be backed by the stock leaving the ledger.
-- +goose StatementBegin
CREATE FUNCTION reqs_issue_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n numeric;
BEGIN
  IF is_import() THEN RETURN NEW; END IF;
  IF NEW.approval_status = 'Issued' AND OLD.approval_status <> 'Issued' THEN
    SELECT coalesce(sum(quantity), 0) INTO n FROM inventory_transactions
     WHERE requisition_id = NEW.requisition_id AND direction = 'Stock Out';
    IF n <> NEW.quantity THEN
      RAISE EXCEPTION '% has not been issued from stock (ledger shows % of %). Use issue_requisition().', NEW.requisition_id, n, NEW.quantity
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER t4_reqs_issue_ledger BEFORE UPDATE OF approval_status ON technician_requisitions
  FOR EACH ROW EXECUTE FUNCTION reqs_issue_ledger();

-- ---------------------------------------------------------------------------------------------
-- purchase request rules
-- ---------------------------------------------------------------------------------------------
-- +goose StatementBegin
CREATE FUNCTION proc_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE own boolean; mgr uuid;
BEGIN
  IF is_import() THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.project_id IS NOT NULL AND actor_role() = 'Project Manager' THEN
      SELECT manager_user_id INTO mgr FROM projects WHERE project_id = NEW.project_id;
      IF mgr IS DISTINCT FROM actor_user_id() THEN
        RAISE EXCEPTION 'You can only raise purchases for projects you manage.' USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  own := requester_is_actor(NEW.requested_by_user_id, NEW.requested_by);

  IF OLD.status = 'Pending Finance' AND NEW.status IN ('Approved', 'Rejected') THEN
    IF own AND actor_role() IS DISTINCT FROM 'Admin' THEN
      RAISE EXCEPTION 'You cannot approve your own purchase request.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.finance_by := coalesce(actor_name(), NEW.finance_by);
    NEW.finance_date := now();
  ELSIF NEW.status = 'Cancelled' THEN
    IF actor_email() IS NOT NULL AND NOT own AND actor_role() IS DISTINCT FROM 'Admin' THEN
      RAISE EXCEPTION 'Only the requester can cancel.' USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF NEW.status = 'Ordered' THEN
    IF coalesce(btrim(NEW.supplier), '') = '' THEN
      RAISE EXCEPTION 'Supplier is required.' USING ERRCODE = 'check_violation';
    END IF;
    NEW.ordered_date := coalesce(NEW.ordered_date, current_date);
  ELSIF NEW.status = 'Received' THEN
    IF NOT EXISTS (SELECT 1 FROM inventory_transactions WHERE procurement_id = NEW.procurement_id AND direction = 'Stock In') THEN
      RAISE EXCEPTION 'Receiving posts a Stock In. Use receive_procurement().' USING ERRCODE = 'check_violation';
    END IF;
    NEW.received_date := coalesce(NEW.received_date, current_date);
    NEW.received_quantity := coalesce(NEW.received_quantity, NEW.quantity);
  END IF;
  RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER t2_proc_zrules BEFORE INSERT OR UPDATE ON procurement_requests
  FOR EACH ROW EXECUTE FUNCTION proc_rules();

-- ---------------------------------------------------------------------------------------------
-- task / ticket ownership
-- ---------------------------------------------------------------------------------------------
-- +goose StatementBegin
CREATE FUNCTION tasks_actor_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF is_import() OR actor_email() IS NULL OR NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NEW.status IN ('In Progress', 'Completed') AND NOT has_perm(actor_role(), 'createTask')
     AND NOT requester_is_actor(NEW.assignee_user_id, NEW.assigned_to) THEN
    RAISE EXCEPTION 'You can only update tasks assigned to you.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER t2_tasks_zactor BEFORE UPDATE ON technician_tasks FOR EACH ROW EXECUTE FUNCTION tasks_actor_guard();

-- +goose StatementBegin
CREATE FUNCTION tickets_actor_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF is_import() THEN RETURN NEW; END IF;
  IF OLD.ticket_status = 'Closed' THEN
    RAISE EXCEPTION 'Ticket is closed.' USING ERRCODE = 'check_violation';
  END IF;
  IF actor_email() IS NOT NULL AND NOT has_perm(actor_role(), 'viewAllTickets') THEN
    IF NOT requester_is_actor(OLD.assigned_user_id, OLD.assigned_to) THEN
      RAISE EXCEPTION 'You can only update tickets assigned to you.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
      RAISE EXCEPTION 'Only support staff can reassign a ticket.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.ticket_status IS DISTINCT FROM OLD.ticket_status AND NEW.ticket_status NOT IN ('In Progress', 'Resolved') THEN
      RAISE EXCEPTION 'Technicians can set In Progress or Resolved.' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER t2_tickets_zactor BEFORE UPDATE ON customer_tickets FOR EACH ROW EXECUTE FUNCTION tickets_actor_guard();

-- ---------------------------------------------------------------------------------------------
-- ledger rules (submitTransaction_)
-- ---------------------------------------------------------------------------------------------
-- +goose StatementBegin
CREATE FUNCTION ledger_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE trk text; scope text;
BEGIN
  IF is_import() THEN RETURN NEW; END IF;
  SELECT tracking_type, project_scope INTO trk, scope FROM item_catalog WHERE sku = NEW.sku;
  IF trk = 'SERIALIZED' AND NEW.asset_id IS NULL AND NEW.cost_type <> 'Adjustment' THEN
    IF NEW.direction = 'Stock Out' THEN
      RAISE EXCEPTION 'This is a serialized SKU. Choose the exact unit to issue.' USING ERRCODE = 'check_violation';
    END IF;
    RAISE EXCEPTION 'Serialized items need their S/N and MAC. Use the serialized stock-in.' USING ERRCODE = 'check_violation';
  END IF;
  IF trk <> 'SERIALIZED' AND NEW.asset_id IS NOT NULL THEN
    RAISE EXCEPTION 'Unit ids are only valid for serialized items.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.direction = 'Stock Out' AND scope IS NOT NULL AND NEW.project_id IS DISTINCT FROM scope THEN
    RAISE EXCEPTION 'Item % is dedicated to project %. Select that project.', NEW.sku, scope USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER t2_ledger_rules BEFORE INSERT ON inventory_transactions FOR EACH ROW EXECUTE FUNCTION ledger_rules();

-- ---------------------------------------------------------------------------------------------
-- splitter ports: who may occupy one, and a single call to assign / release
-- ---------------------------------------------------------------------------------------------
-- +goose StatementBegin
CREATE FUNCTION splitter_ports_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sub text; st text;
BEGIN
  IF num_nonnulls(NEW.customer_id, NEW.hotspot_id, NEW.child_splitter_id) = 0 THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.customer_id IS NOT DISTINCT FROM OLD.customer_id
     AND NEW.hotspot_id IS NOT DISTINCT FROM OLD.hotspot_id
     AND NEW.child_splitter_id IS NOT DISTINCT FROM OLD.child_splitter_id THEN RETURN NEW; END IF;
  SELECT status INTO st FROM splitters WHERE id = NEW.splitter_id;
  IF st = 'Decommissioned' THEN
    RAISE EXCEPTION 'Splitter % is decommissioned', NEW.splitter_id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.customer_id IS NOT NULL THEN
    SELECT subscription_type INTO sub FROM customers WHERE id = NEW.customer_id;
    IF sub IS DISTINCT FROM 'PPPoE' THEN
      RAISE EXCEPTION 'Hotspot users reach the network through their hotspot, not a splitter port' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER t2_splitter_ports_rules BEFORE INSERT OR UPDATE ON splitter_ports
  FOR EACH ROW EXECUTE FUNCTION splitter_ports_rules();

-- p_kind: 'customer' | 'hotspot' | 'splitter'. Moves the occupant if it already used another port.
-- +goose StatementBegin
CREATE FUNCTION assign_port(p_splitter text, p_port int, p_kind text, p_id text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE cap int; cur splitter_ports%ROWTYPE; occ text;
BEGIN
  IF p_kind NOT IN ('customer', 'hotspot', 'splitter') THEN RAISE EXCEPTION 'kind must be customer, hotspot or splitter'; END IF;
  SELECT port_count INTO cap FROM splitters WHERE id = p_splitter;
  IF cap IS NULL THEN RAISE EXCEPTION 'Unknown splitter %', p_splitter; END IF;
  IF p_port IS NULL OR p_port < 1 OR p_port > cap THEN
    RAISE EXCEPTION 'Port must be a whole number from 1 to % on % (%)', cap, p_splitter, (SELECT ratio FROM splitters WHERE id = p_splitter)
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO cur FROM splitter_ports WHERE splitter_id = p_splitter AND port_no = p_port FOR UPDATE;
  occ := coalesce(cur.customer_id, cur.hotspot_id, cur.child_splitter_id);
  IF occ IS NOT NULL AND occ <> p_id THEN
    RAISE EXCEPTION 'Port % on % is already used by %', p_port, p_splitter, occ USING ERRCODE = 'check_violation';
  END IF;
  IF p_kind = 'customer' THEN
    UPDATE splitter_ports SET customer_id = NULL WHERE customer_id = p_id AND NOT (splitter_id = p_splitter AND port_no = p_port);
    UPDATE splitter_ports SET customer_id = p_id WHERE splitter_id = p_splitter AND port_no = p_port;
  ELSIF p_kind = 'hotspot' THEN
    UPDATE splitter_ports SET hotspot_id = NULL WHERE hotspot_id = p_id AND NOT (splitter_id = p_splitter AND port_no = p_port);
    UPDATE splitter_ports SET hotspot_id = p_id WHERE splitter_id = p_splitter AND port_no = p_port;
  ELSE
    UPDATE splitter_ports SET child_splitter_id = NULL WHERE child_splitter_id = p_id AND NOT (splitter_id = p_splitter AND port_no = p_port);
    UPDATE splitter_ports SET child_splitter_id = p_id WHERE splitter_id = p_splitter AND port_no = p_port;
  END IF;
END;
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION release_port(p_kind text, p_id text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_kind = 'customer' THEN UPDATE splitter_ports SET customer_id = NULL WHERE customer_id = p_id;
  ELSIF p_kind = 'hotspot' THEN UPDATE splitter_ports SET hotspot_id = NULL WHERE hotspot_id = p_id;
  ELSIF p_kind = 'splitter' THEN UPDATE splitter_ports SET child_splitter_id = NULL WHERE child_splitter_id = p_id;
  ELSE RAISE EXCEPTION 'kind must be customer, hotspot or splitter'; END IF;
END;
$$;
-- +goose StatementEnd

-- ---------------------------------------------------------------------------------------------
-- operations
-- ---------------------------------------------------------------------------------------------
-- General stock movement (Record Movement screen). For a serialized unit pass p_asset (the SKU comes from the unit).
-- +goose StatementBegin
CREATE FUNCTION record_movement(
  p_direction text, p_sku text, p_qty numeric DEFAULT 1, p_asset text DEFAULT NULL, p_cost_type text DEFAULT NULL,
  p_project text DEFAULT NULL, p_task text DEFAULT NULL, p_site text DEFAULT NULL, p_notes text DEFAULT NULL,
  p_user uuid DEFAULT NULL, p_date timestamptz DEFAULT now()
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_sku text := upper(btrim(p_sku)); v_model text; v_id uuid; v_who text;
BEGIN
  PERFORM use_actor(p_user);
  IF p_asset IS NOT NULL THEN
    SELECT sku INTO v_sku FROM serialized_inventory WHERE asset_id = upper(btrim(p_asset));
    IF v_sku IS NULL THEN RAISE EXCEPTION 'Select a valid serialized unit / asset.'; END IF;
    p_qty := 1;
  END IF;
  SELECT model INTO v_model FROM item_catalog WHERE sku = v_sku;
  IF v_model IS NULL THEN RAISE EXCEPTION 'Unknown item SKU %', v_sku; END IF;
  v_who := coalesce(actor_name(), 'system');
  INSERT INTO inventory_transactions (transaction_date, direction, sku, item_name, quantity, requested_by, role, site_reference, cost_type,
                                      asset_id, project_id, task_id, notes)
  VALUES (p_date, p_direction, v_sku, v_model, p_qty, v_who, actor_role(), coalesce(p_site, p_project),
          coalesce(p_cost_type, CASE WHEN p_direction = 'Stock In' THEN 'Procurement / Stock In' ELSE 'Other' END),
          upper(btrim(p_asset)), p_project, p_task, p_notes)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
-- +goose StatementEnd

-- Hand the stock to the technician: posts the Stock Out(s) (project cost, unit status and balances follow) and marks Issued.
-- +goose StatementBegin
CREATE FUNCTION issue_requisition(p_req text, p_assets text[] DEFAULT '{}', p_user uuid DEFAULT NULL) RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  r technician_requisitions%ROWTYPE; c item_catalog%ROWTYPE;
  a text; n int := 0; v_cost text; v_task text; v_ticket text; v_site text;
BEGIN
  PERFORM use_actor(p_user);
  IF actor_role() IS NOT NULL AND NOT has_perm(actor_role(), 'approveReq') THEN
    RAISE EXCEPTION 'You do not have permission to issue stock.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO r FROM technician_requisitions WHERE requisition_id = upper(btrim(p_req)) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Requisition % not found', p_req; END IF;
  IF r.approval_status <> 'Approved - Ready' THEN
    RAISE EXCEPTION '% is not ready to issue (status: %)', r.requisition_id, r.approval_status USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO c FROM item_catalog WHERE sku = r.item_sku;
  IF c.project_scope IS NOT NULL AND r.project_id IS DISTINCT FROM c.project_scope THEN
    RAISE EXCEPTION 'Item % is dedicated to project %. Select that project.', r.item_sku, c.project_scope USING ERRCODE = 'check_violation';
  END IF;
  v_cost := CASE WHEN coalesce(r.reason, '') ~* 'replac' THEN 'Replacement' ELSE 'Installation' END;
  v_task := coalesce(r.task_id, (SELECT task_id FROM technician_tasks
                                  WHERE task_id = upper((regexp_match(coalesce(r.reason, ''), '(TASK-[0-9]+)', 'i'))[1])));
  v_ticket := coalesce(r.ticket_id, (SELECT ticket_id FROM customer_tickets
                                  WHERE ticket_id = upper((regexp_match(coalesce(r.reason, ''), '(TKT-[0-9]+)', 'i'))[1])));
  v_site := coalesce(r.project_id, v_task, v_ticket, r.requisition_id);

  IF c.tracking_type = 'SERIALIZED' THEN
    IF coalesce(array_length(p_assets, 1), 0) <> r.quantity THEN
      RAISE EXCEPTION 'Select exactly % unit(s) to issue.', r.quantity USING ERRCODE = 'check_violation';
    END IF;
    FOREACH a IN ARRAY p_assets LOOP
      a := upper(btrim(a));
      INSERT INTO requisition_units (requisition_id, asset_id) VALUES (r.requisition_id, a);
      INSERT INTO inventory_transactions (direction, sku, item_name, quantity, requested_by, role, site_reference, cost_type,
                                          asset_id, project_id, task_id, requisition_id, ticket_id, notes)
      VALUES ('Stock Out', r.item_sku, c.model, 1, r.technician_name, 'Technician', v_site, v_cost,
              a, r.project_id, v_task, r.requisition_id, v_ticket, 'Requisition ' || r.requisition_id || ' | ' || v_cost);
      n := n + 1;
    END LOOP;
  ELSE
    INSERT INTO inventory_transactions (direction, sku, item_name, quantity, requested_by, role, site_reference, cost_type,
                                        project_id, task_id, requisition_id, ticket_id, notes)
    VALUES ('Stock Out', r.item_sku, c.model, r.quantity, r.technician_name, 'Technician', v_site, v_cost,
            r.project_id, v_task, r.requisition_id, v_ticket, 'Requisition ' || r.requisition_id || ' | ' || v_cost);
    n := 1;
  END IF;
  UPDATE technician_requisitions SET approval_status = 'Issued' WHERE requisition_id = r.requisition_id;
  RETURN n;
END;
$$;
-- +goose StatementEnd

-- Goods arrived: posts the Stock In. Serialized items get placeholder unit records ("Awaiting S/N & MAC")
-- that are completed afterwards. Releases requisitions / tasks waiting for the SKU (ledger trigger).
-- +goose StatementBegin
CREATE FUNCTION receive_procurement(p_id text, p_user uuid DEFAULT NULL) RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  p procurement_requests%ROWTYPE; c item_catalog%ROWTYPE; i int; v_asset text; v_note text; v_who text;
BEGIN
  PERFORM use_actor(p_user);
  IF actor_role() IS NOT NULL AND NOT has_perm(actor_role(), 'receiveProcurement') THEN
    RAISE EXCEPTION 'You do not have permission to receive stock.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO p FROM procurement_requests WHERE procurement_id = upper(btrim(p_id)) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase request % not found', p_id; END IF;
  IF p.status <> 'Ordered' THEN RAISE EXCEPTION '% has not been ordered yet (status: %)', p.procurement_id, p.status USING ERRCODE = 'check_violation'; END IF;
  SELECT * INTO c FROM item_catalog WHERE sku = p.item_sku;
  v_who := coalesce(actor_name(), 'system');
  v_note := 'Procurement ' || p.procurement_id || coalesce(' | PO ' || p.po_ref, '');

  IF c.tracking_type = 'SERIALIZED' THEN
    IF p.quantity > 200 THEN RAISE EXCEPTION 'Receive at most 200 units at a time.' USING ERRCODE = 'check_violation'; END IF;
    FOR i IN 1..p.quantity LOOP
      INSERT INTO serialized_inventory (asset_id, sku, asset_type, manufacturer, model, access_tech, status, condition, location, notes)
      VALUES ('', p.item_sku, c.asset_type, c.manufacturer, c.model, c.access_tech, 'In Stock', 'New', 'Main Store',
              'Received: ' || current_date || ' | Ref: ' || v_note || ' | Logged By: ' || v_who || ' | Awaiting S/N & MAC')
      RETURNING asset_id INTO v_asset;
      INSERT INTO inventory_transactions (direction, sku, item_name, quantity, requested_by, role, site_reference, cost_type, asset_id, project_id, procurement_id, notes)
      VALUES ('Stock In', p.item_sku, c.model, 1, v_who, actor_role(), 'Procurement ' || p.procurement_id, 'Procurement / Stock In', v_asset, p.project_id, p.procurement_id, v_note);
    END LOOP;
  ELSE
    INSERT INTO inventory_transactions (direction, sku, item_name, quantity, requested_by, role, site_reference, cost_type, project_id, procurement_id, notes)
    VALUES ('Stock In', p.item_sku, c.model, p.quantity, v_who, actor_role(), 'Procurement ' || p.procurement_id, 'Procurement / Stock In', p.project_id, p.procurement_id, v_note);
  END IF;
  UPDATE procurement_requests SET status = 'Received' WHERE procurement_id = p.procurement_id;
  RETURN p.quantity;
END;
$$;
-- +goose StatementEnd

-- Serialized stock in by model: one unit record per S/N + MAC pair.
-- p_units = [{"sn":"...","mac":"AA:BB:...","productId":"...","condition":"New","remarks":"..."}, ...]
-- +goose StatementBegin
CREATE FUNCTION receive_serialized_batch(p_sku text, p_units jsonb, p_site text DEFAULT 'Main Store', p_notes text DEFAULT NULL, p_user uuid DEFAULT NULL)
RETURNS text[] LANGUAGE plpgsql AS $$
DECLARE
  v_sku text := upper(btrim(p_sku)); c item_catalog%ROWTYPE; x jsonb; n int := 0; total int;
  v_sn text; v_mac text; cond text; dup text; v_asset text; v_who text; ids text[] := '{}';
  seen_sn text[] := '{}'; seen_mac text[] := '{}';
BEGIN
  PERFORM use_actor(p_user);
  IF actor_role() IS NOT NULL AND NOT has_perm(actor_role(), 'moveStock') THEN
    RAISE EXCEPTION 'You do not have permission to record stock movements.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO c FROM item_catalog WHERE sku = v_sku;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown SKU %', v_sku; END IF;
  IF c.tracking_type <> 'SERIALIZED' THEN RAISE EXCEPTION 'Pick a serialized model (ONT, router, enterprise router or FAT box).'; END IF;
  total := coalesce(jsonb_array_length(p_units), 0);
  IF total = 0 THEN RAISE EXCEPTION 'Add at least one unit.'; END IF;
  IF total > 200 THEN RAISE EXCEPTION 'Receive at most 200 units at a time.'; END IF;
  v_who := coalesce(actor_name(), 'system');

  FOR x IN SELECT value FROM jsonb_array_elements(p_units) LOOP
    n := n + 1;
    v_sn  := nullif(upper(regexp_replace(coalesce(x ->> 'sn', ''), '\s+', '', 'g')), '');
    v_mac := nullif(upper(regexp_replace(coalesce(x ->> 'mac', ''), '[:.\-\s]', '', 'g')), '');
    IF v_sn IS NULL AND v_mac IS NULL THEN RAISE EXCEPTION 'Row %: enter a serial number or a MAC.', n; END IF;
    IF v_mac IS NOT NULL AND v_mac !~ '^[0-9A-F]{12}$' THEN
      RAISE EXCEPTION 'Row %: "%" is not a valid MAC (needs 12 hex characters).', n, x ->> 'mac';
    END IF;
    IF v_sn IS NOT NULL THEN
      IF v_sn = ANY (seen_sn) THEN RAISE EXCEPTION 'Row %: S/N % appears twice in this list.', n, v_sn; END IF;
      SELECT s.asset_id INTO dup FROM serialized_inventory s WHERE s.serial_number = v_sn;
      IF dup IS NOT NULL THEN RAISE EXCEPTION 'Row %: S/N % already exists as %.', n, v_sn, dup; END IF;
      seen_sn := seen_sn || v_sn;
    END IF;
    IF v_mac IS NOT NULL THEN
      IF v_mac = ANY (seen_mac) THEN RAISE EXCEPTION 'Row %: MAC % appears twice in this list.', n, v_mac; END IF;
      SELECT s.asset_id INTO dup FROM serialized_inventory s WHERE s.mac = v_mac;
      IF dup IS NOT NULL THEN RAISE EXCEPTION 'Row %: MAC % already exists as %.', n, v_mac, dup; END IF;
      seen_mac := seen_mac || v_mac;
    END IF;
    cond := coalesce(nullif(x ->> 'condition', ''), 'New');

    INSERT INTO serialized_inventory (asset_id, sku, asset_type, manufacturer, model, access_tech, product_id, mac, serial_number,
                                      status, condition, location, notes)
    VALUES ('', v_sku, c.asset_type, c.manufacturer, c.model, c.access_tech, nullif(x ->> 'productId', ''), v_mac, v_sn,
            'In Stock', cond, coalesce(nullif(p_site, ''), 'Main Store'),
            'Received: ' || current_date || ' | Ref: ' || coalesce(nullif(p_notes, ''), p_site, 'Main Store') || ' | Logged By: ' || v_who ||
            coalesce(' | ' || nullif(x ->> 'remarks', ''), ''))
    RETURNING asset_id INTO v_asset;
    INSERT INTO inventory_transactions (direction, sku, item_name, quantity, requested_by, role, site_reference, cost_type, asset_id, notes)
    VALUES ('Stock In', v_sku, c.model, 1, v_who, actor_role(), coalesce(nullif(p_site, ''), 'Main Store'), 'Procurement / Stock In', v_asset,
            'Serialized batch' || coalesce(' | ' || nullif(p_notes, ''), ''));
    ids := ids || v_asset;
  END LOOP;
  RETURN ids;
END;
$$;
-- +goose StatementEnd

-- Put a unit at a customer (ONU) or hotspot (ONU / AP). The guard triggers enforce: unit has left the store,
-- one place per unit, no ONU twice, no ONU for hotspot users.
-- +goose StatementBegin
CREATE FUNCTION install_device(p_asset text, p_role text, p_customer text DEFAULT NULL, p_hotspot text DEFAULT NULL,
                               p_ticket text DEFAULT NULL, p_notes text DEFAULT NULL, p_user uuid DEFAULT NULL) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_id bigint; v_loc text; v_name text;
BEGIN
  PERFORM use_actor(p_user);
  IF actor_role() IS NOT NULL AND NOT has_perm(actor_role(), 'manageNetwork') THEN
    RAISE EXCEPTION 'You do not have permission to edit install details.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO device_installations (asset_id, role, customer_id, hotspot_id, uplink_medium, installed_by_user_id, ticket_id, notes)
  VALUES (upper(btrim(p_asset)), p_role, p_customer, p_hotspot, CASE p_role WHEN 'ONU' THEN 'Fibre' ELSE 'Ethernet' END,
          coalesce(p_user, actor_user_id()), p_ticket, p_notes)
  RETURNING id INTO v_id;
  SELECT coalesce(c.location, h.location), coalesce(c.name, 'Hotspot: ' || h.name) INTO v_loc, v_name
    FROM (SELECT 1) x LEFT JOIN customers c ON c.id = p_customer LEFT JOIN hotspots h ON h.id = p_hotspot;
  UPDATE serialized_inventory
     SET location = coalesce(v_loc, v_name), linked_ticket_id = coalesce(p_ticket, linked_ticket_id),
         notes = concat_ws(' | ', nullif(notes, ''), '[' || to_char(now(), 'YYYY-MM-DD HH24:MI') || '] Installed at ' || v_name)
   WHERE asset_id = upper(btrim(p_asset));
  RETURN v_id;
END;
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION remove_device(p_asset text, p_reason text DEFAULT NULL, p_user uuid DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM use_actor(p_user);
  UPDATE device_installations SET removed_at = now(), notes = concat_ws(' | ', nullif(notes, ''), 'Removed: ' || coalesce(p_reason, ''))
   WHERE asset_id = upper(btrim(p_asset)) AND removed_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION '% is not installed anywhere', p_asset; END IF;
END;
$$;
-- +goose StatementEnd

-- Log a ticket; with a technician and p_create_task, a linked task is created and both point at each other.
-- +goose StatementBegin
CREATE FUNCTION create_ticket(
  p_customer_name text, p_category text DEFAULT 'Other', p_priority text DEFAULT 'Normal', p_tech text DEFAULT NULL,
  p_create_task boolean DEFAULT true, p_notes text DEFAULT NULL, p_customer text DEFAULT NULL, p_hotspot text DEFAULT NULL,
  p_device text DEFAULT NULL, p_old_sn text DEFAULT NULL, p_new_sn text DEFAULT NULL, p_user uuid DEFAULT NULL
) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_id text := next_id('TKT', 4); v_task text; v_name text := nullif(btrim(p_customer_name), ''); v_tech text; v_hs text := p_hotspot;
BEGIN
  PERFORM use_actor(p_user);
  IF actor_role() IS NOT NULL AND NOT has_perm(actor_role(), 'createTicket') THEN
    RAISE EXCEPTION 'You do not have permission to log tickets.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_customer IS NOT NULL THEN
    SELECT coalesce(v_name, name || ' / ' || account_no), coalesce(v_hs, hotspot_id) INTO v_name, v_hs FROM customers WHERE id = p_customer;
    IF NOT FOUND THEN RAISE EXCEPTION 'Unknown customer %', p_customer; END IF;
  END IF;
  IF v_hs IS NOT NULL THEN
    SELECT coalesce(v_name, 'Hotspot: ' || name) INTO v_name FROM hotspots WHERE id = v_hs;
    IF NOT FOUND THEN RAISE EXCEPTION 'Unknown hotspot %', v_hs; END IF;
  END IF;
  IF v_name IS NULL THEN RAISE EXCEPTION 'Customer name / account is required.'; END IF;
  IF nullif(btrim(p_tech), '') IS NOT NULL THEN
    SELECT name INTO v_tech FROM users WHERE (lower(name) = lower(btrim(p_tech)) OR lower(email) = lower(btrim(p_tech))) AND status = 'active';
    IF v_tech IS NULL THEN RAISE EXCEPTION 'Technician not found.'; END IF;
    IF p_create_task THEN v_task := next_id('TASK', 4); END IF;
  END IF;

  INSERT INTO customer_tickets (ticket_id, customer_name, customer_id, hotspot_id, device_asset_id, issue_category, assigned_to, priority,
                                logged_by, resolution_notes, old_device_sn, new_device_sn, linked_task_id)
  VALUES (v_id, v_name, p_customer, v_hs, upper(nullif(p_device, '')), coalesce(nullif(p_category, ''), 'Other'), v_tech, coalesce(nullif(p_priority, ''), 'Normal'),
          coalesce(actor_name(), 'system'), p_notes, p_old_sn, p_new_sn, v_task);
  IF v_task IS NOT NULL THEN
    INSERT INTO technician_tasks (task_id, task_title, assigned_to, priority, customer_site, customer_id, hotspot_id, reference, notes, created_by, linked_ticket_id)
    VALUES (v_task, 'Ticket ' || v_id || ': ' || coalesce(nullif(p_category, ''), 'Other'), v_tech, coalesce(nullif(p_priority, ''), 'Normal'),
            v_name, p_customer, v_hs, v_id, p_notes, coalesce(actor_name(), 'system'), v_id);
  END IF;
  RETURN v_id;
END;
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION assign_ticket(p_ticket text, p_tech text, p_create_task boolean DEFAULT true, p_user uuid DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
DECLARE t customer_tickets%ROWTYPE; v_tech text; v_task text;
BEGIN
  PERFORM use_actor(p_user);
  IF actor_role() IS NOT NULL AND NOT has_perm(actor_role(), 'viewAllTickets') THEN
    RAISE EXCEPTION 'Only support staff can assign tickets.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO t FROM customer_tickets WHERE ticket_id = upper(btrim(p_ticket)) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ticket not found.'; END IF;
  SELECT name INTO v_tech FROM users WHERE (lower(name) = lower(btrim(p_tech)) OR lower(email) = lower(btrim(p_tech))) AND status = 'active';
  IF v_tech IS NULL THEN RAISE EXCEPTION 'Technician not found.'; END IF;
  IF p_create_task AND t.linked_task_id IS NULL THEN
    v_task := next_id('TASK', 4);
    INSERT INTO technician_tasks (task_id, task_title, assigned_to, priority, customer_site, customer_id, hotspot_id, reference, created_by, linked_ticket_id)
    VALUES (v_task, 'Ticket ' || t.ticket_id || ': ' || t.issue_category, v_tech, t.priority, t.customer_name, t.customer_id, t.hotspot_id,
            t.ticket_id, coalesce(actor_name(), 'system'), t.ticket_id);
  END IF;
  UPDATE customer_tickets SET assigned_to = v_tech, assigned_user_id = NULL, linked_task_id = coalesce(linked_task_id, v_task)
   WHERE ticket_id = t.ticket_id;
END;
$$;
-- +goose StatementEnd

-- Awaiting Stock requisition -> purchase request for the shortfall.
-- +goose StatementBegin
CREATE FUNCTION raise_procurement_from_requisition(p_req text, p_user uuid DEFAULT NULL) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r technician_requisitions%ROWTYPE; v_short int; v_id text := next_id('PRC', 3);
BEGIN
  PERFORM use_actor(p_user);
  IF actor_role() IS NOT NULL AND NOT has_perm(actor_role(), 'requestProcurement') THEN
    RAISE EXCEPTION 'You do not have permission to raise purchases.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO r FROM technician_requisitions WHERE requisition_id = upper(btrim(p_req)) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Requisition not found.'; END IF;
  IF r.approval_status <> 'Awaiting Stock' THEN RAISE EXCEPTION 'Only requisitions awaiting stock need a purchase.'; END IF;
  IF r.procurement_ref IS NOT NULL THEN RAISE EXCEPTION 'A purchase (%) is already linked.', r.procurement_ref; END IF;
  v_short := greatest(r.quantity - greatest(available_qty(r.item_sku, r.requisition_id)::int, 0), 1);
  INSERT INTO procurement_requests (procurement_id, requested_by, item_sku, quantity, project_id, linked_requisition_id, notes)
  VALUES (v_id, coalesce(actor_name(), 'system'), r.item_sku, v_short, r.project_id, r.requisition_id, 'Shortfall for ' || r.requisition_id);
  UPDATE technician_requisitions SET procurement_ref = v_id WHERE requisition_id = r.requisition_id;
  RETURN v_id;
END;
$$;
-- +goose StatementEnd

-- Delivery note (issued requisition) or receipt note (received purchase). The PDF / Drive link is filled in by the app.
-- +goose StatementBegin
CREATE FUNCTION create_delivery_note(p_ref text, p_user uuid DEFAULT NULL) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r technician_requisitions%ROWTYPE; p procurement_requests%ROWTYPE; v_no text; v_val numeric; v_cost numeric; mgr uuid;
BEGIN
  PERFORM use_actor(p_user);
  IF actor_role() IS NOT NULL AND NOT has_perm(actor_role(), 'generatePDF') THEN
    RAISE EXCEPTION 'You do not have permission to generate notes.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  p_ref := upper(btrim(p_ref));
  IF p_ref LIKE 'REQ-%' THEN
    SELECT * INTO r FROM technician_requisitions WHERE requisition_id = p_ref;
    IF NOT FOUND THEN RAISE EXCEPTION 'Requisition not found.'; END IF;
    IF actor_role() = 'Project Manager' THEN
      SELECT manager_user_id INTO mgr FROM projects WHERE project_id = r.project_id;
      IF mgr IS DISTINCT FROM actor_user_id() THEN RAISE EXCEPTION 'You can only generate notes for projects you manage.' USING ERRCODE = 'insufficient_privilege'; END IF;
    END IF;
    SELECT unit_cost INTO v_cost FROM item_catalog WHERE sku = r.item_sku;
    INSERT INTO delivery_notes (doc_no, type, reference, requisition_id, project_id, recipient, created_by, value_kes, payment_status)
    VALUES ('', 'Delivery Note', p_ref, p_ref, r.project_id, r.technician_name, coalesce(actor_name(), 'system'), round(coalesce(v_cost, 0) * r.quantity, 2), 'Tracking only')
    RETURNING doc_no INTO v_no;
  ELSIF p_ref LIKE 'PRC-%' THEN
    SELECT * INTO p FROM procurement_requests WHERE procurement_id = p_ref;
    IF NOT FOUND THEN RAISE EXCEPTION 'Purchase request not found.'; END IF;
    IF actor_role() = 'Project Manager' THEN
      SELECT manager_user_id INTO mgr FROM projects WHERE project_id = p.project_id;
      IF mgr IS DISTINCT FROM actor_user_id() THEN RAISE EXCEPTION 'You can only generate notes for projects you manage.' USING ERRCODE = 'insufficient_privilege'; END IF;
    END IF;
    SELECT unit_cost INTO v_cost FROM item_catalog WHERE sku = p.item_sku;
    INSERT INTO delivery_notes (doc_no, type, reference, procurement_id, project_id, recipient, created_by, value_kes, payment_status)
    VALUES ('', 'Receipt Note', p_ref, p_ref, p.project_id, 'Main Store', coalesce(actor_name(), 'system'), round(coalesce(v_cost, 0) * p.quantity, 2), 'Pending')
    RETURNING doc_no INTO v_no;
  ELSE
    RAISE EXCEPTION 'Notes can be generated for REQ- or PRC- references only.';
  END IF;
  RETURN v_no;
END;
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION set_payment_status(p_doc text, p_status text, p_ref text DEFAULT NULL, p_user uuid DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM use_actor(p_user);
  IF actor_role() IS NOT NULL AND NOT has_perm(actor_role(), 'managePayments') THEN
    RAISE EXCEPTION 'You do not have permission to record payments.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_status NOT IN ('Tracking only', 'Pending', 'Paid') THEN RAISE EXCEPTION 'Invalid payment status.'; END IF;
  UPDATE delivery_notes
     SET payment_status = p_status,
         paid_date = CASE WHEN p_status = 'Paid' THEN current_date END,
         payment_ref = coalesce(nullif(p_ref, ''), CASE WHEN p_status = 'Paid' THEN 'by ' || coalesce(actor_name(), 'system') END)
   WHERE doc_no = upper(btrim(p_doc));
  IF NOT FOUND THEN RAISE EXCEPTION 'Document not found.'; END IF;
END;
$$;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION ledger_before_insert() RETURNS trigger AS $$
DECLARE
  u serialized_inventory%ROWTYPE;
  u_cost numeric;
BEGIN
  IF NEW.unit_cost = 0 AND NEW.cost_type <> 'Adjustment' THEN
    SELECT unit_cost INTO u_cost FROM item_catalog WHERE sku = NEW.sku;   -- the VLOOKUP the sheet used
    NEW.unit_cost := coalesce(u_cost, 0);
  END IF;
  IF coalesce(current_setting('app.import_mode', true), '') = 'on' THEN RETURN NEW; END IF;

  PERFORM pg_advisory_xact_lock(hashtext('stock:' || NEW.sku));

  IF NEW.asset_id IS NOT NULL THEN
    SELECT * INTO u FROM serialized_inventory WHERE asset_id = NEW.asset_id FOR UPDATE;
    IF u.sku <> NEW.sku THEN
      RAISE EXCEPTION 'Unit % is a % unit, not %', NEW.asset_id, u.sku, NEW.sku USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.direction = 'Stock Out' AND u.status <> 'In Stock' THEN
      RAISE EXCEPTION '% is "%", not In Stock', NEW.asset_id, u.status USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.direction = 'Stock In' AND u.status = 'In Stock' THEN
      RAISE EXCEPTION '% is already In Stock', NEW.asset_id USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.direction = 'Stock Out' AND stock_balance(NEW.sku) < NEW.quantity THEN
    RAISE EXCEPTION 'Not enough % in stock (have %, need %)', NEW.sku, stock_balance(NEW.sku), NEW.quantity
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd
DROP FUNCTION IF EXISTS set_payment_status(text, text, text, uuid);
DROP FUNCTION IF EXISTS create_delivery_note(text, uuid);
DROP FUNCTION IF EXISTS raise_procurement_from_requisition(text, uuid);
DROP FUNCTION IF EXISTS assign_ticket(text, text, boolean, uuid);
DROP FUNCTION IF EXISTS create_ticket(text, text, text, text, boolean, text, text, text, text, text, text, uuid);
DROP FUNCTION IF EXISTS remove_device(text, text, uuid);
DROP FUNCTION IF EXISTS install_device(text, text, text, text, text, text, uuid);
DROP FUNCTION IF EXISTS receive_serialized_batch(text, jsonb, text, text, uuid);
DROP FUNCTION IF EXISTS receive_procurement(text, uuid);
DROP FUNCTION IF EXISTS issue_requisition(text, text[], uuid);
DROP FUNCTION IF EXISTS record_movement(text, text, numeric, text, text, text, text, text, text, uuid, timestamptz);
DROP FUNCTION IF EXISTS release_port(text, text);
DROP FUNCTION IF EXISTS assign_port(text, int, text, text);
DROP TRIGGER IF EXISTS t2_splitter_ports_rules ON splitter_ports;
DROP FUNCTION IF EXISTS splitter_ports_rules();
DROP TRIGGER IF EXISTS t2_ledger_rules ON inventory_transactions;
DROP FUNCTION IF EXISTS ledger_rules();
DROP TRIGGER IF EXISTS t2_tickets_zactor ON customer_tickets;
DROP FUNCTION IF EXISTS tickets_actor_guard();
DROP TRIGGER IF EXISTS t2_tasks_zactor ON technician_tasks;
DROP FUNCTION IF EXISTS tasks_actor_guard();
DROP TRIGGER IF EXISTS t2_proc_zrules ON procurement_requests;
DROP FUNCTION IF EXISTS proc_rules();
DROP TRIGGER IF EXISTS t4_reqs_issue_ledger ON technician_requisitions;
DROP FUNCTION IF EXISTS reqs_issue_ledger();
DROP TRIGGER IF EXISTS t2_reqs_zrules ON technician_requisitions;
DROP FUNCTION IF EXISTS reqs_rules();
DROP FUNCTION IF EXISTS finance_needed(numeric, text);
UPDATE workflow_transitions SET required_permission = 'approveReq', guard = replace(replace(guard, '; Project Managers: only for projects they manage', ''), 'Project Managers: only for projects they manage', '')
 WHERE workflow = 'requisition' AND from_state = 'Pending Approval' AND required_permission = 'approveProjectReq';
DELETE FROM role_permissions WHERE permission = 'approveProjectReq';
DELETE FROM permissions WHERE code = 'approveProjectReq';
DROP FUNCTION IF EXISTS requester_is_actor(uuid, text);
DROP FUNCTION IF EXISTS use_actor(uuid);
DROP FUNCTION IF EXISTS actor_name();
DROP FUNCTION IF EXISTS actor_user_id();
DROP FUNCTION IF EXISTS actor_role();
DROP FUNCTION IF EXISTS actor_email();
DROP FUNCTION IF EXISTS is_import();
