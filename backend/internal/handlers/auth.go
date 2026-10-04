package handlers

import (
	"net/http"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/labstack/echo/v4"
	"github.com/ont/inventory-backend/internal/db"
	"github.com/ont/inventory-backend/internal/models"
	"golang.org/x/crypto/bcrypt"
)

var JwtSecret = []byte("super-secret-key-change-in-prod")

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type AuthResponse struct {
	Token string      `json:"token"`
	User  models.User `json:"user"`
}

func Login(c echo.Context) error {
	var req LoginRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": "Invalid request body"})
	}

	var user models.User
	if err := db.DB.Where("email = ?", req.Email).First(&user).Error; err != nil {
		return c.JSON(http.StatusUnauthorized, echo.Map{"error": "Invalid credentials"})
	}

	// Compare password
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		// Fallback check for initial plaintext migration passwords
		if user.PasswordHash != req.Password {
			return c.JSON(http.StatusUnauthorized, echo.Map{"error": "Invalid credentials"})
		}
	}

	// Create JWT token
	claims := jwt.MapClaims{
		"user_id": user.ID.String(),
		"email":   user.Email,
		"role":    user.Role,
		"exp":     time.Now().Add(time.Hour * 24).Unix(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	t, err := token.SignedString(JwtSecret)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, echo.Map{"error": "Failed to sign token"})
	}

	return c.JSON(http.StatusOK, AuthResponse{
		Token: t,
		User:  user,
	})
}

func AuthMiddleware(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		authHeader := c.Request().Header.Get("Authorization")
		if authHeader == "" || len(authHeader) < 8 || authHeader[:7] != "Bearer " {
			return c.JSON(http.StatusUnauthorized, echo.Map{"error": "Missing or invalid authorization header"})
		}

		tokenString := authHeader[7:]
		token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
			return JwtSecret, nil
		})

		if err != nil || !token.Valid {
			return c.JSON(http.StatusUnauthorized, echo.Map{"error": "Unauthorized / Invalid token"})
		}

		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			return c.JSON(http.StatusUnauthorized, echo.Map{"error": "Invalid token claims"})
		}

		c.Set("user_id", claims["user_id"])
		c.Set("email", claims["email"])
		c.Set("role", claims["role"])

		return next(c)
	}
}
