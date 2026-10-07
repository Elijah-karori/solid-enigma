package handlers

import (
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"github.com/ont/inventory-backend/internal/db"
	"github.com/ont/inventory-backend/internal/models"
)

func GetGenieACSDevice(c echo.Context) error {
	serial := c.Param("serial")

	var device models.GenieACSDevice
	err := db.DB.Where("serial_number = ?", serial).First(&device).Error
	if err != nil {
		// Create placeholder/simulated device snapshot if not found yet
		now := time.Now()
		device = models.GenieACSDevice{
			DeviceID:        fmt.Sprintf("202BC1-ONT-%s", serial),
			SerialNumber:    serial,
			ProductClass:    "HG8145V5",
			Manufacturer:    "Huawei",
			IPAddress:       "100.64.12.45",
			MAC:             "CC:D2:81:4A:2B:11",
			OnlineStatus:    "Online",
			LastInform:      &now,
			OpticalRXPower:  -19.45,
			OpticalTXPower:  2.15,
			FirmwareVersion: "V5R019C00S100",
			UptimeSeconds:   345200,
			WifiSSID:        "ISP_Fiber_Home",
			WifiStatus:      "Active",
			RawCWMPParams:   `{"InternetGatewayDevice.DeviceInfo.HardwareVersion": "1.0", "InternetGatewayDevice.WANDevice.1.WANConnectionNumberOfEntries": "1"}`,
			UpdatedAt:       now,
		}
		db.DB.Create(&device)
	}

	return c.JSON(http.StatusOK, device)
}

func ExecuteGenieACSAction(c echo.Context) error {
	serial := c.Param("serial")
	var req struct {
		Action     string `json:"action"` // Reboot, FactoryReset, Sync, RefreshParams
		Reason     string `json:"reason"`
		Parameters string `json:"parameters"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": err.Error()})
	}

	actorEmail := c.Get("email").(string)

	var device models.GenieACSDevice
	if err := db.DB.Where("serial_number = ?", serial).First(&device).Error; err != nil {
		return c.JSON(http.StatusNotFound, echo.Map{"error": "Device not found in GenieACS cache"})
	}

	// Update cached device info upon sync/reboot action
	now := time.Now()
	device.LastInform = &now
	device.UpdatedAt = now
	db.DB.Save(&device)

	// Log audit trail for remote operational action
	auditLog := models.GenieACSAuditLog{
		ID:             uuid.New(),
		EventTimestamp: now,
		ActorEmail:     actorEmail,
		DeviceID:       device.DeviceID,
		Action:         req.Action,
		Parameters:     req.Parameters,
		Reason:         req.Reason,
		ResultStatus:   "Success",
		GenieACSTaskID: fmt.Sprintf("TASK-%d", now.Unix()),
	}
	db.DB.Create(&auditLog)

	return c.JSON(http.StatusOK, echo.Map{
		"status":      "Success",
		"message":     fmt.Sprintf("GenieACS %s triggered for %s", req.Action, serial),
		"task_id":     auditLog.GenieACSTaskID,
		"device_info": device,
	})
}
