-- +goose Up
-- Settings seeds, gap-tolerant human ids (REQ-001, TKT-0001 ...), name -> user resolution, and the
-- defaults the Apps Script applied when a row was created (est. value, task status, ticket status, closed_at).

-- ---- settings (Inventory Settings sheet) -----------------------------------------------------
INSERT INTO settings (key, value) VALUES
  ('DEFAULT_REORDER_LEVEL',       '3'),
  ('LOW_STOCK_EMAILS',            ''),
  ('LOW_STOCK_ENABLED',           'TRUE'),
  ('TASK_ASSIGNMENT_ENABLED',     'TRUE'),
  ('STOCK_AVAILABLE_ENABLED',     'TRUE'),
  ('PURCHASING_EMAIL',            ''),
  ('FINANCE_EMAIL',               ''),
  ('DRIVE_FOLDER_ID',             ''),
  ('FINANCE_APPROVAL_THRESHOLD',  '50000'),
  ('COMPANY_NAME',                'ONT Network Services'),
  ('DIGEST_ENABLED',              'TRUE'),
  ('GENIEACS_URL',                ''),
  ('GENIEACS_NBI_URL',            ''),
  ('GENIEACS_ONLINE_MINUTES',     '15')
ON CONFLICT (key) DO NOTHING;

-- +goose StatementBegin
CREATE FUNCTION get_setting(p_key text, p_default text DEFAULT '') RETURNS text AS $$
  SELECT coalesce((SELECT nullif(value, '') FROM settings WHERE key = p_key), p_default);
$$ LANGUAGE sql STABLE;
-- +goose StatementEnd

-- Settings the sheet treated as flags: anything but FALSE means on.
-- +goose StatementBegin
CREATE FUNCTION setting_on(p_key text) RETURNS boolean AS $$
  SELECT upper(get_setting(p_key, 'TRUE')) <> 'FALSE';
$$ LANGUAGE sql STABLE;
-- +goose StatementEnd

-- ---- human-readable ids ---------------------------------------------------------------------
CREATE TABLE id_counters (
  prefix     text PRIMARY KEY,
  last_value bigint NOT NULL DEFAULT 0
);

-- +goose StatementBegin
CREATE FUNCTION next_id(p_prefix text, p_width int DEFAULT 3) RETURNS text AS $$
DECLARE n bigint;
BEGIN
  INSERT INTO id_counters AS c (prefix, last_value) VALUES (p_prefix, 1)
  ON CONFLICT (prefix) DO UPDATE SET last_value = c.last_value + 1
  RETURNING last_value INTO n;
  RETURN p_prefix || '-' || lpad(n::text, p_width, '0');
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- BEFORE INSERT: when the id column is NULL or '' draw the next id. EXECUTE FUNCTION autofill_id('col','PRFX',width)
-- +goose StatementBegin
CREATE FUNCTION autofill_id() RETURNS trigger AS $$
DECLARE j jsonb := to_jsonb(NEW);
BEGIN
  IF coalesce(j ->> TG_ARGV[0], '') = '' THEN
    j := jsonb_set(j, ARRAY[TG_ARGV[0]], to_jsonb(next_id(TG_ARGV[1], TG_ARGV[2]::int)));
    RETURN jsonb_populate_record(NEW, j);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE TRIGGER t0_projects_id    BEFORE INSERT ON projects              FOR EACH ROW EXECUTE FUNCTION autofill_id('project_id',     'PRJ',  3);
CREATE TRIGGER t0_tickets_id     BEFORE INSERT ON customer_tickets      FOR EACH ROW EXECUTE FUNCTION autofill_id('ticket_id',      'TKT',  4);
CREATE TRIGGER t0_tasks_id       BEFORE INSERT ON technician_tasks      FOR EACH ROW EXECUTE FUNCTION autofill_id('task_id',        'TASK', 4);
CREATE TRIGGER t0_reqs_id        BEFORE INSERT ON technician_requisitions FOR EACH ROW EXECUTE FUNCTION autofill_id('requisition_id', 'REQ', 3);
CREATE TRIGGER t0_proc_id        BEFORE INSERT ON procurement_requests  FOR EACH ROW EXECUTE FUNCTION autofill_id('procurement_id', 'PRC',  3);
CREATE TRIGGER t0_customers_id   BEFORE INSERT ON customers             FOR EACH ROW EXECUTE FUNCTION autofill_id('id',             'CUS',  4);
CREATE TRIGGER t0_hotspots_id    BEFORE INSERT ON hotspots              FOR EACH ROW EXECUTE FUNCTION autofill_id('id',             'HSP',  3);
CREATE TRIGGER t0_splitters_id   BEFORE INSERT ON splitters             FOR EACH ROW EXECUTE FUNCTION autofill_id('id',             'SPL',  3);
CREATE TRIGGER t0_enclosures_id  BEFORE INSERT ON enclosures            FOR EACH ROW EXECUTE FUNCTION autofill_id('id',             'ENC',  3);
CREATE TRIGGER t0_olts_id        BEFORE INSERT ON olts                  FOR EACH ROW EXECUTE FUNCTION autofill_id('id',             'OLT',  2);

