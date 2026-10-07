package auth

import (
	"fmt"
	"html"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"github.com/ont/inventory-backend/internal/models"
	"github.com/ont/inventory-backend/internal/rbac"
)

// GET /api/users (manageUsers) - password hashes are never serialised (json:"-").
func (s *Service) ListUsers(c echo.Context) error {
	var users []models.User
	s.DB.Order("name asc").Find(&users)
	return c.JSON(200, users)
}

// POST /api/users  {email,name,role,status,site_station,contact_info}
// Creates or updates a user. No password is ever set by an admin: new users get an invitation
// email and choose their own password through "Forgot password" (email OTP).
func (s *Service) SaveUser(c echo.Context) error {
	var req struct {
		Email       string `json:"email"`
		Name        string `json:"name"`
		Role        string `json:"role"`
		Status      string `json:"status"`
		SiteStation string `json:"site_station"`
		ContactInfo string `json:"contact_info"`
	}
	if err := c.Bind(&req); err != nil {
		return bad(c, 400, "Invalid request.")
	}
	email := strings.ToLower(strings.TrimSpace(req.Email))
	if !strings.Contains(email, "@") || strings.ContainsAny(email, " \r\n") {
		return bad(c, 400, "Enter a valid email address.")
	}
	if !rbac.ValidRole(req.Role) {
		return bad(c, 400, "Pick a valid role.")
	}
	status := "active"
	if strings.EqualFold(req.Status, "inactive") {
		status = "inactive"
	}
	actor := c.Get("user").(*models.User)

	var u models.User
	err := s.DB.Where("email = ?", email).First(&u).Error
	if err == nil {
		if u.ID == actor.ID && (status != "active" || req.Role != rbac.Admin) {
			return bad(c, http.StatusBadRequest, "You cannot deactivate or demote your own account.")
		}
		prev := map[string]string{"role": u.Role, "status": u.Status}
		u.Name, u.Role, u.Status, u.SiteStation, u.ContactInfo = firstNonEmpty(req.Name, u.Name), req.Role, status, req.SiteStation, req.ContactInfo
		s.DB.Save(&u)
		if prev["role"] != u.Role || prev["status"] != u.Status {
			s.revokeAll(u.ID.String(), "") // role/status change forces a fresh login
		}
		s.log(c, actor.Email, actor.Role, "User", email, "Updated", prev, map[string]string{"role": u.Role, "status": u.Status}, "")
		return c.JSON(200, echo.Map{"message": "User updated.", "user": u})
	}
	if strings.TrimSpace(req.Name) == "" {
		return bad(c, 400, "Name is required.")
	}
	u = models.User{ID: uuid.New(), Email: email, Name: strings.TrimSpace(req.Name), Role: req.Role, Status: status,
		SiteStation: req.SiteStation, ContactInfo: req.ContactInfo, MustResetPassword: true}
	if err := s.DB.Create(&u).Error; err != nil {
		return bad(c, 500, "Could not create user.")
	}
	s.log(c, actor.Email, actor.Role, "User", email, "Created", nil, map[string]string{"role": u.Role}, "")
	body := fmt.Sprintf(`<p>Hello %s,</p><p>An ONT Portal account was created for you (role: <b>%s</b>).</p><p>Open <a href="%s">%s</a>, choose <b>Forgot password</b>, enter this email address and follow the steps to set your password.</p>`,
		html.EscapeString(u.Name), html.EscapeString(u.Role), html.EscapeString(s.Cfg.AppURL), html.EscapeString(s.Cfg.AppURL))
	go s.sendMail(u.Email, "Your ONT Portal account", body, "USER_INVITE")
	return c.JSON(201, echo.Map{"message": "User created and invited by email.", "user": u})
}

// POST /api/users/:email/revoke-sessions - sign a user out everywhere (lost phone, leaver...).
func (s *Service) RevokeUserSessions(c echo.Context) error {
	u, err := s.userByEmail(c.Param("email"))
	if err != nil {
		return bad(c, 404, "User not found.")
	}
	s.revokeAll(u.ID.String(), "")
	actor := c.Get("user").(*models.User)
	s.log(c, actor.Email, actor.Role, "User", u.Email, "Sessions revoked", nil, nil, time.Now().Format(time.RFC3339))
	return c.JSON(200, echo.Map{"message": "All sessions for " + u.Email + " were ended."})
}

func firstNonEmpty(a, b string) string {
	if strings.TrimSpace(a) != "" {
		return strings.TrimSpace(a)
	}
	return b
}

// Bootstrap creates the first admin ONLY when the users table is empty and BOOTSTRAP_ADMIN_EMAIL is set.
// The account has no password: the owner sets it through "Forgot password" (email OTP). There is no default credential.
func (s *Service) Bootstrap() {
	var n int64
	s.DB.Model(&models.User{}).Count(&n)
	if n > 0 || s.Cfg.BootstrapAdminEmail == "" {
		return
	}
	u := models.User{ID: uuid.New(), Email: s.Cfg.BootstrapAdminEmail, Name: s.Cfg.BootstrapAdminName, Role: rbac.Admin, Status: "active", MustResetPassword: true}
	if s.DB.Create(&u).Error == nil {
		_ = s.Mail
		fmt.Printf("Bootstrap admin %s created. Open the app, choose \"Forgot password\" and set a password.\n", u.Email)
	}
}
