// Package config loads settings from environment variables. Secrets are NEVER hard-coded:
// the server refuses to start without a strong JWT_SECRET.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Port           string
	AppURL         string // public URL of the frontend, used in email links
	AllowedOrigins []string
	CookieSecure   bool

	JWTSecret  []byte
	AccessTTL  time.Duration
	RefreshTTL time.Duration
	OTPTTL     time.Duration
	RequireOTP bool // second factor (emailed code) on every password login

	SMTPHost, SMTPUsername, SMTPPassword, SMTPFrom string
	SMTPPort                                       int

	BootstrapAdminEmail string
	BootstrapAdminName  string
}

func env(k, def string) string {
	if v := strings.TrimSpace(os.Getenv(k)); v != "" {
		return v
	}
	return def
}

func envDur(k string, def time.Duration) time.Duration {
	if v := strings.TrimSpace(os.Getenv(k)); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return def
}

func Load() (*Config, error) {
	secret := os.Getenv("JWT_SECRET")
	if len(secret) < 32 {
		return nil, fmt.Errorf("JWT_SECRET must be set to a random string of at least 32 characters (e.g. `openssl rand -base64 48`)")
	}
	port, _ := strconv.Atoi(env("SMTP_PORT", "587"))
	c := &Config{
		Port:           env("PORT", "8080"),
		AppURL:         strings.TrimRight(env("APP_URL", "http://localhost:3000"), "/"),
		AllowedOrigins: strings.Split(env("ALLOWED_ORIGINS", "http://localhost:3000"), ","),
		CookieSecure:   env("COOKIE_SECURE", "false") == "true",
		JWTSecret:      []byte(secret),
		AccessTTL:      envDur("ACCESS_TTL", 15*time.Minute),
		RefreshTTL:     envDur("REFRESH_TTL", 7*24*time.Hour),
		OTPTTL:         envDur("OTP_TTL", 10*time.Minute),
		RequireOTP:     env("AUTH_REQUIRE_OTP", "true") != "false",
		SMTPHost:       os.Getenv("SMTP_HOST"),
		SMTPPort:       port,
		SMTPUsername:   os.Getenv("SMTP_USERNAME"),
		SMTPPassword:   os.Getenv("SMTP_PASSWORD"),
		SMTPFrom:       os.Getenv("SMTP_FROM"),

		BootstrapAdminEmail: strings.ToLower(os.Getenv("BOOTSTRAP_ADMIN_EMAIL")),
		BootstrapAdminName:  env("BOOTSTRAP_ADMIN_NAME", "System Admin"),
	}
	return c, nil
}
