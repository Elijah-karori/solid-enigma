package models

import (
	"time"

	"github.com/google/uuid"
)

type User struct {
	ID           uuid.UUID `gorm:"type:string;primaryKey" json:"id"`
	Email        string    `gorm:"uniqueIndex;not null" json:"email"`
	PasswordHash string    `json:"-"`
	Name         string    `json:"name"`
	Role         string    `json:"role"` // Admin, Store Manager, Finance, Project Manager, Support, Technician
	Status       string    `gorm:"default:'active'" json:"status"`
	SiteStation  string    `json:"site_station"`
	ContactInfo  string    `json:"contact_info"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type MagicToken struct {
	ID        uuid.UUID `gorm:"type:string;primaryKey" json:"id"`
	Email     string    `json:"email"`
	Token     string    `gorm:"uniqueIndex;not null" json:"token"`
	ExpiresAt time.Time `json:"expires_at"`
	CreatedAt time.Time `json:"created_at"`
}

type ItemCatalog struct {
	SKU          string    `gorm:"primaryKey" json:"sku"`
	AssetType    string    `json:"asset_type"` // BULK, NONSER, ONT, RTR, NET, FAT
	Manufacturer string    `json:"manufacturer"`
	Model        string    `json:"model"`
	AccessTech   string    `json:"access_tech"` // GPON, XGS-PON, ETH, WiFi
	UnitCost     float64   `json:"unit_cost"`
	Description  string    `json:"description"`
	ReorderLevel int       `json:"reorder_level"`
	TrackingType string    `json:"tracking_type"` // SERIALIZED, BULK, NONSER
	ProjectScope string    `json:"project_scope"`
	IsActive     bool      `gorm:"default:true" json:"is_active"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type SerializedInventory struct {
	AssetID          string    `gorm:"primaryKey" json:"asset_id"`
	SKU              string    `json:"sku"`
	AssetType        string    `json:"asset_type"`
	Manufacturer     string    `json:"manufacturer"`
	Model            string    `json:"model"`
	AccessTech       string    `json:"access_tech"`
	ProductID        string    `json:"product_id"`
	MAC              string    `json:"mac"`
	SerialNumber     string    `gorm:"uniqueIndex;not null" json:"serial_number"`
	Status           string    `json:"status"` // In Stock, Issued / Out, Under Repair, Decommissioned
	Condition        string    `json:"condition"` // New, Used, Faulty
	Location         string    `json:"location"`
	Custodian        string    `json:"custodian"`
	Notes            string    `json:"notes"`
	CustomerID       string    `json:"customer_id"`
	CurrentProjectID string    `json:"current_project_id"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

type BulkInventory struct {
	SKU       string    `gorm:"primaryKey" json:"sku"`
	Quantity  float64   `json:"quantity"`
	Unit      string    `json:"unit"`
	Location  string    `json:"location"`
	UpdatedAt time.Time `json:"updated_at"`
}

type InventoryTransaction struct {
	ID              uuid.UUID `gorm:"type:string;primaryKey" json:"id"`
	TransactionDate time.Time `json:"transaction_date"`
	Direction       string    `json:"direction"` // Stock In, Stock Out, Transfer, Adjustment, Issue, Replacement, Return
	SKU             string    `json:"sku"`
	ItemName        string    `json:"item_name"`
	Quantity        float64   `json:"quantity"`
	RequestedBy     string    `json:"requested_by"`
	Role            string    `json:"role"`
	SiteReference   string    `json:"site_reference"`
	UnitCost        float64   `json:"unit_cost"`
	TotalCost       float64   `json:"total_cost"`
	CostType        string    `json:"cost_type"`
	TaskID          string    `json:"task_id"`
	AssetID         string    `json:"asset_id"`
	ProjectID       string    `json:"project_id"`
	Notes           string    `json:"notes"`
}

type Project struct {
	ProjectID      string    `gorm:"primaryKey" json:"project_id"`
	ProjectName    string    `json:"project_name"`
	Type           string    `json:"type"`   // Deployment, Upgrade, Maintenance, Expansion
	Status         string    `json:"status"` // Planning, Active, On Hold, Completed, Cancelled
	LocationFAT    string    `json:"location_fat"`
	ProjectManager string    `json:"project_manager"`
	Budget         float64   `json:"budget"`
	ActualSpend    float64   `json:"actual_spend"`
	StartDate      string    `json:"start_date"`
	EndDate        string    `json:"end_date"`
	Notes          string    `json:"notes"`
	CreatedBy      string    `json:"created_by"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

type Customer struct {
	ID                uuid.UUID `gorm:"type:string;primaryKey" json:"id"`
	AccountNumber     string    `gorm:"uniqueIndex;not null" json:"account_number"`
	Name              string    `json:"name"`
	SubscriptionType  string    `json:"subscription_type"` // PPPoE, Hotspot
	PlotNumber        string    `json:"plot_number"`
	Location          string    `json:"location"`
	GPSCoordinates    string    `json:"gps_coordinates"`
	ContactPerson     string    `json:"contact_person"`
	ContactPhone      string    `json:"contact_phone"`
	ContactEmail      string    `json:"contact_email"`
	Status            string    `json:"status"` // Active, Suspended, Pending
	AssignedONUSerial string    `json:"assigned_onu_serial"`
	AssignedAPMAC     string    `json:"assigned_ap_mac"`
	LinkedSplitterID  string    `json:"linked_splitter_id"`
	LinkedEnclosureID string    `json:"linked_enclosure_id"`
	Notes             string    `json:"notes"`
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`
}

type Hotspot struct {
	ID            uuid.UUID     `gorm:"type:string;primaryKey" json:"id"`
	Name          string        `json:"name"`
	LocationPlot  string        `json:"location_plot"`
	ContactPerson string        `json:"contact_person"`
	Status        string        `json:"status"`
	Users         []HotspotUser `gorm:"foreignKey:HotspotID" json:"users,omitempty"`
	CreatedAt     time.Time     `json:"created_at"`
}

type HotspotUser struct {
	ID               uuid.UUID  `gorm:"type:string;primaryKey" json:"id"`
	HotspotID        uuid.UUID  `json:"hotspot_id"`
	Username         string     `gorm:"uniqueIndex;not null" json:"username"`
	PasswordHash     string     `json:"-"`
	Phone            string     `json:"phone"`
	MACAddress       string     `json:"mac_address"`
	SubscriptionPlan string     `json:"subscription_plan"`
	ExpiresAt        *time.Time `json:"expires_at"`
	Status           string     `json:"status"`
	CreatedAt        time.Time  `json:"created_at"`
}

type Voucher struct {
	ID               uuid.UUID  `gorm:"type:string;primaryKey" json:"id"`
	Code             string     `gorm:"uniqueIndex;not null" json:"code"`
	DurationHours    int        `json:"duration_hours"`
	MaxDevices       int        `json:"max_devices"`
	Price            float64    `json:"price"`
	Status           string     `json:"status"` // Unused, Active, Expired
	HotspotID        *uuid.UUID `json:"hotspot_id"`
	UsedByUsername   string     `json:"used_by_username"`
	ActivatedAt      *time.Time `json:"activated_at"`
	ExpiresAt        *time.Time `json:"expires_at"`
	CreatedAt        time.Time  `json:"created_at"`
}

type OLT struct {
	ID        string    `gorm:"primaryKey" json:"id"`
	Name      string    `json:"name"`
	IPAddress string    `json:"ip_address"`
	Vendor    string    `json:"vendor"`
	Model     string    `json:"model"`
	Location  string    `json:"location"`
	Status    string    `json:"status"`
	Notes     string    `json:"notes"`
	CreatedAt time.Time `json:"created_at"`
}

type PONPort struct {
	ID         string `gorm:"primaryKey" json:"id"` // OLT-01/PON-1
	OLTID      string `json:"olt_id"`
	PortNumber int    `json:"port_number"`
	Technology string `json:"technology"`
	Status     string `json:"status"`
	Notes      string `json:"notes"`
}

type Splitter struct {
	ID          string `gorm:"primaryKey" json:"id"`
	PONPortID   string `json:"pon_port_id"`
	Ratio       string `json:"ratio"`
	Location    string `json:"location"`
	EnclosureID string `json:"enclosure_id"`
	Status      string `json:"status"`
	Notes       string `json:"notes"`
}

type Enclosure struct {
	ID             string `gorm:"primaryKey" json:"id"` // FAT-01
	Name           string `json:"name"`
	LocationPlot   string `json:"location_plot"`
	GPSCoordinates string `json:"gps_coordinates"`
	CapacityPorts  int    `json:"capacity_ports"`
	SplitterID     string `json:"splitter_id"`
	Status         string `json:"status"`
	Notes          string `json:"notes"`
}

type AccessPoint struct {
	ID           string     `gorm:"primaryKey" json:"id"`
	HotspotID    *uuid.UUID `json:"hotspot_id"`
	MAC          string     `gorm:"uniqueIndex;not null" json:"mac"`
	SSID         string     `json:"ssid"`
	Model        string     `json:"location_model"`
	LocationPlot string     `json:"location_plot"`
	EnclosureID  string     `json:"enclosure_id"`
	Status       string     `json:"status"`
	Notes        string     `json:"notes"`
}

type GenieACSDevice struct {
	DeviceID        string     `gorm:"primaryKey" json:"device_id"`
	SerialNumber    string     `gorm:"uniqueIndex;not null" json:"serial_number"`
	ProductClass    string     `json:"product_class"`
	Manufacturer    string     `json:"manufacturer"`
	IPAddress       string     `json:"ip_address"`
	MAC             string     `json:"mac"`
	OnlineStatus    string     `json:"online_status"`
	LastInform      *time.Time `json:"last_inform"`
	OpticalRXPower  float64    `json:"optical_rx_power"`
	OpticalTXPower  float64    `json:"optical_tx_power"`
	FirmwareVersion string     `json:"firmware_version"`
	UptimeSeconds   int64      `json:"uptime_seconds"`
	WifiSSID        string     `json:"wifi_ssid"`
	WifiStatus      string     `json:"wifi_status"`
	RawCWMPParams   string     `gorm:"type:text" json:"raw_cwmp_params"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

type TechnicianRequisition struct {
	RequisitionID     string     `gorm:"primaryKey" json:"requisition_id"`
	DateRequested     time.Time  `json:"date_requested"`
	TechnicianName    string     `json:"technician_name"`
	ItemSKU           string     `json:"item_sku"`
	QuantityRequested float64    `json:"quantity_requested"`
	ReasonJobTicket   string     `json:"reason_job_ticket"`
	ApprovalStatus    string     `json:"approval_status"`
	ApprovedBy        string     `json:"approved_by"`
	IssueDate         *time.Time `json:"issue_date"`
	IssuedBy          string     `json:"issued_by"`
	DecisionNote      string     `json:"decision_note"`
	ProjectID         string     `json:"project_id"`
	FinanceStatus     string     `json:"finance_status"`
	EstValue          float64    `json:"est_value"`
	IssuedUnits       string     `json:"issued_units"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
}

type TechnicianTask struct {
	TaskID            string     `gorm:"primaryKey" json:"task_id"`
	TaskTitle         string     `json:"task_title"`
	TaskType          string     `json:"task_type"`
	AssignedPersonnel string     `json:"assigned_personnel"`
	AssigneeEmail     string     `json:"assignee_email"`
	Priority          string     `json:"priority"`
	Status            string     `json:"status"`
	RequiredSKU       string     `json:"required_sku"`
	RequiredQty       float64    `json:"required_qty"`
	CustomerSite      string     `json:"customer_site"`
	Reference         string     `json:"reference"`
	Notes             string     `json:"notes"`
	CreatedBy         string     `json:"created_by"`
	StockReadyAt      *time.Time `json:"stock_ready_at"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
}

type CustomerTicket struct {
	TicketID               string     `gorm:"primaryKey" json:"ticket_id"`
	DateLogged             time.Time  `json:"date_logged"`
	CustomerAccount        string     `json:"customer_account"`
	IssueCategory          string     `json:"issue_category"`
	AssignedTechnician     string     `json:"assigned_technician"`
	DeviceSwappedOldSN     string     `json:"device_swapped_old_sn"`
	ReplacementDeviceNewSN string     `json:"replacement_device_new_sn"`
	TicketStatus           string     `json:"ticket_status"`
	LoggedBy               string     `json:"logged_by"`
	ResolutionNotes        string     `json:"resolution_notes"`
	LinkedTaskID           string     `json:"linked_task_id"`
	Priority               string     `json:"priority"`
	ClosedAt               *time.Time `json:"closed_at"`
	CreatedAt              time.Time  `json:"created_at"`
	UpdatedAt              time.Time  `json:"updated_at"`
}

type ProcurementRequest struct {
	ProcurementID       string     `gorm:"primaryKey" json:"procurement_id"`
	DateRequested       time.Time  `json:"date_requested"`
	RequestedBy         string     `json:"requested_by"`
	ItemSKU             string     `json:"item_sku"`
	Quantity            float64    `json:"quantity"`
	EstUnitCost         float64    `json:"est_unit_cost"`
	EstTotal            float64    `json:"est_total"`
	ProjectID           string     `json:"project_id"`
	LinkedRequisitionID string     `json:"linked_requisition_id"`
	Status              string     `json:"status"`
	FinanceBy           string     `json:"finance_by"`
	FinanceDate         *time.Time `json:"finance_date"`
	Supplier            string     `json:"supplier"`
	PORef               string     `json:"po_ref"`
	OrderedDate         string     `json:"ordered_date"`
	ReceivedDate        string     `json:"received_date"`
	ReceivedQuantity    float64    `json:"received_quantity"`
	Notes               string     `json:"notes"`
	CreatedAt           time.Time  `json:"created_at"`
	UpdatedAt           time.Time  `json:"updated_at"`
}

type DeliveryNote struct {
	DocNo         string    `gorm:"primaryKey" json:"doc_no"`
	Type          string    `json:"type"`
	Reference     string    `json:"reference"`
	ProjectID     string    `json:"project_id"`
	Recipient     string    `json:"recipient"`
	FileName      string    `json:"file_name"`
	DriveURL      string    `json:"drive_url"`
	CreatedBy     string    `json:"created_by"`
	ValueKES      float64   `json:"value_kes"`
	PaymentStatus string    `json:"payment_status"`
	PaidDate      string    `json:"paid_date"`
	PaymentRef    string    `json:"payment_ref"`
	CreatedAt     time.Time `json:"created_at"`
}

type AuditLedger struct {
	ID             uuid.UUID `gorm:"type:string;primaryKey" json:"id"`
	EventTimestamp time.Time `json:"event_timestamp"`
	ActorEmail     string    `json:"actor_email"`
	ActorRole      string    `json:"actor_role"`
	EntityType     string    `json:"entity_type"`
	EntityID       string    `json:"entity_id"`
	Action         string    `json:"action"`
	PreviousState  string    `gorm:"type:text" json:"previous_state"`
	NewState       string    `gorm:"type:text" json:"new_state"`
	Details        string    `json:"details"`
	IPAddress      string    `json:"ip_address"`
	PrevHash       string    `json:"prev_hash"`
	Hash           string    `json:"hash"`
}

type GenieACSAuditLog struct {
	ID              uuid.UUID `gorm:"type:string;primaryKey" json:"id"`
	EventTimestamp  time.Time `json:"event_timestamp"`
	ActorEmail      string    `json:"actor_email"`
	CustomerAccount string    `json:"customer_account"`
	DeviceID        string    `json:"device_id"`
	Action          string    `json:"action"`
	Parameters      string    `gorm:"type:text" json:"parameters"`
	Reason          string    `json:"reason"`
	ResultStatus    string    `json:"result_status"`
	GenieACSTaskID  string    `json:"genieacs_task_id"`
}
