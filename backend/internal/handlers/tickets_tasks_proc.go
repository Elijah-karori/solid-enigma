package handlers

import (
	"fmt"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"net/http"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/ont/inventory-backend/internal/db"
	"github.com/ont/inventory-backend/internal/models"
)

// Tasks APIs
func GetTasks(c echo.Context) error {
	var tasks []models.TechnicianTask
	q := db.DB.Order("created_at desc")
	if !can(c, "viewAllTasks") {
		q = q.Where("lower(assigned_personnel) = ? OR lower(assignee_email) = ?", strings.ToLower(actorName(c)), actorEmail(c))
	}
	q.Find(&tasks)
	return c.JSON(http.StatusOK, tasks)
}

func CreateTask(c echo.Context) error {
	var task models.TechnicianTask
	if err := c.Bind(&task); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": err.Error()})
	}
	task.TaskID = fmt.Sprintf("TASK-%d", time.Now().UnixNano()%100000)
	task.CreatedAt = time.Now()
	task.UpdatedAt = time.Now()

	if err := db.DB.Create(&task).Error; err != nil {
		return c.JSON(http.StatusInternalServerError, echo.Map{"error": err.Error()})
	}
	return c.JSON(http.StatusOK, task)
}

// Tickets & Device Replacement APIs
func GetTickets(c echo.Context) error {
	var tickets []models.CustomerTicket
	q := db.DB.Order("date_logged desc")
	if !can(c, "viewAllTickets") {
		q = q.Where("lower(assigned_technician) = ? OR lower(assigned_technician) = ?", strings.ToLower(actorName(c)), actorEmail(c))
	}
	q.Find(&tickets)
	return c.JSON(http.StatusOK, tickets)
}

func CreateTicket(c echo.Context) error {
	var body struct {
		CustomerName string `json:"customer_name"`
		Category     string `json:"issue_category"`
		Priority     string `json:"priority"`
		Technician   string `json:"assigned_technician"`
		CreateTask   *bool  `json:"create_task"`
		Notes        string `json:"resolution_notes"`
		CustomerID   string `json:"customer_id"`
		HotspotID    string `json:"hotspot_id"`
		DeviceAsset  string `json:"device_asset_id"`
		OldSN        string `json:"old_device_sn"`
		NewSN        string `json:"new_device_sn"`
	}
	if err := c.Bind(&body); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": err.Error()})
	}

	createTask := true
	if body.CreateTask != nil {
		createTask = *body.CreateTask
	}

	email := actorEmail(c)
	role := actorRole(c)
	var userUUID *uuid.UUID
	if uid, ok := c.Get("user_id").(string); ok && uid != "" {
		if parsed, err := uuid.Parse(uid); err == nil {
			userUUID = &parsed
		}
	}

	var ticketID string
	err := db.WithActor(c.Request().Context(), email, role, func(tx *gorm.DB) error {
		return tx.Raw("SELECT create_ticket(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			nilIfBlank(body.CustomerName), nilIfBlank(body.Category), nilIfBlank(body.Priority),
			nilIfBlank(body.Technician), createTask, nilIfBlank(body.Notes), nilIfBlank(body.CustomerID),
			nilIfBlank(body.HotspotID), nilIfBlank(body.DeviceAsset), nilIfBlank(body.OldSN),
			nilIfBlank(body.NewSN), userUUID,
		).Scan(&ticketID).Error
	})

	if err != nil {
		return c.JSON(http.StatusUnprocessableEntity, echo.Map{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, echo.Map{
		"message":   "Ticket created successfully",
		"ticket_id": ticketID,
	})
}

func UpdateTicket(c echo.Context) error {
	id := c.Param("id")
	var ticket models.CustomerTicket
	if err := db.DB.Where("ticket_id = ?", id).First(&ticket).Error; err != nil {
		return c.JSON(http.StatusNotFound, echo.Map{"error": "Ticket not found"})
	}

	if can(c, "viewAllTickets") {
		if err := c.Bind(&ticket); err != nil {
			return c.JSON(http.StatusBadRequest, echo.Map{"error": err.Error()})
		}
		ticket.TicketID = id // the URL decides which ticket, never the body
	} else {
		// technicians: only their own tickets, and only status + notes
		if !isMe(c, ticket.AssignedTechnician) {
			return c.JSON(http.StatusForbidden, echo.Map{"error": "You can only update tickets assigned to you."})
		}
		var in struct {
			TicketStatus    string `json:"ticket_status"`
			ResolutionNotes string `json:"resolution_notes"`
		}
		if err := c.Bind(&in); err != nil {
			return c.JSON(http.StatusBadRequest, echo.Map{"error": err.Error()})
		}
		if in.TicketStatus != "" && in.TicketStatus != "In Progress" && in.TicketStatus != "Resolved" {
			return c.JSON(http.StatusForbidden, echo.Map{"error": "Technicians can set In Progress or Resolved."})
		}
		if in.TicketStatus == "Resolved" && strings.TrimSpace(in.ResolutionNotes) == "" {
			return c.JSON(http.StatusBadRequest, echo.Map{"error": "Add a resolution note before resolving."})
		}
		if in.TicketStatus != "" {
			ticket.TicketStatus = in.TicketStatus
		}
		if in.ResolutionNotes != "" {
			ticket.ResolutionNotes = in.ResolutionNotes
		}
	}

	if ticket.TicketStatus == "Resolved" || ticket.TicketStatus == "Closed" {
		now := time.Now()
		ticket.ClosedAt = &now

		// If device swapped, process physical status transition
		if ticket.DeviceSwappedOldSN != "" {
			var oldDev models.SerializedInventory
			if err := db.DB.Where("serial_number = ?", ticket.DeviceSwappedOldSN).First(&oldDev).Error; err == nil {
				oldDev.Status = "Under Repair"
				oldDev.Notes = fmt.Sprintf("Swapped out via ticket %s", ticket.TicketID)
				db.DB.Save(&oldDev)
			}
		}
		if ticket.ReplacementDeviceNewSN != "" {
			var newDev models.SerializedInventory
			if err := db.DB.Where("serial_number = ?", ticket.ReplacementDeviceNewSN).First(&newDev).Error; err == nil {
				newDev.Status = "Issued / Out"
				newDev.Location = ticket.CustomerAccount
				newDev.Notes = fmt.Sprintf("Replacement unit issued via ticket %s", ticket.TicketID)
				db.DB.Save(&newDev)
			}
		}
	}

	ticket.UpdatedAt = time.Now()
	if err := db.DB.Save(&ticket).Error; err != nil {
		return c.JSON(http.StatusInternalServerError, echo.Map{"error": err.Error()})
	}
	return c.JSON(http.StatusOK, ticket)
}

// Procurement APIs
func GetProcurement(c echo.Context) error {
	var proc []models.ProcurementRequest
	db.DB.Order("date_requested desc").Find(&proc)
	if !can(c, "viewCosts") {
		for i := range proc {
			proc[i].EstUnitCost, proc[i].EstTotal = 0, 0
		}
	}
	return c.JSON(http.StatusOK, proc)
}

func CreateProcurement(c echo.Context) error {
	var req models.ProcurementRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": err.Error()})
	}

	req.RequestedBy = actorName(c)
	if !can(c, "viewCosts") { // price is taken from the catalog, not trusted from the client
		var cat models.ItemCatalog
		if db.DB.Where("sku = ?", req.ItemSKU).First(&cat).Error == nil {
			req.EstUnitCost = cat.UnitCost
		}
	}
	req.ProcurementID = fmt.Sprintf("PROC-%d", time.Now().UnixNano()%100000)
	req.DateRequested = time.Now()
	req.Status = "Pending Finance"
	req.EstTotal = req.Quantity * req.EstUnitCost
	req.CreatedAt = time.Now()
	req.UpdatedAt = time.Now()

	if err := db.DB.Create(&req).Error; err != nil {
		return c.JSON(http.StatusInternalServerError, echo.Map{"error": err.Error()})
	}
	return c.JSON(http.StatusOK, req)
}

