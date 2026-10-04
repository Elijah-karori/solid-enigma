package handlers_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"github.com/ont/inventory-backend/internal/db"
	"github.com/ont/inventory-backend/internal/handlers"
	"github.com/ont/inventory-backend/internal/models"
)

func TestAuthLogin(t *testing.T) {
	database := db.InitDB()

	// Ensure test user exists
	var count int64
	database.Model(&models.User{}).Where("email = ?", "admin@ont.co.ke").Count(&count)
	if count == 0 {
		database.Create(&models.User{
			ID:           uuid.New(),
			Email:        "admin@ont.co.ke",
			PasswordHash: "admin123",
			Name:         "System Admin",
			Role:         "Admin",
			Status:       "active",
		})
	}

	e := echo.New()
	reqJSON := `{"email":"admin@ont.co.ke","password":"admin123"}`
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(reqJSON))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := handlers.Login(c); err != nil {
		t.Fatalf("Login handler failed: %v", err)
	}

	if rec.Code != http.StatusOK {
		t.Errorf("Expected status code 200, got %d", rec.Code)
	}

	if !strings.Contains(rec.Body.String(), "token") {
		t.Errorf("Expected response body to contain token, got %s", rec.Body.String())
	}
}

func TestDashboardSummary(t *testing.T) {
	db.InitDB()

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/dashboard", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := handlers.GetDashboardSummary(c); err != nil {
		t.Fatalf("GetDashboardSummary handler failed: %v", err)
	}

	if rec.Code != http.StatusOK {
		t.Errorf("Expected status code 200, got %d", rec.Code)
	}
}
