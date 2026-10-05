-- +goose Up
-- Customers (PPPoE over fibre, or hotspot users), hotspots (ONU on fibre + APs over Ethernet),
-- and device_installations: which serialized unit sits where, with history.

CREATE TABLE hotspots (
  id                 text PRIMARY KEY CHECK (id <> ''),         -- HSP-001
  name               text NOT NULL CHECK (name <> ''),
  plots              text,
  location           text,
  contact_person     text,
  phone              text CHECK (phone ~ '^[+0-9][0-9[:space:]()-]{6,}$'),
  status             text NOT NULL DEFAULT 'Active'
                       CHECK (status IN ('Active', 'Planned', 'Suspended', 'Decommissioned')),
  ssid               text,
  genieacs_device_id text,
  install_date       date,
  notes              text,
  created_by         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE customers (
  id                 text PRIMARY KEY CHECK (id <> ''),         -- CUS-0001
  name               text NOT NULL CHECK (name <> ''),
  subscription_type  text NOT NULL DEFAULT 'PPPoE' CHECK (subscription_type IN ('PPPoE', 'Hotspot User')),
  account_no         text NOT NULL,
  contact_person     text,
  phone              text CHECK (phone ~ '^[+0-9][0-9[:space:]()-]{6,}$'),
  email              text CHECK (email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  plot_no            text,
  location           text,
  hotspot_id         text REFERENCES hotspots (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  pppoe_username     text,
  package            text,
  status             text NOT NULL DEFAULT 'Active'
                       CHECK (status IN ('Active', 'Suspended', 'Disconnected', 'Pending Install')),
  genieacs_device_id text,
  install_date       date,
  notes              text,
  created_by         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  -- a hotspot user belongs to a hotspot; a PPPoE customer does not
  CHECK ((subscription_type = 'Hotspot User') = (hotspot_id IS NOT NULL))
);
CREATE UNIQUE INDEX customers_account_uq ON customers (lower(account_no));
CREATE UNIQUE INDEX customers_pppoe_uq   ON customers (lower(pppoe_username)) WHERE pppoe_username IS NOT NULL;
CREATE INDEX customers_hotspot_idx ON customers (hotspot_id);
CREATE INDEX customers_status_idx  ON customers (status);

-- +goose StatementBegin
CREATE FUNCTION customers_defaults() RETURNS trigger AS $$
BEGIN
  IF NEW.account_no IS NULL OR NEW.account_no = '' THEN
    NEW.account_no := NEW.id;                     -- same default as saveCustomer()
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE TRIGGER t1_customers_blank BEFORE INSERT OR UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION blank_to_null('phone', 'email', 'hotspot_id', 'pppoe_username');
CREATE TRIGGER t2_customers_defaults BEFORE INSERT OR UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION customers_defaults();
CREATE TRIGGER t1_hotspots_blank BEFORE INSERT OR UPDATE ON hotspots
  FOR EACH ROW EXECUTE FUNCTION blank_to_null('phone');
CREATE TRIGGER t3_customers_updated BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER t3_hotspots_updated  BEFORE UPDATE ON hotspots  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Port occupants now exist: link them. A deleted customer / hotspot frees its port.
ALTER TABLE splitter_ports
  ADD CONSTRAINT splitter_ports_customer_fk FOREIGN KEY (customer_id) REFERENCES customers (id) ON UPDATE CASCADE ON DELETE SET NULL,
  ADD CONSTRAINT splitter_ports_hotspot_fk  FOREIGN KEY (hotspot_id)  REFERENCES hotspots  (id) ON UPDATE CASCADE ON DELETE SET NULL;

-- Wi-Fi accounts / vouchers served by a hotspot (RADIUS side). A hotspot user may also be a billed customer.
CREATE TABLE hotspot_users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotspot_id        text NOT NULL REFERENCES hotspots (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  customer_id       text REFERENCES customers (id) ON UPDATE CASCADE ON DELETE SET NULL,
  username          text NOT NULL,
  password_hash     text,
  phone             text,
  mac_address       text,
  subscription_plan text,
  expires_at        timestamptz,
  status            text NOT NULL DEFAULT 'Active',
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX hotspot_users_username_uq ON hotspot_users (lower(username));
CREATE INDEX hotspot_users_hotspot_idx ON hotspot_users (hotspot_id);
CREATE TRIGGER t1_hotspot_users_blank BEFORE INSERT OR UPDATE ON hotspot_users
  FOR EACH ROW EXECUTE FUNCTION blank_to_null('customer_id');

CREATE TABLE vouchers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text NOT NULL,
  duration_hours   int  NOT NULL DEFAULT 3 CHECK (duration_hours > 0),
  max_devices      int  NOT NULL DEFAULT 2 CHECK (max_devices > 0),
  price            numeric(12,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  status           text NOT NULL DEFAULT 'Unused' CHECK (status IN ('Unused', 'Active', 'Expired')),
  hotspot_id       text REFERENCES hotspots (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  used_by_username text,
  activated_at     timestamptz,
  expires_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX vouchers_code_uq ON vouchers (code);
CREATE TRIGGER t1_vouchers_blank BEFORE INSERT OR UPDATE ON vouchers
  FOR EACH ROW EXECUTE FUNCTION blank_to_null('hotspot_id', 'used_by_username');

-- TR-069 snapshot cache (filled by the GenieACS sync). Joined to units by serial number, not by FK:
-- a device can be discovered before anyone has recorded it in inventory.
CREATE TABLE genieacs_devices (
  device_id        text PRIMARY KEY,
  serial_number    text NOT NULL,
  product_class    text,
  manufacturer     text,
  ip_address       text,
  mac              text,
  online_status    text NOT NULL DEFAULT 'Offline',
  last_inform      timestamptz,
  optical_rx_power numeric(6,2),
  optical_tx_power numeric(6,2),
  firmware_version text,
  uptime_seconds   bigint NOT NULL DEFAULT 0,
  wifi_ssid        text,
  wifi_status      text,
  raw_cwmp_params  jsonb,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX genieacs_serial_uq ON genieacs_devices (upper(serial_number));

-- ONU / AP installed at a customer or hotspot. Rows are kept after removal (removed_at) so a
-- replacement leaves history. Fibre ONU -> Ethernet AP is the hybrid hotspot layout.
CREATE TABLE device_installations (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  asset_id             text NOT NULL REFERENCES serialized_inventory (asset_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  role                 text NOT NULL CHECK (role IN ('ONU', 'AP')),
  customer_id          text REFERENCES customers (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  hotspot_id           text REFERENCES hotspots  (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  uplink_medium        text NOT NULL CHECK (uplink_medium IN ('Fibre', 'Ethernet', 'Wireless')),
  installed_at         timestamptz NOT NULL DEFAULT now(),
  removed_at           timestamptz,
  installed_by_user_id uuid REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL,
  ticket_id            text,                         -- FK added in 00006
  notes                text,
  CHECK (num_nonnulls(customer_id, hotspot_id) = 1),
  CHECK (role = 'ONU' OR (hotspot_id IS NOT NULL AND customer_id IS NULL)),   -- APs belong to hotspots
  CHECK ((role = 'ONU' AND uplink_medium = 'Fibre') OR (role = 'AP' AND uplink_medium IN ('Ethernet', 'Wireless'))),
  CHECK (removed_at IS NULL OR removed_at >= installed_at)
);
CREATE UNIQUE INDEX dev_inst_asset_active_uq    ON device_installations (asset_id)    WHERE removed_at IS NULL;
CREATE UNIQUE INDEX dev_inst_cust_onu_active_uq ON device_installations (customer_id) WHERE removed_at IS NULL AND role = 'ONU' AND customer_id IS NOT NULL;
CREATE UNIQUE INDEX dev_inst_hs_onu_active_uq   ON device_installations (hotspot_id)  WHERE removed_at IS NULL AND role = 'ONU' AND hotspot_id  IS NOT NULL;
CREATE INDEX dev_inst_customer_idx ON device_installations (customer_id);
CREATE INDEX dev_inst_hotspot_idx  ON device_installations (hotspot_id);
CREATE INDEX dev_inst_asset_idx    ON device_installations (asset_id);

-- checkUnitFree_(): a unit can be installed only if it has left the store; and a hotspot user has no ONU of its own.
-- +goose StatementBegin
CREATE FUNCTION device_installations_guard() RETURNS trigger AS $$
DECLARE
  u_status text;
  sub      text;
BEGIN
  IF NEW.uplink_medium IS NULL THEN
    NEW.uplink_medium := CASE NEW.role WHEN 'ONU' THEN 'Fibre' ELSE 'Ethernet' END;
  END IF;
  IF NEW.removed_at IS NULL AND (TG_OP = 'INSERT' OR OLD.removed_at IS NOT NULL OR OLD.asset_id <> NEW.asset_id) THEN
    SELECT status INTO u_status FROM serialized_inventory WHERE asset_id = NEW.asset_id;
    IF u_status IS DISTINCT FROM 'Issued / Out' THEN
      RAISE EXCEPTION 'Unit % is "%". Issue it first (requisition or stock movement) before installing it.',
        NEW.asset_id, coalesce(u_status, 'unknown') USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.customer_id IS NOT NULL THEN
    SELECT subscription_type INTO sub FROM customers WHERE id = NEW.customer_id;
    IF sub IS DISTINCT FROM 'PPPoE' THEN
      RAISE EXCEPTION 'Customer % is a hotspot user: install the unit at its hotspot instead', NEW.customer_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE TRIGGER t1_dev_inst_blank BEFORE INSERT OR UPDATE ON device_installations
  FOR EACH ROW EXECUTE FUNCTION blank_to_null('customer_id', 'hotspot_id', 'ticket_id');
CREATE TRIGGER t2_dev_inst_guard BEFORE INSERT OR UPDATE ON device_installations
  FOR EACH ROW EXECUTE FUNCTION device_installations_guard();

-- An installed unit cannot go back to "In Stock" until its installation is closed.
-- +goose StatementBegin
CREATE FUNCTION serialized_not_installed() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'In Stock' AND OLD.status <> 'In Stock'
     AND EXISTS (SELECT 1 FROM device_installations WHERE asset_id = NEW.asset_id AND removed_at IS NULL) THEN
    RAISE EXCEPTION 'Unit % is still installed - close its installation before returning it to stock', NEW.asset_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE TRIGGER t4_serialized_not_installed BEFORE UPDATE OF status ON serialized_inventory
  FOR EACH ROW EXECUTE FUNCTION serialized_not_installed();

-- +goose Down
DROP TRIGGER IF EXISTS t4_serialized_not_installed ON serialized_inventory;
DROP FUNCTION IF EXISTS serialized_not_installed();
DROP TABLE IF EXISTS device_installations;
DROP FUNCTION IF EXISTS device_installations_guard();
DROP TABLE IF EXISTS genieacs_devices;
DROP TABLE IF EXISTS vouchers;
DROP TABLE IF EXISTS hotspot_users;
ALTER TABLE splitter_ports DROP CONSTRAINT IF EXISTS splitter_ports_customer_fk;
ALTER TABLE splitter_ports DROP CONSTRAINT IF EXISTS splitter_ports_hotspot_fk;
DROP TABLE IF EXISTS customers;
DROP FUNCTION IF EXISTS customers_defaults();
DROP TABLE IF EXISTS hotspots;
