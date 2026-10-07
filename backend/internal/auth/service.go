// Package auth: email+password login with an emailed one-time code (2FA), forgot/reset password,
// JWT access tokens (short lived, carry jti + sid), rotating refresh tokens in an httpOnly cookie,
// server-side sessions that can be revoked, and RBAC context for downstream handlers.
package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"html"
	"math/big"
	"net/http"
	"strings"
	"time"
	"unicode"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"github.com/ont/inventory-backend/internal/audit"
	"github.com/ont/inventory-backend/internal/config"
	"github.com/ont/inventory-backend/internal/email"
	"github.com/ont/inventory-backend/internal/models"
	"github.com/ont/inventory-backend/internal/rbac"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

const (
	issuer         = "ont-inventory"
	refreshCookie  = "refresh_token"
	maxOTPAttempts = 5
	maxFailedLogin = 5
	lockDuration   = 15 * time.Minute
	otpResendGap   = 60 * time.Second
	bcryptCost     = 12
)

type Service struct {
	DB   *gorm.DB
	Cfg  *config.Config
	Mail email.Sender
}

func New(db *gorm.DB, cfg *config.Config, mail email.Sender) *Service {
	return &Service{DB: db, Cfg: cfg, Mail: mail}
}

// ---------------------------------------------------------------- tokens

type Claims struct {
	jwt.RegisteredClaims
	Typ  string `json:"typ"` // access | refresh | otp | reset
	SID  string `json:"sid,omitempty"`
	Role string `json:"role,omitempty"`
}

func (s *Service) sign(typ, subject, jti, sid, role string, ttl time.Duration) (string, error) {
	now := time.Now()
	c := Claims{
		RegisteredClaims: jwt.RegisteredClaims{Issuer: issuer, Subject: subject, ID: jti, IssuedAt: jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(now.Add(ttl))},
		Typ: typ, SID: sid, Role: role,
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, c).SignedString(s.Cfg.JWTSecret)
}

func (s *Service) parse(tok, typ string) (*Claims, error) {
	c := &Claims{}
	t, err := jwt.ParseWithClaims(tok, c, func(*jwt.Token) (any, error) { return s.Cfg.JWTSecret, nil },
		jwt.WithValidMethods([]string{"HS256"}), jwt.WithIssuer(issuer), jwt.WithExpirationRequired())
	if err != nil || !t.Valid || c.Typ != typ || c.ID == "" {
		return nil, fmt.Errorf("invalid token")
	}
	return c, nil
}

// ---------------------------------------------------------------- helpers

var dummyHash, _ = bcrypt.GenerateFromPassword([]byte("timing-equaliser"), bcryptCost)

func bad(c echo.Context, code int, msg string) error { return c.JSON(code, echo.Map{"error": msg}) }

func invalidCreds(c echo.Context) error {
	return bad(c, http.StatusUnauthorized, "Invalid email or password. First time here, or forgot it? Use \"Forgot password\" to set one.")
}

func (s *Service) log(c echo.Context, actor, role, entity, id, action string, prev, next any, details string) {
	ip := ""
	if c != nil {
		ip = c.RealIP()
	}
	_ = audit.Append(s.DB, actor, role, entity, id, action, prev, next, details, ip)
}

// ValidatePassword: 10-72 chars (72 is bcrypt's hard limit), at least one letter and one digit.
func ValidatePassword(pw, email string) error {
	if len(pw) < 10 {
		return fmt.Errorf("Password must be at least 10 characters.")
	}
	if len(pw) > 72 {
		return fmt.Errorf("Password must be at most 72 characters.")
	}
	var letter, digit bool
	for _, r := range pw {
		letter = letter || unicode.IsLetter(r)
		digit = digit || unicode.IsDigit(r)
	}
	if !letter || !digit {
		return fmt.Errorf("Password must contain at least one letter and one number.")
	}
	if strings.EqualFold(pw, email) {
		return fmt.Errorf("Password must not be your email address.")
	}
	return nil
}

func (s *Service) userByEmail(e string) (*models.User, error) {
	var u models.User
	if err := s.DB.Where("email = ?", strings.ToLower(strings.TrimSpace(e))).First(&u).Error; err != nil {
		return nil, err
	}
	return &u, nil
}

func active(u *models.User) bool { return strings.EqualFold(u.Status, "active") }

func (s *Service) otpHash(id, code string) string {
	m := hmac.New(sha256.New, s.Cfg.JWTSecret)
	m.Write([]byte(id + ":" + code))
	return hex.EncodeToString(m.Sum(nil))
}