// Projects APIs
func GetProjects(c echo.Context) error {
	var projects []models.Project
	db.DB.Order("created_at desc").Find(&projects)
	return c.JSON(http.StatusOK, projects)
}

func CreateProject(c echo.Context) error {
	var project models.Project
	if err := c.Bind(&project); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": err.Error()})
	}
	project.ProjectID = fmt.Sprintf("PRJ-%d", time.Now().UnixNano()%100000)
	project.CreatedAt = time.Now()
	project.UpdatedAt = time.Now()

	if err := db.DB.Create(&project).Error; err != nil {
		return c.JSON(http.StatusInternalServerError, echo.Map{"error": err.Error()})
	}
	return c.JSON(http.StatusOK, project)
}

// Dashboard Summary API
func GetDashboardSummary(c echo.Context) error {
	var totalSerialized int64
	var totalInStock int64
	var totalIssued int64
	var pendingRequisitions int64
	var openTickets int64
	var activeProjects int64

	db.DB.Model(&models.SerializedInventory{}).Count(&totalSerialized)
	db.DB.Model(&models.SerializedInventory{}).Where("status = ?", "In Stock").Count(&totalInStock)
	db.DB.Model(&models.SerializedInventory{}).Where("status = ?", "Issued / Out").Count(&totalIssued)
	db.DB.Model(&models.TechnicianRequisition{}).Where("approval_status LIKE ?", "Pending%").Count(&pendingRequisitions)
	db.DB.Model(&models.CustomerTicket{}).Where("ticket_status IN ?", []string{"Open", "Assigned", "In Progress"}).Count(&openTickets)
	db.DB.Model(&models.Project{}).Where("status = ?", "Active").Count(&activeProjects)

	return c.JSON(http.StatusOK, echo.Map{
		"total_serialized":     totalSerialized,
		"in_stock":             totalInStock,
		"issued":               totalIssued,
		"pending_requisitions": pendingRequisitions,
		"open_tickets":         openTickets,
		"active_projects":      activeProjects,
	})
}
