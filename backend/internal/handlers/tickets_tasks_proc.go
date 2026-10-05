package handlers

import (
	"fmt"
	"net/http"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/ont/inventory-backend/internal/db"
	"github.com/ont/inventory-backend/internal/models"
)

// Tasks, Tickets, Procurement & Projects APIs

// Tickets & Device Replacement APIs
func GetTickets(c echo.Context) error {
	var tickets []models.CustomerTicket
	db.DB.Order("date_logged desc").Find(&tickets)
	return c.JSON(http.StatusOK, tickets)
}

func CreateTicket(c echo.Context) error {
	var ticket models.CustomerTicket
	if err := c.Bind(&ticket); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": err.Error()})
	}
	ticket.TicketID = fmt.Sprintf("TCK-%d", time.Now().UnixNano()%100000)
	ticket.DateLogged = time.Now()
	ticket.TicketStatus = "Open"
	ticket.CreatedAt = time.Now()
	ticket.UpdatedAt = time.Now()

	if err := db.DB.Create(&ticket).Error; err != nil {
		return c.JSON(http.StatusInternalServerError, echo.Map{"error": err.Error()})
	}
	return c.JSON(http.StatusOK, ticket)
}

func UpdateTicket(c echo.Context) error {
	id := c.Param("id")
	var ticket models.CustomerTicket
	if err := db.DB.Where("ticket_id = ?", id).First(&ticket).Error; err != nil {
		return c.JSON(http.StatusNotFound, echo.Map{"error": "Ticket not found"})
	}

	if err := c.Bind(&ticket); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": err.Error()})
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
		"in_stock":            totalInStock,
		"issued":              totalIssued,
		"pending_requisitions": pendingRequisitions,
		"open_tickets":         openTickets,
		"active_projects":      activeProjects,
	})
}
