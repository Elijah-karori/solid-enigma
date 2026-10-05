package handlers

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"github.com/ont/inventory-backend/internal/db"
	"github.com/ont/inventory-backend/internal/models"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

// Audit Log Helper with SHA-256 Hash Chaining
func LogAudit(actorEmail, actorRole, entityType, entityID, action, prevVal, newVal, details string) {
	var lastAudit models.AuditLedger
	prevHash := "GENESIS"
	if err := db.DB.Order("event_timestamp desc").First(&lastAudit).Error; err == nil && lastAudit.Hash != "" {
		prevHash = lastAudit.Hash
	}

	now := time.Now()
	dataToHash := fmt.Sprintf("%s|%s|%s|%s|%s|%s|%s|%s|%s",
		prevHash, actorEmail, actorRole, entityType, entityID, action, prevVal, newVal, now.Format(time.RFC3339))
	hashBytes := sha256.Sum256([]byte(dataToHash))
	hashStr := hex.EncodeToString(hashBytes[:])

	audit := models.AuditLedger{
		ID:             uuid.New(),
		EventTimestamp: now,
		ActorEmail:     actorEmail,
		ActorRole:      actorRole,
		EntityType:     entityType,
		EntityID:       entityID,
		Action:         action,
		PreviousState:  prevVal,
		NewState:       newVal,
		Details:        details,
		PrevHash:       prevHash,
		Hash:           hashStr,
	}
	db.DB.Create(&audit)
}

// ---------------- USER MANAGEMENT & AUTH EXTENSIONS ----------------

func ChangePassword(c echo.Context) error {
	actorEmail := c.Get("email").(string)
	var body struct {
		OldPassword string `json:"old_password"`
		NewPassword string `json:"new_password"`
	}
	if err := c.Bind(&body); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": err.Error()})
	}
	if len(body.NewPassword) < 6 {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": "New password must be at least 6 characters"})
	}

	var user models.User
	if err := db.DB.Where("email = ?", actorEmail).First(&user).Error; err != nil {
		return c.JSON(http.StatusNotFound, echo.Map{"error": "User not found"})
	}

	// Verify old password
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(body.OldPassword)); err != nil {
		if user.PasswordHash != body.OldPassword {
			return c.JSON(http.StatusUnauthorized, echo.Map{"error": "Current password incorrect"})
		}
	}

	hashed, err := bcrypt.GenerateFromPassword([]byte(body.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, echo.Map{"error": "Failed to hash password"})
	}

	user.PasswordHash = string(hashed)
	user.MustChangePassword = false
	user.UpdatedAt = time.Now()
	db.DB.Save(&user)

	LogAudit(actorEmail, user.Role, "User", user.Email, "Password Changed", "", "", "Password updated successfully")
	return c.JSON(http.StatusOK, echo.Map{"message": "Password changed successfully"})
}

func SendMagicLink(c echo.Context) error {
	var body struct {
		Email string `json:"email"`
	}
	if err := c.Bind(&body); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": err.Error()})
	}

	var user models.User
	if err := db.DB.Where("email = ?", body.Email).First(&user).Error; err != nil {
		return c.JSON(http.StatusNotFound, echo.Map{"error": "No account found with this email"})
	}

	tokenStr := fmt.Sprintf("MT-%s", uuid.New().String()[:8])
	magicToken := models.MagicToken{
		ID:        uuid.New(),
		Email:     user.Email,
		Token:     tokenStr,
		ExpiresAt: time.Now().Add(15 * time.Minute),
		CreatedAt: time.Now(),
	}
	db.DB.Create(&magicToken)

	LogAudit(user.Email, user.Role, "MagicToken", tokenStr, "Generated", "", "", "Magic login token created")
	return c.JSON(http.StatusOK, echo.Map{
		"message": fmt.Sprintf("Magic login link generated for %s (Token: %s)", user.Email, tokenStr),
		"token":   tokenStr,
	})
}

func GetUsers(c echo.Context) error {
	var users []models.User
	db.DB.Order("name asc").Find(&users)
	return c.JSON(http.StatusOK, users)
}