-- delivery notes: DN- for requisitions, RN- for purchases
-- +goose StatementBegin
CREATE FUNCTION notes_autofill_no() RETURNS trigger AS $$
BEGIN
  IF coalesce(NEW.doc_no, '') = '' THEN
    NEW.doc_no := next_id(CASE NEW.type WHEN 'Delivery Note' THEN 'DN' ELSE 'RN' END, 4);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd
CREATE TRIGGER t0_notes_no BEFORE INSERT ON delivery_notes FOR EACH ROW EXECUTE FUNCTION notes_autofill_no();

-- unit ids INV-ONT-0001 ... prefix comes from the SKU (SKU-ONT-* -> INV-ONT)
-- +goose StatementBegin
CREATE FUNCTION next_asset_id(p_sku text) RETURNS text AS $$
  SELECT next_id('INV-' || coalesce(nullif(split_part(upper(p_sku), '-', 2), ''), 'UNIT'), 4);
$$ LANGUAGE sql;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE FUNCTION serialized_autofill_id() RETURNS trigger AS $$
BEGIN
  IF coalesce(NEW.asset_id, '') = '' THEN NEW.asset_id := next_asset_id(NEW.sku); END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd
CREATE TRIGGER t0_serialized_id BEFORE INSERT ON serialized_inventory FOR EACH ROW EXECUTE FUNCTION serialized_autofill_id();

-- Re-read the highest used number of every prefix. Run after a bulk import.
-- +goose StatementBegin
CREATE FUNCTION reseed_id_counters() RETURNS void AS $$
DECLARE r record; m bigint;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('PRJ','projects','project_id'), ('TKT','customer_tickets','ticket_id'), ('TASK','technician_tasks','task_id'),
      ('REQ','technician_requisitions','requisition_id'), ('PRC','procurement_requests','procurement_id'),
      ('CUS','customers','id'), ('HSP','hotspots','id'), ('SPL','splitters','id'), ('ENC','enclosures','id'),
      ('OLT','olts','id'), ('DN','delivery_notes','doc_no'), ('RN','delivery_notes','doc_no'),
      ('INV-ONT','serialized_inventory','asset_id'), ('INV-RTR','serialized_inventory','asset_id'),
      ('INV-NET','serialized_inventory','asset_id'), ('INV-FAT','serialized_inventory','asset_id'),
      ('INV-UNIT','serialized_inventory','asset_id')) AS t(prefix, tbl, col)
  LOOP
    EXECUTE format('SELECT max((regexp_match(%I, %L))[1]::bigint) FROM %I', r.col, '^' || r.prefix || '-([0-9]+)$', r.tbl) INTO m;
    IF m IS NOT NULL THEN
      INSERT INTO id_counters (prefix, last_value) VALUES (r.prefix, m)
      ON CONFLICT (prefix) DO UPDATE SET last_value = greatest(id_counters.last_value, EXCLUDED.last_value);
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- ---- name / email -> users.id ------------------------------------------------------------------
-- The workbook stores people as free text. Resolve to a user only when exactly one user matches.
-- EXECUTE FUNCTION resolve_user_ref('name_col', 'id_col' [, 'email_col'])
-- +goose StatementBegin
CREATE FUNCTION resolve_user_ref() RETURNS trigger AS $$
DECLARE
  j     jsonb := to_jsonb(NEW);
  nm    text  := btrim(coalesce(j ->> TG_ARGV[0], ''));
  n     int;
  uid   uuid;
  uemail text;
BEGIN
  IF nm = '' OR (j ->> TG_ARGV[1]) IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT count(*), min(id::text)::uuid, min(email) INTO n, uid, uemail
    FROM users WHERE lower(name) = lower(nm) OR lower(email) = lower(nm);
  IF n = 1 THEN
    j := jsonb_set(j, ARRAY[TG_ARGV[1]], to_jsonb(uid));
    IF TG_NARGS >= 3 AND coalesce(j ->> TG_ARGV[2], '') = '' THEN
      j := jsonb_set(j, ARRAY[TG_ARGV[2]], to_jsonb(uemail));
    END IF;
    RETURN jsonb_populate_record(NEW, j);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE TRIGGER t1_tickets_user  BEFORE INSERT OR UPDATE OF assigned_to ON customer_tickets
  FOR EACH ROW EXECUTE FUNCTION resolve_user_ref('assigned_to', 'assigned_user_id');
