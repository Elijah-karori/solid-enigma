#!/bin/bash
# usage: run.sh file.sql  -> applies the Up section only
f=$1
awk '/^-- \+goose Down/{exit} /^-- \+goose/{next} {print}' "$f" > /tmp/up.sql
su postgres -c "psql -v ON_ERROR_STOP=1 -q -d ont -f /tmp/up.sql" 2>&1 | head -20
echo "== $f exit ${PIPESTATUS[0]}"