func SaveUser(c echo.Context) error {
	actorEmail := c.Get("email").(string)
	actorRole := c.Get("role").(string)

	var req struct {
		ID       string `json:"id"`
		Email    string `json:"email"`
		Name     string `json:"name"`
		Role     string `json:"role"`
		Status   string `json:"status"`
		Password string `json:"password"`
		Site     string `json:"site_station"`
		Contact  string `json:"contact_info"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": err.Error()})
	}
	if req.Email == "" {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": "Email is required"})
	}

	var user models.User
	err := db.DB.Where("email = ?", req.Email).First(&user).Error

	if err == gorm.ErrRecordNotFound {
		user = models.User{
			ID:                 uuid.New(),
			Email:              req.Email,
			Name:               req.Name,
			Role:               req.Role,
			Status:             req.Status,
			SiteStation:        req.Site,
			ContactInfo:        req.Contact,
			MustChangePassword: true,
			CreatedAt:          time.Now(),
			UpdatedAt:          time.Now(),
		}
		if req.Role == "" {
			user.Role = "Technician"
		}
		if req.Status == "" {
			user.Status = "active"
		}
		pwd := req.Password
		if pwd == "" {
			pwd = "Password123!"
		}
		hashed, _ := bcrypt.GenerateFromPassword([]byte(pwd), bcrypt.DefaultCost)
		user.PasswordHash = string(hashed)

		if err := db.DB.Create(&user).Error; err != nil {
			return c.JSON(http.StatusInternalServerError, echo.Map{"error": err.Error()})
		}
		LogAudit(actorEmail, actorRole, "User", user.Email, "Created", "", user.Role, "Created new user")
	} else {
		user.Name = req.Name
		user.Role = req.Role
		user.Status = req.Status
		user.SiteStation = req.Site
		user.ContactInfo = req.Contact
		user.UpdatedAt = time.Now()

		if req.Password != "" {
			hashed, _ := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
			user.PasswordHash = string(hashed)
		}
		db.DB.Save(&user)
		LogAudit(actorEmail, actorRole, "User", user.Email, "Updated", "", user.Role, "Updated user details")
	}

	return c.JSON(http.StatusOK, user)
}

// ---------------- GENERAL STOCK MOVEMENT & NEGATIVE STOCK PREVENTER ----------------

type MovementRequest struct {
	Date      string  `json:"date"`
	Direction string  `json:"direction"` // Stock In, Stock Out, Transfer, Adjustment
	ItemType  string  `json:"item_type"` // bulk, serialized
	ItemID    string  `json:"item_id"`   // SKU or AssetID
	Model     string  `json:"model"`
	Quantity  float64 `json:"quantity"`
	User      string  `json:"user"`
	CostType  string  `json:"cost_type"`
	TaskID    string  `json:"task_id"`
	Site      string  `json:"site"`
	Notes     string  `json:"notes"`
	ProjectID string  `json:"project_id"`
}

func RecordStockMovement(c echo.Context) error {
	actorEmail := c.Get("email").(string)
	actorRole := fmt.Sprintf("%v", c.Get("role"))

	var req MovementRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": err.Error()})
	}
	if req.ItemID == "" || req.Quantity <= 0 {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": "Item ID and Quantity (>0) are required"})
	}

	dir := strings.TrimSpace(req.Direction)
	if dir == "Stock Out" || dir == "Issue" {
		dir = "Stock Out"
	} else {
		dir = "Stock In"
	}

	err := db.DB.Transaction(func(tx *gorm.DB) error {
		var cat models.ItemCatalog
		tx.Where("sku = ?", req.ItemID).First(&cat)

		// Check for Negative Stock on Stock Out for Bulk Items
		if dir == "Stock Out" && req.ItemType != "serialized" {
			var totalIn, totalOut float64
			tx.Model(&models.InventoryTransaction{}).Where("sku = ? AND direction = 'Stock In'", req.ItemID).Select("COALESCE(SUM(quantity), 0)").Scan(&totalIn)
			tx.Model(&models.InventoryTransaction{}).Where("sku = ? AND direction = 'Stock Out'", req.ItemID).Select("COALESCE(SUM(quantity), 0)").Scan(&totalOut)
			available := totalIn - totalOut

			if available < req.Quantity {
				return fmt.Errorf("insufficient stock for SKU %s: available %.0f, requested %.0f", req.ItemID, available, req.Quantity)
			}
		}

		if req.ItemType == "serialized" {
			var dev models.SerializedInventory
			if err := tx.Where("asset_id = ?", req.ItemID).First(&dev).Error; err != nil {
				return fmt.Errorf("serialized unit %s not found", req.ItemID)
			}
			if dir == "Stock Out" {
				dev.Status = "Issued / Out"
				dev.Custodian = req.User
				dev.Location = req.Site
			} else {
				dev.Status = "In Stock"
				dev.Custodian = ""
				dev.Location = req.Site
			}
			dev.UpdatedAt = time.Now()
			tx.Save(&dev)
		}

		txLog := models.InventoryTransaction{
			ID:              uuid.New(),
			TransactionDate: time.Now(),
			Direction:       dir,
			SKU:             req.ItemID,
			ItemName:        req.Model,
			Quantity:        req.Quantity,
			RequestedBy:     req.User,
			Role:            actorRole,
			SiteReference:   req.Site,
			UnitCost:        cat.UnitCost,
			TotalCost:       cat.UnitCost * req.Quantity,
			CostType:        req.CostType,
			TaskID:          req.TaskID,
			ProjectID:       req.ProjectID,
			Notes:           req.Notes,
		}
		return tx.Create(&txLog).Error
	})

	if err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": err.Error()})
	}

	LogAudit(actorEmail, actorRole, "InventoryTransaction", req.ItemID, dir, "", fmt.Sprintf("Qty: %.0f", req.Quantity), req.Notes)
	return c.JSON(http.StatusOK, echo.Map{"message": "Movement recorded successfully"})
}

// ---------------- BATCH SERIALIZED STOCK IN & DEVICE REPLACEMENT ----------------

type BatchUnitItem struct {
	SN        string `json:"sn"`
	MAC       string `json:"mac"`
	ProductID string `json:"productId"`
	Condition string `json:"condition"`
	Remarks   string `json:"remarks"`
}

type BatchStockInReq struct {
	SKU   string          `json:"sku"`
	Site  string          `json:"site"`
	Notes string          `json:"notes"`
	Units []BatchUnitItem `json:"units"`
}

func BatchStockInSerialized(c echo.Context) error {
	actorEmail := c.Get("email").(string)
	actorRole := fmt.Sprintf("%v", c.Get("role"))

	var req BatchStockInReq
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": err.Error()})
	}
	if req.SKU == "" || len(req.Units) == 0 {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": "SKU and at least 1 unit are required"})
	}

	var cat models.ItemCatalog
	db.DB.Where("sku = ?", req.SKU).First(&cat)

	count := 0
	err := db.DB.Transaction(func(tx *gorm.DB) error {
		for _, u := range req.Units {
			if u.SN == "" && u.MAC == "" {
				continue
			}

			assetID := fmt.Sprintf("%s-%s", req.SKU, u.SN)
			if u.SN == "" {
				assetID = fmt.Sprintf("%s-%s", req.SKU, u.MAC)
			}

			// Duplicate check
			var existing models.SerializedInventory
			if u.SN != "" && tx.Where("serial_number = ?", u.SN).First(&existing).Error == nil {
				return fmt.Errorf("duplicate serial number: %s already exists", u.SN)
			}

			dev := models.SerializedInventory{
				AssetID:      assetID,
				SKU:          req.SKU,
				AssetType:    cat.AssetType,
				Manufacturer: cat.Manufacturer,
				Model:        cat.Model,
				AccessTech:   cat.AccessTech,
				ProductID:    u.ProductID,
				MAC:          u.MAC,
				SerialNumber: u.SN,
				Status:       "In Stock",
				Condition:    u.Condition,
				Location:     req.Site,
				Notes:        req.Notes + " " + u.Remarks,
				CreatedAt:    time.Now(),
				UpdatedAt:    time.Now(),
			}
			if dev.Condition == "" {
				dev.Condition = "New"
			}
			if dev.Location == "" {
				dev.Location = "Main Store"
			}

			if err := tx.Create(&dev).Error; err != nil {
				return err
			}

			txLog := models.InventoryTransaction{
				ID:              uuid.New(),
				TransactionDate: time.Now(),
				Direction:       "Stock In",
				SKU:             req.SKU,
				ItemName:        cat.Model,
				Quantity:        1,
				RequestedBy:     actorEmail,
				Role:            actorRole,
				SiteReference:   req.Site,
				UnitCost:        cat.UnitCost,
				TotalCost:       cat.UnitCost,
				AssetID:         dev.AssetID,
				Notes:           fmt.Sprintf("Batch Stock In S/N: %s, MAC: %s", u.SN, u.MAC),
			}
			tx.Create(&txLog)
			count++
		}
		return nil
	})

	if err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": err.Error()})
	}

	LogAudit(actorEmail, actorRole, "SerializedInventory", req.SKU, "Batch Stock In", "", fmt.Sprintf("Received %d units", count), req.Notes)
	return c.JSON(http.StatusOK, echo.Map{"message": fmt.Sprintf("Successfully received %d units into stock", count)})
}

func ReplaceDevice(c echo.Context) error {
	actorEmail := c.Get("email").(string)
	actorRole := fmt.Sprintf("%v", c.Get("role"))

	var req struct {
		Kind     string `json:"kind"` // customer, hotspot
		EntityID string `json:"entityId"`
		Role     string `json:"role"` // ONU, AP
		OldAsset string `json:"oldAsset"`
		NewAsset string `json:"newAsset"`
		TicketID string `json:"ticketId"`
		Reason   string `json:"reason"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": err.Error()})
	}

	err := db.DB.Transaction(func(tx *gorm.DB) error {
		// 1. Mark old device Under Repair / Faulty
		var oldDev models.SerializedInventory
		if err := tx.Where("asset_id = ? OR serial_number = ?", req.OldAsset, req.OldAsset).First(&oldDev).Error; err == nil {
			oldDev.Status = "Under Repair"
			oldDev.Condition = "Faulty"
			oldDev.Notes += fmt.Sprintf(" | Replaced on %s: %s", time.Now().Format("2006-01-02"), req.Reason)
			oldDev.UpdatedAt = time.Now()
			tx.Save(&oldDev)
		}

		// 2. Mark new device Issued / Out
		var newDev models.SerializedInventory
		if err := tx.Where("asset_id = ? OR serial_number = ?", req.NewAsset, req.NewAsset).First(&newDev).Error; err == nil {
			newDev.Status = "Issued / Out"
			newDev.Custodian = req.EntityID
			newDev.Notes += fmt.Sprintf(" | Swapped in place of %s", req.OldAsset)
			newDev.UpdatedAt = time.Now()
			tx.Save(&newDev)
		}

		// 3. Update Customer or Hotspot record
		if req.Kind == "customer" {
			var cust models.Customer
			if err := tx.Where("id = ? OR account_number = ?", req.EntityID, req.EntityID).First(&cust).Error; err == nil {
				cust.AssignedONUSerial = req.NewAsset
				cust.UpdatedAt = time.Now()
				tx.Save(&cust)
			}
		}

		// 4. Update Ticket if present
		if req.TicketID != "" {
			var ticket models.CustomerTicket
			if err := tx.Where("ticket_id = ?", req.TicketID).First(&ticket).Error; err == nil {
				ticket.DeviceSwappedOldSN = req.OldAsset
				ticket.ReplacementDeviceNewSN = req.NewAsset
				ticket.TicketStatus = "Resolved"
				ticket.ResolutionNotes += " " + req.Reason
				ticket.UpdatedAt = time.Now()
				tx.Save(&ticket)
			}
		}

		return nil
	})

	if err != nil {
		return c.JSON(http.StatusInternalServerError, echo.Map{"error": err.Error()})
	}

	LogAudit(actorEmail, actorRole, "DeviceReplacement", req.EntityID, "Replaced", req.OldAsset, req.NewAsset, req.Reason)
	return c.JSON(http.StatusOK, echo.Map{"message": fmt.Sprintf("Successfully replaced %s with %s", req.OldAsset, req.NewAsset)})
}

