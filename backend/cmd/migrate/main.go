package main

import (
	"github.com/ont/inventory-backend/internal/db"
	"log"
)

func main() {
	log.Println("Initializing database tables...")
	db.InitDB()
	log.Println("Database tables initialized successfully.")
}
