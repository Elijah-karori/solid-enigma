package main

import (
	"log"
	"github.com/ont/inventory-backend/internal/db"
)

func main() {
	log.Println("Initializing database tables...")
	db.InitDB()
	log.Println("Database tables initialized successfully.")
}
