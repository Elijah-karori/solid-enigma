-- +goose Up
-- Tickets, tasks, requisitions, procurement, delivery notes, the stock ledger, device replacements
-- and the audit trail - with the workflow guard that ties statuses to roles (workflows table, 00002).
--
-- Session settings read by the triggers (set with SET LOCAL inside a transaction):
--   app.actor_role   role of the signed-in user; when set, role-gated transitions are checked
--   app.actor_email  who is acting (used for audit rows written by triggers)
--   app.import_mode  'on' = workbook import: skips workflow, balance and side-effect triggers

CREATE TABLE issue_categories (name text PRIMARY KEY, sort_order int NOT NULL DEFAULT 0);
INSERT INTO issue_categories (name, sort_order) VALUES
  ('No Optical Link', 1), ('Faulty ONT / Router', 2), ('High Loss / Splice Needed', 3),
  ('Wi-Fi / Password Reset', 4), ('New Installation', 5), ('Relocation', 6), ('Other', 7);

-- ---------------------------------------------------------------------------------------------
-- generic workflow guard
-- ---------------------------------------------------------------------------------------------
-- +goose StatementBegin
CREATE FUNCTION workflow_guard() RETURNS trigger AS $$
DECLARE
  wf        text := TG_ARGV[0];
  col       text := TG_ARGV[1];
  note_col  text := TG_ARGV[2];
  new_s     text;
  old_s     text;
  t         workflow_transitions%ROWTYPE;
  v_role    text;
  free_form boolean;
BEGIN
  new_s := to_jsonb(NEW) ->> col;
  IF NOT EXISTS (SELECT 1 FROM workflow_states WHERE workflow = wf AND state = new_s) THEN
    RAISE EXCEPTION '"%" is not a valid % status', new_s, wf USING ERRCODE = 'check_violation';
  END IF;
  IF coalesce(current_setting('app.import_mode', true), '') = 'on' THEN RETURN NEW; END IF;

  free_form := NOT EXISTS (SELECT 1 FROM workflow_transitions WHERE workflow = wf);
  IF free_form THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM workflow_states WHERE workflow = wf AND state = new_s AND is_initial) THEN
      RAISE EXCEPTION 'A new % cannot start as "%"', wf, new_s USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  old_s := to_jsonb(OLD) ->> col;
  IF new_s = old_s THEN RETURN NEW; END IF;

  SELECT * INTO t FROM workflow_transitions WHERE workflow = wf AND from_state = old_s AND to_state = new_s;
  IF NOT FOUND THEN
    RAISE EXCEPTION '% cannot go from "%" to "%"', wf, old_s, new_s USING ERRCODE = 'check_violation';
  END IF;

  v_role := nullif(current_setting('app.actor_role', true), '');
  IF v_role IS NOT NULL AND t.required_permission IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM role_permissions rp WHERE rp.role = v_role AND rp.permission = t.required_permission) THEN
    RAISE EXCEPTION 'Role "%" may not move a % from "%" to "%" (needs %)', v_role, wf, old_s, new_s, t.required_permission
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF t.requires_note AND note_col IS NOT NULL AND btrim(coalesce(to_jsonb(NEW) ->> note_col, '')) = '' THEN
    RAISE EXCEPTION 'A note (%) is required to move a % to "%"', note_col, wf, new_s USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- Dedicated items may only be requested / bought against their own project (scopeError_()).
-- Requests are accepted for Planning / Active projects only (projectOpen_()).
-- +goose StatementBegin
CREATE FUNCTION scope_guard() RETURNS trigger AS $$
DECLARE
  j       jsonb := to_jsonb(NEW);
  v_sku   text  := j ->> TG_ARGV[0];
  v_proj  text  := j ->> TG_ARGV[1];
  v_scope text;
  v_stat  text;