var errThrottled = fmt.Errorf("throttled")

// createOTP issues a 6-digit code, invalidates earlier unused codes for the same purpose and emails it.
func (s *Service) createOTP(u *models.User, purpose string) (*models.OTPCode, error) {
	var last models.OTPCode
	if err := s.DB.Where("email = ? AND purpose = ?", u.Email, purpose).Order("created_at desc").Limit(1).Find(&last).Error; err == nil &&
		last.ID != "" && time.Since(last.CreatedAt) < otpResendGap {
		return nil, errThrottled
	}
	n, err := rand.Int(rand.Reader, big.NewInt(1000000))
	if err != nil {
		return nil, err
	}
	code := fmt.Sprintf("%06d", n.Int64())
	now := time.Now()
	row := &models.OTPCode{ID: uuid.NewString(), Email: u.Email, Purpose: purpose, ExpiresAt: now.Add(s.Cfg.OTPTTL), CreatedAt: now}
	row.CodeHash = s.otpHash(row.ID, code)
	err = s.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&models.OTPCode{}).Where("email = ? AND purpose = ? AND consumed_at IS NULL", u.Email, purpose).Update("consumed_at", now).Error; err != nil {
			return err
		}
		return tx.Create(row).Error
	})
	if err != nil {
		return nil, err
	}
	what := map[string]string{"login": "sign in", "reset": "reset your password"}[purpose]
	body := fmt.Sprintf(`<div style="font-family:Arial,sans-serif;max-width:480px"><p>Hello %s,</p><p>Use this code to %s:</p>
<p style="font-size:30px;letter-spacing:6px;font-weight:bold">%s</p><p style="color:#64748b;font-size:12px">It expires in %d minutes and can be used once. If you did not ask for it, ignore this email - your password has not changed.</p></div>`,
		html.EscapeString(u.Name), what, code, int(s.Cfg.OTPTTL.Minutes()))
	s.sendMail(u.Email, "Your ONT Portal verification code", body, "OTP_"+strings.ToUpper(purpose))
	return row, nil
}

func (s *Service) sendMail(to, subject, body, typ string) {
	err := s.Mail.SendEmail([]string{to}, subject, body, true)
	nl := models.NotificationLog{Timestamp: time.Now(), Type: typ, Recipient: to, Subject: subject, Status: "SENT"}
	if err != nil {
		nl.Status, nl.Error = "FAILED", err.Error()
	}
	s.DB.Create(&nl)
}

// ---------------------------------------------------------------- sessions

func (s *Service) setRefreshCookie(c echo.Context, tok string, exp time.Time) {
	c.SetCookie(&http.Cookie{Name: refreshCookie, Value: tok, Path: "/api/auth", Expires: exp, HttpOnly: true,
		Secure: s.Cfg.CookieSecure, SameSite: http.SameSiteStrictMode})
}

func (s *Service) clearRefreshCookie(c echo.Context) {
	c.SetCookie(&http.Cookie{Name: refreshCookie, Value: "", Path: "/api/auth", MaxAge: -1, HttpOnly: true,
		Secure: s.Cfg.CookieSecure, SameSite: http.SameSiteStrictMode})
}

func (s *Service) userPayload(u *models.User) echo.Map {
	return echo.Map{"id": u.ID.String(), "email": u.Email, "name": u.Name, "role": u.Role, "status": u.Status,
		"site_station": u.SiteStation, "must_reset_password": u.MustResetPassword}
}

func (s *Service) issueSession(c echo.Context, u *models.User) error {
	now := time.Now()
	sess := models.Session{ID: uuid.NewString(), UserID: u.ID.String(), RefreshJTI: uuid.NewString(), UserAgent: c.Request().UserAgent(),
		IPAddress: c.RealIP(), ExpiresAt: now.Add(s.Cfg.RefreshTTL), CreatedAt: now}
	if len(sess.UserAgent) > 250 {
		sess.UserAgent = sess.UserAgent[:250]
	}
	if err := s.DB.Create(&sess).Error; err != nil {
		return bad(c, 500, "Could not start session.")
	}
	access, err1 := s.sign("access", u.ID.String(), uuid.NewString(), sess.ID, u.Role, s.Cfg.AccessTTL)
	refresh, err2 := s.sign("refresh", u.ID.String(), sess.RefreshJTI, sess.ID, "", s.Cfg.RefreshTTL)
	if err1 != nil || err2 != nil {
		return bad(c, 500, "Could not sign token.")
	}
	s.DB.Model(u).Updates(map[string]any{"last_login_at": now, "failed_logins": 0, "locked_until": nil})
	s.setRefreshCookie(c, refresh, sess.ExpiresAt)
	s.log(c, u.Email, u.Role, "Session", sess.ID, "Login", nil, nil, "")
	return c.JSON(200, echo.Map{"access_token": access, "expires_in": int(s.Cfg.AccessTTL.Seconds()), "user": s.userPayload(u), "permissions": rbac.For(u.Role)})
}