// ---------------- UNIVERSAL SCANNER LOOKUP ----------------

func UniversalLookup(c echo.Context) error {
	query := strings.TrimSpace(c.QueryParam("q"))
	if query == "" {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": "Query parameter 'q' is required"})
	}

	// 1. Search Serialized Inventory
	var unit models.SerializedInventory
	if err := db.DB.Where("asset_id = ? OR serial_number = ? OR mac = ? OR product_id = ?", query, query, query, query).First(&unit).Error; err == nil {
		return c.JSON(http.StatusOK, echo.Map{
			"kind":      "unit",
			"id":        unit.AssetID,
			"sku":       unit.SKU,
			"model":     unit.Model,
			"sn":        unit.SerialNumber,
			"mac":       unit.MAC,
			"status":    unit.Status,
			"condition": unit.Condition,
			"location":  unit.Location,
			"custodian": unit.Custodian,
		})
	}

	// 2. Search Item Catalog
	var cat models.ItemCatalog
	if err := db.DB.Where("sku = ? OR model = ?", query, query).First(&cat).Error; err == nil {
		var totalIn, totalOut float64
		db.DB.Model(&models.InventoryTransaction{}).Where("sku = ? AND direction = 'Stock In'", cat.SKU).Select("COALESCE(SUM(quantity), 0)").Scan(&totalIn)
		db.DB.Model(&models.InventoryTransaction{}).Where("sku = ? AND direction = 'Stock Out'", cat.SKU).Select("COALESCE(SUM(quantity), 0)").Scan(&totalOut)

		return c.JSON(http.StatusOK, echo.Map{
			"kind":     "sku",
			"sku":      cat.SKU,
			"model":    cat.Model,
			"tracking": cat.TrackingType,
			"scope":    cat.ProjectScope,
			"net":      totalIn - totalOut,
		})
	}

	return c.JSON(http.StatusNotFound, echo.Map{"error": fmt.Sprintf("No item or unit found matching '%s'", query)})
}

