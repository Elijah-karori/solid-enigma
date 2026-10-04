-- Extension for UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users, Roles and Permissions
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL,
    status VARCHAR(50) DEFAULT 'active',
    site_station VARCHAR(255),
    contact_info VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS magic_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL,
    token VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Item Catalog
CREATE TABLE IF NOT EXISTS item_catalog (
    sku VARCHAR(100) PRIMARY KEY,
    asset_type VARCHAR(50) NOT NULL, -- BULK, NONSER, ONT, RTR, NET, FAT
    manufacturer VARCHAR(100),
    model VARCHAR(100) NOT NULL,
    access_tech VARCHAR(50), -- GPON, XGS-PON, ETH, WiFi
    unit_cost NUMERIC(12, 2) DEFAULT 0.00,
    description TEXT,
    reorder_level INT DEFAULT 5,
    tracking_type VARCHAR(50) DEFAULT 'SERIALIZED', -- SERIALIZED, BULK, NONSER
    project_scope VARCHAR(255),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Serialized Inventory
CREATE TABLE IF NOT EXISTS serialized_inventory (
    asset_id VARCHAR(100) PRIMARY KEY, -- Internal Asset ID e.g. ONT-001 or UUID
    sku VARCHAR(100) REFERENCES item_catalog(sku),
    asset_type VARCHAR(50),
    manufacturer VARCHAR(100),
    model VARCHAR(100),
    access_tech VARCHAR(50),
    product_id VARCHAR(100),
    mac VARCHAR(100),
    serial_number VARCHAR(100) UNIQUE NOT NULL,
    status VARCHAR(50) DEFAULT 'In Stock', -- In Stock, Issued / Out, Under Repair, Decommissioned
    condition VARCHAR(50) DEFAULT 'New', -- New, Used, Faulty
    location VARCHAR(255) DEFAULT 'Main Store',
    custodian VARCHAR(255),
    notes TEXT,
    customer_id VARCHAR(100),
    current_project_id VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Bulk Inventory Balances
CREATE TABLE IF NOT EXISTS bulk_inventory (
    sku VARCHAR(100) PRIMARY KEY REFERENCES item_catalog(sku),
    quantity NUMERIC(12, 2) DEFAULT 0,
    unit VARCHAR(50) DEFAULT 'Units',
    location VARCHAR(255) DEFAULT 'Main Store',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Transaction Ledger (Immutable Stock Movements)
CREATE TABLE IF NOT EXISTS inventory_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transaction_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    direction VARCHAR(50) NOT NULL, -- Stock In, Stock Out, Transfer, Adjustment, Issue, Replacement, Return
    sku VARCHAR(100) REFERENCES item_catalog(sku),
    item_name VARCHAR(255),
    quantity NUMERIC(12, 2) NOT NULL,
    requested_by VARCHAR(255),
    role VARCHAR(50),
    site_reference VARCHAR(255),
    unit_cost NUMERIC(12, 2) DEFAULT 0.00,
    total_cost NUMERIC(12, 2) DEFAULT 0.00,
    cost_type VARCHAR(50),
    task_id VARCHAR(100),
    asset_id VARCHAR(100),
    project_id VARCHAR(100),
    notes TEXT
);

-- Projects & Infrastructure
CREATE TABLE IF NOT EXISTS projects (
    project_id VARCHAR(100) PRIMARY KEY,
    project_name VARCHAR(255) NOT NULL,
    type VARCHAR(50), -- Deployment, Upgrade, Maintenance, Expansion
    status VARCHAR(50) DEFAULT 'Planning', -- Planning, Active, On Hold, Completed, Cancelled
    location_fat VARCHAR(255),
    project_manager VARCHAR(255),
    budget NUMERIC(12, 2) DEFAULT 0.00,
    actual_spend NUMERIC(12, 2) DEFAULT 0.00,
    start_date DATE,
    end_date DATE,
    notes TEXT,
    created_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Customers & Subscription Services
CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_number VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    subscription_type VARCHAR(50) NOT NULL DEFAULT 'PPPoE', -- PPPoE, Hotspot
    plot_number VARCHAR(100),
    location VARCHAR(255),
    gps_coordinates VARCHAR(100),
    contact_person VARCHAR(255),
    contact_phone VARCHAR(100),
    contact_email VARCHAR(255),
    status VARCHAR(50) DEFAULT 'Active', -- Active, Suspended, Pending
    assigned_onu_serial VARCHAR(100),
    assigned_ap_mac VARCHAR(100),
    linked_splitter_id VARCHAR(100),
    linked_enclosure_id VARCHAR(100),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Hotspots & Hotspot Users
CREATE TABLE IF NOT EXISTS hotspots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    location_plot VARCHAR(255),
    contact_person VARCHAR(255),
    status VARCHAR(50) DEFAULT 'Active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS hotspot_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    hotspot_id UUID REFERENCES hotspots(id),
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255),
    phone VARCHAR(100),
    mac_address VARCHAR(100),
    subscription_plan VARCHAR(100),
    expires_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(50) DEFAULT 'Active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vouchers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(100) UNIQUE NOT NULL,
    duration_hours INT DEFAULT 3,
    max_devices INT DEFAULT 2,
    price NUMERIC(12, 2) DEFAULT 0.00,
    status VARCHAR(50) DEFAULT 'Unused', -- Unused, Active, Expired
    hotspot_id UUID REFERENCES hotspots(id),
    used_by_username VARCHAR(100),
    activated_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Network Topology & Infrastructure Mapping
CREATE TABLE IF NOT EXISTS olts (
    id VARCHAR(100) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    ip_address VARCHAR(100),
    vendor VARCHAR(100),
    model VARCHAR(100),
    location VARCHAR(255),
    status VARCHAR(50) DEFAULT 'Online',
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pon_ports (
    id VARCHAR(100) PRIMARY KEY, -- e.g. OLT-01/PON-1
    olt_id VARCHAR(100) REFERENCES olts(id),
    port_number INT NOT NULL,
    technology VARCHAR(50) DEFAULT 'GPON',
    status VARCHAR(50) DEFAULT 'Online',
    notes TEXT
);

CREATE TABLE IF NOT EXISTS splitters (
    id VARCHAR(100) PRIMARY KEY, -- e.g. SPLITTER-01
    pon_port_id VARCHAR(100) REFERENCES pon_ports(id),
    ratio VARCHAR(50) DEFAULT '1:8',
    location VARCHAR(255),
    enclosure_id VARCHAR(100),
    status VARCHAR(50) DEFAULT 'Active',
    notes TEXT
);

CREATE TABLE IF NOT EXISTS enclosures (
    id VARCHAR(100) PRIMARY KEY, -- e.g. FAT-01
    name VARCHAR(255) NOT NULL,
    location_plot VARCHAR(255),
    gps_coordinates VARCHAR(100),
    capacity_ports INT DEFAULT 16,
    splitter_id VARCHAR(100) REFERENCES splitters(id),
    status VARCHAR(50) DEFAULT 'Active',
    notes TEXT
);

CREATE TABLE IF NOT EXISTS access_points (
    id VARCHAR(100) PRIMARY KEY, -- AP MAC or ID
    hotspot_id UUID REFERENCES hotspots(id),
    mac VARCHAR(100) UNIQUE NOT NULL,
    ssid VARCHAR(100),
    model VARCHAR(100),
    location_plot VARCHAR(255),
    enclosure_id VARCHAR(100) REFERENCES enclosures(id),
    status VARCHAR(50) DEFAULT 'Online',
    notes TEXT
);

-- GenieACS TR-069 Snapshot & Cache
CREATE TABLE IF NOT EXISTS genieacs_devices (
    device_id VARCHAR(255) PRIMARY KEY, -- GenieACS _id e.g. 202BC1-ONT-12345
    serial_number VARCHAR(100) UNIQUE NOT NULL,
    product_class VARCHAR(100),
    manufacturer VARCHAR(100),
    ip_address VARCHAR(100),
    mac VARCHAR(100),
    online_status VARCHAR(50) DEFAULT 'Offline',
    last_inform TIMESTAMP WITH TIME ZONE,
    optical_rx_power NUMERIC(6, 2),
    optical_tx_power NUMERIC(6, 2),
    firmware_version VARCHAR(100),
    uptime_seconds BIGINT DEFAULT 0,
    wifi_ssid VARCHAR(100),
    wifi_status VARCHAR(50),
    raw_cwmp_params JSONB,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Requisitions
CREATE TABLE IF NOT EXISTS technician_requisitions (
    requisition_id VARCHAR(100) PRIMARY KEY,
    date_requested TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    technician_name VARCHAR(255) NOT NULL,
    item_sku VARCHAR(100) REFERENCES item_catalog(sku),
    quantity_requested NUMERIC(12, 2) NOT NULL,
    reason_job_ticket VARCHAR(255),
    approval_status VARCHAR(50) DEFAULT 'Pending Approval', -- Pending Approval, Pending Finance, Approved - Ready, Awaiting Stock, Issued, Rejected, Cancelled
    approved_by VARCHAR(255),
    issue_date TIMESTAMP WITH TIME ZONE,
    issued_by VARCHAR(255),
    decision_note TEXT,
    project_id VARCHAR(100) REFERENCES projects(project_id),
    finance_status VARCHAR(50) DEFAULT 'N/A',
    est_value NUMERIC(12, 2) DEFAULT 0.00,
    issued_units TEXT, -- Comma-separated Serial IDs
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Tasks
CREATE TABLE IF NOT EXISTS technician_tasks (
    task_id VARCHAR(100) PRIMARY KEY,
    task_title VARCHAR(255) NOT NULL,
    task_type VARCHAR(100),
    assigned_personnel VARCHAR(255),
    assignee_email VARCHAR(255),
    priority VARCHAR(50) DEFAULT 'Medium',
    status VARCHAR(50) DEFAULT 'Assigned', -- Assigned, Awaiting Stock, Ready, In Progress, Completed, Cancelled
    required_sku VARCHAR(100) REFERENCES item_catalog(sku),
    required_qty NUMERIC(12, 2) DEFAULT 1,
    customer_site VARCHAR(255),
    reference VARCHAR(255),
    notes TEXT,
    created_by VARCHAR(255),
    stock_ready_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Customer Tickets
CREATE TABLE IF NOT EXISTS customer_tickets (
    ticket_id VARCHAR(100) PRIMARY KEY,
    date_logged TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    customer_account VARCHAR(255) NOT NULL,
    issue_category VARCHAR(100), -- No Optical Link, Faulty ONT / Router, High Loss / Splice Needed, Wi-Fi / Password Reset, New Installation, Relocation, Other
    assigned_technician VARCHAR(255),
    device_swapped_old_sn VARCHAR(100),
    replacement_device_new_sn VARCHAR(100),
    ticket_status VARCHAR(50) DEFAULT 'Open', -- Open, Assigned, In Progress, Resolved, Closed
    logged_by VARCHAR(255),
    resolution_notes TEXT,
    linked_task_id VARCHAR(100),
    priority VARCHAR(50) DEFAULT 'Medium',
    closed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Procurement
CREATE TABLE IF NOT EXISTS procurement_requests (
    procurement_id VARCHAR(100) PRIMARY KEY,
    date_requested TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    requested_by VARCHAR(255) NOT NULL,
    item_sku VARCHAR(100) REFERENCES item_catalog(sku),
    quantity NUMERIC(12, 2) NOT NULL,
    est_unit_cost NUMERIC(12, 2) DEFAULT 0.00,
    est_total NUMERIC(12, 2) DEFAULT 0.00,
    project_id VARCHAR(100) REFERENCES projects(project_id),
    linked_requisition_id VARCHAR(100),
    status VARCHAR(50) DEFAULT 'Pending Finance', -- Pending Finance, Approved, Ordered, Received, Rejected, Cancelled
    finance_by VARCHAR(255),
    finance_date TIMESTAMP WITH TIME ZONE,
    supplier VARCHAR(255),
    po_ref VARCHAR(100),
    ordered_date DATE,
    received_date DATE,
    received_quantity NUMERIC(12, 2) DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Delivery / Receipt Notes
CREATE TABLE IF NOT EXISTS delivery_notes (
    doc_no VARCHAR(100) PRIMARY KEY,
    type VARCHAR(50) DEFAULT 'Delivery Note',
    reference VARCHAR(255),
    project_id VARCHAR(100) REFERENCES projects(project_id),
    recipient VARCHAR(255),
    file_name VARCHAR(255),
    drive_url VARCHAR(255),
    created_by VARCHAR(255),
    value_kes NUMERIC(12, 2) DEFAULT 0.00,
    payment_status VARCHAR(50) DEFAULT 'Unpaid',
    paid_date DATE,
    payment_ref VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Tamper-Evident Audit Ledger
CREATE TABLE IF NOT EXISTS audit_ledger (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    actor_email VARCHAR(255) NOT NULL,
    actor_role VARCHAR(50),
    entity_type VARCHAR(100) NOT NULL,
    entity_id VARCHAR(255) NOT NULL,
    action VARCHAR(100) NOT NULL,
    previous_state JSONB,
    new_state JSONB,
    details TEXT,
    ip_address VARCHAR(100),
    prev_hash VARCHAR(255),
    hash VARCHAR(255) NOT NULL
);

-- GenieACS Action Audit Logs
CREATE TABLE IF NOT EXISTS genieacs_audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    actor_email VARCHAR(255) NOT NULL,
    customer_account VARCHAR(255),
    device_id VARCHAR(255) NOT NULL,
    action VARCHAR(100) NOT NULL, -- Reboot, Sync, FactoryReset, ParameterChange
    parameters JSONB,
    reason TEXT,
    result_status VARCHAR(50),
    genieacs_task_id VARCHAR(255)
);
