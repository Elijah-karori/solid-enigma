// Command import loads out/import_bundle.json (produced by tools/extract_workbook.py) into the database.
//
//	go run ./cmd/import -bundle out/import_bundle.json            # dry run: validates and prints a plan, writes nothing
//	go run ./cmd/import -bundle out/import_bundle.json -commit    # writes everything in ONE transaction
//
// Idempotent: users/catalog/units/documents are upserted by key, transactions use deterministic IDs.
// After writing, stock balances are recomputed from the imported ledger and compared with the
// bundle's expected balances; any difference rolls the whole import back.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/ont/inventory-backend/internal/audit"
	"github.com/ont/inventory-backend/internal/db"
	"github.com/ont/inventory-backend/internal/models"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ---- bundle schema (field tags match tools/extract_workbook.py output) ----

type reqRow struct {
	RequisitionID     string  `json:"requisition_id"`
	DateRequested     string  `json:"date_requested"`
	TechnicianName    string  `json:"technician_name"`
	ItemSKU           string  `json:"item_sku"`
	QuantityRequested float64 `json:"quantity_requested"`
	ReasonJobTicket   string  `json:"reason_job_ticket"`
	ApprovalStatus    string  `json:"approval_status"`
	ApprovedBy        string  `json:"approved_by"`
	IssueDate         string  `json:"issue_date"`
	IssuedBy          string  `json:"issued_by"`
	DecisionNote      string  `json:"decision_note"`
	ProjectID         string  `json:"project_id"`
	FinanceStatus     string  `json:"finance_status"`
	EstValue          float64 `json:"est_value"`
	IssuedUnits       string  `json:"issued_units"`
}

type taskRow struct {
	TaskID            string  `json:"task_id"`
	CreatedAt         string  `json:"created_at"`
	TaskTitle         string  `json:"task_title"`
	TaskType          string  `json:"task_type"`
	AssignedPersonnel string  `json:"assigned_personnel"`
	AssigneeEmail     string  `json:"assignee_email"`
	Priority          string  `json:"priority"`
	Status            string  `json:"status"`
	RequiredSKU       string  `json:"required_sku"`
	RequiredQty       float64 `json:"required_qty"`
	CustomerSite      string  `json:"customer_site"`
	Reference         string  `json:"reference"`
	Notes             string  `json:"notes"`
	CreatedBy         string  `json:"created_by"`
	StockReadyAt      string  `json:"stock_ready_at"`
	LinkedTicketID    string  `json:"linked_ticket_id"`
	ProjectID         string  `json:"project_id"`
}

type ticketRow struct {
	TicketID               string `json:"ticket_id"`
	DateLogged             string `json:"date_logged"`
	CustomerAccount        string `json:"customer_account"`
	IssueCategory          string `json:"issue_category"`
	AssignedTechnician     string `json:"assigned_technician"`
	DeviceSwappedOldSN     string `json:"device_swapped_old_sn"`
	ReplacementDeviceNewSN string `json:"replacement_device_new_sn"`
	TicketStatus           string `json:"ticket_status"`
	LoggedBy               string `json:"logged_by"`
	ResolutionNotes        string `json:"resolution_notes"`
	LinkedTaskID           string `json:"linked_task_id"`
	Priority               string `json:"priority"`
	ClosedAt               string `json:"closed_at"`
	CustomerID             string `json:"customer_id"`
	HotspotID              string `json:"hotspot_id"`
	DeviceAssetID          string `json:"device_asset_id"`
}

type procRow struct {
	ProcurementID       string  `json:"procurement_id"`
	DateRequested       string  `json:"date_requested"`
	RequestedBy         string  `json:"requested_by"`
	ItemSKU             string  `json:"item_sku"`
	Quantity            float64 `json:"quantity"`
	EstUnitCost         float64 `json:"est_unit_cost"`
	EstTotal            float64 `json:"est_total"`
	ProjectID           string  `json:"project_id"`
	LinkedRequisitionID string  `json:"linked_requisition_id"`
	Status              string  `json:"status"`
	FinanceBy           string  `json:"finance_by"`
	FinanceDate         string  `json:"finance_date"`
	Supplier            string  `json:"supplier"`
	PORef               string  `json:"po_ref"`
	OrderedDate         string  `json:"ordered_date"`
	ReceivedDate        string  `json:"received_date"`
	Notes               string  `json:"notes"`
}