// ---------------- TECHNICIAN TASKS & LINKAGE ----------------

func GetTasks(c echo.Context) error {
	var tasks []models.TechnicianTask
	db.DB.Order("created_at desc").Find(&tasks)
	return c.JSON(http.StatusOK, tasks)
}

func CreateTask(c echo.Context) error {
	actorEmail := c.Get("email").(string)
	var task models.TechnicianTask
	if err := c.Bind(&task); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": err.Error()})
	}

	task.TaskID = fmt.Sprintf("TASK-%d", time.Now().UnixNano()%100000)
	task.Status = "Assigned"
	task.CreatedBy = actorEmail
	task.CreatedAt = time.Now()
	task.UpdatedAt = time.Now()

	if err := db.DB.Create(&task).Error; err != nil {
		return c.JSON(http.StatusInternalServerError, echo.Map{"error": err.Error()})
	}
	return c.JSON(http.StatusOK, task)
}

func UpdateTaskStatus(c echo.Context) error {
	taskID := c.Param("id")
	var body struct {
		Status string `json:"status"` // Assigned, In Progress, Completed, Cancelled
		Notes  string `json:"notes"`
	}
	if err := c.Bind(&body); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": err.Error()})
	}

	var task models.TechnicianTask
	if err := db.DB.Where("task_id = ?", taskID).First(&task).Error; err != nil {
		return c.JSON(http.StatusNotFound, echo.Map{"error": "Task not found"})
	}

	task.Status = body.Status
	if body.Notes != "" {
		task.Notes += " | " + body.Notes
	}
	task.UpdatedAt = time.Now()
	db.DB.Save(&task)

	return c.JSON(http.StatusOK, task)
}

