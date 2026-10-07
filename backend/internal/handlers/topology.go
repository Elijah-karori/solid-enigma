package handlers

import (
	"github.com/google/uuid"
	"gorm.io/gorm"
	"net/http"

	"github.com/labstack/echo/v4"
	"github.com/ont/inventory-backend/internal/db"
	"github.com/ont/inventory-backend/internal/models"
)

type TopologyTreeResponse struct {
	OLTs       []models.OLT         `json:"olts"`
	PONPorts   []models.PONPort     `json:"pon_ports"`
	Splitters  []models.Splitter    `json:"splitters"`
	Enclosures []models.Enclosure   `json:"enclosures"`
	APs        []models.AccessPoint `json:"aps"`
	Customers  []models.Customer    `json:"customers"`
}

func GetNetworkTopology(c echo.Context) error {
	var olts []models.OLT
	var ponPorts []models.PONPort
	var splitters []models.Splitter
	var enclosures []models.Enclosure
	var aps []models.AccessPoint
	var customers []models.Customer

	db.DB.Find(&olts)
	db.DB.Find(&ponPorts)
	db.DB.Find(&splitters)
	db.DB.Find(&enclosures)
	db.DB.Find(&aps)
	db.DB.Find(&customers)

	return c.JSON(http.StatusOK, TopologyTreeResponse{
		OLTs:       olts,
		PONPorts:   ponPorts,
		Splitters:  splitters,
		Enclosures: enclosures,
		APs:        aps,
		Customers:  customers,
	})
}

func CreateOLT(c echo.Context) error {
	var item models.OLT
	if err := c.Bind(&item); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": err.Error()})
	}
	if err := db.DB.Save(&item).Error; err != nil {
		return c.JSON(http.StatusInternalServerError, echo.Map{"error": err.Error()})
	}
	return c.JSON(http.StatusOK, item)
}

func CreateEnclosure(c echo.Context) error {
	var item models.Enclosure
	if err := c.Bind(&item); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": err.Error()})
	}
	if err := db.DB.Save(&item).Error; err != nil {
		return c.JSON(http.StatusInternalServerError, echo.Map{"error": err.Error()})
	}
	return c.JSON(http.StatusOK, item)
}

func CreateSplitter(c echo.Context) error {
	var item models.Splitter
	if err := c.Bind(&item); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": err.Error()})
	}
	if err := db.DB.Save(&item).Error; err != nil {
		return c.JSON(http.StatusInternalServerError, echo.Map{"error": err.Error()})
	}
	return c.JSON(http.StatusOK, item)
}

func CreateAccessPoint(c echo.Context) error {
	var item models.AccessPoint
	if err := c.Bind(&item); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": err.Error()})
	}
	if err := db.DB.Save(&item).Error; err != nil {
		return c.JSON(http.StatusInternalServerError, echo.Map{"error": err.Error()})
	}
	return c.JSON(http.StatusOK, item)
}

func AssignPort(c echo.Context) error {
	var body struct {
		SplitterID string `json:"splitter_id"`
		PortNo     int    `json:"port_no"`
		Kind       string `json:"kind"` // customer, hotspot, splitter
		EntityID   string `json:"id"`
	}
	if err := c.Bind(&body); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": err.Error()})
	}

	email := actorEmail(c)
	role := actorRole(c)

	err := db.WithActor(c.Request().Context(), email, role, func(tx *gorm.DB) error {
		return tx.Exec("SELECT assign_port(?, ?, ?, ?)", body.SplitterID, body.PortNo, body.Kind, body.EntityID).Error
	})

	if err != nil {
		return c.JSON(http.StatusUnprocessableEntity, echo.Map{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, echo.Map{"message": "Port assigned successfully"})
}

func ReleasePort(c echo.Context) error {
	var body struct {
		Kind     string `json:"kind"` // customer, hotspot, splitter
		EntityID string `json:"id"`
	}
	if err := c.Bind(&body); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": err.Error()})
	}

	email := actorEmail(c)
	role := actorRole(c)

	err := db.WithActor(c.Request().Context(), email, role, func(tx *gorm.DB) error {
		return tx.Exec("SELECT release_port(?, ?)", body.Kind, body.EntityID).Error
	})

	if err != nil {
		return c.JSON(http.StatusUnprocessableEntity, echo.Map{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, echo.Map{"message": "Port released successfully"})
}

func InstallDevice(c echo.Context) error {
	var body struct {
		AssetID    string `json:"asset_id"`
		Role       string `json:"role"` // ONU, AP
		CustomerID string `json:"customer_id"`
		HotspotID  string `json:"hotspot_id"`
		TicketID   string `json:"ticket_id"`
		Notes      string `json:"notes"`
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

	var installID int64
	err := db.WithActor(c.Request().Context(), email, role, func(tx *gorm.DB) error {
		return tx.Raw("SELECT install_device(?, ?, ?, ?, ?, ?, ?)",
			body.AssetID, body.Role, nilIfBlank(body.CustomerID), nilIfBlank(body.HotspotID),
			nilIfBlank(body.TicketID), nilIfBlank(body.Notes), userUUID,
		).Scan(&installID).Error
	})

	if err != nil {
		return c.JSON(http.StatusUnprocessableEntity, echo.Map{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, echo.Map{"message": "Device installed successfully", "install_id": installID})
}

func RemoveDevice(c echo.Context) error {
	var body struct {
		AssetID string `json:"asset_id"`
		Reason  string `json:"reason"`
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

	err := db.WithActor(c.Request().Context(), email, role, func(tx *gorm.DB) error {
		return tx.Exec("SELECT remove_device(?, ?, ?)", body.AssetID, body.Reason, userUUID).Error
	})

	if err != nil {
		return c.JSON(http.StatusUnprocessableEntity, echo.Map{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, echo.Map{"message": "Device removed successfully"})
}

func GetPortMap(c echo.Context) error {
	var portMap []map[string]any
	db.DB.Raw("SELECT * FROM v_port_map").Scan(&portMap)
	return c.JSON(http.StatusOK, portMap)
}