CREATE TRIGGER t1_tasks_user    BEFORE INSERT OR UPDATE OF assigned_to ON technician_tasks
  FOR EACH ROW EXECUTE FUNCTION resolve_user_ref('assigned_to', 'assignee_user_id', 'assignee_email');
CREATE TRIGGER t1_reqs_user     BEFORE INSERT OR UPDATE OF technician_name ON technician_requisitions
  FOR EACH ROW EXECUTE FUNCTION resolve_user_ref('technician_name', 'technician_user_id');
CREATE TRIGGER t1_proc_user     BEFORE INSERT OR UPDATE OF requested_by ON procurement_requests
  FOR EACH ROW EXECUTE FUNCTION resolve_user_ref('requested_by', 'requested_by_user_id');
CREATE TRIGGER t1_projects_user BEFORE INSERT OR UPDATE OF project_manager ON projects
  FOR EACH ROW EXECUTE FUNCTION resolve_user_ref('project_manager', 'manager_user_id');
CREATE TRIGGER t1_serialized_user BEFORE INSERT OR UPDATE OF custodian ON serialized_inventory
  FOR EACH ROW EXECUTE FUNCTION resolve_user_ref('custodian', 'custodian_user_id');
CREATE TRIGGER t1_ledger_user   BEFORE INSERT ON inventory_transactions
  FOR EACH ROW EXECUTE FUNCTION resolve_user_ref('requested_by', 'actor_user_id');

-- A project is managed by a Project Manager or an Admin (saveProject).
-- +goose StatementBegin
CREATE FUNCTION projects_manager_role() RETURNS trigger AS $$
DECLARE r text;
BEGIN
  IF NEW.manager_user_id IS NOT NULL AND coalesce(current_setting('app.import_mode', true), '') <> 'on' THEN
    SELECT role INTO r FROM users WHERE id = NEW.manager_user_id;
    IF r NOT IN ('Project Manager', 'Admin') THEN
      RAISE EXCEPTION 'Pick a Project Manager (or Admin) as the project manager' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd
CREATE TRIGGER t2_projects_manager BEFORE INSERT OR UPDATE OF manager_user_id ON projects
  FOR EACH ROW EXECUTE FUNCTION projects_manager_role();

-- ---- defaults applied when a record is created --------------------------------------------------
ALTER TABLE technician_requisitions ALTER COLUMN date_requested SET DEFAULT now();
ALTER TABLE procurement_requests    ALTER COLUMN date_requested SET DEFAULT now();
ALTER TABLE customer_tickets        ALTER COLUMN date_logged    SET DEFAULT now();
ALTER TABLE inventory_transactions  ALTER COLUMN transaction_date SET DEFAULT now();

-- requisition: estimated value from the catalog price (estValue_)
-- +goose StatementBegin
CREATE FUNCTION reqs_defaults() RETURNS trigger AS $$
DECLARE c numeric;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.est_value = 0 THEN
    SELECT unit_cost INTO c FROM item_catalog WHERE sku = NEW.item_sku;
    NEW.est_value := round(coalesce(c, 0) * NEW.quantity, 2);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd
CREATE TRIGGER t1_reqs_defaults BEFORE INSERT ON technician_requisitions FOR EACH ROW EXECUTE FUNCTION reqs_defaults();

-- purchase request: estimated unit cost from the catalog (createProcurement_)
-- +goose StatementBegin
CREATE FUNCTION proc_defaults() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.est_unit_cost = 0 THEN
    SELECT unit_cost INTO NEW.est_unit_cost FROM item_catalog WHERE sku = NEW.item_sku;
    NEW.est_unit_cost := coalesce(NEW.est_unit_cost, 0);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd
CREATE TRIGGER t1_proc_defaults BEFORE INSERT ON procurement_requests FOR EACH ROW EXECUTE FUNCTION proc_defaults();

-- task: starts "Awaiting Stock" when the required stock is short (createTaskInternal_)
-- +goose StatementBegin
CREATE FUNCTION tasks_initial_status() RETURNS trigger AS $$
BEGIN
  IF coalesce(current_setting('app.import_mode', true), '') = 'on' THEN RETURN NEW; END IF;
  IF NEW.status = 'Assigned' AND NEW.required_sku IS NOT NULL AND stock_balance(NEW.required_sku) < NEW.required_qty THEN
    NEW.status := 'Awaiting Stock';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd
CREATE TRIGGER t1_tasks_status BEFORE INSERT ON technician_tasks FOR EACH ROW EXECUTE FUNCTION tasks_initial_status();