BEGIN
  IF coalesce(current_setting('app.import_mode', true), '') = 'on' THEN RETURN NEW; END IF;
  SELECT project_scope INTO v_scope FROM item_catalog WHERE sku = v_sku;
  IF v_scope IS NOT NULL AND v_proj IS DISTINCT FROM v_scope THEN
    RAISE EXCEPTION 'Item % is dedicated to project %. Select that project.', v_sku, v_scope USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' AND v_proj IS NOT NULL THEN
    SELECT status INTO v_stat FROM projects WHERE project_id = v_proj;
    IF v_stat NOT IN ('Planning', 'Active') THEN
      RAISE EXCEPTION 'Project % is %. Requests are accepted for Planning or Active projects only.', v_proj, v_stat
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- ---------------------------------------------------------------------------------------------
-- tickets and tasks (each points at the other, so those two FKs are deferred to commit time)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE customer_tickets (
  ticket_id         text PRIMARY KEY CHECK (ticket_id <> ''),
  date_logged       timestamptz NOT NULL,
  customer_name     text NOT NULL CHECK (btrim(customer_name) <> ''),   -- "Customer Name / Acc" as typed
  customer_id       text REFERENCES customers (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  hotspot_id        text REFERENCES hotspots  (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  device_asset_id   text REFERENCES serialized_inventory (asset_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  issue_category    text NOT NULL DEFAULT 'Other' REFERENCES issue_categories (name) ON UPDATE CASCADE ON DELETE RESTRICT,
  assigned_to       text,                         -- name as written
  assigned_user_id  uuid REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL,
  old_device_sn     text,
  new_device_sn     text,
  old_asset_id      text REFERENCES serialized_inventory (asset_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  new_asset_id      text REFERENCES serialized_inventory (asset_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  ticket_status     text NOT NULL DEFAULT 'Open',
  priority          text NOT NULL DEFAULT 'Normal' CHECK (priority IN ('Low', 'Normal', 'High', 'Critical')),
  logged_by         text,
  resolution_notes  text,
  linked_task_id    text,
  closed_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK ((ticket_status = 'Closed') = (closed_at IS NOT NULL)),
  CHECK (old_asset_id IS NULL OR new_asset_id IS NULL OR old_asset_id <> new_asset_id)
);
CREATE INDEX tickets_customer_idx ON customer_tickets (customer_id, date_logged);
CREATE INDEX tickets_hotspot_idx  ON customer_tickets (hotspot_id, date_logged);
CREATE INDEX tickets_device_idx   ON customer_tickets (device_asset_id, date_logged);
CREATE INDEX tickets_status_idx   ON customer_tickets (ticket_status);
CREATE INDEX tickets_assignee_idx ON customer_tickets (assigned_user_id);

CREATE TABLE technician_tasks (
  task_id           text PRIMARY KEY CHECK (task_id <> ''),
  created_at        timestamptz NOT NULL DEFAULT now(),
  task_title        text NOT NULL CHECK (btrim(task_title) <> ''),
  task_type         text NOT NULL DEFAULT 'Field / Operations',
  assigned_to       text NOT NULL,
  assignee_user_id  uuid REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL,
  assignee_email    text,
  priority          text NOT NULL DEFAULT 'Normal' CHECK (priority IN ('Low', 'Normal', 'High', 'Critical')),
  status            text NOT NULL DEFAULT 'Assigned',
  required_sku      text REFERENCES item_catalog (sku) ON UPDATE CASCADE ON DELETE RESTRICT,
  required_qty      numeric(12,2) NOT NULL DEFAULT 0 CHECK (required_qty >= 0),
  customer_site     text,
  customer_id       text REFERENCES customers (id) ON UPDATE CASCADE ON DELETE SET NULL,
  hotspot_id        text REFERENCES hotspots  (id) ON UPDATE CASCADE ON DELETE SET NULL,
  reference         text,
  notes             text,
  created_by        text,
  stock_ready_at    timestamptz,
  linked_ticket_id  text,
  project_id        text REFERENCES projects (project_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK ((required_sku IS NULL) = (required_qty = 0))
);
CREATE INDEX tasks_assignee_idx ON technician_tasks (assignee_user_id, status);
CREATE INDEX tasks_project_idx  ON technician_tasks (project_id);
CREATE INDEX tasks_ticket_idx   ON technician_tasks (linked_ticket_id);
CREATE INDEX tasks_awaiting_idx ON technician_tasks (required_sku) WHERE status = 'Awaiting Stock';

ALTER TABLE customer_tickets
  ADD CONSTRAINT tickets_task_fk FOREIGN KEY (linked_task_id) REFERENCES technician_tasks (task_id)
    ON UPDATE CASCADE ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE technician_tasks
  ADD CONSTRAINT tasks_ticket_fk FOREIGN KEY (linked_ticket_id) REFERENCES customer_tickets (ticket_id)
    ON UPDATE CASCADE ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE serialized_inventory
  ADD CONSTRAINT serialized_ticket_fk FOREIGN KEY (linked_ticket_id) REFERENCES customer_tickets (ticket_id)
    ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE device_installations
  ADD CONSTRAINT dev_inst_ticket_fk FOREIGN KEY (ticket_id) REFERENCES customer_tickets (ticket_id)
    ON UPDATE CASCADE ON DELETE SET NULL;

-- ---------------------------------------------------------------------------------------------
-- requisitions (project and / or task / ticket) and procurement
-- ---------------------------------------------------------------------------------------------
CREATE TABLE technician_requisitions (
  requisition_id    text PRIMARY KEY CHECK (requisition_id <> ''),
  date_requested    timestamptz NOT NULL,
  technician_name   text NOT NULL,
  technician_user_id uuid REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL,
  item_sku          text NOT NULL REFERENCES item_catalog (sku) ON UPDATE CASCADE ON DELETE RESTRICT,
  quantity          int  NOT NULL CHECK (quantity > 0),
  reason            text,
  project_id        text REFERENCES projects (project_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  task_id           text REFERENCES technician_tasks (task_id) ON UPDATE CASCADE ON DELETE SET NULL,
  ticket_id         text REFERENCES customer_tickets (ticket_id) ON UPDATE CASCADE ON DELETE SET NULL,
  approval_status   text NOT NULL DEFAULT 'Pending Approval',
  approved_by       text,
  action_date       timestamptz,
  issued_by         text,
  decision_note     text,
  finance_status    text NOT NULL DEFAULT 'N/A' CHECK (finance_status IN ('N/A', 'Pending', 'Approved', 'Rejected')),
  finance_by        text,
  est_value         numeric(12,2) NOT NULL DEFAULT 0 CHECK (est_value >= 0),
  procurement_ref   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (approval_status <> 'Pending Finance' OR finance_status = 'Pending'),
  CHECK (approval_status <> 'Issued' OR issued_by IS NOT NULL)
);
COMMENT ON TABLE technician_requisitions IS
  'A requisition is for general stock, or linked to a project, a task, or a ticket (any combination). Issued units live in requisition_units.';
CREATE INDEX reqs_status_idx  ON technician_requisitions (approval_status);
CREATE INDEX reqs_project_idx ON technician_requisitions (project_id);
CREATE INDEX reqs_task_idx    ON technician_requisitions (task_id);
CREATE INDEX reqs_ticket_idx  ON technician_requisitions (ticket_id);
CREATE INDEX reqs_sku_idx     ON technician_requisitions (item_sku);
CREATE INDEX reqs_tech_idx    ON technician_requisitions (technician_user_id);

CREATE TABLE procurement_requests (
  procurement_id       text PRIMARY KEY CHECK (procurement_id <> ''),
  date_requested       timestamptz NOT NULL,
  requested_by         text NOT NULL,
  requested_by_user_id uuid REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL,
  item_sku             text NOT NULL REFERENCES item_catalog (sku) ON UPDATE CASCADE ON DELETE RESTRICT,
  quantity             int  NOT NULL CHECK (quantity > 0),
  est_unit_cost        numeric(12,2) NOT NULL DEFAULT 0 CHECK (est_unit_cost >= 0),
  est_total            numeric(14,2) GENERATED ALWAYS AS (round(quantity * est_unit_cost, 2)) STORED,
  project_id           text REFERENCES projects (project_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  linked_requisition_id text,
  status               text NOT NULL DEFAULT 'Pending Finance',
  finance_by           text,
  finance_date         timestamptz,
  supplier             text,
  po_ref               text,
  ordered_date         date,
  received_date        date,
  received_quantity    int CHECK (received_quantity >= 0),
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (status NOT IN ('Ordered', 'Received') OR supplier IS NOT NULL),
  CHECK (status <> 'Received' OR received_date IS NOT NULL),
  CHECK (received_date IS NULL OR ordered_date IS NULL OR received_date >= ordered_date)
);
CREATE INDEX proc_status_idx  ON procurement_requests (status);
CREATE INDEX proc_project_idx ON procurement_requests (project_id);
CREATE INDEX proc_req_idx     ON procurement_requests (linked_requisition_id);
CREATE INDEX proc_sku_idx     ON procurement_requests (item_sku);

ALTER TABLE technician_requisitions
  ADD CONSTRAINT reqs_proc_fk FOREIGN KEY (procurement_ref) REFERENCES procurement_requests (procurement_id)
    ON UPDATE CASCADE ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE procurement_requests
  ADD CONSTRAINT proc_req_fk FOREIGN KEY (linked_requisition_id) REFERENCES technician_requisitions (requisition_id)
    ON UPDATE CASCADE ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

-- Serialized units handed over for one requisition (replaces the comma-separated "Issued Units" cell).
CREATE TABLE requisition_units (
  requisition_id text NOT NULL REFERENCES technician_requisitions (requisition_id) ON UPDATE CASCADE ON DELETE CASCADE,
  asset_id       text NOT NULL REFERENCES serialized_inventory (asset_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  PRIMARY KEY (requisition_id, asset_id)
);
CREATE INDEX req_units_asset_idx ON requisition_units (asset_id);

-- A serialized requisition can only be marked Issued with exactly `quantity` units attached,
-- all of the requested SKU. Checked when the status flips, so units may be attached in the same transaction.
-- +goose StatementBegin
CREATE FUNCTION requisition_issue_check() RETURNS trigger AS $$
DECLARE
  trk text;
  n   int;
  bad int;
BEGIN
  IF coalesce(current_setting('app.import_mode', true), '') = 'on' THEN RETURN NEW; END IF;
  IF NEW.approval_status = 'Issued' AND OLD.approval_status IS DISTINCT FROM 'Issued' THEN
    SELECT tracking_type INTO trk FROM item_catalog WHERE sku = NEW.item_sku;
    IF trk = 'SERIALIZED' THEN
      SELECT count(*), count(*) FILTER (WHERE s.sku <> NEW.item_sku)
        INTO n, bad
        FROM requisition_units ru JOIN serialized_inventory s USING (asset_id)
       WHERE ru.requisition_id = NEW.requisition_id;
      IF n <> NEW.quantity THEN
        RAISE EXCEPTION 'Select exactly % unit(s) to issue for % (found %)', NEW.quantity, NEW.requisition_id, n
          USING ERRCODE = 'check_violation';
      END IF;
      IF bad > 0 THEN
        RAISE EXCEPTION 'Some units on % are not % units', NEW.requisition_id, NEW.item_sku USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- Triggers: blank -> NULL (1), workflow / scope (2), the rest (3+)
CREATE TRIGGER t1_tickets_blank BEFORE INSERT OR UPDATE ON customer_tickets
  FOR EACH ROW EXECUTE FUNCTION blank_to_null('customer_id', 'hotspot_id', 'device_asset_id', 'old_asset_id', 'new_asset_id', 'linked_task_id', 'old_device_sn', 'new_device_sn');
CREATE TRIGGER t2_tickets_workflow BEFORE INSERT OR UPDATE ON customer_tickets
  FOR EACH ROW EXECUTE FUNCTION workflow_guard('ticket', 'ticket_status', 'resolution_notes');
CREATE TRIGGER t3_tickets_updated BEFORE UPDATE ON customer_tickets FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER t1_tasks_blank BEFORE INSERT OR UPDATE ON technician_tasks
  FOR EACH ROW EXECUTE FUNCTION blank_to_null('required_sku', 'customer_id', 'hotspot_id', 'linked_ticket_id', 'project_id');
CREATE TRIGGER t2_tasks_workflow BEFORE INSERT OR UPDATE ON technician_tasks
  FOR EACH ROW EXECUTE FUNCTION workflow_guard('task', 'status', 'notes');
CREATE TRIGGER t3_tasks_updated BEFORE UPDATE ON technician_tasks FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER t1_reqs_blank BEFORE INSERT OR UPDATE ON technician_requisitions
  FOR EACH ROW EXECUTE FUNCTION blank_to_null('project_id', 'task_id', 'ticket_id', 'procurement_ref');
CREATE TRIGGER t2_reqs_workflow BEFORE INSERT OR UPDATE ON technician_requisitions
  FOR EACH ROW EXECUTE FUNCTION workflow_guard('requisition', 'approval_status', 'decision_note');
CREATE TRIGGER t2_reqs_scope BEFORE INSERT OR UPDATE OF item_sku, project_id ON technician_requisitions
  FOR EACH ROW EXECUTE FUNCTION scope_guard('item_sku', 'project_id');
CREATE TRIGGER t3_reqs_updated BEFORE UPDATE ON technician_requisitions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER t4_reqs_issue_check BEFORE UPDATE ON technician_requisitions
  FOR EACH ROW EXECUTE FUNCTION requisition_issue_check();

CREATE TRIGGER t1_proc_blank BEFORE INSERT OR UPDATE ON procurement_requests
  FOR EACH ROW EXECUTE FUNCTION blank_to_null('project_id', 'linked_requisition_id', 'supplier');
CREATE TRIGGER t2_proc_workflow BEFORE INSERT OR UPDATE ON procurement_requests
  FOR EACH ROW EXECUTE FUNCTION workflow_guard('procurement', 'status', 'notes');
CREATE TRIGGER t2_proc_scope BEFORE INSERT OR UPDATE OF item_sku, project_id ON procurement_requests
  FOR EACH ROW EXECUTE FUNCTION scope_guard('item_sku', 'project_id');
CREATE TRIGGER t3_proc_updated BEFORE UPDATE ON procurement_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER t2_projects_workflow BEFORE INSERT OR UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION workflow_guard('project', 'status', NULL);

-- A task started / completed moves its ticket along (updateTaskStatus -> setTicketStatus_).
-- +goose StatementBegin
CREATE FUNCTION tasks_sync_ticket() RETURNS trigger AS $$
BEGIN
  IF coalesce(current_setting('app.import_mode', true), '') = 'on' THEN RETURN NULL; END IF;
  IF NEW.linked_ticket_id IS NULL OR NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NULL; END IF;
  IF NEW.status = 'In Progress' THEN
    UPDATE customer_tickets
       SET ticket_status = 'In Progress',
           resolution_notes = concat_ws(' | ', nullif(resolution_notes, ''),
                                        '[' || to_char(now(), 'YYYY-MM-DD HH24:MI') || '] In Progress: task ' || NEW.task_id || ' started')
     WHERE ticket_id = NEW.linked_ticket_id AND ticket_status IN ('Open', 'Assigned');
  ELSIF NEW.status = 'Completed' THEN
    UPDATE customer_tickets
       SET ticket_status = 'Resolved',
           resolution_notes = concat_ws(' | ', nullif(resolution_notes, ''),
                                        '[' || to_char(now(), 'YYYY-MM-DD HH24:MI') || '] Resolved: task ' || NEW.task_id || ' completed')
     WHERE ticket_id = NEW.linked_ticket_id AND ticket_status IN ('Open', 'Assigned', 'In Progress');
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd
CREATE TRIGGER t5_tasks_sync_ticket AFTER UPDATE OF status ON technician_tasks
  FOR EACH ROW EXECUTE FUNCTION tasks_sync_ticket();

-- ---------------------------------------------------------------------------------------------
-- delivery / receipt notes
-- ---------------------------------------------------------------------------------------------
CREATE TABLE delivery_notes (
  doc_no          text PRIMARY KEY CHECK (doc_no <> ''),
  type            text NOT NULL CHECK (type IN ('Delivery Note', 'Receipt Note')),
  reference       text NOT NULL,                       -- REQ-xxx or PRC-xxx as printed
  requisition_id  text REFERENCES technician_requisitions (requisition_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  procurement_id  text REFERENCES procurement_requests    (procurement_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  project_id      text REFERENCES projects (project_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  recipient       text,
  file_name       text,
  drive_url       text,
  created_by      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  emailed_to      text,
  value_kes       numeric(14,2) NOT NULL DEFAULT 0 CHECK (value_kes >= 0),
  payment_status  text NOT NULL DEFAULT 'Tracking only' CHECK (payment_status IN ('Tracking only', 'Pending', 'Paid')),
  paid_date       date,
  payment_ref     text,
  CHECK (num_nonnulls(requisition_id, procurement_id) = 1),
  CHECK ((type = 'Delivery Note') = (requisition_id IS NOT NULL)),
  CHECK ((payment_status = 'Paid') = (paid_date IS NOT NULL))
);
CREATE INDEX notes_project_idx ON delivery_notes (project_id);
CREATE INDEX notes_req_idx     ON delivery_notes (requisition_id);
CREATE INDEX notes_proc_idx    ON delivery_notes (procurement_id);
CREATE TRIGGER t1_notes_blank BEFORE INSERT OR UPDATE ON delivery_notes
  FOR EACH ROW EXECUTE FUNCTION blank_to_null('project_id', 'requisition_id', 'procurement_id');

-- A note exists only for an issued requisition / a received purchase.
-- +goose StatementBegin
CREATE FUNCTION delivery_notes_guard() RETURNS trigger AS $$
DECLARE s text;
BEGIN
  IF coalesce(current_setting('app.import_mode', true), '') = 'on' THEN RETURN NEW; END IF;
  IF NEW.requisition_id IS NOT NULL THEN
    SELECT approval_status INTO s FROM technician_requisitions WHERE requisition_id = NEW.requisition_id;
    IF s <> 'Issued' THEN
      RAISE EXCEPTION 'A delivery note can only be made after the stock has been issued' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    SELECT status INTO s FROM procurement_requests WHERE procurement_id = NEW.procurement_id;
    IF s <> 'Received' THEN
      RAISE EXCEPTION 'A receipt note can only be made after the goods are received' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd
CREATE TRIGGER t2_notes_guard BEFORE INSERT ON delivery_notes FOR EACH ROW EXECUTE FUNCTION delivery_notes_guard();

-- ---------------------------------------------------------------------------------------------
-- stock ledger: append-only; balances are derived from it (v_stock_summary), never stored
-- ---------------------------------------------------------------------------------------------
CREATE TABLE inventory_transactions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq              bigint GENERATED ALWAYS AS IDENTITY,
  transaction_date timestamptz NOT NULL,
  direction        text NOT NULL CHECK (direction IN ('Stock In', 'Stock Out')),
  sku              text NOT NULL REFERENCES item_catalog (sku) ON UPDATE RESTRICT ON DELETE RESTRICT,
  item_name        text,
  quantity         numeric(12,2) NOT NULL CHECK (quantity > 0),
  requested_by     text,
  actor_user_id    uuid REFERENCES users (id) ON UPDATE RESTRICT ON DELETE SET NULL,
  role             text,
  site_reference   text,
  unit_cost        numeric(12,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  total_cost       numeric(14,2) GENERATED ALWAYS AS (round(quantity * unit_cost, 2)) STORED,
  cost_type        text NOT NULL DEFAULT 'Other' REFERENCES cost_types (code) ON UPDATE RESTRICT ON DELETE RESTRICT,
  asset_id         text REFERENCES serialized_inventory (asset_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  project_id       text REFERENCES projects (project_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  task_id          text REFERENCES technician_tasks (task_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  requisition_id   text REFERENCES technician_requisitions (requisition_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  procurement_id   text REFERENCES procurement_requests (procurement_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  ticket_id        text REFERENCES customer_tickets (ticket_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  customer_id      text REFERENCES customers (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  hotspot_id       text REFERENCES hotspots (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (asset_id IS NULL OR quantity = 1),
  CHECK (num_nonnulls(customer_id, hotspot_id) <= 1)
);
COMMENT ON COLUMN inventory_transactions.site_reference IS
  'Free text as written in the register ("phase 6", "main store"). It is NOT a task id: use task_id / project_id for links.';
CREATE UNIQUE INDEX ledger_seq_uq     ON inventory_transactions (seq);
CREATE INDEX ledger_sku_idx           ON inventory_transactions (sku, transaction_date);
CREATE INDEX ledger_asset_idx         ON inventory_transactions (asset_id) WHERE asset_id IS NOT NULL;
CREATE INDEX ledger_project_idx       ON inventory_transactions (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX ledger_task_idx          ON inventory_transactions (task_id) WHERE task_id IS NOT NULL;
CREATE INDEX ledger_req_idx           ON inventory_transactions (requisition_id) WHERE requisition_id IS NOT NULL;
CREATE INDEX ledger_customer_idx      ON inventory_transactions (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX ledger_hotspot_idx       ON inventory_transactions (hotspot_id) WHERE hotspot_id IS NOT NULL;
CREATE INDEX ledger_cost_type_idx     ON inventory_transactions (cost_type, direction);

CREATE TRIGGER t1_ledger_blank BEFORE INSERT ON inventory_transactions
  FOR EACH ROW EXECUTE FUNCTION blank_to_null('asset_id', 'project_id', 'task_id', 'requisition_id', 'procurement_id', 'ticket_id', 'customer_id', 'hotspot_id');

-- +goose StatementBegin
CREATE FUNCTION stock_balance(p_sku text) RETURNS numeric AS $$
  SELECT coalesce(sum(CASE direction WHEN 'Stock In' THEN quantity ELSE -quantity END), 0)
    FROM inventory_transactions WHERE sku = p_sku;
$$ LANGUAGE sql STABLE;
-- +goose StatementEnd

-- Stock that is approved for a requisition but not yet handed over.
-- +goose StatementBegin
CREATE FUNCTION reserved_qty(p_sku text, p_except text DEFAULT NULL) RETURNS numeric AS $$
  SELECT coalesce(sum(quantity), 0) FROM technician_requisitions
   WHERE item_sku = p_sku AND approval_status = 'Approved - Ready'
     AND (p_except IS NULL OR requisition_id <> p_except);
$$ LANGUAGE sql STABLE;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION available_qty(p_sku text, p_except text DEFAULT NULL) RETURNS numeric AS $$
  SELECT stock_balance(p_sku) - reserved_qty(p_sku, p_except);
$$ LANGUAGE sql STABLE;
-- +goose StatementEnd

-- Before insert: unit rules and "no negative stock" (one advisory lock per SKU serialises concurrent issues).
-- +goose StatementBegin
CREATE FUNCTION ledger_before_insert() RETURNS trigger AS $$
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
CREATE TRIGGER t2_ledger_before BEFORE INSERT ON inventory_transactions
  FOR EACH ROW EXECUTE FUNCTION ledger_before_insert();

-- After insert: move the unit (updateSerialUnit_) and release anything waiting for this SKU
-- (notifyAwaitingStockTasks_ / notifyAwaitingRequisitions_). Tasks first, oldest first.
-- +goose StatementBegin
CREATE FUNCTION ledger_after_insert() RETURNS trigger AS $$
DECLARE
  bal numeric;
  r   record;
BEGIN
  IF coalesce(current_setting('app.import_mode', true), '') = 'on' THEN RETURN NULL; END IF;

  IF NEW.asset_id IS NOT NULL THEN
    IF NEW.direction = 'Stock Out' THEN
      UPDATE serialized_inventory
         SET status = 'Issued / Out',
             custodian = coalesce(NEW.requested_by, custodian),
             location = coalesce(NEW.site_reference, location),
             current_project_id = coalesce(NEW.project_id, current_project_id),
             notes = concat_ws(' | ', nullif(notes, ''),
                     '[' || to_char(NEW.transaction_date, 'YYYY-MM-DD') || '] Stock Out -> ' || coalesce(NEW.requested_by, 'Staff') ||
                     ' (Site: ' || coalesce(NEW.site_reference, 'Main Store') || ')')
       WHERE asset_id = NEW.asset_id;
    ELSE
      UPDATE serialized_inventory
         SET status = 'In Stock', custodian = NULL, custodian_user_id = NULL,
             location = coalesce(NEW.site_reference, 'Main Store'), current_project_id = NULL,
             notes = concat_ws(' | ', nullif(notes, ''),
                     '[' || to_char(NEW.transaction_date, 'YYYY-MM-DD') || '] Stock In -> ' || coalesce(NEW.requested_by, 'Staff') ||
                     ' (Site: ' || coalesce(NEW.site_reference, 'Main Store') || ')')
       WHERE asset_id = NEW.asset_id;
    END IF;
  END IF;

  IF NEW.direction = 'Stock In' THEN
    bal := stock_balance(NEW.sku);
    FOR r IN SELECT task_id, required_qty FROM technician_tasks
              WHERE status = 'Awaiting Stock' AND required_sku = NEW.sku AND required_qty > 0
              ORDER BY created_at, task_id FOR UPDATE LOOP
      EXIT WHEN bal < r.required_qty;
      bal := bal - r.required_qty;
      UPDATE technician_tasks SET status = 'Ready', stock_ready_at = now() WHERE task_id = r.task_id;
    END LOOP;
    FOR r IN SELECT requisition_id, quantity FROM technician_requisitions
              WHERE approval_status = 'Awaiting Stock' AND item_sku = NEW.sku
              ORDER BY date_requested, requisition_id FOR UPDATE LOOP
      EXIT WHEN bal < r.quantity;
      bal := bal - r.quantity;
      UPDATE technician_requisitions SET approval_status = 'Approved - Ready', action_date = now() WHERE requisition_id = r.requisition_id;
    END LOOP;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd
CREATE TRIGGER t5_ledger_after AFTER INSERT ON inventory_transactions
  FOR EACH ROW EXECUTE FUNCTION ledger_after_insert();

CREATE TRIGGER t0_ledger_append_only BEFORE UPDATE OR DELETE ON inventory_transactions
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();
CREATE TRIGGER t0_ledger_no_truncate BEFORE TRUNCATE ON inventory_transactions
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_mutation();

-- ---------------------------------------------------------------------------------------------
-- device replacements: one row per swap, so failure history and replacement cost can be analysed
-- ---------------------------------------------------------------------------------------------
CREATE TABLE device_replacements (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  replaced_at      timestamptz NOT NULL DEFAULT now(),
  role             text NOT NULL CHECK (role IN ('ONU', 'AP')),
  customer_id      text REFERENCES customers (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  hotspot_id       text REFERENCES hotspots  (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  old_asset_id     text NOT NULL REFERENCES serialized_inventory (asset_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  new_asset_id     text NOT NULL REFERENCES serialized_inventory (asset_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  ticket_id        text REFERENCES customer_tickets (ticket_id) ON UPDATE CASCADE ON DELETE SET NULL,
  reason           text NOT NULL DEFAULT 'faulty',
  replaced_by      uuid REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL,
  CHECK (num_nonnulls(customer_id, hotspot_id) = 1),
  CHECK (old_asset_id <> new_asset_id)
);
CREATE INDEX replacements_old_idx    ON device_replacements (old_asset_id);
CREATE INDEX replacements_new_idx    ON device_replacements (new_asset_id);
CREATE INDEX replacements_cust_idx   ON device_replacements (customer_id);
CREATE INDEX replacements_hotspot_idx ON device_replacements (hotspot_id);

-- replaceDevice() in one atomic call. The replacement must already be Issued / Out (the store issues it first).
-- +goose StatementBegin
CREATE FUNCTION replace_device(
  p_kind text, p_entity_id text, p_role text, p_old text, p_new text,
  p_ticket text DEFAULT NULL, p_reason text DEFAULT 'faulty', p_user uuid DEFAULT NULL
) RETURNS bigint AS $$
DECLARE
  v_cust text; v_hs text; v_name text; v_acct text; v_loc text;
  v_inst bigint; v_id bigint;
  v_medium text := CASE p_role WHEN 'ONU' THEN 'Fibre' ELSE 'Ethernet' END;
BEGIN
  IF p_role NOT IN ('ONU', 'AP') THEN RAISE EXCEPTION 'role must be ONU or AP'; END IF;
  IF p_old = p_new THEN RAISE EXCEPTION 'Pick the faulty unit and a different replacement'; END IF;
  IF p_kind = 'hotspot' THEN
    v_hs := p_entity_id;
    SELECT name, location INTO v_name, v_loc FROM hotspots WHERE id = v_hs;
    v_name := 'Hotspot: ' || v_name; v_acct := v_hs;
  ELSE
    v_cust := p_entity_id;
    SELECT name, location, account_no INTO v_name, v_loc, v_acct FROM customers WHERE id = v_cust;
  END IF;
  IF v_name IS NULL THEN RAISE EXCEPTION 'Customer / hotspot % not found', p_entity_id; END IF;

  SELECT id INTO v_inst FROM device_installations
   WHERE asset_id = p_old AND role = p_role AND removed_at IS NULL
     AND customer_id IS NOT DISTINCT FROM v_cust AND hotspot_id IS NOT DISTINCT FROM v_hs;
  IF v_inst IS NULL THEN
    RAISE EXCEPTION '% is not installed at % as its %', p_old, p_entity_id, p_role USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM device_installations WHERE asset_id = p_new AND removed_at IS NULL) THEN
    RAISE EXCEPTION '% is already installed somewhere', p_new USING ERRCODE = 'check_violation';
  END IF;

  UPDATE device_installations SET removed_at = now() WHERE id = v_inst;
  UPDATE serialized_inventory
     SET status = 'Under Repair', condition = 'Faulty', custodian = coalesce(
           (SELECT name FROM users WHERE id = p_user), custodian),
         location = 'Returned from ' || v_name,
         linked_ticket_id = coalesce(p_ticket, linked_ticket_id),
         notes = concat_ws(' | ', nullif(notes, ''), '[' || to_char(now(), 'YYYY-MM-DD HH24:MI') || '] Replaced by ' || p_new || ' at ' || v_name || ' - ' || p_reason)
   WHERE asset_id = p_old;

  INSERT INTO device_installations (asset_id, role, customer_id, hotspot_id, uplink_medium, installed_by_user_id, ticket_id, notes)
  VALUES (p_new, p_role, v_cust, v_hs, v_medium, p_user, p_ticket, 'Replaces ' || p_old || ' - ' || p_reason);
  UPDATE serialized_inventory
     SET location = coalesce(v_loc, v_name), linked_ticket_id = coalesce(p_ticket, linked_ticket_id),
         notes = concat_ws(' | ', nullif(notes, ''), '[' || to_char(now(), 'YYYY-MM-DD HH24:MI') || '] Installed at ' || v_name || ', replacing ' || p_old)
   WHERE asset_id = p_new;

  IF p_ticket IS NOT NULL THEN
    UPDATE customer_tickets
       SET old_asset_id = p_old, new_asset_id = p_new,
           resolution_notes = concat_ws(' | ', nullif(resolution_notes, ''),
             '[' || to_char(now(), 'YYYY-MM-DD HH24:MI') || '] Device replaced ' || p_old || ' -> ' || p_new)
     WHERE ticket_id = p_ticket;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ticket % not found', p_ticket; END IF;
  END IF;

  INSERT INTO device_replacements (role, customer_id, hotspot_id, old_asset_id, new_asset_id, ticket_id, reason, replaced_by)
  VALUES (p_role, v_cust, v_hs, p_old, p_new, p_ticket, p_reason, p_user)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- ---------------------------------------------------------------------------------------------
-- audit trail (hash chain). The application computes the hash; the database makes the chain
-- append-only, gap-free and fork-free.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE audit_ledger (
  id              uuid PRIMARY KEY,
  seq             bigint NOT NULL,
  event_timestamp timestamptz NOT NULL,
  actor_email     text NOT NULL DEFAULT 'system',
  actor_role      text NOT NULL DEFAULT 'System',
  entity_type     text NOT NULL,
  entity_id       text NOT NULL,
  action          text NOT NULL,
  previous_state  text NOT NULL DEFAULT '',
  new_state       text NOT NULL DEFAULT '',
  details         text NOT NULL DEFAULT '',
  ip_address      text NOT NULL DEFAULT '',
  prev_hash       text NOT NULL DEFAULT '',
  hash            text NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX audit_seq_uq    ON audit_ledger (seq);
CREATE INDEX audit_entity_idx       ON audit_ledger (entity_type, entity_id, seq);
CREATE INDEX audit_actor_idx        ON audit_ledger (actor_email, seq);

-- +goose StatementBegin
CREATE FUNCTION audit_chain_guard() RETURNS trigger AS $$
DECLARE last audit_ledger%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('audit_ledger'));
  SELECT * INTO last FROM audit_ledger ORDER BY seq DESC LIMIT 1;
  IF NOT FOUND THEN
    IF NEW.seq <> 1 OR NEW.prev_hash <> '' THEN
      RAISE EXCEPTION 'The first audit row must have seq 1 and an empty prev_hash' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.seq <> last.seq + 1 OR NEW.prev_hash <> last.hash THEN
    RAISE EXCEPTION 'Audit chain broken: expected seq % linked to the previous hash', last.seq + 1 USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd
CREATE TRIGGER t1_audit_chain BEFORE INSERT ON audit_ledger FOR EACH ROW EXECUTE FUNCTION audit_chain_guard();
CREATE TRIGGER t0_audit_append_only BEFORE UPDATE OR DELETE ON audit_ledger FOR EACH ROW EXECUTE FUNCTION prevent_mutation();
CREATE TRIGGER t0_audit_no_truncate BEFORE TRUNCATE ON audit_ledger FOR EACH STATEMENT EXECUTE FUNCTION prevent_mutation();

-- Rows from the Apps Script "Audit Trail Log": read-only history, verified by the old hash scheme.
CREATE TABLE legacy_audit_entries (
  audit_id       text PRIMARY KEY,
  timestamp      text NOT NULL,
  entity_type    text NOT NULL,
  entity_id      text NOT NULL,
  action         text NOT NULL,
  actor          text,
  role           text,
  previous_state text,
  new_state      text,
  details        text,
  legacy_hash    text
);
CREATE INDEX legacy_audit_entity_idx ON legacy_audit_entries (entity_type, entity_id);
CREATE TRIGGER t0_legacy_append_only BEFORE UPDATE OR DELETE ON legacy_audit_entries FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

CREATE TABLE genieacs_audit_logs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_timestamp  timestamptz NOT NULL DEFAULT now(),
  actor_email      text NOT NULL,
  customer_id      text REFERENCES customers (id) ON UPDATE CASCADE ON DELETE SET NULL,
  hotspot_id       text REFERENCES hotspots  (id) ON UPDATE CASCADE ON DELETE SET NULL,
  device_id        text NOT NULL,
  action           text NOT NULL,
  parameters       text,
  reason           text,
  result_status    text,
  genieacs_task_id text
);
CREATE INDEX genie_audit_device_idx ON genieacs_audit_logs (device_id, event_timestamp);
CREATE TRIGGER t0_genie_audit_append_only BEFORE UPDATE OR DELETE ON genieacs_audit_logs FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

-- +goose Down
DROP TABLE IF EXISTS genieacs_audit_logs;
DROP TABLE IF EXISTS legacy_audit_entries;
DROP TRIGGER IF EXISTS t0_audit_append_only ON audit_ledger;
DROP TRIGGER IF EXISTS t0_audit_no_truncate ON audit_ledger;
DROP TABLE IF EXISTS audit_ledger;
DROP FUNCTION IF EXISTS audit_chain_guard();
DROP FUNCTION IF EXISTS replace_device(text, text, text, text, text, text, text, uuid);
DROP TABLE IF EXISTS device_replacements;
DROP TRIGGER IF EXISTS t0_ledger_append_only ON inventory_transactions;
DROP TRIGGER IF EXISTS t0_ledger_no_truncate ON inventory_transactions;
DROP TABLE IF EXISTS inventory_transactions;
DROP FUNCTION IF EXISTS ledger_after_insert();
DROP FUNCTION IF EXISTS ledger_before_insert();
DROP FUNCTION IF EXISTS available_qty(text, text);
DROP FUNCTION IF EXISTS reserved_qty(text, text);
DROP FUNCTION IF EXISTS stock_balance(text);
DROP TABLE IF EXISTS delivery_notes;
DROP FUNCTION IF EXISTS delivery_notes_guard();
ALTER TABLE device_installations DROP CONSTRAINT IF EXISTS dev_inst_ticket_fk;
ALTER TABLE serialized_inventory DROP CONSTRAINT IF EXISTS serialized_ticket_fk;
DROP TRIGGER IF EXISTS t2_projects_workflow ON projects;
DROP TABLE IF EXISTS requisition_units;
ALTER TABLE technician_requisitions DROP CONSTRAINT IF EXISTS reqs_proc_fk;
ALTER TABLE procurement_requests DROP CONSTRAINT IF EXISTS proc_req_fk;
DROP TABLE IF EXISTS procurement_requests;
DROP TABLE IF EXISTS technician_requisitions;
ALTER TABLE customer_tickets DROP CONSTRAINT IF EXISTS tickets_task_fk;
ALTER TABLE technician_tasks DROP CONSTRAINT IF EXISTS tasks_ticket_fk;
DROP TABLE IF EXISTS technician_tasks;
DROP TABLE IF EXISTS customer_tickets;
DROP FUNCTION IF EXISTS tasks_sync_ticket();
DROP FUNCTION IF EXISTS requisition_issue_check();
DROP FUNCTION IF EXISTS scope_guard();
DROP FUNCTION IF EXISTS workflow_guard();
DROP TABLE IF EXISTS issue_categories;
