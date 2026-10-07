package handlers

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"github.com/ont/inventory-backend/internal/db"
	"github.com/ont/inventory-backend/internal/models"
	"github.com/ont/inventory-backend/internal/rbac"
	"gorm.io/gorm"
)

// Catalog APIs
func GetCatalog(c echo.Context) error {
	var items []models.ItemCatalog
	db.DB.Find(&items)
	if !can(c, "viewCosts") { // unit costs are Admin / Finance only
		for i := range items {
			items[i].UnitCost = 0
		}
	}
	return c.JSON(http.StatusOK, items)
}

func SaveCatalogItem(c echo.Context) error {
	var item models.ItemCatalog
	if err := c.Bind(&item); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": err.Error()})
	}
	if item.SKU == "" {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": "SKU is required"})
	}
	if !can(c, "viewCosts") { // only Admin / Finance may set prices; keep the existing price for others
		var old models.ItemCatalog
		if db.DB.Where("sku = ?", item.SKU).First(&old).Error == nil {
			item.UnitCost = old.UnitCost
		} else {
			item.UnitCost = 0
		}
	}

	if err := db.DB.Save(&item).Error; err != nil {
		return c.JSON(http.StatusInternalServerError, echo.Map{"error": err.Error()})
	}
	return c.JSON(http.StatusOK, item)
}

// Serialized Inventory APIs
func GetSerializedInventory(c echo.Context) error {
	var items []models.SerializedInventory
	db.DB.Order("created_at desc").Find(&items)
	return c.JSON(http.StatusOK, items)
}

type StockInRequest struct {
	SKU          string `json:"sku"`
	Quantity     int    `json:"quantity"`
	SerialNumber string `json:"serial_number"`
	MAC          string `json:"mac"`
	Model        string `json:"model"`
	Manufacturer string `json:"manufacturer"`
	AccessTech   string `json:"access_tech"`
	Condition    string `json:"condition"`
	Location     string `json:"location"`
	Notes        string `json:"notes"`
	ProjectID    string `json:"project_id"`
	RequestedBy  string `json:"requested_by"`
}

func StockInSerializedItem(c echo.Context) error {
	var req StockInRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": err.Error()})
	}

	actorEmail := c.Get("email").(string)

	err := db.DB.Transaction(func(tx *gorm.DB) error {
		// Fetch catalog item for cost
		var cat models.ItemCatalog
		tx.Where("sku = ?", req.SKU).First(&cat)

		assetID := fmt.Sprintf("%s-%d", req.SKU, time.Now().UnixNano()%10000)
		if req.SerialNumber != "" {
			assetID = fmt.Sprintf("%s-%s", req.SKU, req.SerialNumber)
		}

		unit := models.SerializedInventory{
			AssetID:          assetID,
			SKU:              req.SKU,
			AssetType:        cat.AssetType,
			Manufacturer:     req.Manufacturer,
			Model:            req.Model,
			AccessTech:       req.AccessTech,
			MAC:              req.MAC,
			SerialNumber:     nilIfBlank(req.SerialNumber),
			Status:           "In Stock",
			Condition:        req.Condition,
			Location:         req.Location,
			Notes:            req.Notes,
			CurrentProjectID: req.ProjectID,
			CreatedAt:        time.Now(),
			UpdatedAt:        time.Now(),
		}

		if unit.Condition == "" {
			unit.Condition = "New"
		}
		if unit.Location == "" {
			unit.Location = "Main Store"
		}

		if err := tx.Save(&unit).Error; err != nil {
			return err
		}

		// Immutable Inventory Transaction
		txLog := models.InventoryTransaction{
			ID:              uuid.New(),
			TransactionDate: time.Now(),
			Direction:       "Stock In",
			SKU:             req.SKU,
			ItemName:        cat.Model,
			Quantity:        1,
			RequestedBy:     actorEmail,
			Role:            fmt.Sprintf("%v", c.Get("role")),
			SiteReference:   req.Location,
			UnitCost:        cat.UnitCost,
			TotalCost:       cat.UnitCost,
			AssetID:         unit.AssetID,
			ProjectID:       req.ProjectID,
			Notes:           fmt.Sprintf("Stock In S/N: %s, MAC: %s", req.SerialNumber, req.MAC),
		}
		return tx.Create(&txLog).Error
	})

	if err != nil {
		return c.JSON(http.StatusInternalServerError, echo.Map{"error": err.Error()})
	}
	return c.JSON(http.StatusOK, echo.Map{"message": "Stock In recorded successfully"})
}

