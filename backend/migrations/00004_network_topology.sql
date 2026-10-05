-- +goose Up
-- Fibre plant:  OLT -> PON port -> splitter (primary) -> splitter (secondary) -> customer / hotspot ONU.
-- Enclosures (FAT box, joint closure, ...) hold splitters and carry the GPS position.
-- Ports are ROWS (splitter_ports), so "one port, one occupant" is a primary key, not application code.

CREATE TABLE olts (
  id         text PRIMARY KEY CHECK (id <> ''),
  name       text NOT NULL,
  ip_address text,
  vendor     text,
  model      text,
  location   text,
  status     text NOT NULL DEFAULT 'Online' CHECK (status IN ('Online', 'Offline', 'Planned', 'Decommissioned')),
  notes      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pon_ports (
  id          text PRIMARY KEY CHECK (id <> ''),               -- e.g. OLT-01/PON-1
  olt_id      text NOT NULL REFERENCES olts (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  port_number int  NOT NULL CHECK (port_number > 0),
  technology  text NOT NULL DEFAULT 'GPON',
  status      text NOT NULL DEFAULT 'Online',
  notes       text,
  UNIQUE (olt_id, port_number)
);

CREATE TABLE enclosures (
  id         text PRIMARY KEY CHECK (id <> ''),                -- ENC-001
  name       text NOT NULL CHECK (name <> ''),
  type       text NOT NULL DEFAULT 'FAT Box'
               CHECK (type IN ('FAT Box', 'Joint Closure', 'Pole Box', 'Cabinet', 'Other')),
  location   text,
  plot_area  text,
  latitude   numeric(9,6) CHECK (latitude  BETWEEN -90  AND 90),
  longitude  numeric(9,6) CHECK (longitude BETWEEN -180 AND 180),
  capacity   int CHECK (capacity >= 0),
  status     text NOT NULL DEFAULT 'Active',
  notes      text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((latitude IS NULL) = (longitude IS NULL))
);

CREATE TABLE splitters (
  id            text PRIMARY KEY CHECK (id <> ''),             -- SPL-001
  name          text NOT NULL CHECK (name <> ''),
  ratio         text NOT NULL CHECK (ratio IN ('1:2', '1:4', '1:8', '1:16', '1:32', '1:64')),
  port_count    int  GENERATED ALWAYS AS (split_part(ratio, ':', 2)::int) STORED,
  pon_port_id   text REFERENCES pon_ports (id)  ON UPDATE CASCADE ON DELETE RESTRICT,
  uplink_ref    text,                                          -- sheet text "OLT / PON Port" when it cannot be parsed
  enclosure_id  text REFERENCES enclosures (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  status        text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Planned', 'Decommissioned')),
  notes         text,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE splitters IS
  'Primary / Secondary level and the parent splitter are DERIVED from splitter_ports (child_splitter_id), see v_splitters.';
CREATE INDEX splitters_enclosure_idx ON splitters (enclosure_id);
CREATE INDEX splitters_pon_idx       ON splitters (pon_port_id);

-- One row per physical port. customer_id / hotspot_id FKs are added in 00005 (tables do not exist yet).
CREATE TABLE splitter_ports (
  splitter_id       text NOT NULL REFERENCES splitters (id) ON UPDATE CASCADE ON DELETE CASCADE,
  port_no           int  NOT NULL CHECK (port_no > 0),
  customer_id       text,
  hotspot_id        text,
  child_splitter_id text REFERENCES splitters (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  assigned_at       timestamptz,
  PRIMARY KEY (splitter_id, port_no),
  CHECK (num_nonnulls(customer_id, hotspot_id, child_splitter_id) <= 1),
  CHECK (child_splitter_id IS DISTINCT FROM splitter_id)
);
-- An occupant uses exactly one port anywhere in the network.
CREATE UNIQUE INDEX splitter_ports_customer_uq ON splitter_ports (customer_id)       WHERE customer_id       IS NOT NULL;
CREATE UNIQUE INDEX splitter_ports_hotspot_uq  ON splitter_ports (hotspot_id)        WHERE hotspot_id        IS NOT NULL;
CREATE UNIQUE INDEX splitter_ports_child_uq    ON splitter_ports (child_splitter_id) WHERE child_splitter_id IS NOT NULL;

-- Keep one port row per physical port of the ratio. Shrinking is refused while upper ports are in use.
-- +goose StatementBegin
CREATE FUNCTION splitters_sync_ports() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.port_count < OLD.port_count THEN
    IF EXISTS (SELECT 1 FROM splitter_ports
                WHERE splitter_id = NEW.id AND port_no > NEW.port_count
                  AND num_nonnulls(customer_id, hotspot_id, child_splitter_id) > 0) THEN
      RAISE EXCEPTION 'Cannot change % to %: ports above % are in use', NEW.id, NEW.ratio, NEW.port_count
        USING ERRCODE = 'check_violation';
    END IF;
    DELETE FROM splitter_ports WHERE splitter_id = NEW.id AND port_no > NEW.port_count;
  END IF;
  INSERT INTO splitter_ports (splitter_id, port_no)
    SELECT NEW.id, g FROM generate_series(1, NEW.port_count) AS g
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE TRIGGER t4_splitters_sync_ports AFTER INSERT OR UPDATE OF ratio ON splitters
  FOR EACH ROW EXECUTE FUNCTION splitters_sync_ports();

-- A splitter cannot (indirectly) feed itself: walk up from the parent, give up at the sheet's depth limit of 12.
-- +goose StatementBegin
CREATE FUNCTION splitter_ports_no_loop() RETURNS trigger AS $$
BEGIN
  IF num_nonnulls(NEW.customer_id, NEW.hotspot_id, NEW.child_splitter_id) = 0 THEN
    NEW.assigned_at := NULL;                       -- port is free
  ELSIF NEW.assigned_at IS NULL THEN
    NEW.assigned_at := now();
  END IF;
  IF NEW.child_splitter_id IS NULL THEN RETURN NEW; END IF;
  IF EXISTS (
    WITH RECURSIVE up(id, depth) AS (
      SELECT NEW.splitter_id, 0
      UNION ALL
      SELECT sp.splitter_id, up.depth + 1
        FROM splitter_ports sp JOIN up ON sp.child_splitter_id = up.id
       WHERE up.depth < 12
    )
    SELECT 1 FROM up WHERE id = NEW.child_splitter_id
  ) THEN
    RAISE EXCEPTION 'Splitter % cannot feed % - that would create a loop', NEW.child_splitter_id, NEW.splitter_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE TRIGGER t2_splitter_ports_guard BEFORE INSERT OR UPDATE ON splitter_ports
  FOR EACH ROW EXECUTE FUNCTION splitter_ports_no_loop();

CREATE TRIGGER t1_pon_blank BEFORE INSERT OR UPDATE ON splitters
  FOR EACH ROW EXECUTE FUNCTION blank_to_null('pon_port_id', 'enclosure_id');
CREATE TRIGGER t1_sp_blank BEFORE INSERT OR UPDATE ON splitter_ports
  FOR EACH ROW EXECUTE FUNCTION blank_to_null('customer_id', 'hotspot_id', 'child_splitter_id');
CREATE TRIGGER t3_olts_updated       BEFORE UPDATE ON olts       FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER t3_enclosures_updated BEFORE UPDATE ON enclosures FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER t3_splitters_updated  BEFORE UPDATE ON splitters  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- +goose Down
DROP TABLE IF EXISTS splitter_ports;
DROP FUNCTION IF EXISTS splitter_ports_no_loop();
DROP TABLE IF EXISTS splitters;
DROP FUNCTION IF EXISTS splitters_sync_ports();
DROP TABLE IF EXISTS enclosures;
DROP TABLE IF EXISTS pon_ports;
DROP TABLE IF EXISTS olts;