// ---------------- PROCUREMENT WORKFLOW ----------------

func GetProcurement(c echo.Context) error {
	var procs []models.ProcurementRequest
	db.DB.Order("date_requested desc").Find(&procs)
	return c.JSON(http.StatusOK, procs)
}

func CreateProcurement(c echo.Context) error {
	actorEmail := c.Get("email").(string)
	var req models.ProcurementRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": err.Error()})
	}

	req.ProcurementID = fmt.Sprintf("PROC-%d", time.Now().UnixNano()%100000)
	req.DateRequested = time.Now()
	req.RequestedBy = actorEmail
	req.Status = "Pending Finance"
	req.CreatedAt = time.Now()
	req.UpdatedAt = time.Now()

	var cat models.ItemCatalog
	if err := db.DB.Where("sku = ?", req.ItemSKU).First(&cat).Error; err == nil {
		req.EstUnitCost = cat.UnitCost
		req.EstTotal = cat.UnitCost * req.Quantity
	}

	if err := db.DB.Create(&req).Error; err != nil {
		return c.JSON(http.StatusInternalServerError, echo.Map{"error": err.Error()})
	}
	return c.JSON(http.StatusOK, req)
}

func DecideProcurement(c echo.Context) error {
	id := c.Param("id")
	actorEmail := c.Get("email").(string)
	var body struct {
		Action string `json:"action"` // Approved, Rejected, Cancelled
		Notes  string `json:"notes"`
	}
	if err := c.Bind(&body); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": err.Error()})
	}

	var req models.ProcurementRequest
	if err := db.DB.Where("procurement_id = ?", id).First(&req).Error; err != nil {
		return c.JSON(http.StatusNotFound, echo.Map{"error": "Procurement request not found"})
	}

	now := time.Now()
	req.Status = body.Action
	req.FinanceBy = actorEmail
	req.FinanceDate = &now
	req.Notes += " " + body.Notes
	req.UpdatedAt = now

	db.DB.Save(&req)
	return c.JSON(http.StatusOK, req)
}

