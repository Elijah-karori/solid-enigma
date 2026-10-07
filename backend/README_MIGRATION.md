# Migrating the Apps Script workbook

1. `pip install openpyxl`
2. `python3 tools/extract_workbook.py path/to/workbook.xlsx --out out`
   -> `out/import_bundle.json` (data) and `out/migration_report.md` (read this first)
3. `go run ./cmd/import -bundle out/import_bundle.json`            (dry run)
   `go run ./cmd/import -bundle out/import_bundle.json -commit`   (single transaction; rolls back if balances differ)
4. Every imported user must set a password: Login -> "Forgot password" -> emailed code. No legacy password is carried over.

Run `go mod tidy` once (new direct dependency: golang.org/x/time).
