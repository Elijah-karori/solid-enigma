-- +goose Up
-- Roles, permissions (seeded from the Apps Script CAN_ matrix + the Go-only extras),
-- users, sessions, settings, and the workflow state machines that tie roles to status changes.

CREATE TABLE roles (
  name        text PRIMARY KEY,
  description text NOT NULL DEFAULT '',
  sort_order  int  NOT NULL DEFAULT 0
);

CREATE TABLE permissions (
  code        text PRIMARY KEY,
  description text NOT NULL DEFAULT ''
);

CREATE TABLE role_permissions (
  role       text NOT NULL REFERENCES roles (name)        ON UPDATE CASCADE ON DELETE CASCADE,
  permission text NOT NULL REFERENCES permissions (code)  ON UPDATE CASCADE ON DELETE CASCADE,
  PRIMARY KEY (role, permission)
);

INSERT INTO roles (name, sort_order) VALUES
  ('Admin', 1),
  ('Store Manager', 2),
  ('Finance', 3),
  ('Project Manager', 4),
  ('Support', 5),
  ('Technician', 6);

INSERT INTO permissions (code, description) VALUES
  ('viewCosts', 'See unit costs and values'),
  ('viewLedger', 'See the transaction ledger'),
  ('manageUsers', 'Create and edit users'),
  ('viewStock', 'See stock balances'),
  ('manageCatalog', 'Edit the item catalog'),
  ('moveStock', 'Record stock movements'),
  ('manageDevices', 'Edit serialized units'),
  ('approveReq', 'Operations approval and issue of requisitions'),
  ('approveFinance', 'Finance clearance of requisitions'),
  ('viewAllReqs', 'See every requisition'),
  ('createTicket', 'Log customer tickets'),
  ('viewAllTickets', 'See every ticket'),
  ('createTask', 'Create and manage tasks'),
  ('viewAllTasks', 'See every task'),
  ('requestMaterial', 'Raise a requisition'),
  ('manageProjects', 'Create and edit projects'),
  ('viewProcurement', 'See purchase requests'),
  ('requestProcurement', 'Raise a purchase request'),
  ('approveProcurement', 'Finance approval of purchases'),
  ('receiveProcurement', 'Order and receive purchases'),
  ('generatePDF', 'Generate delivery and receipt notes'),
  ('viewDocs', 'See delivery and receipt notes'),
  ('managePayments', 'Mark notes paid'),
  ('viewAudit', 'See history of one record'),
  ('viewAuditAll', 'See the full audit trail'),
  ('viewNetwork', 'See the network map'),
  ('manageCustomers', 'Create and edit customers and hotspots'),
  ('manageNetwork', 'Edit enclosures, splitters and install details'),
  ('replaceDevice', 'Swap a faulty ONU or AP'),
  ('viewDashboard', 'See the dashboard'),
  ('viewNotifications', 'See the notification log'),
  ('manageSettings', 'Edit settings'),
  ('genieacsRead', 'Read TR-069 device data'),
  ('genieacsAct', 'Run TR-069 actions');

