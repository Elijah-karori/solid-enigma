package handlers

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/ont/inventory-backend/internal/pdf"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
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
	user.MustResetPassword = false
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
			ID:                uuid.New(),
			Email:             req.Email,
			Name:              req.Name,
			Role:              req.Role,
			Status:            req.Status,
			SiteStation:       req.Site,
			ContactInfo:       req.Contact,
			MustResetPassword: true,
			CreatedAt:         time.Now(),
			UpdatedAt:         time.Now(),
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
	AssetID   string  `json:"asset_id"`
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
	email := actorEmail(c)
	role := actorRole(c)

	var req MovementRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": err.Error()})
	}

	dir := strings.TrimSpace(req.Direction)
	if dir == "Stock Out" || dir == "Issue" {
		dir = "Stock Out"
	} else {
		dir = "Stock In"
	}

	var txID uuid.UUID
	var userUUID *uuid.UUID
	if uid, ok := c.Get("user_id").(string); ok && uid != "" {
		if parsed, err := uuid.Parse(uid); err == nil {
			userUUID = &parsed
		}
	}

	err := db.WithActor(c.Request().Context(), email, role, func(tx *gorm.DB) error {
		return tx.Raw("SELECT record_movement(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			dir, req.ItemID, req.Quantity, nilIfBlank(req.AssetID), nilIfBlank(req.CostType),
			nilIfBlank(req.ProjectID), nilIfBlank(req.TaskID), nilIfBlank(req.Site), nilIfBlank(req.Notes),
			userUUID, time.Now(),
		).Scan(&txID).Error
	})

	if err != nil {
		return c.JSON(http.StatusUnprocessableEntity, echo.Map{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, echo.Map{"message": "Movement recorded successfully", "id": txID})
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
	email := actorEmail(c)
	role := actorRole(c)

	var req BatchStockInReq
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": err.Error()})
	}

	unitsJSON, err := json.Marshal(req.Units)
	if err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": "Invalid units list"})
	}

	var userUUID *uuid.UUID
	if uid, ok := c.Get("user_id").(string); ok && uid != "" {
		if parsed, err := uuid.Parse(uid); err == nil {
			userUUID = &parsed
		}
	}

	var createdAssetIDs []string
	err = db.WithActor(c.Request().Context(), email, role, func(tx *gorm.DB) error {
		return tx.Raw("SELECT receive_serialized_batch(?, ?::jsonb, ?, ?, ?)",
			req.SKU, string(unitsJSON), req.Site, req.Notes, userUUID,
		).Scan(&createdAssetIDs).Error
	})

	if err != nil {
		return c.JSON(http.StatusUnprocessableEntity, echo.Map{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, echo.Map{
		"message":   fmt.Sprintf("Successfully received %d units into stock", len(createdAssetIDs)),
		"asset_ids": createdAssetIDs,
	})
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
	code := strings.TrimSpace(c.QueryParam("code"))
	if code == "" {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": "Query parameter 'code' is required"})
	}

	cleanCode := strings.ToUpper(regexp.MustCompile(`[^a-zA-Z0-9]`).ReplaceAllString(code, ""))

	var unit models.SerializedInventory
	err := db.DB.Where(
		"UPPER(asset_id) = ? OR UPPER(serial_number) = ? OR UPPER(REGEXP_REPLACE(mac, '[:.-]', '', 'g')) = ? OR UPPER(product_id) = ?",
		cleanCode, cleanCode, cleanCode, cleanCode,
	).First(&unit).Error

	if err == nil {
		res := echo.Map{
			"type": "unit",
			"unit": unit,
		}
		if can(c, "manageCustomers") || can(c, "viewAllTickets") {
			if unit.CustomerAccount != "" {
				var cust models.Customer
				if db.DB.Where("customer_account = ?", unit.CustomerAccount).First(&cust).Error == nil {
					res["customer"] = cust
				}
			}
			if unit.LinkedTicketID != "" {
				var tck models.CustomerTicket
				if db.DB.Where("ticket_id = ?", unit.LinkedTicketID).First(&tck).Error == nil {
					res["ticket"] = tck
				}
			}
		}
		return c.JSON(http.StatusOK, res)
	}

	var item models.ItemCatalog
	err = db.DB.Where("UPPER(sku) = ? OR UPPER(model) = ?", cleanCode, cleanCode).First(&item).Error
	if err == nil {
		if !can(c, "viewCosts") {
			item.UnitCost = 0
		}
		return c.JSON(http.StatusOK, echo.Map{
			"type": "item",
			"item": item,
		})
	}

	return c.JSON(http.StatusNotFound, echo.Map{"error": fmt.Sprintf("No device or catalog item found matching '%s'", code)})
}

func GetUnitHistory(c echo.Context) error {
	assetID := c.Param("id")
	var history []map[string]any
	db.DB.Raw("SELECT * FROM v_unit_history WHERE asset_id = ? ORDER BY at DESC", assetID).Scan(&history)
	return c.JSON(http.StatusOK, history)
}

// ---------------- TECHNICIAN TASKS & LINKAGE ----------------

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
	email := actorEmail(c)
	role := actorRole(c)
	var userUUID *uuid.UUID
	if uid, ok := c.Get("user_id").(string); ok && uid != "" {
		if parsed, err := uuid.Parse(uid); err == nil {
			userUUID = &parsed
		}
	}

	var count int
	err := db.WithActor(c.Request().Context(), email, role, func(tx *gorm.DB) error {
		return tx.Raw("SELECT receive_procurement(?, ?)", id, userUUID).Scan(&count).Error
	})

	if err != nil {
		return c.JSON(http.StatusUnprocessableEntity, echo.Map{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, echo.Map{
		"message": fmt.Sprintf("Received %d item(s) from procurement into stock", count),
	})
}

// ---------------- DELIVERY NOTES & PAYMENTS ----------------

func GetDeliveryNotes(c echo.Context) error {
	var docs []models.DeliveryNote
	db.DB.Order("created_at desc").Find(&docs)
	return c.JSON(http.StatusOK, docs)
}

func GenerateDeliveryNote(c echo.Context) error {
	email := actorEmail(c)
	role := actorRole(c)

	var body struct {
		Ref       string  `json:"ref"`
		Type      string  `json:"type"`
		Project   string  `json:"project"`
		Recipient string  `json:"recipient"`
		Value     float64 `json:"value"`
	}
	if err := c.Bind(&body); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": err.Error()})
	}

	docNo := fmt.Sprintf("DN-%d", time.Now().UnixNano()%100000)
	docType := body.Type
	if docType == "" {
		docType = "Delivery note"
	}

	var txs []models.InventoryTransaction
	db.DB.Where("site_reference = ? OR project_id = ? OR requisition_id = ? OR procurement_id = ?", body.Ref, body.Project, body.Ref, body.Ref).Find(&txs)

	pdfItems := make([]pdf.DeliveryNoteItem, len(txs))
	showCosts := can(c, "viewCosts")
	var totalVal float64

	for i, tx := range txs {
		pdfItems[i] = pdf.DeliveryNoteItem{
			SKU:       tx.SKU,
			Model:     tx.ItemName,
			AssetID:   tx.AssetID,
			Quantity:  tx.Quantity,
			UnitCost:  tx.UnitCost,
			TotalCost: tx.TotalCost,
		}
		totalVal += tx.TotalCost
	}

	var compSetting models.Setting
	compName := "ONT Network Operations"
	if db.DB.Where("key = ?", "COMPANY_NAME").First(&compSetting).Error == nil && compSetting.Value != "" {
		compName = compSetting.Value
	}

	filePath, err := pdf.GenerateDeliveryNotePDF(pdf.DeliveryNoteData{
		DocNo:       docNo,
		Type:        docType,
		CompanyName: compName,
		Reference:   body.Ref,
		ProjectID:   body.Project,
		Recipient:   body.Recipient,
		CreatedBy:   email,
		Date:        time.Now(),
		Items:       pdfItems,
		ShowCosts:   showCosts,
		TotalValue:  totalVal,
	})
	_ = filePath

	fileName := fmt.Sprintf("%s.pdf", docNo)
	driveURL := fmt.Sprintf("/api/delivery-notes/%s/pdf", docNo)

	doc := models.DeliveryNote{
		DocNo:         docNo,
		Type:          docType,
		Reference:     body.Ref,
		ProjectID:     body.Project,
		Recipient:     body.Recipient,
		FileName:      fileName,
		DriveURL:      driveURL,
		CreatedBy:     email,
		ValueKES:      totalVal,
		PaymentStatus: "Pending",
		CreatedAt:     time.Now(),
	}

	err = db.WithActor(c.Request().Context(), email, role, func(tx *gorm.DB) error {
		return tx.Create(&doc).Error
	})

	if err != nil {
		return c.JSON(http.StatusInternalServerError, echo.Map{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, doc)
}

func DownloadDeliveryNotePDF(c echo.Context) error {
	docNo := c.Param("id")
	filePath := filepath.Join("storage/delivery_notes", fmt.Sprintf("%s.pdf", docNo))

	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		return c.JSON(http.StatusNotFound, echo.Map{"error": "PDF not found"})
	}

	return c.File(filePath)
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
	type VerifyResult struct {
		Intact    bool   `json:"intact"`
		Checked   int64  `json:"checked"`
		BrokenSeq *int64 `json:"broken_seq"`
		Reason    string `json:"reason"`
	}
	var res VerifyResult
	if err := db.DB.Raw("SELECT intact, checked, broken_seq, reason FROM audit_verify()").Scan(&res).Error; err != nil {
		return c.JSON(http.StatusInternalServerError, echo.Map{"error": err.Error()})
	}
	return c.JSON(http.StatusOK, res)
}

// ---------------- INVENTORY SETTINGS & LOW STOCK SCAN ----------------

func GetSettings(c echo.Context) error {
	var settings []models.Setting
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

	email := actorEmail(c)
	role := actorRole(c)

	err := db.WithActor(c.Request().Context(), email, role, func(tx *gorm.DB) error {
		for k, v := range body {
			setting := models.Setting{
				Key:       k,
				Value:     v,
				UpdatedAt: time.Now(),
			}
			if err := tx.Save(&setting).Error; err != nil {
				return err
			}
		}
		return nil
	})

	if err != nil {
		return c.JSON(http.StatusInternalServerError, echo.Map{"error": err.Error()})
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
