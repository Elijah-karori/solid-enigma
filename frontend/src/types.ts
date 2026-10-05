export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  site_station?: string;
  contact_info?: string;
  must_change_password?: boolean;
}

export interface ItemCatalog {
  sku: string;
  asset_type: string;
  manufacturer: string;
  model: string;
  access_tech: string;
  unit_cost: number;
  description: string;
  reorder_level: number;
  tracking_type?: string;
  project_scope?: string;
  is_active?: boolean;
}

export interface SerializedInventory {
  asset_id: string;
  sku: string;
  asset_type: string;
  manufacturer: string;
  model: string;
  access_tech: string;
  product_id?: string;
  mac: string;
  serial_number: string;
  status: string;
  condition: string;
  location: string;
  custodian: string;
  notes: string;
  customer_id?: string;
  created_at: string;
}

export interface InventoryTransaction {
  id: string;
  transaction_date: string;
  direction: string;
  sku: string;
  item_name: string;
  quantity: number;
  requested_by: string;
  role: string;
  site_reference: string;
  unit_cost: number;
  total_cost: number;
  cost_type: string;
  task_id: string;
  asset_id: string;
  project_id: string;
  notes: string;
}

export interface DeliveryNote {
  doc_no: string;
  type: string;
  reference: string;
  project_id: string;
  recipient: string;
  created_by: string;
  value_kes: number;
  payment_status: string;
  paid_date: string;
  payment_ref: string;
  created_at: string;
}

export interface AuditLedger {
  id: string;
  event_timestamp: string;
  actor_email: string;
  actor_role: string;
  entity_type: string;
  entity_id: string;
  action: string;
  previous_state: string;
  new_state: string;
  details: string;
  prev_hash: string;
  hash: string;
}

export interface Customer {
  id: string;
  account_number: string;
  name: string;
  subscription_type: 'PPPoE' | 'Hotspot';
  plot_number: string;
  location: string;
  gps_coordinates: string;
  contact_person: string;
  contact_phone: string;
  contact_email: string;
  status: string;
  assigned_onu_serial: string;
  assigned_ap_mac: string;
  linked_splitter_id: string;
  linked_enclosure_id: string;
  notes: string;
}

export interface Hotspot {
  id: string;
  name: string;
  location_plot: string;
  contact_person: string;
  status: string;
  users?: HotspotUser[];
}

export interface HotspotUser {
  id: string;
  hotspot_id: string;
  username: string;
  phone: string;
  mac_address: string;
  subscription_plan: string;
  expires_at: string;
  status: string;
}

export interface OLT {
  id: string;
  name: string;
  ip_address: string;
  vendor: string;
  model: string;
  location: string;
  status: string;
}

export interface Enclosure {
  id: string;
  name: string;
  location_plot: string;
  capacity_ports: number;
  splitter_id: string;
  status: string;
}

export interface Splitter {
  id: string;
  pon_port_id: string;
  ratio: string;
  location: string;
  status: string;
}

export interface AccessPoint {
  id: string;
  mac: string;
  ssid: string;
  model: string;
  location_plot: string;
  status: string;
}

export interface GenieACSDevice {
  device_id: string;
  serial_number: string;
  product_class: string;
  manufacturer: string;
  ip_address: string;
  mac: string;
  online_status: string;
  last_inform: string;
  optical_rx_power: number;
  optical_tx_power: number;
  firmware_version: string;
  uptime_seconds: number;
  wifi_ssid: string;
  wifi_status: string;
  raw_cwmp_params: string;
}

export interface TechnicianRequisition {
  requisition_id: string;
  date_requested: string;
  technician_name: string;
  item_sku: string;
  quantity_requested: number;
  reason_job_ticket: string;
  approval_status: string;
  approved_by: string;
  issued_by: string;
  decision_note: string;
  project_id?: string;
  est_value?: number;
}

export interface TechnicianTask {
  task_id: string;
  task_title: string;
  task_type: string;
  assigned_personnel: string;
  assignee_email: string;
  priority: string;
  status: string;
  required_sku: string;
  required_qty: number;
  customer_site: string;
  reference: string;
  notes: string;
  created_by: string;
  created_at: string;
}

export interface CustomerTicket {
  ticket_id: string;
  date_logged: string;
  customer_account: string;
  issue_category: string;
  assigned_technician: string;
  device_swapped_old_sn: string;
  replacement_device_new_sn: string;
  ticket_status: string;
  resolution_notes: string;
}

export interface ProcurementRequest {
  procurement_id: string;
  date_requested: string;
  requested_by: string;
  item_sku: string;
  quantity: number;
  est_unit_cost: number;
  est_total: number;
  project_id: string;
  status: string;
  finance_by: string;
  supplier: string;
  po_ref: string;
  notes: string;
}