INSERT INTO role_permissions (role, permission) VALUES
  ('Admin', 'viewCosts'),
  ('Finance', 'viewCosts'),
  ('Admin', 'viewLedger'),
  ('Finance', 'viewLedger'),
  ('Admin', 'manageUsers'),
  ('Admin', 'viewStock'),
  ('Store Manager', 'viewStock'),
  ('Finance', 'viewStock'),
  ('Project Manager', 'viewStock'),
  ('Admin', 'manageCatalog'),
  ('Store Manager', 'manageCatalog'),
  ('Admin', 'moveStock'),
  ('Store Manager', 'moveStock'),
  ('Admin', 'manageDevices'),
  ('Store Manager', 'manageDevices'),
  ('Admin', 'approveReq'),
  ('Store Manager', 'approveReq'),
  ('Admin', 'approveFinance'),
  ('Finance', 'approveFinance'),
  ('Admin', 'viewAllReqs'),
  ('Store Manager', 'viewAllReqs'),
  ('Finance', 'viewAllReqs'),
  ('Admin', 'createTicket'),
  ('Store Manager', 'createTicket'),
  ('Support', 'createTicket'),
  ('Admin', 'viewAllTickets'),
  ('Store Manager', 'viewAllTickets'),
  ('Support', 'viewAllTickets'),
  ('Admin', 'createTask'),
  ('Store Manager', 'createTask'),
  ('Support', 'createTask'),
  ('Project Manager', 'createTask'),
  ('Admin', 'viewAllTasks'),
  ('Store Manager', 'viewAllTasks'),
  ('Support', 'viewAllTasks'),
  ('Project Manager', 'viewAllTasks'),
  ('Finance', 'viewAllTasks'),
  ('Admin', 'requestMaterial'),
  ('Store Manager', 'requestMaterial'),
  ('Technician', 'requestMaterial'),
  ('Project Manager', 'requestMaterial'),
  ('Admin', 'manageProjects'),
  ('Project Manager', 'manageProjects'),
  ('Admin', 'viewProcurement'),
  ('Store Manager', 'viewProcurement'),
  ('Finance', 'viewProcurement'),
  ('Project Manager', 'viewProcurement'),
  ('Admin', 'requestProcurement'),
  ('Store Manager', 'requestProcurement'),
  ('Project Manager', 'requestProcurement'),
  ('Admin', 'approveProcurement'),
  ('Finance', 'approveProcurement'),
  ('Admin', 'receiveProcurement'),
  ('Store Manager', 'receiveProcurement'),
  ('Admin', 'generatePDF'),
  ('Store Manager', 'generatePDF'),
  ('Finance', 'generatePDF'),
  ('Project Manager', 'generatePDF'),
  ('Admin', 'viewDocs'),
  ('Store Manager', 'viewDocs'),
  ('Finance', 'viewDocs'),
  ('Project Manager', 'viewDocs'),
  ('Admin', 'managePayments'),
  ('Finance', 'managePayments'),
  ('Admin', 'viewAudit'),
  ('Finance', 'viewAudit'),
  ('Store Manager', 'viewAudit'),
  ('Admin', 'viewAuditAll'),
  ('Finance', 'viewAuditAll'),
  ('Admin', 'viewNetwork'),
  ('Store Manager', 'viewNetwork'),
  ('Support', 'viewNetwork'),
  ('Technician', 'viewNetwork'),
  ('Project Manager', 'viewNetwork'),
  ('Admin', 'manageCustomers'),
  ('Store Manager', 'manageCustomers'),
  ('Support', 'manageCustomers'),
  ('Admin', 'manageNetwork'),
  ('Store Manager', 'manageNetwork'),
  ('Technician', 'manageNetwork'),
  ('Admin', 'replaceDevice'),
  ('Store Manager', 'replaceDevice'),
  ('Technician', 'replaceDevice'),
  ('Admin', 'viewDashboard'),
  ('Store Manager', 'viewDashboard'),
  ('Finance', 'viewDashboard'),
  ('Project Manager', 'viewDashboard'),
  ('Support', 'viewDashboard'),
  ('Technician', 'viewDashboard'),
  ('Admin', 'viewNotifications'),
  ('Finance', 'viewNotifications'),
  ('Admin', 'manageSettings'),
  ('Admin', 'genieacsRead'),
  ('Store Manager', 'genieacsRead'),
  ('Support', 'genieacsRead'),
  ('Technician', 'genieacsRead'),
  ('Admin', 'genieacsAct'),
  ('Support', 'genieacsAct'),
  ('Technician', 'genieacsAct');

CREATE TABLE users (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id           text,
  email               text NOT NULL,
  password_hash       text NOT NULL DEFAULT '',
  must_reset_password boolean NOT NULL DEFAULT false,
  failed_logins       int  NOT NULL DEFAULT 0,
  locked_until        timestamptz,
  last_login_at       timestamptz,
  name                text NOT NULL,
  role                text NOT NULL REFERENCES roles (name) ON UPDATE CASCADE ON DELETE RESTRICT,
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  site_station        text,
  contact_info        text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));
