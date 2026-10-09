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

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func InitDB() *gorm.DB {
	var err error
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" && os.Getenv("DATABASE_HOST") != "" {
		dsn = fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
			env("DATABASE_HOST", "localhost"),
			env("DATABASE_PORT", "5432"),
			env("DATABASE_USER", "postgres"),
			env("DATABASE_PASSWORD", ""),
			env("DATABASE_NAME", "invertory"),
			env("DATABASE_SSL_MODE", "disable"),
		)
	}

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
	}

	_ = DB.AutoMigrate(
		&models.User{}, &models.MagicToken{}, &models.Session{}, &models.OTPCode{},
		&models.ItemCatalog{}, &models.SerializedInventory{}, &models.BulkInventory{}, &models.InventoryTransaction{},
		&models.Project{}, &models.Customer{}, &models.Hotspot{}, &models.HotspotUser{}, &models.Voucher{},
		&models.OLT{}, &models.PONPort{}, &models.Splitter{}, &models.Enclosure{}, &models.AccessPoint{}, &models.GenieACSDevice{},
		&models.TechnicianRequisition{}, &models.TechnicianTask{}, &models.CustomerTicket{}, &models.ProcurementRequest{}, &models.DeliveryNote{},
		&models.AuditLedger{}, &models.GenieACSAuditLog{}, &models.Setting{}, &models.NotificationLog{}, &models.LegacyAuditEntry{},
		&models.NotificationOutbox{},
	)

	if dsn != "" {
		_ = DB.Exec(`
			CREATE OR REPLACE FUNCTION claim_notifications(p_limit int DEFAULT 20) RETURNS SETOF notification_outbox LANGUAGE sql AS $$
			  UPDATE notification_outbox o
				 SET status = 'SENDING', attempts = o.attempts + 1, next_attempt_at = now() + interval '5 minutes'
			   WHERE o.id IN (SELECT id FROM notification_outbox
								WHERE status IN ('PENDING', 'SENDING') AND next_attempt_at <= now()
								ORDER BY id LIMIT p_limit FOR UPDATE SKIP LOCKED)
			  RETURNING o.*;
			$$;
		`).Error

		_ = DB.Exec(`
			CREATE OR REPLACE FUNCTION mark_notification(p_id bigint, p_ok boolean, p_error text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $$
			DECLARE o notification_outbox%ROWTYPE;
			BEGIN
			  SELECT * INTO o FROM notification_outbox WHERE id = p_id FOR UPDATE;
			  IF p_ok THEN
				UPDATE notification_outbox SET status = 'SENT', sent_at = now() WHERE id = p_id;
				INSERT INTO notification_logs (notification_id, recipient, subject, status, error)
				VALUES (p_id, o.recipient, o.subject, 'SENT', '');
			  ELSE
				UPDATE notification_outbox
				   SET status = CASE WHEN o.attempts >= 5 THEN 'FAILED' ELSE 'PENDING' END,
					   last_error = p_error,
					   next_attempt_at = CASE WHEN o.attempts >= 5 THEN now() else now() + (o.attempts * interval '2 minutes') end
				 WHERE id = p_id;
				INSERT INTO notification_logs (notification_id, recipient, subject, status, error)
				VALUES (p_id, o.recipient, o.subject, 'FAILED', p_error);
			  END IF;
			END;
			$$;
		`).Error
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
