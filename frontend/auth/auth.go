package auth

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"time"
)

// Role constants for RBAC
const (
	RoleAdmin          = "Admin"
	RoleStoreManager   = "Store Manager"
	RoleFinance        = "Finance"
	RoleProjectManager = "Project Manager"
	RoleSupport        = "Support"
	RoleTechnician     = "Technician"
)

// Permissions map for RBAC
var RolePermissions = map[string][]string{
	RoleAdmin: {
		"view_costs", "view_ledger", "manage_users", "view_stock",
		"manage_catalog", "move_stock", "manage_devices", "approve_req",
		"approve_finance", "create_ticket", "create_task", "request_material",
		"manage_projects", "view_procurement", "request_procurement",
		"approve_procurement", "receive_procurement", "generate_pdf",
		"view_docs", "manage_payments", "view_audit", "view_network",
		"manage_customers", "manage_network", "replace_device",
	},
	RoleStoreManager: {
		"view_stock", "manage_catalog", "move_stock", "manage_devices",
		"approve_req", "create_ticket", "create_task", "request_material",
		"view_procurement", "receive_procurement", "generate_pdf", "view_docs",
		"view_audit", "view_network", "manage_customers", "manage_network",
		"replace_device",
	},
	RoleFinance: {
		"view_costs", "view_ledger", "view_stock", "approve_finance",
		"view_all_reqs", "view_procurement", "approve_procurement",
		"generate_pdf", "view_docs", "manage_payments", "view_audit",
		"view_network",
	},
	RoleProjectManager: {
		"view_stock", "create_task", "request_material", "manage_projects",
		"view_procurement", "request_procurement", "generate_pdf", "view_docs",
		"view_network",
	},
	RoleSupport: {
		"create_ticket", "view_all_tickets", "view_network", "manage_customers",
	},
	RoleTechnician: {
		"request_material", "view_network", "manage_network", "replace_device",
	},
}

// HasPermission checks if a role has a given permission
func HasPermission(role, permission string) bool {
	perms, exists := RolePermissions[role]
	if !exists {
		return false
	}
	for _, p := range perms {
		if p == permission {
			return true
		}
	}
	return false
}

// TokenClaims represents JWT claims with JTI (JWT ID)
type TokenClaims struct {
	JTI   string
	Email string
	Role  string
	Exp   int64
}

// GenerateJTI generates a unique JWT ID
func GenerateJTI() string {
	bytes := make([]byte, 16)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
}

// GenerateOTP generates a 6-digit One-Time Password
func GenerateOTP() string {
	bytes := make([]byte, 3)
	rand.Read(bytes)
	num := int(bytes[0])<<16 | int(bytes[1])<<8 | int(bytes[2])
	return fmt.Sprintf("%06d", num%1000000)
}