-- ticket: Assigned when a technician is picked, closed_at follows Closed (logCustomerIssue / setTicketStatus_)
-- +goose StatementBegin
CREATE FUNCTION tickets_defaults() RETURNS trigger AS $$
BEGIN
  IF coalesce(current_setting('app.import_mode', true), '') <> 'on' THEN
    IF NEW.ticket_status = 'Open' AND coalesce(NEW.assigned_to, '') <> '' AND
       (TG_OP = 'INSERT' OR coalesce(OLD.assigned_to, '') = '') THEN
      NEW.ticket_status := 'Assigned';
    END IF;
  END IF;
  IF NEW.ticket_status = 'Closed' AND NEW.closed_at IS NULL THEN NEW.closed_at := now(); END IF;
  IF NEW.ticket_status <> 'Closed' THEN NEW.closed_at := NULL; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd
CREATE TRIGGER t1_tickets_defaults BEFORE INSERT OR UPDATE ON customer_tickets FOR EACH ROW EXECUTE FUNCTION tickets_defaults();

-- a ticket on a device marks the unit (setUnitTicket_)
-- +goose StatementBegin
CREATE FUNCTION tickets_mark_unit() RETURNS trigger AS $$
BEGIN
  IF NEW.device_asset_id IS NOT NULL THEN
    UPDATE serialized_inventory SET linked_ticket_id = NEW.ticket_id WHERE asset_id = NEW.device_asset_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd
CREATE TRIGGER t5_tickets_mark_unit AFTER INSERT OR UPDATE OF device_asset_id ON customer_tickets
  FOR EACH ROW EXECUTE FUNCTION tickets_mark_unit();

-- +goose Down
DROP TRIGGER IF EXISTS t5_tickets_mark_unit ON customer_tickets;
DROP FUNCTION IF EXISTS tickets_mark_unit();
DROP TRIGGER IF EXISTS t1_tickets_defaults ON customer_tickets;
DROP FUNCTION IF EXISTS tickets_defaults();
DROP TRIGGER IF EXISTS t1_tasks_status ON technician_tasks;
DROP FUNCTION IF EXISTS tasks_initial_status();
DROP TRIGGER IF EXISTS t1_proc_defaults ON procurement_requests;
DROP FUNCTION IF EXISTS proc_defaults();
DROP TRIGGER IF EXISTS t1_reqs_defaults ON technician_requisitions;
DROP FUNCTION IF EXISTS reqs_defaults();
DROP TRIGGER IF EXISTS t2_projects_manager ON projects;
DROP FUNCTION IF EXISTS projects_manager_role();
DROP TRIGGER IF EXISTS t1_ledger_user ON inventory_transactions;
DROP TRIGGER IF EXISTS t1_serialized_user ON serialized_inventory;
DROP TRIGGER IF EXISTS t1_projects_user ON projects;
DROP TRIGGER IF EXISTS t1_proc_user ON procurement_requests;
DROP TRIGGER IF EXISTS t1_reqs_user ON technician_requisitions;
DROP TRIGGER IF EXISTS t1_tasks_user ON technician_tasks;
DROP TRIGGER IF EXISTS t1_tickets_user ON customer_tickets;
DROP FUNCTION IF EXISTS resolve_user_ref();
DROP FUNCTION IF EXISTS reseed_id_counters();
DROP TRIGGER IF EXISTS t0_serialized_id ON serialized_inventory;
DROP FUNCTION IF EXISTS serialized_autofill_id();
DROP FUNCTION IF EXISTS next_asset_id(text);
DROP TRIGGER IF EXISTS t0_notes_no ON delivery_notes;
DROP FUNCTION IF EXISTS notes_autofill_no();
DROP TRIGGER IF EXISTS t0_olts_id ON olts;
DROP TRIGGER IF EXISTS t0_enclosures_id ON enclosures;
DROP TRIGGER IF EXISTS t0_splitters_id ON splitters;
DROP TRIGGER IF EXISTS t0_hotspots_id ON hotspots;
DROP TRIGGER IF EXISTS t0_customers_id ON customers;
DROP TRIGGER IF EXISTS t0_proc_id ON procurement_requests;
DROP TRIGGER IF EXISTS t0_reqs_id ON technician_requisitions;
DROP TRIGGER IF EXISTS t0_tasks_id ON technician_tasks;
DROP TRIGGER IF EXISTS t0_tickets_id ON customer_tickets;
DROP TRIGGER IF EXISTS t0_projects_id ON projects;
DROP FUNCTION IF EXISTS autofill_id();
DROP FUNCTION IF EXISTS next_id(text, int);
DROP TABLE IF EXISTS id_counters;
DROP FUNCTION IF EXISTS setting_on(text);
DROP FUNCTION IF EXISTS get_setting(text, text);
ALTER TABLE inventory_transactions ALTER COLUMN transaction_date DROP DEFAULT;
ALTER TABLE customer_tickets ALTER COLUMN date_logged DROP DEFAULT;
ALTER TABLE procurement_requests ALTER COLUMN date_requested DROP DEFAULT;
ALTER TABLE technician_requisitions ALTER COLUMN date_requested DROP DEFAULT;