CREATE INDEX users_name_idx ON users (lower(name));
CREATE TRIGGER t3_users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE sessions (
  id          text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  refresh_jti text,
  user_agent  text,
  ip_address  text,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE otp_codes (
  id            text PRIMARY KEY,
  email         text NOT NULL,
  purpose       text NOT NULL CHECK (purpose IN ('login', 'reset')),
  code_hash     text NOT NULL,
  expires_at    timestamptz NOT NULL,
  attempts      int  NOT NULL DEFAULT 0,
  consumed_at   timestamptz,
  reset_jti     text,
  reset_used_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_codes_email_idx ON otp_codes (email);

CREATE TABLE settings (
  key        text PRIMARY KEY,
  value      text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notification_logs (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  timestamp timestamptz NOT NULL,
  type      text NOT NULL DEFAULT '',
  reference text NOT NULL DEFAULT '',
  recipient text NOT NULL DEFAULT '',
  subject   text NOT NULL DEFAULT '',
  status    text NOT NULL DEFAULT 'SENT',
  error     text NOT NULL DEFAULT '',
  legacy    boolean NOT NULL DEFAULT false
);
CREATE INDEX notification_logs_ts_idx ON notification_logs (timestamp);

-- ---- workflows: which statuses exist, who may move between them ----
CREATE TABLE workflows (
  code          text PRIMARY KEY,
  name          text NOT NULL,
  entity_table  text NOT NULL,
  status_column text NOT NULL,
  initial_state text NOT NULL
);

CREATE TABLE workflow_states (
  workflow    text NOT NULL REFERENCES workflows (code) ON UPDATE CASCADE ON DELETE CASCADE,
  state       text NOT NULL,
  is_terminal boolean NOT NULL DEFAULT false,
  is_initial  boolean NOT NULL DEFAULT false,   -- a record may be CREATED in this state
  sort_order  int NOT NULL,
  PRIMARY KEY (workflow, state)
);

CREATE TABLE workflow_transitions (
  workflow            text NOT NULL,
  from_state          text NOT NULL,
  to_state            text NOT NULL,
  required_permission text REFERENCES permissions (code) ON UPDATE CASCADE ON DELETE RESTRICT,
  requires_note       boolean NOT NULL DEFAULT false,
  guard               text NOT NULL DEFAULT '',
  PRIMARY KEY (workflow, from_state, to_state),
  FOREIGN KEY (workflow, from_state) REFERENCES workflow_states (workflow, state) ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (workflow, to_state)   REFERENCES workflow_states (workflow, state) ON UPDATE CASCADE ON DELETE CASCADE
);
COMMENT ON COLUMN workflow_transitions.required_permission IS
  'NULL = performed by the system or by the record owner (assignee / requester); the application checks ownership.';

INSERT INTO workflows (code, name, entity_table, status_column, initial_state) VALUES ('requisition', 'Technician requisition', 'technician_requisitions', 'approval_status', 'Pending Approval');
INSERT INTO workflow_states (workflow, state, is_terminal, sort_order) VALUES
  ('requisition', 'Pending Approval', false, 1),
  ('requisition', 'Pending Finance', false, 2),
  ('requisition', 'Approved - Ready', false, 3),
  ('requisition', 'Awaiting Stock', false, 4),
  ('requisition', 'Issued', true, 5),
  ('requisition', 'Rejected', true, 6),
  ('requisition', 'Cancelled', true, 7);
INSERT INTO workflow_transitions (workflow, from_state, to_state, required_permission, requires_note, guard) VALUES
  ('requisition', 'Pending Approval', 'Pending Finance', 'approveReq', false, 'Value at or above FINANCE_APPROVAL_THRESHOLD, or project would exceed budget'),
  ('requisition', 'Pending Approval', 'Approved - Ready', 'approveReq', false, 'Stock available after reservations'),
  ('requisition', 'Pending Approval', 'Awaiting Stock', 'approveReq', false, 'Stock short'),
  ('requisition', 'Pending Approval', 'Rejected', 'approveReq', true, 'Requester cannot approve own requisition (Admin excepted)'),
  ('requisition', 'Pending Approval', 'Cancelled', 'requestMaterial', false, 'Requester only'),
  ('requisition', 'Pending Finance', 'Approved - Ready', 'approveFinance', false, 'Stock available after reservations'),
  ('requisition', 'Pending Finance', 'Awaiting Stock', 'approveFinance', false, 'Stock short'),
  ('requisition', 'Pending Finance', 'Rejected', 'approveFinance', true, ''),
  ('requisition', 'Pending Finance', 'Cancelled', 'requestMaterial', false, 'Requester only'),
  ('requisition', 'Awaiting Stock', 'Approved - Ready', NULL, false, 'System: stock received'),
  ('requisition', 'Approved - Ready', 'Issued', 'approveReq', false, 'Posts Stock Out; serialized items need exact unit selection');
INSERT INTO workflows (code, name, entity_table, status_column, initial_state) VALUES ('task', 'Technician task', 'technician_tasks', 'status', 'Assigned');
INSERT INTO workflow_states (workflow, state, is_terminal, sort_order) VALUES
  ('task', 'Assigned', false, 1),
  ('task', 'Awaiting Stock', false, 2),
  ('task', 'Ready', false, 3),
  ('task', 'In Progress', false, 4),
  ('task', 'Completed', true, 5),
  ('task', 'Cancelled', true, 6);
INSERT INTO workflow_transitions (workflow, from_state, to_state, required_permission, requires_note, guard) VALUES
  ('task', 'Assigned', 'Awaiting Stock', NULL, false, 'System: required stock short'),
  ('task', 'Assigned', 'Ready', NULL, false, 'System: required stock available'),
  ('task', 'Assigned', 'In Progress', NULL, false, 'Assignee or createTask holder'),
  ('task', 'Assigned', 'Cancelled', 'createTask', false, ''),
  ('task', 'Awaiting Stock', 'Ready', NULL, false, 'System: stock received'),
  ('task', 'Awaiting Stock', 'Assigned', 'createTask', false, ''),
  ('task', 'Awaiting Stock', 'Cancelled', 'createTask', false, ''),
  ('task', 'Ready', 'In Progress', NULL, false, 'Assignee or createTask holder'),
  ('task', 'Ready', 'Awaiting Stock', 'createTask', false, ''),
  ('task', 'Ready', 'Cancelled', 'createTask', false, ''),
  ('task', 'In Progress', 'Completed', NULL, false, 'Assignee or createTask holder; task must have been started'),
  ('task', 'In Progress', 'Cancelled', 'createTask', false, '');
INSERT INTO workflows (code, name, entity_table, status_column, initial_state) VALUES ('ticket', 'Customer ticket', 'customer_tickets', 'ticket_status', 'Open');
INSERT INTO workflow_states (workflow, state, is_terminal, sort_order) VALUES
  ('ticket', 'Open', false, 1),
  ('ticket', 'Assigned', false, 2),
  ('ticket', 'In Progress', false, 3),
  ('ticket', 'Resolved', false, 4),
  ('ticket', 'Closed', true, 5);
INSERT INTO workflow_transitions (workflow, from_state, to_state, required_permission, requires_note, guard) VALUES
  ('ticket', 'Open', 'Assigned', 'createTicket', false, 'A technician is assigned'),
  ('ticket', 'Open', 'In Progress', NULL, false, 'Assigned technician or viewAllTickets holder'),
  ('ticket', 'Open', 'Resolved', 'viewAllTickets', true, 'Resolution note required'),
  ('ticket', 'Assigned', 'In Progress', NULL, false, 'Assigned technician or viewAllTickets holder'),
  ('ticket', 'Assigned', 'Resolved', NULL, true, 'Resolution note required'),
  ('ticket', 'In Progress', 'Resolved', NULL, true, 'Resolution note required'),
  ('ticket', 'Resolved', 'In Progress', 'viewAllTickets', false, 'Re-open'),
  ('ticket', 'Resolved', 'Closed', 'viewAllTickets', false, 'Sets closed_at'),
  ('ticket', 'Open', 'Closed', 'viewAllTickets', false, ''),
  ('ticket', 'Assigned', 'Closed', 'viewAllTickets', false, ''),
  ('ticket', 'In Progress', 'Closed', 'viewAllTickets', false, '');
INSERT INTO workflows (code, name, entity_table, status_column, initial_state) VALUES ('procurement', 'Purchase request', 'procurement_requests', 'status', 'Pending Finance');
INSERT INTO workflow_states (workflow, state, is_terminal, sort_order) VALUES
  ('procurement', 'Pending Finance', false, 1),
  ('procurement', 'Approved', false, 2),
  ('procurement', 'Ordered', false, 3),
  ('procurement', 'Received', true, 4),
  ('procurement', 'Rejected', true, 5),
  ('procurement', 'Cancelled', true, 6);
INSERT INTO workflow_transitions (workflow, from_state, to_state, required_permission, requires_note, guard) VALUES
  ('procurement', 'Pending Finance', 'Approved', 'approveProcurement', false, 'Requester cannot approve own request (Admin excepted)'),
  ('procurement', 'Pending Finance', 'Rejected', 'approveProcurement', true, ''),
  ('procurement', 'Pending Finance', 'Cancelled', 'requestProcurement', false, 'Requester or Admin'),
  ('procurement', 'Approved', 'Ordered', 'receiveProcurement', false, 'Supplier required'),
  ('procurement', 'Ordered', 'Received', 'receiveProcurement', false, 'Posts Stock In');
INSERT INTO workflows (code, name, entity_table, status_column, initial_state) VALUES ('project', 'Project', 'projects', 'status', 'Planning');
INSERT INTO workflow_states (workflow, state, is_terminal, sort_order) VALUES
  ('project', 'Planning', false, 1),
  ('project', 'Active', false, 2),
  ('project', 'On Hold', false, 3),
  ('project', 'Completed', false, 4),
  ('project', 'Cancelled', false, 5);

-- States a record may be created in (createTaskInternal starts at Awaiting Stock when stock is short;
-- logCustomerIssue starts at Assigned when a technician is picked).
UPDATE workflow_states SET is_initial = true WHERE (workflow, state) IN (
  ('requisition','Pending Approval'),
  ('task','Assigned'), ('task','Awaiting Stock'),
  ('ticket','Open'), ('ticket','Assigned'),
  ('procurement','Pending Finance'),
  ('project','Planning'));

-- +goose Down
DROP TABLE IF EXISTS workflow_transitions;
DROP TABLE IF EXISTS workflow_states;
DROP TABLE IF EXISTS workflows;
DROP TABLE IF EXISTS notification_logs;
DROP TABLE IF EXISTS settings;
DROP TABLE IF EXISTS otp_codes;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS role_permissions;
DROP TABLE IF EXISTS permissions;
DROP TABLE IF EXISTS roles;
