export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
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
}

export interface SerializedInventory {
  asset_id: string;
  sku: string;
  asset_type: string;
  manufacturer: string;
  model: string;
  access_tech: string;
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
