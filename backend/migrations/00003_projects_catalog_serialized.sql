-- +goose Up
-- Projects, item catalog, and per-unit serialized inventory.

CREATE TABLE projects (
  project_id      text PRIMARY KEY CHECK (project_id <> ''),
  project_name    text NOT NULL CHECK (project_name <> ''),
  type            text NOT NULL DEFAULT 'Deployment'
                    CHECK (type IN ('Deployment', 'Upgrade', 'Maintenance', 'Expansion', 'Other')),
  status          text NOT NULL DEFAULT 'Planning',     -- validated by the project workflow
  location_fat    text,
  project_manager text,                                  -- name as written in the sheet
  manager_user_id uuid REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL,
  budget          numeric(12,2) NOT NULL DEFAULT 0 CHECK (budget >= 0),
  start_date      date,
  end_date        date,
  notes           text,
  created_by      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);
COMMENT ON TABLE projects IS 'Spend is NOT stored here: it is derived from the ledger (see v_project_cost).';
CREATE INDEX projects_manager_idx ON projects (manager_user_id);
CREATE TRIGGER t1_projects_blank BEFORE INSERT OR UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION blank_to_null('manager_user_id');
CREATE TRIGGER t3_projects_updated BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Lookup instead of a CHECK so new cost types need an INSERT, not a migration.
CREATE TABLE cost_types (
  code        text PRIMARY KEY,
  description text NOT NULL DEFAULT ''
);
INSERT INTO cost_types (code, description) VALUES
  ('Installation',           'Stock issued to install at a customer, hotspot or project'),
  ('Replacement',            'Stock issued to replace a faulty unit'),
  ('Procurement / Stock In', 'Goods received from a purchase'),
  ('Adjustment',             'Opening balance or reconciliation correction'),
  ('Internal Use',           'Consumed internally'),
  ('Other',                  'Unclassified');

CREATE TABLE item_catalog (
  sku           text PRIMARY KEY CHECK (sku <> ''),
  asset_type    text,
  manufacturer  text,
  model         text NOT NULL CHECK (model <> ''),
  access_tech   text,
  unit_cost     numeric(12,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  description   text,
  reorder_level int NOT NULL DEFAULT 3 CHECK (reorder_level >= 0),
  tracking_type text NOT NULL DEFAULT 'BULK' CHECK (tracking_type IN ('SERIALIZED', 'BULK', 'NONSER')),
  project_scope text REFERENCES projects (project_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON COLUMN item_catalog.project_scope IS 'NULL = shared. Otherwise the item may only be requested / purchased against that project.';
CREATE INDEX item_catalog_scope_idx ON item_catalog (project_scope);
CREATE TRIGGER t1_item_catalog_blank BEFORE INSERT OR UPDATE ON item_catalog
  FOR EACH ROW EXECUTE FUNCTION blank_to_null('project_scope');
CREATE TRIGGER t3_item_catalog_updated BEFORE UPDATE ON item_catalog FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE serialized_inventory (
  asset_id           text PRIMARY KEY CHECK (asset_id <> ''),
  sku                text NOT NULL REFERENCES item_catalog (sku) ON UPDATE CASCADE ON DELETE RESTRICT,
  asset_type         text,
  manufacturer       text,
  model              text,
  access_tech        text,
  product_id         text,
  mac                text CHECK (mac ~ '^[0-9A-F]{12}$'),
  serial_number      text,
  status             text NOT NULL DEFAULT 'In Stock'
                       CHECK (status IN ('In Stock', 'Issued / Out', 'Under Repair', 'Decommissioned')),
  condition          text NOT NULL DEFAULT 'Not Recorded'
                       CHECK (condition IN ('New', 'Used', 'Good', 'Needs Repair', 'Damaged', 'Faulty', 'Not Recorded')),
  location           text,
  custodian          text,
  custodian_user_id  uuid REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL,
  notes              text,
  current_project_id text REFERENCES projects (project_id) ON UPDATE CASCADE ON DELETE SET NULL,
  linked_ticket_id   text,   -- FK added in 00006 once customer_tickets exists
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE serialized_inventory IS
  'Which customer / hotspot a unit sits at is NOT stored here: see device_installations (one place per unit, with history).';
CREATE UNIQUE INDEX serialized_serial_uq ON serialized_inventory (serial_number) WHERE serial_number IS NOT NULL;
CREATE UNIQUE INDEX serialized_mac_uq    ON serialized_inventory (mac)           WHERE mac IS NOT NULL;
CREATE INDEX serialized_sku_idx    ON serialized_inventory (sku);
CREATE INDEX serialized_status_idx ON serialized_inventory (status);

-- +goose StatementBegin
CREATE FUNCTION serialized_normalise() RETURNS trigger AS $$
DECLARE trk text;
BEGIN
  IF NEW.mac IS NOT NULL THEN
    NEW.mac := upper(regexp_replace(NEW.mac, '[^0-9A-Fa-f]', '', 'g'));
    IF NEW.mac = '' THEN NEW.mac := NULL; END IF;
  END IF;
  IF NEW.serial_number IS NOT NULL THEN
    NEW.serial_number := upper(regexp_replace(NEW.serial_number, '\s+', '', 'g'));
    IF NEW.serial_number = '' THEN NEW.serial_number := NULL; END IF;
  END IF;
  SELECT tracking_type INTO trk FROM item_catalog WHERE sku = NEW.sku;
  IF trk IS DISTINCT FROM 'SERIALIZED' THEN
    RAISE EXCEPTION 'Unit % uses SKU % whose catalog tracking is %, not SERIALIZED', NEW.asset_id, NEW.sku, coalesce(trk, 'unknown')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE TRIGGER t1_serialized_blank BEFORE INSERT OR UPDATE ON serialized_inventory
  FOR EACH ROW EXECUTE FUNCTION blank_to_null('mac', 'serial_number', 'current_project_id', 'linked_ticket_id');
CREATE TRIGGER t2_serialized_normalise BEFORE INSERT OR UPDATE ON serialized_inventory
  FOR EACH ROW EXECUTE FUNCTION serialized_normalise();
CREATE TRIGGER t3_serialized_updated BEFORE UPDATE ON serialized_inventory
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- +goose Down
DROP TABLE IF EXISTS serialized_inventory;
DROP FUNCTION IF EXISTS serialized_normalise();
DROP TABLE IF EXISTS item_catalog;
DROP TABLE IF EXISTS cost_types;
DROP TABLE IF EXISTS projects;
