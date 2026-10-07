.PHONY: up down migrate test seed-dev import

DATABASE_URL ?= postgres://postgres:postgrespassword@localhost:5432/ont_inventory?sslmode=disable

up:
	docker-compose up -d

down:
	docker-compose down

migrate:
	cd backend && DATABASE_URL="$(DATABASE_URL)" go run cmd/migrate/main.go

test:
	cd backend && go test ./...
	cd frontend && npm run build

seed-dev:
	cd backend && DATABASE_URL="$(DATABASE_URL)" BOOTSTRAP_ADMIN_EMAIL="admin@ont.co.ke" go run cmd/server/main.go

import:
	cd backend && DATABASE_URL="$(DATABASE_URL)" go run cmd/import/main.go