type projectRow struct {
	ProjectID      string  `json:"project_id"`
	ProjectName    string  `json:"project_name"`
	Type           string  `json:"type"`
	Status         string  `json:"status"`
	StartDate      string  `json:"start_date"`
	EndDate        string  `json:"end_date"`
	LocationFAT    string  `json:"location_fat"`
	ProjectManager string  `json:"project_manager"`
	Notes          string  `json:"notes"`
	CreatedBy      string  `json:"created_by"`
	Budget         float64 `json:"budget"`
}

type noteRow struct {
	DocNo         string  `json:"doc_no"`
	Type          string  `json:"type"`
	Reference     string  `json:"reference"`
	ProjectID     string  `json:"project_id"`
	Recipient     string  `json:"recipient"`
	FileName      string  `json:"file_name"`
	DriveURL      string  `json:"drive_url"`
	CreatedBy     string  `json:"created_by"`
	CreatedAt     string  `json:"created_at"`
	PaymentStatus string  `json:"payment_status"`
	PaidDate      string  `json:"paid_date"`
	PaymentRef    string  `json:"payment_ref"`
	ValueKES      float64 `json:"value_kes"`
}

type notifRow struct {
	Timestamp string `json:"timestamp"`
	Type      string `json:"type"`
	Reference string `json:"reference"`
	Recipient string `json:"recipient"`
	Subject   string `json:"subject"`
	Status    string `json:"status"`
	Error     string `json:"error"`
}

type auditRow struct {
	AuditID       string `json:"audit_id"`
	Timestamp     string `json:"timestamp"`
	EntityType    string `json:"entity_type"`
	EntityID      string `json:"entity_id"`
	Action        string `json:"action"`
	User          string `json:"user"`
	Role          string `json:"role"`
	PreviousState string `json:"previous_state"`
	NewState      string `json:"new_state"`
	Details       string `json:"details"`
	Hash          string `json:"hash"`
}

type serialRow struct {
	AssetID         string  `json:"asset_id"`
	SKU             string  `json:"sku"`
	AssetType       string  `json:"asset_type"`
	Manufacturer    string  `json:"manufacturer"`
	Model           string  `json:"model"`
	AccessTech      string  `json:"access_tech"`
	ProductID       string  `json:"product_id"`
	MAC             string  `json:"mac"`
	SerialNumber    *string `json:"serial_number"`
	Status          string  `json:"status"`
	Condition       string  `json:"condition"`
	Location        string  `json:"location"`
	Custodian       string  `json:"custodian"`
	Notes           string  `json:"notes"`
	CustomerName    string  `json:"customer_name"`
	CustomerAccount string  `json:"customer_account"`
	LinkedTicketID  string  `json:"linked_ticket_id"`
}

type txRow struct {
	TransactionDate string  `json:"transaction_date"`
	Direction       string  `json:"direction"`
	SKU             string  `json:"sku"`
	ItemName        string  `json:"item_name"`
	RequestedBy     string  `json:"requested_by"`
	Role            string  `json:"role"`
	SiteReference   string  `json:"site_reference"`
	CostType        string  `json:"cost_type"`
	TaskID          string  `json:"task_id"`
	AssetID         string  `json:"asset_id"`
	ProjectID       string  `json:"project_id"`
	Notes           string  `json:"notes"`
	Quantity        float64 `json:"quantity"`
	UnitCost        float64 `json:"unit_cost"`
	TotalCost       float64 `json:"total_cost"`
}

type bundle struct {
	Meta struct {
		SourceFile string         `json:"source_file"`
		Counts     map[string]int `json:"counts"`
	} `json:"meta"`
	Settings []struct {
		Key   string `json:"key"`
		Value string `json:"value"`
	} `json:"settings"`
	Users []struct {
		LegacyID    string `json:"legacy_id"`
		Email       string `json:"email"`
		Name        string `json:"name"`
		Role        string `json:"role"`
		Status      string `json:"status"`
		SiteStation string `json:"site_station"`
		ContactInfo string `json:"contact_info"`
	} `json:"users"`
	Catalog          []models.ItemCatalog `json:"catalog"`
	Serialized       []serialRow          `json:"serialized"`
	Transactions     []txRow              `json:"transactions"`
	Requisitions     []reqRow             `json:"requisitions"`
	Tasks            []taskRow            `json:"tasks"`
	Tickets          []ticketRow          `json:"tickets"`
	Procurement      []procRow            `json:"procurement"`
	Projects         []projectRow         `json:"projects"`
	DeliveryNotes    []noteRow            `json:"delivery_notes"`
	NotificationLog  []notifRow           `json:"notification_log"`
	AuditLegacy      []auditRow           `json:"audit_legacy"`
	ExpectedBalances map[string]int       `json:"expected_balances"`
}