func OrderProcurement(c echo.Context) error {
	id := c.Param("id")
	var body struct {
		Supplier string `json:"supplier"`
		PORef    string `json:"po_ref"`
	}
	if err := c.Bind(&body); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": err.Error()})
	}

	var req models.ProcurementRequest
	if err := db.DB.Where("procurement_id = ?", id).First(&req).Error; err != nil {
		return c.JSON(http.StatusNotFound, echo.Map{"error": "Procurement request not found"})
	}

	req.Status = "Ordered"
	req.Supplier = body.Supplier
	req.PORef = body.PORef
	req.OrderedDate = time.Now().Format("2006-01-02")
	req.UpdatedAt = time.Now()

	db.DB.Save(&req)
	return c.JSON(http.StatusOK, req)
}

func ReceiveProcurement(c echo.Context) error {
	id := c.Param("id")
	actorEmail := c.Get("email").(string)
	actorRole := fmt.Sprintf("%v", c.Get("role"))

	err := db.DB.Transaction(func(tx *gorm.DB) error {
		var req models.ProcurementRequest
		if err := tx.Where("procurement_id = ?", id).First(&req).Error; err != nil {
			return err
		}

		req.Status = "Received"
		req.ReceivedDate = time.Now().Format("2006-01-02")
		req.ReceivedQuantity = req.Quantity
		req.UpdatedAt = time.Now()
		tx.Save(&req)

		// Post Stock In
		var cat models.ItemCatalog
		tx.Where("sku = ?", req.ItemSKU).First(&cat)

		txLog := models.InventoryTransaction{
			ID:              uuid.New(),
			TransactionDate: time.Now(),
			Direction:       "Stock In",
			SKU:             req.ItemSKU,
			ItemName:        cat.Model,
			Quantity:        req.Quantity,
			RequestedBy:     actorEmail,
			Role:            actorRole,
			SiteReference:   "Main Store",
			UnitCost:        req.EstUnitCost,
			TotalCost:       req.EstTotal,
			ProjectID:       req.ProjectID,
			Notes:           fmt.Sprintf("Received from Procurement PO: %s", req.PORef),
		}
		return tx.Create(&txLog).Error
	})

	if err != nil {
		return c.JSON(http.StatusInternalServerError, echo.Map{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, echo.Map{"message": "Procurement items received into stock"})
}

// ---------------- DELIVERY NOTES & PAYMENTS ----------------

func GetDeliveryNotes(c echo.Context) error {
	var docs []models.DeliveryNote
	db.DB.Order("created_at desc").Find(&docs)
	return c.JSON(http.StatusOK, docs)
}

func GenerateDeliveryNote(c echo.Context) error {
	actorEmail := c.Get("email").(string)
	var body struct {
		Ref      string `json:"ref"`
		Type     string `json:"type"` // Delivery note, Receipt note
		Project  string `json:"project"`
		Recipient string `json:"recipient"`
		Value    float64 `json:"value"`
	}
	if err := c.Bind(&body); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": err.Error()})
	}

	docNo := fmt.Sprintf("DN-%d", time.Now().UnixNano()%100000)
	doc := models.DeliveryNote{
		DocNo:         docNo,
		Type:          body.Type,
		Reference:     body.Ref,
		ProjectID:     body.Project,
		Recipient:     body.Recipient,
		CreatedBy:     actorEmail,
		ValueKES:      body.Value,
		PaymentStatus: "Pending",
		CreatedAt:     time.Now(),
	}
	if doc.Type == "" {
		doc.Type = "Delivery note"
	}

	db.DB.Create(&doc)
	return c.JSON(http.StatusOK, doc)
}

func UpdatePaymentStatus(c echo.Context) error {
	id := c.Param("id")
	var body struct {
		Status string `json:"status"` // Pending, Paid, Tracking only
		Ref    string `json:"ref"`
	}
	if err := c.Bind(&body); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": err.Error()})
	}

	var doc models.DeliveryNote
	if err := db.DB.Where("doc_no = ?", id).First(&doc).Error; err != nil {
		return c.JSON(http.StatusNotFound, echo.Map{"error": "Note not found"})
	}

	doc.PaymentStatus = body.Status
	doc.PaymentRef = body.Ref
	doc.PaidDate = time.Now().Format("2006-01-02")
	db.DB.Save(&doc)

	return c.JSON(http.StatusOK, doc)
}

