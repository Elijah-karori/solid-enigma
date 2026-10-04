package db

import (
	"log"
	"os"

	"github.com/ont/inventory-backend/internal/models"
	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

var DB *gorm.DB

func InitDB() *gorm.DB {
	var err error
	dsn := os.Getenv("DATABASE_URL")

	if dsn != "" {
		DB, err = gorm.Open(postgres.Open(dsn), &gorm.Config{})
		if err != nil {
			log.Fatalf("Failed to connect to PostgreSQL: %v", err)
		}
		log.Println("Connected to PostgreSQL database.")
	} else {
		// Fallback to SQLite for portable dev/testing environment
		DB, err = gorm.Open(sqlite.Open("app_inventory.db"), &gorm.Config{})
		if err != nil {
			log.Fatalf("Failed to connect to SQLite: %v", err)
		}
		log.Println("Connected to SQLite database.")
	}

	// Auto-migrate all GORM models
	err = DB.AutoMigrate(
		&models.User{},
		&models.MagicToken{},
		&models.ItemCatalog{},
		&models.SerializedInventory{},
		&models.BulkInventory{},
		&models.InventoryTransaction{},
		&models.Project{},
		&models.Customer{},
		&models.Hotspot{},
		&models.HotspotUser{},
		&models.Voucher{},
		&models.OLT{},
		&models.PONPort{},
		&models.Splitter{},
		&models.Enclosure{},
		&models.AccessPoint{},
		&models.GenieACSDevice{},
		&models.TechnicianRequisition{},
		&models.TechnicianTask{},
		&models.CustomerTicket{},
		&models.ProcurementRequest{},
		&models.DeliveryNote{},
		&models.AuditLedger{},
		&models.GenieACSAuditLog{},
	)
	if err != nil {
		log.Fatalf("AutoMigrate failed: %v", err)
	}

	return DB
}
