package main

import (
	"log"
	"net/http"
	"os"

	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"github.com/ont/inventory-backend/internal/db"
	"github.com/ont/inventory-backend/internal/handlers"
)

func main() {
	// Initialize Database
	db.InitDB()

	e := echo.New()

	// Middlewares
	e.Use(middleware.Logger())
	e.Use(middleware.Recover())
	e.Use(middleware.CORSWithConfig(middleware.CORSConfig{
		AllowOrigins: []string{"*"},
		AllowMethods: []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete},
		AllowHeaders: []string{echo.HeaderOrigin, echo.HeaderContentType, echo.HeaderAccept, echo.HeaderAuthorization},
	}))

	// Public Routes
	e.POST("/api/auth/login", handlers.Login)

	// Protected Routes
	api := e.Group("/api", handlers.AuthMiddleware)

	// Dashboard
	api.GET("/dashboard", handlers.GetDashboardSummary)

	// Catalog & Inventory
	api.GET("/catalog", handlers.GetCatalog)
	api.POST("/catalog", handlers.SaveCatalogItem)
	api.GET("/inventory/serialized", handlers.GetSerializedInventory)
	api.POST("/inventory/stock-in", handlers.StockInSerializedItem)
	api.PUT("/inventory/serialized/:id", handlers.UpdateSerializedDevice)
	api.GET("/inventory/transactions", handlers.GetTransactions)

	// Requisitions
	api.GET("/requisitions", handlers.GetRequisitions)
	api.POST("/requisitions", handlers.CreateRequisition)
	api.POST("/requisitions/:id/decide", handlers.DecideRequisition)
	api.POST("/requisitions/:id/issue", handlers.IssueRequisition)

	// Customers & Hotspots
	api.GET("/customers", handlers.GetCustomers)
	api.POST("/customers", handlers.CreateCustomer)
	api.PUT("/customers/:id", handlers.UpdateCustomer)
	api.GET("/hotspots", handlers.GetHotspots)
	api.POST("/hotspots", handlers.CreateHotspot)
	api.POST("/hotspot-users", handlers.CreateHotspotUser)
	api.GET("/vouchers", handlers.GetVouchers)
	api.POST("/vouchers", handlers.CreateVoucher)

	// Network Topology
	api.GET("/topology", handlers.GetNetworkTopology)
	api.POST("/topology/olts", handlers.CreateOLT)
	api.POST("/topology/enclosures", handlers.CreateEnclosure)
	api.POST("/topology/splitters", handlers.CreateSplitter)
	api.POST("/topology/aps", handlers.CreateAccessPoint)

	// GenieACS TR-069
	api.GET("/genieacs/device/:serial", handlers.GetGenieACSDevice)
	api.POST("/genieacs/device/:serial/action", handlers.ExecuteGenieACSAction)

	// Tasks, Tickets & Procurement
	api.GET("/tasks", handlers.GetTasks)
	api.POST("/tasks", handlers.CreateTask)
	api.GET("/tickets", handlers.GetTickets)
	api.POST("/tickets", handlers.CreateTicket)
	api.PATCH("/tickets/:id", handlers.UpdateTicket)
	api.GET("/procurement", handlers.GetProcurement)
	api.POST("/procurement", handlers.CreateProcurement)
	api.GET("/projects", handlers.GetProjects)
	api.POST("/projects", handlers.CreateProject)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Starting ONT Inventory Backend Server on port %s...", port)
	e.Logger.Fatal(e.Start(":" + port))
}
