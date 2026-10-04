package handlers

import (
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"github.com/ont/inventory-backend/internal/db"
	"github.com/ont/inventory-backend/internal/models"
)

func GetCustomers(c echo.Context) error {
	var customers []models.Customer
	db.DB.Order("created_at desc").Find(&customers)
	return c.JSON(http.StatusOK, customers)
}

func CreateCustomer(c echo.Context) error {
	var customer models.Customer
	if err := c.Bind(&customer); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": err.Error()})
	}

	customer.ID = uuid.New()
	customer.CreatedAt = time.Now()
	customer.UpdatedAt = time.Now()

	if err := db.DB.Create(&customer).Error; err != nil {
		return c.JSON(http.StatusInternalServerError, echo.Map{"error": err.Error()})
	}
	return c.JSON(http.StatusOK, customer)
}

func UpdateCustomer(c echo.Context) error {
	id := c.Param("id")
	var customer models.Customer
	if err := db.DB.Where("id = ?", id).First(&customer).Error; err != nil {
		return c.JSON(http.StatusNotFound, echo.Map{"error": "Customer not found"})
	}

	if err := c.Bind(&customer); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": err.Error()})
	}
	customer.UpdatedAt = time.Now()

	if err := db.DB.Save(&customer).Error; err != nil {
		return c.JSON(http.StatusInternalServerError, echo.Map{"error": err.Error()})
	}
	return c.JSON(http.StatusOK, customer)
}

// Hotspots & Hotspot Users APIs
func GetHotspots(c echo.Context) error {
	var hotspots []models.Hotspot
	db.DB.Preload("Users").Find(&hotspots)
	return c.JSON(http.StatusOK, hotspots)
}

func CreateHotspot(c echo.Context) error {
	var hs models.Hotspot
	if err := c.Bind(&hs); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": err.Error()})
	}

	hs.ID = uuid.New()
	hs.CreatedAt = time.Now()
	if err := db.DB.Create(&hs).Error; err != nil {
		return c.JSON(http.StatusInternalServerError, echo.Map{"error": err.Error()})
	}
	return c.JSON(http.StatusOK, hs)
}

func CreateHotspotUser(c echo.Context) error {
	var user models.HotspotUser
	if err := c.Bind(&user); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": err.Error()})
	}

	user.ID = uuid.New()
	user.CreatedAt = time.Now()
	if err := db.DB.Create(&user).Error; err != nil {
		return c.JSON(http.StatusInternalServerError, echo.Map{"error": err.Error()})
	}
	return c.JSON(http.StatusOK, user)
}

// Vouchers API
func GetVouchers(c echo.Context) error {
	var vouchers []models.Voucher
	db.DB.Order("created_at desc").Find(&vouchers)
	return c.JSON(http.StatusOK, vouchers)
}

func CreateVoucher(c echo.Context) error {
	var voucher models.Voucher
	if err := c.Bind(&voucher); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": err.Error()})
	}

	voucher.ID = uuid.New()
	voucher.Status = "Unused"
	voucher.CreatedAt = time.Now()
	if err := db.DB.Create(&voucher).Error; err != nil {
		return c.JSON(http.StatusInternalServerError, echo.Map{"error": err.Error()})
	}
	return c.JSON(http.StatusOK, voucher)
}
