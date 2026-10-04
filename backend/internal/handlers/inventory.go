package handlers

import (
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"github.com/ont/inventory-backend/internal/db"
	"github.com/ont/inventory-backend/internal/models"
	"gorm.io/gorm"
)

// Catalog APIs
func GetCatalog(c echo.Context) error {
	var items []models.ItemCatalog
	db.DB.Find(&items)
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
	SKU            string `json:"sku"`
	Quantity       int    `json:"quantity"`
	SerialNumber   string `json:"serial_number"`
	MAC            string `json:"mac"`
	Model          string `json:"model"`
	Manufacturer   string `json:"manufacturer"`
	AccessTech     string `json:"access_tech"`
	Condition      string `json:"condition"`
	Location       string `json:"location"`
	Notes          string `json:"notes"`
	ProjectID      string `json:"project_id"`
	RequestedBy    string `json:"requested_by"`
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
			SerialNumber:     req.SerialNumber,
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

	item.SerialNumber = req.SerialNumber
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
	db.DB.Order("date_requested desc").Find(&reqs)
	return c.JSON(http.StatusOK, reqs)
}

func CreateRequisition(c echo.Context) error {
	var req models.TechnicianRequisition
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": err.Error()})
	}

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

	if body.Action == "Approve" {
		req.ApprovalStatus = "Approved - Ready"
		req.ApprovedBy = actorEmail
	} else if body.Action == "Reject" {
		req.ApprovalStatus = "Rejected"
	} else if body.Action == "Cancel" {
		req.ApprovalStatus = "Cancelled"
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

	actorEmail := c.Get("email").(string)

	err := db.DB.Transaction(func(tx *gorm.DB) error {
		var req models.TechnicianRequisition
		if err := tx.Where("requisition_id = ?", id).First(&req).Error; err != nil {
			return err
		}

		// Update requisition
		req.ApprovalStatus = "Issued"
		req.IssuedBy = actorEmail
		now := time.Now()
		req.IssueDate = &now
		req.IssuedUnits = fmt.Sprintf("%v", body.AssetIDs)
		req.UpdatedAt = now

		if err := tx.Save(&req).Error; err != nil {
			return err
		}

		// Update physical serial units
		for _, assetID := range body.AssetIDs {
			var device models.SerializedInventory
			if err := tx.Where("asset_id = ?", assetID).First(&device).Error; err == nil {
				device.Status = "Issued / Out"
				device.Custodian = req.TechnicianName
				device.Location = req.ReasonJobTicket
				device.UpdatedAt = now
				tx.Save(&device)

				// Create stock movement ledger
				txLog := models.InventoryTransaction{
					ID:              uuid.New(),
					TransactionDate: now,
					Direction:       "Stock Out",
					SKU:             req.ItemSKU,
					ItemName:        device.Model,
					Quantity:        1,
					RequestedBy:     req.TechnicianName,
					Role:            "Technician",
					SiteReference:   req.ReasonJobTicket,
					AssetID:         device.AssetID,
					ProjectID:       req.ProjectID,
					Notes:           fmt.Sprintf("Issued for Requisition: %s", req.RequisitionID),
				}
				tx.Create(&txLog)
			}
		}

		return nil
	})

	if err != nil {
		return c.JSON(http.StatusInternalServerError, echo.Map{"error": err.Error()})
	}
	return c.JSON(http.StatusOK, echo.Map{"message": "Stock issued successfully"})
}
