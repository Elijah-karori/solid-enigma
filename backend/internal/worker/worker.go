package worker

import (
	"context"
	"log"
	"time"

	"github.com/ont/inventory-backend/internal/email"
	"github.com/ont/inventory-backend/internal/models"
	"gorm.io/gorm"
)

type Worker struct {
	DB     *gorm.DB
	Mailer email.Sender
}

func New(db *gorm.DB, mailer email.Sender) *Worker {
	return &Worker{DB: db, Mailer: mailer}
}

func (w *Worker) Start(ctx context.Context) {
	log.Println("Starting notification worker loop...")
	ticker := time.NewTicker(5 * time.Second)
	hourlyTicker := time.NewTicker(1 * time.Hour)
	digestTicker := time.NewTicker(1 * time.Minute)

	defer ticker.Stop()
	defer hourlyTicker.Stop()
	defer digestTicker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Println("Notification worker stopping gracefully.")
			return
		case <-ticker.C:
			w.processOutbox()
		case <-hourlyTicker.C:
			w.runLowStockScan()
		case <-digestTicker.C:
			w.checkDailyDigest()
		}
	}
}

func (w *Worker) processOutbox() {
	var outbox []models.NotificationOutbox
	if err := w.DB.Raw("SELECT * FROM claim_notifications(20)").Scan(&outbox).Error; err != nil {
		return
	}

	for _, item := range outbox {
		err := w.Mailer.SendEmail([]string{item.Recipient}, item.Subject, item.BodyHTML, true)
		ok := (err == nil)
		errStr := ""
		if err != nil {
			errStr = err.Error()
		}
		w.DB.Exec("SELECT mark_notification(?, ?, ?)", item.ID, ok, errStr)
	}
}

func (w *Worker) runLowStockScan() {
	var count int
	if err := w.DB.Raw("SELECT run_low_stock_scan()").Scan(&count).Error; err == nil && count > 0 {
		log.Printf("Low stock scan enqueued %d alerts", count)
	}
}

func (w *Worker) checkDailyDigest() {
	now := time.Now().In(time.FixedZone("EAT", 3*3600))
	if now.Hour() == 8 && now.Minute() == 0 {
		var count int
		if err := w.DB.Raw("SELECT enqueue_daily_digest()").Scan(&count).Error; err == nil && count > 0 {
			log.Printf("Enqueued daily digest for %d recipients", count)
		}
	}
}