func (s *Service) revokeAll(userID, exceptSID string) {
	now := time.Now()
	q := s.DB.Model(&models.Session{}).Where("user_id = ? AND revoked_at IS NULL", userID)
	if exceptSID != "" {
		q = q.Where("id <> ?", exceptSID)
	}
	q.Update("revoked_at", now)
}

// ---------------------------------------------------------------- handlers

// POST /api/auth/login {email,password}
func (s *Service) Login(c echo.Context) error {
	var req struct{ Email, Password string }
	if err := c.Bind(&req); err != nil || req.Email == "" || req.Password == "" {
		return bad(c, 400, "Email and password are required.")
	}
	u, err := s.userByEmail(req.Email)
	if err != nil || !active(u) || u.PasswordHash == "" {
		_ = bcrypt.CompareHashAndPassword(dummyHash, []byte(req.Password)) // equalise timing
		return invalidCreds(c)
	}
	if u.LockedUntil != nil && u.LockedUntil.After(time.Now()) {
		return bad(c, http.StatusTooManyRequests, fmt.Sprintf("Too many failed attempts. Try again in %d minutes.", int(time.Until(*u.LockedUntil).Minutes())+1))
	}
	if bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(req.Password)) != nil {
		u.FailedLogins++
		upd := map[string]any{"failed_logins": u.FailedLogins}
		if u.FailedLogins >= maxFailedLogin {
			lock := time.Now().Add(lockDuration)
			upd["locked_until"], upd["failed_logins"] = lock, 0
			s.log(c, u.Email, u.Role, "User", u.Email, "Account locked", nil, nil, "too many failed logins")
		}
		s.DB.Model(u).Updates(upd)
		return invalidCreds(c)
	}
	if u.MustResetPassword {
		_, _ = s.createOTP(u, "reset")
		return c.JSON(200, echo.Map{"status": "password_reset_required", "message": "You must set a new password. We emailed you a verification code."})
	}
	if !s.Cfg.RequireOTP {
		return s.issueSession(c, u)
	}
	row, err := s.createOTP(u, "login")
	if err == errThrottled {
		return bad(c, 429, "A code was just sent. Wait a minute before requesting another.")
	}
	if err != nil {
		return bad(c, 500, "Could not send verification code.")
	}
	challenge, _ := s.sign("otp", u.ID.String(), row.ID, "", "", s.Cfg.OTPTTL)
	return c.JSON(200, echo.Map{"status": "otp_required", "challenge_token": challenge, "expires_in": int(s.Cfg.OTPTTL.Seconds()),
		"message": "We emailed you a 6-digit code."})
}

