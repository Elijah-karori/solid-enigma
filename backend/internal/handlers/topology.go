package handlers

import (
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
