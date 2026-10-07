// Package rbac is the single source of truth for who may do what. It is a direct port of the
// Apps Script CAN_ matrix. The backend enforces it on every route (Require) and the frontend
// receives the same flags from /api/auth/me to decide which views and buttons to show.
package rbac

import (
	"net/http"

	"github.com/labstack/echo/v4"
)

const (
	Admin          = "Admin"
	StoreManager   = "Store Manager"
	Finance        = "Finance"
	ProjectManager = "Project Manager"
	Support        = "Support"
	Technician     = "Technician"
)

var Roles = []string{Admin, StoreManager, Finance, ProjectManager, Support, Technician}

var matrix = map[string][]string{
	"viewCosts":          {Admin, Finance},
	"viewLedger":         {Admin, Finance},
	"manageUsers":        {Admin},
	"viewStock":          {Admin, StoreManager, Finance, ProjectManager},
	"manageCatalog":      {Admin, StoreManager},
	"moveStock":          {Admin, StoreManager},
	"manageDevices":      {Admin, StoreManager},
	"approveReq":         {Admin, StoreManager},
	"approveFinance":     {Admin, Finance},
	"viewAllReqs":        {Admin, StoreManager, Finance},
	"createTicket":       {Admin, StoreManager, Support},
	"viewAllTickets":     {Admin, StoreManager, Support},
	"createTask":         {Admin, StoreManager, Support, ProjectManager},
	"viewAllTasks":       {Admin, StoreManager, Support, ProjectManager, Finance},
	"requestMaterial":    {Admin, StoreManager, Technician, ProjectManager},
	"manageProjects":     {Admin, ProjectManager},
	"viewProcurement":    {Admin, StoreManager, Finance, ProjectManager},
	"requestProcurement": {Admin, StoreManager, ProjectManager},
	"approveProcurement": {Admin, Finance},
	"receiveProcurement": {Admin, StoreManager},
	"generatePDF":        {Admin, StoreManager, Finance, ProjectManager},
	"viewDocs":           {Admin, StoreManager, Finance, ProjectManager},
	"managePayments":     {Admin, Finance},
	"viewAudit":          {Admin, Finance, StoreManager},
	"viewAuditAll":       {Admin, Finance},
	"viewNetwork":        {Admin, StoreManager, Support, Technician, ProjectManager},
	"manageCustomers":    {Admin, StoreManager, Support},
	"manageNetwork":      {Admin, StoreManager, Technician},
	"replaceDevice":      {Admin, StoreManager, Technician},
	"viewDashboard":      {Admin, StoreManager, Finance, ProjectManager, Support, Technician},
	"viewNotifications":  {Admin, Finance},
	"manageSettings":     {Admin},
	"genieacsRead":       {Admin, StoreManager, Support, Technician},
	"genieacsAct":        {Admin, Support, Technician},
}

// Can reports whether role holds the permission. Unknown roles/permissions are denied.
func Can(role, perm string) bool {
	for _, r := range matrix[perm] {
		if r == role {
			return true
		}
	}
	return false
}

// For returns every permission flag for a role (sent to the frontend).
func For(role string) map[string]bool {
	out := make(map[string]bool, len(matrix))
	for p := range matrix {
		out[p] = Can(role, p)
	}
	return out
}

func ValidRole(r string) bool {
	for _, x := range Roles {
		if x == r {
			return true
		}
	}
	return false
}

// Require rejects the request unless the authenticated user's role holds ANY of the permissions.
// It must run after auth.Middleware, which sets "role".
func Require(perms ...string) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			role, _ := c.Get("role").(string)
			for _, p := range perms {
				if Can(role, p) {
					return next(c)
				}
			}
			return c.JSON(http.StatusForbidden, echo.Map{"error": "You do not have permission for this action."})
		}
	}
}
