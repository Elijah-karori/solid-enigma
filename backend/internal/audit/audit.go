// Package audit implements the append-only, SHA-256 hash-chained audit trail (port of the
// Apps Script "Audit Trail Log"). Each row hashes its own fields plus the previous row's hash,
// so an edited, inserted or deleted row breaks Verify().
package audit

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/ont/inventory-backend/internal/models"
	"gorm.io/gorm"
)

const fs = "\u241f"

var mu sync.Mutex // serialises appends inside this process; the unique index on seq guards other writers

func str(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	default:
		b, _ := json.Marshal(x)
		return string(b)
	}
}

func hashOf(prev string, e *models.AuditLedger) string {
	raw := strings.Join([]string{prev, fmt.Sprint(e.Seq), e.EventTimestamp.UTC().Format(time.RFC3339Nano), e.ActorEmail, e.ActorRole,
		e.EntityType, e.EntityID, e.Action, e.PreviousState, e.NewState, e.Details, e.IPAddress}, fs)
	h := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(h[:])
}

// Append writes one chained entry. Pass the same *gorm.DB transaction as the business change so
// both commit or roll back together. prev/next may be nil, strings or any JSON-serialisable value.
func Append(db *gorm.DB, actorEmail, actorRole, entityType, entityID, action string, prev, next any, details, ip string) error {
	mu.Lock()
	defer mu.Unlock()
	var last models.AuditLedger
	err := db.Order("seq desc").Limit(1).Find(&last).Error
	if err != nil {
		return err
	}
	e := &models.AuditLedger{
		ID: uuid.New(), Seq: last.Seq + 1, EventTimestamp: time.Now().UTC(), ActorEmail: actorEmail, ActorRole: actorRole,
		EntityType: entityType, EntityID: entityID, Action: action, PreviousState: str(prev), NewState: str(next), Details: details, IPAddress: ip,
		PrevHash: last.Hash,
	}
	e.Hash = hashOf(e.PrevHash, e)
	return db.Create(e).Error
}

type Result struct {
	Intact   bool   `json:"intact"`
	Count    int    `json:"count"`
	BrokenAt int64  `json:"broken_at,omitempty"`
	Reason   string `json:"reason,omitempty"`
}

// Verify walks the whole chain and reports the first inconsistency.
func Verify(db *gorm.DB) (Result, error) {
	var rows []models.AuditLedger
	if err := db.Order("seq asc").Find(&rows).Error; err != nil {
		return Result{}, err
	}
	prev := ""
	for i := range rows {
		r := &rows[i]
		if r.Seq != int64(i+1) {
			return Result{Intact: false, Count: i, BrokenAt: int64(i + 1), Reason: "a row is missing or out of sequence"}, nil
		}
		if r.PrevHash != prev || hashOf(prev, r) != r.Hash {
			return Result{Intact: false, Count: i, BrokenAt: r.Seq, Reason: "row content or link does not match its hash"}, nil
		}
		prev = r.Hash
	}
	return Result{Intact: true, Count: len(rows)}, nil
}