// POST /api/auth/otp/verify
// login purpose : {purpose:"login", challenge_token, code}
// reset purpose : {purpose:"reset", email, code}  -> returns a single-use reset_token
func (s *Service) VerifyOTP(c echo.Context) error {
	var req struct {
		Purpose        string `json:"purpose"`
		Email          string `json:"email"`
		Code           string `json:"code"`
		ChallengeToken string `json:"challenge_token"`
	}
	if err := c.Bind(&req); err != nil || len(req.Code) != 6 {
		return bad(c, 400, "Enter the 6-digit code.")
	}
	fail := func() error { return bad(c, 401, "That code is invalid or has expired.") }

	var row models.OTPCode
	var u *models.User
	switch req.Purpose {
	case "login":
		cl, err := s.parse(req.ChallengeToken, "otp")
		if err != nil {
			return fail()
		}
		if s.DB.Where("id = ? AND purpose = ?", cl.ID, "login").First(&row).Error != nil {
			return fail()
		}
		var usr models.User
		if s.DB.Where("id = ?", cl.Subject).First(&usr).Error != nil || usr.Email != row.Email {
			return fail()
		}
		u = &usr
	case "reset":
		usr, err := s.userByEmail(req.Email)
		if err != nil || s.DB.Where("email = ? AND purpose = ? AND consumed_at IS NULL", usr.Email, "reset").Order("created_at desc").Limit(1).Find(&row).Error != nil || row.ID == "" {
			return fail()
		}
		u = usr
	default:
		return bad(c, 400, "Unknown purpose.")
	}
	if !active(u) || row.ConsumedAt != nil || time.Now().After(row.ExpiresAt) || row.Attempts >= maxOTPAttempts {
		return fail()
	}
	s.DB.Model(&row).Update("attempts", row.Attempts+1) // count every try, right or wrong
	if subtle.ConstantTimeCompare([]byte(s.otpHash(row.ID, req.Code)), []byte(row.CodeHash)) != 1 {
		return fail()
	}
	now := time.Now()
	s.DB.Model(&row).Update("consumed_at", now)
	if req.Purpose == "login" {
		return s.issueSession(c, u)
	}
	jti := uuid.NewString()
	s.DB.Model(&row).Update("reset_jti", jti)
	tok, _ := s.sign("reset", u.ID.String(), jti, "", "", 10*time.Minute)
	return c.JSON(200, echo.Map{"reset_token": tok, "expires_in": 600})
}

// POST /api/auth/forgot-password {email} - always answers the same, never reveals whether the account exists.
func (s *Service) ForgotPassword(c echo.Context) error {
	var req struct{ Email string }
	_ = c.Bind(&req)
	e := strings.ToLower(strings.TrimSpace(req.Email))
	go func() {
		if u, err := s.userByEmail(e); err == nil && active(u) {
			_, _ = s.createOTP(u, "reset")
		}
	}()
	return c.JSON(200, echo.Map{"message": "If that email is registered, a verification code has been sent."})
}

// POST /api/auth/reset-password {reset_token,new_password}
func (s *Service) ResetPassword(c echo.Context) error {
	var req struct {
		ResetToken  string `json:"reset_token"`
		NewPassword string `json:"new_password"`
	}
	if err := c.Bind(&req); err != nil {
		return bad(c, 400, "Invalid request.")
	}
	cl, err := s.parse(req.ResetToken, "reset")
	if err != nil {
		return bad(c, 401, "Reset session expired. Start again.")
	}
	var row models.OTPCode
	if s.DB.Where("reset_jti = ? AND reset_used_at IS NULL", cl.ID).First(&row).Error != nil {
		return bad(c, 401, "Reset session expired. Start again.")
	}
	var u models.User
	if s.DB.Where("id = ?", cl.Subject).First(&u).Error != nil || !active(&u) {
		return bad(c, 401, "Reset session expired. Start again.")
	}
	if err := ValidatePassword(req.NewPassword, u.Email); err != nil {
		return bad(c, 400, err.Error())
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcryptCost)
	if err != nil {
		return bad(c, 500, "Could not set password.")
	}
	now := time.Now()
	s.DB.Model(&row).Update("reset_used_at", now)
	s.DB.Model(&u).Updates(map[string]any{"password_hash": string(hash), "must_reset_password": false, "failed_logins": 0, "locked_until": nil})
	s.revokeAll(u.ID.String(), "") // every existing login is signed out
	s.log(c, u.Email, u.Role, "User", u.Email, "Password reset", nil, nil, "via email OTP")
	go s.sendMail(u.Email, "Your ONT Portal password was changed", "<p>Your password was just changed. If this wasn't you, contact an administrator immediately.</p>", "PASSWORD_CHANGED")
	return c.JSON(200, echo.Map{"message": "Password updated. You can sign in now."})
}

