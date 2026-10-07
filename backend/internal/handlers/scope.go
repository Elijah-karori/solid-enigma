package handlers

import (
	"strings"

	"github.com/labstack/echo/v4"
	"github.com/ont/inventory-backend/internal/rbac"
)

// can reports whether the authenticated caller's role holds perm (role is set by auth.Middleware from the database).
func can(c echo.Context, perm string) bool {
	role, _ := c.Get("role").(string)
	return rbac.Can(role, perm)
}

func actorName(c echo.Context) string  { s, _ := c.Get("name").(string); return s }
func actorEmail(c echo.Context) string { s, _ := c.Get("email").(string); return s }
func actorRole(c echo.Context) string  { s, _ := c.Get("role").(string); return s }

// isMe matches a free-text name/email field (workbook data stores either) against the caller.
func isMe(c echo.Context, v string) bool {
	v = strings.ToLower(strings.TrimSpace(v))
	return v != "" && (v == strings.ToLower(actorName(c)) || v == actorEmail(c))
}