func UpdateSerializedDevice(c echo.Context) error {
	assetID := c.Param("id")
	var item models.SerializedInventory
	if err := db.DB.Where("asset_id = ?", assetID).First(&item).Error; err != nil {
		return c.JSON(http.StatusNotFound, echo.Map{"error": "Device not found"})
	}

	var req models.SerializedInventory
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": err.Error()})
	}

	item.SerialNumber = nilIfBlankPtr(req.SerialNumber)
	item.MAC = req.MAC
	item.Model = req.Model
	item.Manufacturer = req.Manufacturer
	item.Condition = req.Condition
	item.Status = req.Status
	item.Location = req.Location
	item.Custodian = req.Custodian
	item.Notes = req.Notes
	item.UpdatedAt = time.Now()

	if err := db.DB.Save(&item).Error; err != nil {
		return c.JSON(http.StatusInternalServerError, echo.Map{"error": err.Error()})
	}
	return c.JSON(http.StatusOK, item)
}

// Transaction Ledger API
func GetTransactions(c echo.Context) error {
	var txs []models.InventoryTransaction
	db.DB.Order("transaction_date desc").Find(&txs)
	return c.JSON(http.StatusOK, txs)
}

// Requisitions API
func GetRequisitions(c echo.Context) error {
	var reqs []models.TechnicianRequisition
	q := db.DB.Order("date_requested desc")
	if !can(c, "viewAllReqs") { // technicians / project managers see only their own
		q = q.Where("lower(technician_name) = ? OR lower(technician_name) = ?", strings.ToLower(actorName(c)), actorEmail(c))
	}
	q.Find(&reqs)
	if !can(c, "viewCosts") {
		for i := range reqs {
			reqs[i].EstValue = 0
		}
	}
	return c.JSON(http.StatusOK, reqs)
}

func CreateRequisition(c echo.Context) error {
	var req models.TechnicianRequisition
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": err.Error()})
	}

	req.TechnicianName = actorName(c) // requester is always the caller, never client-supplied
	req.RequisitionID = fmt.Sprintf("REQ-%d", time.Now().UnixNano()%100000)
	req.DateRequested = time.Now()
	req.ApprovalStatus = "Pending Approval"
	req.CreatedAt = time.Now()
	req.UpdatedAt = time.Now()

	if err := db.DB.Create(&req).Error; err != nil {
		return c.JSON(http.StatusInternalServerError, echo.Map{"error": err.Error()})
	}
	return c.JSON(http.StatusOK, req)
}