// ---------------- SHA-256 AUDIT LOG & HASH CHAIN INTEGRITY ----------------

func GetAuditLogs(c echo.Context) error {
	var logs []models.AuditLedger
	db.DB.Order("event_timestamp desc").Limit(500).Find(&logs)
	return c.JSON(http.StatusOK, logs)
}

func VerifyAuditTrail(c echo.Context) error {
	var logs []models.AuditLedger
	db.DB.Order("event_timestamp asc").Find(&logs)

	prevHash := "GENESIS"
	for idx, audit := range logs {
		if idx > 0 && audit.PrevHash != prevHash {
			return c.JSON(http.StatusOK, echo.Map{
				"intact":   false,
				"brokenAt": audit.ID.String(),
				"row":      idx + 1,
				"message":  fmt.Sprintf("Tampering detected at record %s (row %d): PrevHash mismatch", audit.ID.String(), idx+1),
			})
		}

		dataToHash := fmt.Sprintf("%s|%s|%s|%s|%s|%s|%s|%s|%s",
			audit.PrevHash, audit.ActorEmail, audit.ActorRole, audit.EntityType, audit.EntityID, audit.Action, audit.PreviousState, audit.NewState, audit.EventTimestamp.Format(time.RFC3339))
		hashBytes := sha256.Sum256([]byte(dataToHash))
		computedHash := hex.EncodeToString(hashBytes[:])

		if audit.Hash != "" && audit.Hash != computedHash {
			return c.JSON(http.StatusOK, echo.Map{
				"intact":   false,
				"brokenAt": audit.ID.String(),
				"row":      idx + 1,
				"message":  fmt.Sprintf("Tampering detected at record %s (row %d): SHA-256 hash mismatch", audit.ID.String(), idx+1),
			})
		}

		if audit.Hash != "" {
			prevHash = audit.Hash
		}
	}

	return c.JSON(http.StatusOK, echo.Map{
		"intact":  true,
		"count":   len(logs),
		"message": fmt.Sprintf("Audit trail intact - %d chained records verified.", len(logs)),
	})
}

// ---------------- INVENTORY SETTINGS & LOW STOCK SCAN ----------------

func GetSettings(c echo.Context) error {
	var settings []models.InventorySetting
	db.DB.Find(&settings)

	out := make(map[string]string)
	for _, s := range settings {
		out[s.Key] = s.Value
	}
	return c.JSON(http.StatusOK, out)
}

func SaveSettings(c echo.Context) error {
	var body map[string]string
	if err := c.Bind(&body); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": err.Error()})
	}

	for k, v := range body {
		setting := models.InventorySetting{
			Key:       k,
			Value:     v,
			UpdatedAt: time.Now(),
		}
		db.DB.Save(&setting)
	}
	return c.JSON(http.StatusOK, echo.Map{"message": "Settings saved successfully"})
}

func RunLowStockScan(c echo.Context) error {
	var catalog []models.ItemCatalog
	db.DB.Find(&catalog)

	lowStockCount := 0
	for _, item := range catalog {
		var totalIn, totalOut float64
		db.DB.Model(&models.InventoryTransaction{}).Where("sku = ? AND direction = 'Stock In'", item.SKU).Select("COALESCE(SUM(quantity), 0)").Scan(&totalIn)
		db.DB.Model(&models.InventoryTransaction{}).Where("sku = ? AND direction = 'Stock Out'", item.SKU).Select("COALESCE(SUM(quantity), 0)").Scan(&totalOut)

		balance := totalIn - totalOut
		if balance <= float64(item.ReorderLevel) {
			lowStockCount++
			// Log notification
			notif := models.NotificationLog{
				ID:        uuid.New(),
				Timestamp: time.Now(),
				Type:      "LOW_STOCK",
				Reference: item.SKU,
				Recipient: "admin@ont.co.ke",
				Subject:   fmt.Sprintf("Low stock alert: %s (%s)", item.SKU, item.Model),
				Status:    "SENT",
			}
			db.DB.Create(&notif)
		}
	}

	return c.JSON(http.StatusOK, echo.Map{
		"message":  fmt.Sprintf("Low stock scan completed. Found %d low-stock items.", lowStockCount),
		"lowCount": lowStockCount,
	})
}