var nairobi *time.Location

func ts(s string) time.Time {
	if s == "" {
		return time.Time{}
	}
	for _, f := range []string{"2006-01-02T15:04:05", "2006-01-02 15:04", "2006-01-02"} {
		if t, err := time.ParseInLocation(f, s, nairobi); err == nil {
			return t
		}
	}
	return time.Time{}
}
func tsp(s string) *time.Time {
	if t := ts(s); !t.IsZero() {
		return &t
	}
	return nil
}

func main() {
	path := flag.String("bundle", "out/import_bundle.json", "bundle produced by tools/extract_workbook.py")
	commit := flag.Bool("commit", false, "write to the database (default is a dry run)")
	flag.Parse()
	var err error
	if nairobi, err = time.LoadLocation("Africa/Nairobi"); err != nil {
		nairobi = time.FixedZone("EAT", 3*3600)
	}
	raw, err := os.ReadFile(*path)
	if err != nil {
		log.Fatal(err)
	}
	var b bundle
	if err := json.Unmarshal(raw, &b); err != nil {
		log.Fatalf("bad bundle: %v", err)
	}

	if err := preflight(&b); err != nil {
		log.Fatalf("PREFLIGHT FAILED: %v", err)
	}
	fmt.Printf("Bundle OK: %d users, %d catalog items, %d units, %d transactions, %d requisitions, %d tasks, %d tickets, %d purchases, %d notification rows\n",
		len(b.Users), len(b.Catalog), len(b.Serialized), len(b.Transactions), len(b.Requisitions), len(b.Tasks), len(b.Tickets), len(b.Procurement), len(b.NotificationLog))
	if !*commit {
		fmt.Println("Dry run only. Re-run with -commit to write.")
		return
	}

	database := db.InitDB()
	err = database.Transaction(func(tx *gorm.DB) error {
		if err := load(tx, &b); err != nil {
			return err
		}
		return reconcile(tx, &b) // returning an error here rolls everything back
	})
	if err != nil {
		log.Fatalf("IMPORT ROLLED BACK: %v", err)
	}
	fmt.Println("Import committed and stock balances reconcile with the workbook.")
	fmt.Println("All imported users must set a password: Login screen -> Forgot password -> email code.")
}

// preflight catches problems before anything is written.
func preflight(b *bundle) error {
	var errs []string
	skus := map[string]bool{}
	for _, c := range b.Catalog {
		skus[c.SKU] = true
	}
	for _, t := range b.Transactions {
		if !skus[t.SKU] {
			errs = append(errs, "transaction for unknown SKU "+t.SKU)
		}
	}
	seen := map[string]string{}
	for _, u := range b.Serialized {
		if u.SKU == "" {
			errs = append(errs, u.AssetID+": no SKU - fix in the workbook or the bundle")
		}
		if u.SerialNumber != nil {
			if o, dup := seen[*u.SerialNumber]; dup {
				errs = append(errs, fmt.Sprintf("serial %s used by %s and %s", *u.SerialNumber, o, u.AssetID))
			}
			seen[*u.SerialNumber] = u.AssetID
		}
	}
	bal := balances(b.Transactions)
	for k, v := range bal {
		if v < 0 {
			errs = append(errs, fmt.Sprintf("%s balance would be negative (%d)", k, v))
		}
	}
	if len(errs) > 0 {
		sort.Strings(errs)
		return fmt.Errorf("\n  - %s", strings.Join(errs, "\n  - "))
	}
	return nil
}

func balances(txs []txRow) map[string]int {
	m := map[string]int{}
	for _, t := range txs {
		if t.Direction == "Stock In" {
			m[t.SKU] += int(t.Quantity)
		} else {
			m[t.SKU] -= int(t.Quantity)
		}
	}
	return m
}

func up(tx *gorm.DB, v any) error {
	return tx.Clauses(clause.OnConflict{UpdateAll: true}).Create(v).Error
}

