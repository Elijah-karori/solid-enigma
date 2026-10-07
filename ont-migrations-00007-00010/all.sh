#!/bin/bash
# fresh database, apply every migration in order
su postgres -c "psql -q -c 'DROP DATABASE IF EXISTS ont' -c 'CREATE DATABASE ont'"
for f in 0000*.sql 0001*.sql; do [ -f "$f" ] && ./run.sh $f | tail -3; done
