package main

import (
	"context"
	"github.com/ont/inventory-backend/internal/worker"
	"log"
	"net/http"

	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"github.com/ont/inventory-backend/internal/audit"
	"github.com/ont/inventory-backend/internal/auth"
	"github.com/ont/inventory-backend/internal/config"
	"github.com/ont/inventory-backend/internal/db"
	"github.com/ont/inventory-backend/internal/email"
	"github.com/ont/inventory-backend/internal/handlers"
	"github.com/ont/inventory-backend/internal/models"
	"github.com/ont/inventory-backend/internal/rbac"
	"golang.org/x/time/rate"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}
	database := db.InitDB()
	mailer := email.New(cfg.SMTPHost, cfg.SMTPPort, cfg.SMTPUsername, cfg.SMTPPassword, cfg.SMTPFrom)
	authSvc := auth.New(database, cfg, mailer)
	authSvc.Bootstrap()
	wrk := worker.New(database, mailer)
	go wrk.Start(context.Background())

	e := echo.New()
	e.HideBanner = true
	e.Use(middleware.Logger(), middleware.Recover(), middleware.Secure())
	e.Use(middleware.BodyLimit("2M"))
	e.Use(middleware.CORSWithConfig(middleware.CORSConfig{
		AllowOrigins:     cfg.AllowedOrigins, // explicit origins: required for the refresh cookie
		AllowCredentials: true,
		AllowMethods:     []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete},
		AllowHeaders:     []string{echo.HeaderOrigin, echo.HeaderContentType, echo.HeaderAccept, echo.HeaderAuthorization},
	}))

	// ---- public auth routes, rate limited per IP (OTP + password endpoints are brute-force targets)
	limit := middleware.RateLimiter(middleware.NewRateLimiterMemoryStoreWithConfig(
		middleware.RateLimiterMemoryStoreConfig{Rate: rate.Limit(0.5), Burst: 10}))
	pub := e.Group("/api/auth", limit)
	pub.POST("/login", authSvc.Login)
	pub.POST("/otp/verify", authSvc.VerifyOTP)
	pub.POST("/forgot-password", authSvc.ForgotPassword)
	pub.POST("/reset-password", authSvc.ResetPassword)
	pub.POST("/refresh", authSvc.Refresh)
	pub.POST("/logout", authSvc.Logout)

	// ---- authenticated routes
	api := e.Group("/api", authSvc.Middleware)
	api.GET("/auth/me", authSvc.Me)
	api.POST("/auth/change-password", authSvc.ChangePassword)

	R := rbac.Require

	// Users & security
	api.GET("/users", authSvc.ListUsers, R("manageUsers"))
	api.POST("/users", authSvc.SaveUser, R("manageUsers"))
	api.POST("/users/:email/revoke-sessions", authSvc.RevokeUserSessions, R("manageUsers"))
	api.GET("/audit", func(c echo.Context) error {
		var rows []models.AuditLedger
		database.Order("seq desc").Limit(500).Find(&rows)
		return c.JSON(200, rows)
	}, R("viewAuditAll"))
	api.GET("/audit/verify", func(c echo.Context) error {
		r, err := audit.Verify(database)
		if err != nil {
			return c.JSON(500, echo.Map{"error": err.Error()})
		}
		return c.JSON(200, r)
	}, R("viewAuditAll"))
	api.GET("/delivery-notes/:id/pdf", handlers.DownloadDeliveryNotePDF, R("viewDocs"))
	api.GET("/settings", handlers.GetSettings, R("manageSettings", "viewStock"))
	api.POST("/settings", handlers.SaveSettings, R("manageSettings"))
	api.GET("/notifications", func(c echo.Context) error {
		var rows []models.NotificationLog
		database.Order("timestamp desc").Limit(500).Find(&rows)
		return c.JSON(200, rows)
	}, R("viewNotifications"))

	// Dashboard
	api.GET("/dashboard", handlers.GetDashboardSummary, R("viewDashboard"))

	// Catalog & inventory
	api.GET("/lookup", handlers.UniversalLookup)
	api.GET("/serialized/:id/history", handlers.GetUnitHistory, R("manageDevices", "moveStock"))
	api.POST("/inventory/movement", handlers.RecordStockMovement, R("moveStock"))
	api.POST("/inventory/batch-stock-in", handlers.BatchStockInSerialized, R("moveStock"))
	api.POST("/device-replacement", handlers.ReplaceDevice, R("replaceDevice"))
	api.GET("/catalog", handlers.GetCatalog, R("viewStock", "requestMaterial", "manageCatalog"))
	api.POST("/catalog", handlers.SaveCatalogItem, R("manageCatalog"))
	api.GET("/inventory/serialized", handlers.GetSerializedInventory, R("manageDevices", "moveStock", "manageNetwork", "manageCustomers"))
	api.POST("/inventory/stock-in", handlers.StockInSerializedItem, R("moveStock"))
	api.PUT("/inventory/serialized/:id", handlers.UpdateSerializedDevice, R("manageDevices"))
	api.GET("/inventory/transactions", handlers.GetTransactions, R("viewLedger"))

	// Requisitions
	api.GET("/requisitions", handlers.GetRequisitions, R("viewAllReqs", "requestMaterial"))
	api.POST("/requisitions", handlers.CreateRequisition, R("requestMaterial"))
	api.POST("/requisitions/:id/decide", handlers.DecideRequisition, R("approveReq", "approveFinance", "manageProjects"))
	api.POST("/requisitions/:id/issue", handlers.IssueRequisition, R("approveReq"))
	api.POST("/requisitions/:id/raise-procurement", handlers.RaiseProcurementFromRequisition, R("requestProcurement"))

	// Customers, hotspots, network
	api.GET("/customers", handlers.GetCustomers, R("viewNetwork"))
	api.POST("/customers", handlers.CreateCustomer, R("manageCustomers"))
	api.PUT("/customers/:id", handlers.UpdateCustomer, R("manageCustomers"))
	api.GET("/hotspots", handlers.GetHotspots, R("viewNetwork"))
	api.POST("/hotspots", handlers.CreateHotspot, R("manageCustomers"))
	api.POST("/hotspot-users", handlers.CreateHotspotUser, R("manageCustomers"))
	api.GET("/vouchers", handlers.GetVouchers, R("viewNetwork"))
	api.POST("/vouchers", handlers.CreateVoucher, R("manageCustomers"))
	api.GET("/topology", handlers.GetNetworkTopology, R("viewNetwork"))
	api.POST("/topology/olts", handlers.CreateOLT, R("manageNetwork"))
	api.POST("/topology/enclosures", handlers.CreateEnclosure, R("manageNetwork"))
	api.POST("/topology/splitters", handlers.CreateSplitter, R("manageNetwork"))
	api.POST("/topology/aps", handlers.CreateAccessPoint, R("manageNetwork"))
	api.POST("/topology/ports/assign", handlers.AssignPort, R("manageNetwork"))
	api.POST("/topology/ports/release", handlers.ReleasePort, R("manageNetwork"))
	api.POST("/devices/install", handlers.InstallDevice, R("manageNetwork"))
	api.POST("/devices/remove", handlers.RemoveDevice, R("manageNetwork"))
	api.GET("/topology/port-map", handlers.GetPortMap, R("viewNetwork"))

	// GenieACS
	api.GET("/genieacs/device/:serial", handlers.GetGenieACSDevice, R("genieacsRead"))
	api.POST("/genieacs/device/:serial/action", handlers.ExecuteGenieACSAction, R("genieacsAct"))

	// Tasks, tickets, procurement, projects
	api.GET("/tasks", handlers.GetTasks)
	api.POST("/tasks", handlers.CreateTask, R("createTask"))
	api.GET("/tickets", handlers.GetTickets, R("viewAllTickets", "viewNetwork"))
	api.POST("/tickets", handlers.CreateTicket, R("createTicket"))
	api.PATCH("/tickets/:id", handlers.UpdateTicket, R("viewAllTickets", "viewNetwork"))
	api.GET("/procurement", handlers.GetProcurement, R("viewProcurement"))
	api.POST("/procurement", handlers.CreateProcurement, R("requestProcurement"))
	api.GET("/projects", handlers.GetProjects)
	api.POST("/projects", handlers.CreateProject, R("manageProjects"))

	log.Printf("Starting ONT Inventory Backend on :%s", cfg.Port)
	e.Logger.Fatal(e.Start(":" + cfg.Port))
}
