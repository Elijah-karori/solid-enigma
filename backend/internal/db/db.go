package db

import (
	"context"
	"fmt"
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
		DB, err = gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
		if err != nil {
			log.Fatalf("Failed to connect to SQLite in-memory: %v", err)
		}
		log.Println("Connected to in-memory SQLite database for testing.")
		_ = DB.AutoMigrate(
			&models.User{}, &models.MagicToken{}, &models.Session{}, &models.OTPCode{},
			&models.ItemCatalog{}, &models.SerializedInventory{}, &models.BulkInventory{}, &models.InventoryTransaction{},
			&models.Project{}, &models.Customer{}, &models.Hotspot{}, &models.HotspotUser{}, &models.Voucher{},
			&models.OLT{}, &models.PONPort{}, &models.Splitter{}, &models.Enclosure{}, &models.AccessPoint{}, &models.GenieACSDevice{},
			&models.TechnicianRequisition{}, &models.TechnicianTask{}, &models.CustomerTicket{}, &models.ProcurementRequest{}, &models.DeliveryNote{},
			&models.AuditLedger{}, &models.GenieACSAuditLog{}, &models.Setting{}, &models.NotificationLog{}, &models.LegacyAuditEntry{},
		)
	}
	return DB
}

func WithActor(ctx context.Context, actorEmail, actorRole string, fn func(tx *gorm.DB) error) error {
	return WithActorOpt(ctx, actorEmail, actorRole, false, fn)
}

func WithActorImport(ctx context.Context, actorEmail, actorRole string, fn func(tx *gorm.DB) error) error {
	return WithActorOpt(ctx, actorEmail, actorRole, true, fn)
}

func WithActorUser(ctx context.Context, user *models.User, fn func(tx *gorm.DB) error) error {
	email, role := "", ""
	if user != nil {
		email = user.Email
		role = user.Role
	}
	return WithActor(ctx, email, role, fn)
}

func WithActorOpt(ctx context.Context, actorEmail, actorRole string, importMode bool, fn func(tx *gorm.DB) error) error {
	if DB == nil {
		return fmt.Errorf("database not initialized")
	}
	return DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if actorEmail != "" {
			var err error
			if importMode {
				err = tx.Exec("SELECT set_config('app.actor_email', ?, true), set_config('app.actor_role', ?, true), set_config('app.import_mode', 'on', true)", actorEmail, actorRole).Error
			} else {
				err = tx.Exec("SELECT set_config('app.actor_email', ?, true), set_config('app.actor_role', ?, true)", actorEmail, actorRole).Error
			}
			if err != nil {
				// SQLite in tests might not support set_config
			}
		}
		return fn(tx)
	})
}