func DecideRequisition(c echo.Context) error {
	id := c.Param("id")
	var body struct {
		Action       string `json:"action"` // Approve, Reject, Cancel
		DecisionNote string `json:"decision_note"`
	}
	if err := c.Bind(&body); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": err.Error()})
	}

	actorEmail := c.Get("email").(string)

	var req models.TechnicianRequisition
	if err := db.DB.Where("requisition_id = ?", id).First(&req).Error; err != nil {
		return c.JSON(http.StatusNotFound, echo.Map{"error": "Requisition not found"})
	}

	own := isMe(c, req.TechnicianName)
	if body.Action == "Cancel" {
		if !own || (req.ApprovalStatus != "Pending Approval" && req.ApprovalStatus != "Pending Finance") {
			return c.JSON(http.StatusForbidden, echo.Map{"error": "Only the requester can withdraw a pending requisition."})
		}
		req.ApprovalStatus = "Cancelled"
	} else {
		if body.Action != "Approve" && body.Action != "Reject" {
			return c.JSON(http.StatusBadRequest, echo.Map{"error": "Action must be Approve, Reject or Cancel."})
		}
		if own && actorRole(c) != rbac.Admin { // no self-approval
			return c.JSON(http.StatusForbidden, echo.Map{"error": "You cannot approve your own requisition."})
		}
		if body.Action == "Reject" && strings.TrimSpace(body.DecisionNote) == "" {
			return c.JSON(http.StatusBadRequest, echo.Map{"error": "Give a reason for rejecting."})
		}
		switch req.ApprovalStatus {
		case "Pending Approval":
			if !can(c, "approveReq") && !can(c, "manageProjects") {
				return c.JSON(http.StatusForbidden, echo.Map{"error": "You cannot approve at this stage."})
			}
			if body.Action == "Approve" {
				req.ApprovalStatus, req.ApprovedBy = "Approved - Ready", actorEmail
			} else {
				req.ApprovalStatus = "Rejected"
			}
		case "Pending Finance":
			if !can(c, "approveFinance") {
				return c.JSON(http.StatusForbidden, echo.Map{"error": "Only Finance can clear this requisition."})
			}
			if body.Action == "Approve" {
				req.ApprovalStatus, req.FinanceStatus = "Approved - Ready", "Approved"
			} else {
				req.ApprovalStatus, req.FinanceStatus = "Rejected", "Rejected"
			}
		default:
			return c.JSON(http.StatusConflict, echo.Map{"error": "Requisition is already " + req.ApprovalStatus + "."})
		}
	}

	req.DecisionNote = body.DecisionNote
	req.UpdatedAt = time.Now()

	if err := db.DB.Save(&req).Error; err != nil {
		return c.JSON(http.StatusInternalServerError, echo.Map{"error": err.Error()})
	}
	return c.JSON(http.StatusOK, req)
}

func IssueRequisition(c echo.Context) error {
	id := c.Param("id")
	var body struct {
		AssetIDs []string `json:"asset_ids"`
	}
	if err := c.Bind(&body); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": err.Error()})
	}

	email := actorEmail(c)
	role := actorRole(c)
	var userUUID *uuid.UUID
	if uid, ok := c.Get("user_id").(string); ok && uid != "" {
		if parsed, err := uuid.Parse(uid); err == nil {
			userUUID = &parsed
		}
	}

	var issuedCount int
	err := db.WithActor(c.Request().Context(), email, role, func(tx *gorm.DB) error {
		pqAssets := "{" + strings.Join(body.AssetIDs, ",") + "}"
		return tx.Raw("SELECT issue_requisition(?, ?::text[], ?)", id, pqAssets, userUUID).Scan(&issuedCount).Error
	})

	if err != nil {
		return c.JSON(http.StatusUnprocessableEntity, echo.Map{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, echo.Map{
		"message":      "Stock issued successfully",
		"issued_count": issuedCount,
	})
}

func RaiseProcurementFromRequisition(c echo.Context) error {
	reqID := c.Param("id")
	email := actorEmail(c)
	role := actorRole(c)
	var userUUID *uuid.UUID
	if uid, ok := c.Get("user_id").(string); ok && uid != "" {
		if parsed, err := uuid.Parse(uid); err == nil {
			userUUID = &parsed
		}
	}

	var procID string
	err := db.WithActor(c.Request().Context(), email, role, func(tx *gorm.DB) error {
		return tx.Raw("SELECT raise_procurement_from_requisition(?, ?)", reqID, userUUID).Scan(&procID).Error
	})

	if err != nil {
		return c.JSON(http.StatusUnprocessableEntity, echo.Map{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, echo.Map{
		"message":        "Procurement raised from requisition",
		"procurement_id": procID,
	})
}

func nilIfBlank(s string) *string {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	v := strings.ToUpper(strings.TrimSpace(s))
	return &v
}

func nilIfBlankPtr(s *string) *string {
	if s == nil {
		return nil
	}
	return nilIfBlank(*s)
}
