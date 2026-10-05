-- +goose Up
-- Shared trigger helpers used by every later migration.

-- +goose StatementBegin
CREATE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- Append-only tables (ledger, audit): any UPDATE / DELETE / TRUNCATE is refused.
-- +goose StatementBegin
CREATE FUNCTION prevent_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed: the table is append-only', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- The Go models use plain strings, so an unset optional reference arrives as ''.
-- A foreign key cannot reference '', so this turns '' into NULL for the columns named in
-- the trigger arguments:  EXECUTE FUNCTION blank_to_null('project_id','task_id').
-- Text columns only (a '' date or number is rejected before any trigger runs).
-- +goose StatementBegin
CREATE FUNCTION blank_to_null() RETURNS trigger AS $$
DECLARE
  col text;
  j   jsonb;
BEGIN
  j := to_jsonb(NEW);
  FOREACH col IN ARRAY TG_ARGV LOOP
    IF (j ->> col) = '' THEN
      j := jsonb_set(j, ARRAY[col], 'null'::jsonb);
    END IF;
  END LOOP;
  RETURN jsonb_populate_record(NEW, j);
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- +goose Down
DROP FUNCTION IF EXISTS blank_to_null();
DROP FUNCTION IF EXISTS prevent_mutation();
DROP FUNCTION IF EXISTS set_updated_at();