func load(tx *gorm.DB, b *bundle) error {
	for _, s := range b.Settings {
		if err := up(tx, &models.Setting{Key: s.Key, Value: s.Value, UpdatedAt: time.Now()}); err != nil {
			return err
		}
	}
	for _, u := range b.Users {
		var ex models.User
		if tx.Where("email = ?", u.Email).First(&ex).Error == nil {
			continue // never overwrite a live account (or its password)
		}
		// No password hash is imported: legacy SHA-256 / plaintext values are discarded; user must set one via email OTP.
		nu := models.User{ID: uuid.New(), Email: u.Email, Name: u.Name, Role: u.Role, Status: u.Status, SiteStation: u.SiteStation,
			ContactInfo: u.ContactInfo, LegacyID: u.LegacyID, MustResetPassword: true}
		if err := tx.Create(&nu).Error; err != nil {
			return fmt.Errorf("user %s: %w", u.Email, err)
		}
	}
	for i := range b.Catalog {
		if err := up(tx, &b.Catalog[i]); err != nil {
			return fmt.Errorf("catalog %s: %w", b.Catalog[i].SKU, err)
		}
	}
	for _, s := range b.Serialized {
		m := models.SerializedInventory{AssetID: s.AssetID, SKU: s.SKU, AssetType: s.AssetType, Manufacturer: s.Manufacturer, Model: s.Model,
			AccessTech: s.AccessTech, ProductID: s.ProductID, MAC: s.MAC, SerialNumber: s.SerialNumber, Status: s.Status, Condition: s.Condition,
			Location: s.Location, Custodian: s.Custodian, Notes: s.Notes, CustomerID: s.CustomerAccount}
		if err := up(tx, &m); err != nil {
			return fmt.Errorf("unit %s: %w", s.AssetID, err)
		}
	}
	// Deterministic IDs make re-running the import safe: the same row always gets the same UUID.
	ns := uuid.NewSHA1(uuid.NameSpaceURL, []byte("ont-inventory-import"))
	for i, t := range b.Transactions {
		id := uuid.NewSHA1(ns, []byte(fmt.Sprintf("%d|%s|%s|%s|%v", i, t.TransactionDate, t.Direction, t.SKU, t.Quantity)))
		m := models.InventoryTransaction{ID: id, TransactionDate: ts(t.TransactionDate), Direction: t.Direction, SKU: t.SKU, ItemName: t.ItemName,
			Quantity: t.Quantity, RequestedBy: t.RequestedBy, Role: t.Role, SiteReference: t.SiteReference, UnitCost: t.UnitCost, TotalCost: t.TotalCost,
			CostType: t.CostType, TaskID: t.TaskID, AssetID: t.AssetID, ProjectID: t.ProjectID, Notes: t.Notes}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&m).Error; err != nil {
			return err
		}
	}
	for _, p := range b.Projects {
		if err := up(tx, &models.Project{ProjectID: p.ProjectID, ProjectName: p.ProjectName, Type: p.Type, Status: p.Status, LocationFAT: p.LocationFAT,
			ProjectManager: p.ProjectManager, Budget: p.Budget, StartDate: p.StartDate, EndDate: p.EndDate, Notes: p.Notes, CreatedBy: p.CreatedBy}); err != nil {
			return err
		}
	}
	for _, r := range b.Requisitions {
		if err := up(tx, &models.TechnicianRequisition{RequisitionID: r.RequisitionID, DateRequested: ts(r.DateRequested), TechnicianName: r.TechnicianName,
			ItemSKU: r.ItemSKU, QuantityRequested: r.QuantityRequested, ReasonJobTicket: r.ReasonJobTicket, ApprovalStatus: r.ApprovalStatus, ApprovedBy: r.ApprovedBy,
			IssueDate: tsp(r.IssueDate), IssuedBy: r.IssuedBy, DecisionNote: r.DecisionNote, ProjectID: r.ProjectID, FinanceStatus: r.FinanceStatus,
			EstValue: r.EstValue, IssuedUnits: r.IssuedUnits}); err != nil {
			return err
		}
	}
	for _, t := range b.Tasks {
		if err := up(tx, &models.TechnicianTask{TaskID: t.TaskID, TaskTitle: t.TaskTitle, TaskType: t.TaskType, AssignedPersonnel: t.AssignedPersonnel,
			AssigneeEmail: t.AssigneeEmail, Priority: t.Priority, Status: t.Status, RequiredSKU: t.RequiredSKU, RequiredQty: t.RequiredQty, CustomerSite: t.CustomerSite,
			Reference: t.Reference, Notes: t.Notes, CreatedBy: t.CreatedBy, StockReadyAt: tsp(t.StockReadyAt), LinkedTicketID: t.LinkedTicketID, ProjectID: t.ProjectID,
			CreatedAt: ts(t.CreatedAt)}); err != nil {
			return err
		}
	}
	for _, t := range b.Tickets {
		if err := up(tx, &models.CustomerTicket{TicketID: t.TicketID, DateLogged: ts(t.DateLogged), CustomerAccount: t.CustomerAccount, IssueCategory: t.IssueCategory,
			AssignedTechnician: t.AssignedTechnician, DeviceSwappedOldSN: t.DeviceSwappedOldSN, ReplacementDeviceNewSN: t.ReplacementDeviceNewSN, TicketStatus: t.TicketStatus,
			LoggedBy: t.LoggedBy, ResolutionNotes: t.ResolutionNotes, LinkedTaskID: t.LinkedTaskID, Priority: t.Priority, ClosedAt: tsp(t.ClosedAt),
			CustomerID: t.CustomerID, HotspotID: t.HotspotID, DeviceAssetID: t.DeviceAssetID}); err != nil {
			return err
		}
	}
	for _, p := range b.Procurement {
		if err := up(tx, &models.ProcurementRequest{ProcurementID: p.ProcurementID, DateRequested: ts(p.DateRequested), RequestedBy: p.RequestedBy, ItemSKU: p.ItemSKU,
			Quantity: p.Quantity, EstUnitCost: p.EstUnitCost, EstTotal: p.EstTotal, ProjectID: p.ProjectID, LinkedRequisitionID: p.LinkedRequisitionID, Status: p.Status,
			FinanceBy: p.FinanceBy, FinanceDate: tsp(p.FinanceDate), Supplier: p.Supplier, PORef: p.PORef, OrderedDate: p.OrderedDate, ReceivedDate: p.ReceivedDate, Notes: p.Notes}); err != nil {
			return err
		}
	}
	for _, d := range b.DeliveryNotes {
		if err := up(tx, &models.DeliveryNote{DocNo: d.DocNo, Type: d.Type, Reference: d.Reference, ProjectID: d.ProjectID, Recipient: d.Recipient, FileName: d.FileName,
			DriveURL: d.DriveURL, CreatedBy: d.CreatedBy, ValueKES: d.ValueKES, PaymentStatus: d.PaymentStatus, PaidDate: d.PaidDate, PaymentRef: d.PaymentRef, CreatedAt: ts(d.CreatedAt)}); err != nil {
			return err
		}
	}
	// Notification history: replace previous legacy rows so re-runs do not duplicate them.
	if err := tx.Where("legacy = ?", true).Delete(&models.NotificationLog{}).Error; err != nil {
		return err
	}
	for _, n := range b.NotificationLog {
		if err := tx.Create(&models.NotificationLog{Timestamp: ts(n.Timestamp), Type: n.Type, Reference: n.Reference, Recipient: n.Recipient, Subject: n.Subject,
			Status: n.Status, Error: n.Error, Legacy: true}).Error; err != nil {
			return err
		}
	}
	for _, a := range b.AuditLegacy {
		if err := up(tx, &models.LegacyAuditEntry{AuditID: a.AuditID, Timestamp: a.Timestamp, EntityType: a.EntityType, EntityID: a.EntityID, Action: a.Action, Actor: a.User,
			Role: a.Role, PreviousState: a.PreviousState, NewState: a.NewState, Details: a.Details, LegacyHash: a.Hash}); err != nil {
			return err
		}
	}
	// Genesis entry of the NEW hash chain, recording what was imported.
	var n int64
	tx.Model(&models.AuditLedger{}).Count(&n)
	if n == 0 {
		return audit.Append(tx, "migration", "System", "Migration", b.Meta.SourceFile, "Workbook imported", nil, b.Meta.Counts, "legacy audit rows kept in legacy_audit_entries", "")
	}
	return nil
}

// reconcile recomputes balances from the database and compares them with the workbook-derived expectation.
func reconcile(tx *gorm.DB, b *bundle) error {
	var rows []models.InventoryTransaction
	if err := tx.Find(&rows).Error; err != nil {
		return err
	}
	got := map[string]int{}
	for _, r := range rows {
		if r.Direction == "Stock In" {
			got[r.SKU] += int(r.Quantity)
		} else {
			got[r.SKU] -= int(r.Quantity)
		}
	}
	var bad []string
	for sku, want := range b.ExpectedBalances {
		if got[sku] != want {
			bad = append(bad, fmt.Sprintf("%s: database %d, expected %d", sku, got[sku], want))
		}
	}
	for sku, v := range got {
		if v < 0 {
			bad = append(bad, fmt.Sprintf("%s: negative balance %d", sku, v))
		}
	}
	if len(bad) > 0 {
		sort.Strings(bad)
		return fmt.Errorf("balance mismatch:\n  - %s", strings.Join(bad, "\n  - "))
	}
	return nil
}