// POST /api/auth/refresh - uses the httpOnly cookie; rotates the refresh token and detects reuse.
func (s *Service) Refresh(c echo.Context) error {
	ck, err := c.Cookie(refreshCookie)
	if err != nil {
		return bad(c, 401, "Not signed in.")
	}
	cl, err := s.parse(ck.Value, "refresh")
	if err != nil {
		s.clearRefreshCookie(c)
		return bad(c, 401, "Session expired.")
	}
	var sess models.Session
	if s.DB.Where("id = ?", cl.SID).First(&sess).Error != nil || sess.RevokedAt != nil || time.Now().After(sess.ExpiresAt) {
		s.clearRefreshCookie(c)
		return bad(c, 401, "Session expired.")
	}
	var u models.User
	if s.DB.Where("id = ?", sess.UserID).First(&u).Error != nil || !active(&u) {
		s.clearRefreshCookie(c)
		return bad(c, 401, "Session expired.")
	}
	if sess.RefreshJTI != cl.ID { // an old refresh token was replayed: assume theft, kill the session
		s.DB.Model(&sess).Update("revoked_at", time.Now())
		s.log(c, u.Email, u.Role, "Session", sess.ID, "Refresh token reuse detected", nil, nil, "session revoked")
		s.clearRefreshCookie(c)
		return bad(c, 401, "Session expired.")
	}
	newJTI := uuid.NewString()
	s.DB.Model(&sess).Update("refresh_jti", newJTI)
	refresh, _ := s.sign("refresh", u.ID.String(), newJTI, sess.ID, "", time.Until(sess.ExpiresAt))
	access, _ := s.sign("access", u.ID.String(), uuid.NewString(), sess.ID, u.Role, s.Cfg.AccessTTL)
	s.setRefreshCookie(c, refresh, sess.ExpiresAt)
	return c.JSON(200, echo.Map{"access_token": access, "expires_in": int(s.Cfg.AccessTTL.Seconds()), "user": s.userPayload(&u), "permissions": rbac.For(u.Role)})
}

// POST /api/auth/logout - revokes the server-side session so the tokens die immediately.
func (s *Service) Logout(c echo.Context) error {
	if ck, err := c.Cookie(refreshCookie); err == nil {
		if cl, err := s.parse(ck.Value, "refresh"); err == nil {
			s.DB.Model(&models.Session{}).Where("id = ? AND revoked_at IS NULL", cl.SID).Update("revoked_at", time.Now())
			s.log(c, cl.Subject, "", "Session", cl.SID, "Logout", nil, nil, "")
		}
	}
	s.clearRefreshCookie(c)
	return c.JSON(200, echo.Map{"message": "Signed out."})
}

// Middleware authenticates the bearer access token, checks the session and the user are still
// valid in the database (so deactivation / role change / logout take effect at once) and
// publishes user, role, email and sid on the context.
func (s *Service) Middleware(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		h := c.Request().Header.Get("Authorization")
		if !strings.HasPrefix(h, "Bearer ") {
			return bad(c, 401, "Missing or invalid authorization header.")
		}
		cl, err := s.parse(strings.TrimPrefix(h, "Bearer "), "access")
		if err != nil {
			return bad(c, 401, "Unauthorized / invalid token.")
		}
		var sess models.Session
		if s.DB.Where("id = ? AND revoked_at IS NULL AND expires_at > ?", cl.SID, time.Now()).First(&sess).Error != nil {
			return bad(c, 401, "Session ended. Please sign in again.")
		}
		var u models.User
		if s.DB.Where("id = ?", cl.Subject).First(&u).Error != nil || !active(&u) {
			return bad(c, 401, "Account disabled.")
		}
		c.Set("user", &u)
		c.Set("user_id", u.ID.String())
		c.Set("email", u.Email)
		c.Set("name", u.Name)
		c.Set("role", u.Role) // from the database, not the token
		c.Set("sid", sess.ID)
		return next(c)
	}
}

// GET /api/auth/me
func (s *Service) Me(c echo.Context) error {
	u := c.Get("user").(*models.User)
	return c.JSON(200, echo.Map{"user": s.userPayload(u), "permissions": rbac.For(u.Role)})
}

// POST /api/auth/change-password {current_password,new_password}
func (s *Service) ChangePassword(c echo.Context) error {
	var req struct {
		Current string `json:"current_password"`
		New     string `json:"new_password"`
	}
	if err := c.Bind(&req); err != nil {
		return bad(c, 400, "Invalid request.")
	}
	u := c.Get("user").(*models.User)
	if bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(req.Current)) != nil {
		return bad(c, 400, "Current password is incorrect.")
	}
	if err := ValidatePassword(req.New, u.Email); err != nil {
		return bad(c, 400, err.Error())
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(req.New), bcryptCost)
	if err != nil {
		return bad(c, 500, "Could not set password.")
	}
	s.DB.Model(u).Updates(map[string]any{"password_hash": string(hash), "must_reset_password": false})
	s.revokeAll(u.ID.String(), c.Get("sid").(string)) // other devices are signed out
	s.log(c, u.Email, u.Role, "User", u.Email, "Password changed", nil, nil, "")
	return c.JSON(200, echo.Map{"message": "Password changed. Other devices were signed out."})
}
