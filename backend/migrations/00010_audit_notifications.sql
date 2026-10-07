-- +goose Up
-- (1) database-side audit trail: every change to a business table lands in the hash-chained audit_ledger,
--     and the chain can be verified with audit_verify();
-- (2) email notifications as a transactional outbox: triggers queue messages, a worker sends them
--     (Go SMTP sender) and records the outcome in notification_logs.

-- +goose StatementBegin
CREATE FUNCTION html_esc(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT replace(replace(replace(replace(coalesce(t, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;');
$$;
-- +goose StatementEnd

-- ---------------------------------------------------------------------------------------------
-- audit
-- ---------------------------------------------------------------------------------------------
-- Canonical hash (the Go API uses exactly the same recipe): SHA-256 over
--   prev_hash U+241F seq U+241F UTC timestamp (microseconds, 'Z') U+241F actor U+241F role U+241F entity type U+241F
--   entity id U+241F action U+241F previous state U+241F new state U+241F details U+241F ip
-- +goose StatementBegin
CREATE FUNCTION audit_hash(p_prev text, p_seq bigint, p_ts timestamptz, p_actor text, p_role text, p_type text, p_id text,
                           p_action text, p_prev_state text, p_new_state text, p_details text, p_ip text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(concat_ws(chr(9247), coalesce(p_prev, ''), p_seq::text,
           to_char(p_ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
           coalesce(p_actor, ''), coalesce(p_role, ''), coalesce(p_type, ''), coalesce(p_id, ''), coalesce(p_action, ''),
           coalesce(p_prev_state, ''), coalesce(p_new_state, ''), coalesce(p_details, ''), coalesce(p_ip, '')), 'UTF8')), 'hex');
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION audit_append(p_actor text, p_role text, p_type text, p_id text, p_action text,
                             p_prev text DEFAULT '', p_new text DEFAULT '', p_details text DEFAULT '', p_ip text DEFAULT '') RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE s bigint; h text; ts timestamptz := clock_timestamp();
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('audit_ledger'));
  SELECT seq, hash INTO s, h FROM audit_ledger ORDER BY seq DESC LIMIT 1;
  s := coalesce(s, 0) + 1;
  h := coalesce(h, '');
  INSERT INTO audit_ledger (id, seq, event_timestamp, actor_email, actor_role, entity_type, entity_id, action,
                            previous_state, new_state, details, ip_address, prev_hash, hash)
  VALUES (gen_random_uuid(), s, ts, coalesce(p_actor, 'system'), coalesce(p_role, 'System'), p_type, p_id, p_action,
          coalesce(p_prev, ''), coalesce(p_new, ''), coalesce(p_details, ''), coalesce(p_ip, ''), h,
          audit_hash(h, s, ts, coalesce(p_actor, 'system'), coalesce(p_role, 'System'), p_type, p_id, p_action,
                     coalesce(p_prev, ''), coalesce(p_new, ''), coalesce(p_details, ''), coalesce(p_ip, '')));
  RETURN s;
END;
$$;
-- +goose StatementEnd

-- Walks the whole chain: link, sequence and hash of every row.
-- +goose StatementBegin
CREATE FUNCTION audit_verify() RETURNS TABLE (intact boolean, checked bigint, broken_seq bigint, reason text)
LANGUAGE plpgsql STABLE AS $$
DECLARE r audit_ledger%ROWTYPE; prev text := ''; n bigint := 0; expect bigint := 1;
BEGIN
  FOR r IN SELECT * FROM audit_ledger ORDER BY seq LOOP
    IF r.seq <> expect THEN
      RETURN QUERY SELECT false, n, expect, 'a row is missing or out of sequence'; RETURN;
    END IF;
    IF r.prev_hash <> prev OR r.hash <> audit_hash(r.prev_hash, r.seq, r.event_timestamp, r.actor_email, r.actor_role, r.entity_type,
                       r.entity_id, r.action, r.previous_state, r.new_state, r.details, r.ip_address) THEN
      RETURN QUERY SELECT false, n, r.seq, 'row content or link does not match its hash'; RETURN;
    END IF;
    prev := r.hash; n := n + 1; expect := expect + 1;
  END LOOP;
  RETURN QUERY SELECT true, n, NULL::bigint, ''::text;
END;
$$;
-- +goose StatementEnd

-- Generic row trigger: EXECUTE FUNCTION audit_row('Entity type', 'id column').
-- Records only the columns that changed; never records password hashes or bookkeeping columns.
-- +goose StatementBegin
CREATE FUNCTION audit_row() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  noise text[] := ARRAY['updated_at', 'created_at', 'password_hash', 'last_login_at', 'failed_logins', 'locked_until'];
  o jsonb; n jsonb; k text; dp jsonb := '{}'; dn jsonb := '{}'; v_id text; act text;
BEGIN
  IF is_import() THEN RETURN NULL; END IF;
  IF TG_OP <> 'INSERT' THEN o := to_jsonb(OLD) - noise; END IF;
  IF TG_OP <> 'DELETE' THEN n := to_jsonb(NEW) - noise; END IF;
  v_id := coalesce(CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END ->> TG_ARGV[1], '');
  IF TG_OP = 'INSERT' THEN dn := n; act := 'Created';
  ELSIF TG_OP = 'DELETE' THEN dp := o; act := 'Deleted';
  ELSE
    FOR k IN SELECT jsonb_object_keys(n) LOOP
      IF n -> k IS DISTINCT FROM o -> k THEN dp := dp || jsonb_build_object(k, o -> k); dn := dn || jsonb_build_object(k, n -> k); END IF;
    END LOOP;
    IF dn = '{}'::jsonb THEN RETURN NULL; END IF;
    act := CASE WHEN dn ?| ARRAY['status', 'approval_status', 'ticket_status'] THEN 'Status changed' ELSE 'Updated' END;
  END IF;
  PERFORM audit_append(coalesce(actor_email(), 'system'), coalesce(actor_role(), 'System'), TG_ARGV[0], v_id, act,
                       CASE WHEN dp = '{}'::jsonb THEN '' ELSE left(dp::text, 2000) END,
                       CASE WHEN dn = '{}'::jsonb THEN '' ELSE left(dn::text, 2000) END, '', '');
  RETURN NULL;
END;
$$;
-- +goose StatementEnd

CREATE TRIGGER t9_users_audit      AFTER INSERT OR UPDATE OR DELETE ON users                   FOR EACH ROW EXECUTE FUNCTION audit_row('User', 'email');
CREATE TRIGGER t9_catalog_audit    AFTER INSERT OR UPDATE OR DELETE ON item_catalog            FOR EACH ROW EXECUTE FUNCTION audit_row('Catalog Item', 'sku');
CREATE TRIGGER t9_serialized_audit AFTER INSERT OR UPDATE OR DELETE ON serialized_inventory    FOR EACH ROW EXECUTE FUNCTION audit_row('Serialized Asset', 'asset_id');
CREATE TRIGGER t9_projects_audit   AFTER INSERT OR UPDATE OR DELETE ON projects                FOR EACH ROW EXECUTE FUNCTION audit_row('Project', 'project_id');
CREATE TRIGGER t9_customers_audit  AFTER INSERT OR UPDATE OR DELETE ON customers              FOR EACH ROW EXECUTE FUNCTION audit_row('Customer', 'id');
CREATE TRIGGER t9_hotspots_audit   AFTER INSERT OR UPDATE OR DELETE ON hotspots                FOR EACH ROW EXECUTE FUNCTION audit_row('Hotspot', 'id');
CREATE TRIGGER t9_enclosures_audit AFTER INSERT OR UPDATE OR DELETE ON enclosures              FOR EACH ROW EXECUTE FUNCTION audit_row('Enclosure', 'id');
CREATE TRIGGER t9_splitters_audit  AFTER INSERT OR UPDATE OR DELETE ON splitters               FOR EACH ROW EXECUTE FUNCTION audit_row('Splitter', 'id');
CREATE TRIGGER t9_install_audit    AFTER INSERT OR UPDATE OR DELETE ON device_installations    FOR EACH ROW EXECUTE FUNCTION audit_row('Installation', 'asset_id');
CREATE TRIGGER t9_replace_audit    AFTER INSERT ON device_replacements                         FOR EACH ROW EXECUTE FUNCTION audit_row('Device Replacement', 'old_asset_id');
CREATE TRIGGER t9_tickets_audit    AFTER INSERT OR UPDATE OR DELETE ON customer_tickets        FOR EACH ROW EXECUTE FUNCTION audit_row('Ticket', 'ticket_id');
CREATE TRIGGER t9_tasks_audit      AFTER INSERT OR UPDATE OR DELETE ON technician_tasks        FOR EACH ROW EXECUTE FUNCTION audit_row('Task', 'task_id');
CREATE TRIGGER t9_reqs_audit       AFTER INSERT OR UPDATE OR DELETE ON technician_requisitions FOR EACH ROW EXECUTE FUNCTION audit_row('Requisition', 'requisition_id');
CREATE TRIGGER t9_proc_audit       AFTER INSERT OR UPDATE OR DELETE ON procurement_requests    FOR EACH ROW EXECUTE FUNCTION audit_row('Procurement', 'procurement_id');
CREATE TRIGGER t9_notes_audit      AFTER INSERT OR UPDATE OR DELETE ON delivery_notes          FOR EACH ROW EXECUTE FUNCTION audit_row('Document', 'doc_no');
CREATE TRIGGER t9_settings_audit   AFTER INSERT OR UPDATE OR DELETE ON settings                FOR EACH ROW EXECUTE FUNCTION audit_row('Setting', 'key');

-- Life cycle of one unit: audited changes + every stock movement that carried it.
CREATE VIEW v_unit_history AS
SELECT a.entity_id AS asset_id, a.event_timestamp AS at, a.actor_email AS by_user, a.actor_role, a.action,
       a.previous_state, a.new_state, a.details, 'audit'::text AS source
  FROM audit_ledger a WHERE a.entity_type = 'Serialized Asset'
UNION ALL
SELECT t.asset_id, t.transaction_date, t.requested_by, t.role, t.direction, '', '', concat_ws(' | ', t.site_reference, t.cost_type, t.notes), 'ledger'
  FROM inventory_transactions t WHERE t.asset_id IS NOT NULL;

-- ---------------------------------------------------------------------------------------------
-- notifications: transactional outbox
-- ---------------------------------------------------------------------------------------------
CREATE TABLE notification_outbox (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at      timestamptz NOT NULL DEFAULT now(),
  type            text NOT NULL,
  reference       text NOT NULL DEFAULT '',
  recipient       text NOT NULL CHECK (recipient ~ '^[^[:space:]@]+@[^[:space:]@]+$'),
  subject         text NOT NULL,
  body_html       text NOT NULL,
  status          text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENDING', 'SENT', 'FAILED')),
  attempts        int  NOT NULL DEFAULT 0,
  last_error      text NOT NULL DEFAULT '',
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  ledger_seq      bigint      -- ledger position when a stock alert was raised (episode tracking)
);
CREATE INDEX notification_outbox_due_idx ON notification_outbox (status, next_attempt_at);
CREATE INDEX notification_outbox_ref_idx ON notification_outbox (type, reference, created_at);

-- +goose StatementBegin
CREATE FUNCTION email_of(p_name text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN count(*) = 1 THEN min(email) END FROM users
   WHERE status = 'active' AND (lower(name) = lower(btrim(coalesce(p_name, ''))) OR lower(email) = lower(btrim(coalesce(p_name, ''))));
$$;
-- +goose StatementEnd

-- active users holding one of the roles, plus any addresses typed into a setting ("a@x.com, b@y.com")
-- +goose StatementBegin
CREATE FUNCTION emails_for_roles(p_roles text[], p_setting text DEFAULT NULL) RETURNS text[] LANGUAGE sql STABLE AS $$
  SELECT coalesce(array_agg(DISTINCT e), '{}') FROM (
    SELECT lower(email) AS e FROM users WHERE status = 'active' AND role = ANY (p_roles)
    UNION
    SELECT lower(x) FROM regexp_split_to_table(CASE WHEN p_setting IS NULL THEN '' ELSE get_setting(p_setting, '') END, '[,;[:space:]]+') AS x
  ) q WHERE e <> '';
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION enqueue_email(p_type text, p_ref text, p_to text[], p_subject text, p_body text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  IF is_import() THEN RETURN 0; END IF;
  INSERT INTO notification_outbox (type, reference, recipient, subject, body_html)
  SELECT DISTINCT p_type, coalesce(p_ref, ''), lower(btrim(r)), p_subject, p_body
    FROM unnest(p_to) AS r
   WHERE r IS NOT NULL AND btrim(r) ~ '^[^[:space:]@]+@[^[:space:]@]+$';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
-- +goose StatementEnd

-- Worker API: claim a batch (safe with several workers; a claim that is never confirmed is retried after 5 minutes) ...
-- +goose StatementBegin
CREATE FUNCTION claim_notifications(p_limit int DEFAULT 20) RETURNS SETOF notification_outbox LANGUAGE sql AS $$
  UPDATE notification_outbox o
     SET status = 'SENDING', attempts = o.attempts + 1, next_attempt_at = now() + interval '5 minutes'
   WHERE o.id IN (SELECT id FROM notification_outbox
                   WHERE status IN ('PENDING', 'SENDING') AND next_attempt_at <= now()
                   ORDER BY id LIMIT p_limit FOR UPDATE SKIP LOCKED)
  RETURNING o.*;
$$;
-- +goose StatementEnd

-- ... and report the result. Failures retry with growing delay, then stay FAILED. Either way notification_logs gets a row.
-- +goose StatementBegin
CREATE FUNCTION mark_notification(p_id bigint, p_ok boolean, p_error text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $$
DECLARE o notification_outbox%ROWTYPE;
BEGIN
  SELECT * INTO o FROM notification_outbox WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF p_ok THEN
    UPDATE notification_outbox SET status = 'SENT', sent_at = now(), last_error = '' WHERE id = p_id;
    INSERT INTO notification_logs (timestamp, type, reference, recipient, subject, status) VALUES (now(), o.type, o.reference, o.recipient, o.subject, 'SENT');
  ELSIF o.attempts >= 5 THEN
    UPDATE notification_outbox SET status = 'FAILED', last_error = left(coalesce(p_error, ''), 300) WHERE id = p_id;
    INSERT INTO notification_logs (timestamp, type, reference, recipient, subject, status, error) VALUES (now(), o.type, o.reference, o.recipient, o.subject, 'FAILED', left(coalesce(p_error, ''), 300));
  ELSE
    UPDATE notification_outbox SET status = 'PENDING', last_error = left(coalesce(p_error, ''), 300),
           next_attempt_at = now() + o.attempts * interval '2 minutes' WHERE id = p_id;
  END IF;
END;
$$;
-- +goose StatementEnd

-- ---- who gets told ----------------------------------------------------------------------------
-- +goose StatementBegin
CREATE FUNCTION requester_email(p_user uuid, p_name text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT email FROM users WHERE id = p_user), email_of(p_name));
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION low_stock_recipients() RETURNS text[] LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN get_setting('LOW_STOCK_EMAILS', '') <> ''
              THEN emails_for_roles('{}', 'LOW_STOCK_EMAILS')
              ELSE emails_for_roles(ARRAY['Admin', 'Store Manager']) END
         || emails_for_roles('{}', 'PURCHASING_EMAIL');
$$;
-- +goose StatementEnd

-- ---- requisitions -----------------------------------------------------------------------------
-- +goose StatementBegin
CREATE FUNCTION notify_req_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE to_list text[]; req text := requester_email(NEW.technician_user_id, NEW.technician_name); pm text; pn text;
BEGIN
  IF is_import() THEN RETURN NULL; END IF;
  SELECT array_agg(email) INTO to_list FROM users WHERE status = 'active' AND has_perm(role, 'approveReq');
  SELECT u.email, p.project_name INTO pm, pn FROM projects p JOIN users u ON u.id = p.manager_user_id WHERE p.project_id = NEW.project_id;
  to_list := coalesce(to_list, '{}') || coalesce(ARRAY[pm], '{}');
  to_list := array_remove(to_list, req);
  PERFORM enqueue_email('REQUISITION_PENDING', NEW.requisition_id, to_list, 'Requisition awaiting approval: ' || NEW.requisition_id,
    format('<p><b>%s</b>: %s requests %s x %s%s<br>Reason: %s</p>', NEW.requisition_id, html_esc(NEW.technician_name), NEW.quantity, html_esc(NEW.item_sku),
           CASE WHEN NEW.project_id IS NOT NULL THEN '<br>Project: ' || NEW.project_id || ' - ' || html_esc(pn) ELSE '' END,
           html_esc(coalesce(NEW.reason, '-'))));
  RETURN NULL;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER t6_reqs_notify_insert AFTER INSERT ON technician_requisitions FOR EACH ROW EXECUTE FUNCTION notify_req_insert();

-- +goose StatementBegin
CREATE FUNCTION notify_req_status() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE req text := requester_email(NEW.technician_user_id, NEW.technician_name); id text := NEW.requisition_id; line text;
BEGIN
  IF is_import() OR NEW.approval_status = OLD.approval_status THEN RETURN NULL; END IF;
  line := format('%s x %s', NEW.quantity, html_esc(NEW.item_sku));
  IF NEW.approval_status = 'Rejected' THEN
    PERFORM enqueue_email('REQUISITION_STATUS', id, ARRAY[req], 'Requisition ' || id || ': Rejected',
      format('<p><b>%s</b> - %s was rejected by %s.<br>Reason: %s</p>', id, line, html_esc(coalesce(actor_name(), '')), html_esc(coalesce(NEW.decision_note, ''))));
  ELSIF NEW.approval_status = 'Pending Finance' THEN
    PERFORM enqueue_email('REQUISITION_FINANCE', id, emails_for_roles(ARRAY['Finance'], 'FINANCE_EMAIL'), 'Finance approval needed: ' || id,
      format('<p><b>%s</b> - %s%s<br>Estimated value: KES %s<br>Why Finance: %s.<br>Operations approved by %s.</p>', id, line,
             coalesce(' for ' || NEW.project_id, ''), NEW.est_value, html_esc(finance_needed(NEW.est_value, NEW.project_id)), html_esc(coalesce(NEW.approved_by, ''))));
    PERFORM enqueue_email('REQUISITION_STATUS', id, ARRAY[req], 'Requisition ' || id || ': with Finance',
      format('<p>Operations approved <b>%s</b>. It now needs Finance clearance.</p>', id));
  ELSIF NEW.approval_status IN ('Approved - Ready', 'Awaiting Stock') AND OLD.approval_status = 'Awaiting Stock' THEN
    IF setting_on('STOCK_AVAILABLE_ENABLED') THEN
      PERFORM enqueue_email('STOCK_AVAILABLE_REQ', id, ARRAY[req], 'Stock available for requisition ' || id,
        format('<p>Stock required for your approved requisition is now available.</p><p><b>Requisition:</b> %s<br><b>SKU:</b> %s<br><b>Qty:</b> %s<br><b>Status:</b> Approved - Ready</p>', id, html_esc(NEW.item_sku), NEW.quantity));
    END IF;
  ELSIF NEW.approval_status IN ('Approved - Ready', 'Awaiting Stock') THEN
    PERFORM enqueue_email('REQUISITION_STATUS', id, ARRAY[req], 'Requisition ' || id || ': ' || NEW.approval_status,
      format('<p><b>%s</b> - %s<br>Status: <b>%s</b><br>%s</p>', id, line, NEW.approval_status,
             CASE WHEN NEW.approval_status = 'Awaiting Stock' THEN 'Stock is being arranged.' ELSE 'Collect it from the store.' END));
    IF NEW.approval_status = 'Awaiting Stock' THEN
      PERFORM enqueue_email('REQUISITION_SHORT', id, (SELECT array_agg(email) FROM users WHERE status = 'active' AND has_perm(role, 'approveReq')),
        'Short of stock for ' || id, format('<p><b>%s</b> is approved but stock is short of %s. Raise a purchase request in the portal.</p>', id, line));
    END IF;
  ELSIF NEW.approval_status = 'Issued' THEN
    PERFORM enqueue_email('REQUISITION_ISSUED', id, ARRAY[req], 'Stock issued: ' || id,
      format('<p>%s issued to you by %s%s</p>', line, html_esc(coalesce(NEW.issued_by, '')), coalesce(' for ' || NEW.project_id, '')));
  END IF;
  RETURN NULL;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER t6_reqs_notify_status AFTER UPDATE OF approval_status ON technician_requisitions FOR EACH ROW EXECUTE FUNCTION notify_req_status();

-- ---- tasks / tickets --------------------------------------------------------------------------
-- +goose StatementBegin
CREATE FUNCTION notify_task() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF is_import() THEN RETURN NULL; END IF;
  IF TG_OP = 'INSERT' THEN
    IF setting_on('TASK_ASSIGNMENT_ENABLED') AND NEW.assignee_email IS NOT NULL THEN
      PERFORM enqueue_email('TASK_ASSIGNED', NEW.task_id, ARRAY[NEW.assignee_email], 'Task assigned: ' || NEW.task_id || ' - ' || NEW.task_title,
        format('<p>A task has been assigned to you.</p><p><b>Task:</b> %s<br><b>Title:</b> %s<br><b>Priority:</b> %s<br><b>Status:</b> %s<br><b>Required stock:</b> %s<br><b>Site:</b> %s<br><b>Reference:</b> %s</p>',
               NEW.task_id, html_esc(NEW.task_title), NEW.priority, NEW.status,
               CASE WHEN NEW.required_sku IS NOT NULL THEN html_esc(NEW.required_sku) || ' x ' || NEW.required_qty ELSE 'None' END,
               html_esc(coalesce(NEW.customer_site, '-')), html_esc(coalesce(NEW.reference, '-'))));
    END IF;
  ELSIF OLD.status = 'Awaiting Stock' AND NEW.status = 'Ready' AND setting_on('STOCK_AVAILABLE_ENABLED') AND NEW.assignee_email IS NOT NULL THEN
    PERFORM enqueue_email('STOCK_AVAILABLE', NEW.task_id, ARRAY[NEW.assignee_email], 'Stock available for task ' || NEW.task_id,
      format('<p>Required stock is now available for your task.</p><p><b>Task:</b> %s<br><b>SKU:</b> %s<br><b>Qty:</b> %s<br><b>Status:</b> Ready</p>', NEW.task_id, html_esc(NEW.required_sku), NEW.required_qty));
  END IF;
  RETURN NULL;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER t6_tasks_notify AFTER INSERT OR UPDATE OF status ON technician_tasks FOR EACH ROW EXECUTE FUNCTION notify_task();

-- a ticket assigned WITHOUT a linked task: tell the technician directly
-- +goose StatementBegin
CREATE FUNCTION notify_ticket() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE em text;
BEGIN
  IF is_import() OR NEW.linked_task_id IS NOT NULL OR coalesce(NEW.assigned_to, '') = '' THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND NEW.assigned_to IS NOT DISTINCT FROM OLD.assigned_to THEN RETURN NULL; END IF;
  em := requester_email(NEW.assigned_user_id, NEW.assigned_to);
  PERFORM enqueue_email('TICKET_ASSIGNED', NEW.ticket_id, ARRAY[em], 'Support task assigned: ' || NEW.ticket_id,
    format('<p>A customer support task has been assigned to you.</p><p><b>Ticket:</b> %s<br><b>Customer:</b> %s<br><b>Issue:</b> %s<br><b>Notes:</b> %s</p>',
           NEW.ticket_id, html_esc(NEW.customer_name), html_esc(NEW.issue_category), html_esc(coalesce(NEW.resolution_notes, ''))));
  RETURN NULL;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER t6_tickets_notify AFTER INSERT OR UPDATE OF assigned_to ON customer_tickets FOR EACH ROW EXECUTE FUNCTION notify_ticket();

-- ---- purchases / projects ---------------------------------------------------------------------
-- +goose StatementBegin
CREATE FUNCTION notify_proc() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE req text := requester_email(NEW.requested_by_user_id, NEW.requested_by); fin text[] := emails_for_roles(ARRAY['Finance'], 'FINANCE_EMAIL');
        id text := NEW.procurement_id; body text;
BEGIN
  IF is_import() THEN RETURN NULL; END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM enqueue_email('PROCUREMENT_PENDING', id, fin, 'Purchase approval needed: ' || id,
      format('<p><b>%s</b>: %s wants to buy %s x %s%s%s.<br>Estimated: KES %s</p>', id, html_esc(NEW.requested_by), NEW.quantity, html_esc(NEW.item_sku),
             coalesce(' for ' || NEW.project_id, ''), coalesce(' - to fulfil ' || NEW.linked_requisition_id, ''), NEW.est_total));
    RETURN NULL;
  END IF;
  IF NEW.status = OLD.status THEN RETURN NULL; END IF;
  body := format('<p><b>%s</b> (%s x %s) is now <b>%s</b>.</p>', id, NEW.quantity, html_esc(NEW.item_sku), NEW.status);
  IF NEW.status IN ('Approved', 'Rejected', 'Cancelled') THEN
    PERFORM enqueue_email('PROCUREMENT_STATUS', id, ARRAY[req], 'Purchase ' || id || ': ' || NEW.status, body);
    IF NEW.status = 'Approved' THEN
      PERFORM enqueue_email('PROCUREMENT_APPROVED', id, emails_for_roles(ARRAY['Admin', 'Store Manager'], 'PURCHASING_EMAIL'), 'Place order: ' || id,
        body || '<p>Please order from a supplier and record it in the portal.</p>');
    END IF;
  ELSIF NEW.status = 'Ordered' THEN
    PERFORM enqueue_email('PROCUREMENT_ORDERED', id, ARRAY[req] || fin, 'Order placed: ' || id,
      format('<p><b>%s</b> ordered from %s%s.</p>', id, html_esc(NEW.supplier), coalesce(' (PO ' || html_esc(NEW.po_ref) || ')', '')));
  ELSIF NEW.status = 'Received' THEN
    PERFORM enqueue_email('PROCUREMENT_RECEIVED', id, ARRAY[req] || fin, 'Stock received: ' || id,
      format('<p><b>%s</b>: %s x %s received into the store. A receipt note can now be generated for payment tracking.</p>', id, NEW.quantity, html_esc(NEW.item_sku)));
  END IF;
  RETURN NULL;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER t6_proc_notify AFTER INSERT OR UPDATE OF status ON procurement_requests FOR EACH ROW EXECUTE FUNCTION notify_proc();

-- +goose StatementBegin
CREATE FUNCTION notify_project() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE em text;
BEGIN
  IF is_import() OR NEW.manager_user_id IS NULL THEN RETURN NULL; END IF;
  SELECT email INTO em FROM users WHERE id = NEW.manager_user_id AND lower(name) <> lower(coalesce(NEW.created_by, ''));
  PERFORM enqueue_email('PROJECT_ASSIGNED', NEW.project_id, ARRAY[em], 'You manage project ' || NEW.project_id,
    format('<p>You have been made project manager of <b>%s - %s</b>%s.</p>', NEW.project_id, html_esc(NEW.project_name), coalesce(' by ' || html_esc(NEW.created_by), '')));
  RETURN NULL;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER t6_projects_notify AFTER INSERT ON projects FOR EACH ROW EXECUTE FUNCTION notify_project();

-- ---- low stock, one alert per "episode" ---------------------------------------------------------
-- Alert when the balance is at / below the reorder level, then stay quiet until stock has been
-- replenished (a Stock In after the last alert) and falls low again.
-- +goose StatementBegin
CREATE FUNCTION enqueue_low_stock(p_sku text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE s v_stock_summary%ROWTYPE; last_seq bigint; n int;
BEGIN
  IF is_import() OR NOT setting_on('LOW_STOCK_ENABLED') THEN RETURN 0; END IF;
  SELECT * INTO s FROM v_stock_summary WHERE sku = p_sku AND is_active;
  IF NOT FOUND OR s.net_qty > s.alert_level THEN RETURN 0; END IF;
  -- already alerted for this episode? (no Stock In since the last alert; compared by ledger position, which is
  -- monotonic even inside one transaction, unlike now())
  SELECT max(ledger_seq) INTO last_seq FROM notification_outbox WHERE type = 'LOW_STOCK' AND reference = p_sku;
  IF last_seq IS NOT NULL AND NOT EXISTS (SELECT 1 FROM inventory_transactions
                                           WHERE sku = p_sku AND direction = 'Stock In' AND seq > last_seq) THEN
    RETURN 0;
  END IF;
  n := enqueue_email('LOW_STOCK', p_sku, low_stock_recipients(), 'Low stock alert: ' || p_sku,
    format('<p><strong>Low stock alert</strong></p><p><b>SKU:</b> %s<br><b>Item:</b> %s<br><b>Available:</b> %s<br><b>Reorder level:</b> %s<br><b>Unit cost:</b> KES %s<br><b>Stock value:</b> KES %s</p>',
           html_esc(p_sku), html_esc(s.model), s.net_qty, s.alert_level, s.unit_cost, s.stock_value));
  UPDATE notification_outbox SET ledger_seq = (SELECT max(seq) FROM inventory_transactions)
   WHERE type = 'LOW_STOCK' AND reference = p_sku AND ledger_seq IS NULL;
  RETURN n;
END;
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION ledger_low_stock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM enqueue_low_stock(NEW.sku);
  RETURN NULL;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER t6_ledger_low_stock AFTER INSERT ON inventory_transactions FOR EACH ROW EXECUTE FUNCTION ledger_low_stock();

-- scheduled scan (Inventory Tools > Run low-stock alert scan): returns how many SKUs raised an alert
-- +goose StatementBegin
CREATE FUNCTION run_low_stock_scan() RETURNS int LANGUAGE plpgsql AS $$
DECLARE r record; c int := 0;
BEGIN
  FOR r IN SELECT sku FROM v_low_stock LOOP
    IF enqueue_low_stock(r.sku) > 0 THEN c := c + 1; END IF;
  END LOOP;
  RETURN c;
END;
$$;
-- +goose StatementEnd

-- ---- daily digest ------------------------------------------------------------------------------
-- Call once a day (08:00) from the worker or pg_cron. One consolidated mail per audience and recipient.
-- +goose StatementBegin
CREATE FUNCTION enqueue_daily_digest() RETURNS int LANGUAGE plpgsql AS $$
DECLARE aud text; body text; to_list text[]; subj text; sent int := 0; v_ref text := to_char(current_date, 'YYYY-MM-DD'); n int;
BEGIN
  IF NOT setting_on('DIGEST_ENABLED') THEN RETURN 0; END IF;
  FOREACH aud IN ARRAY ARRAY['ops', 'finance'] LOOP
    SELECT string_agg(sec_html, '' ORDER BY srt) INTO body FROM (
      SELECT min(sort) AS srt,
             '<h3 style="margin:16px 0 4px;font-size:14px;">' || html_esc(section) || ' (' || count(*) || ')</h3><ul style="margin:0;padding-left:18px;font-size:13px;">' ||
             string_agg('<li>' || html_esc(line) || '</li>', '' ORDER BY ref) || '</ul>' AS sec_html
        FROM v_digest WHERE audience = aud GROUP BY section) s;
    CONTINUE WHEN body IS NULL;
    IF aud = 'ops' THEN
      to_list := emails_for_roles(ARRAY['Admin', 'Store Manager'], 'PURCHASING_EMAIL') || low_stock_recipients();
      subj := 'Daily inventory digest - ' || v_ref; body := '<h2 style="font-size:16px;">Inventory & approvals digest</h2>' || body;
    ELSE
      to_list := emails_for_roles(ARRAY['Finance'], 'FINANCE_EMAIL');
      subj := 'Daily finance digest - ' || v_ref; body := '<h2 style="font-size:16px;">Finance approvals digest</h2>' || body;
    END IF;
    to_list := ARRAY(SELECT DISTINCT x FROM unnest(to_list) x WHERE NOT EXISTS (
                 SELECT 1 FROM notification_outbox o WHERE o.type = 'DIGEST_' || upper(aud) AND o.reference = v_ref AND o.recipient = x));
    sent := sent + enqueue_email('DIGEST_' || upper(aud), v_ref, to_list, subj, body);
  END LOOP;
  RETURN sent;
END;
$$;
-- +goose StatementEnd

-- +goose Down
DROP FUNCTION IF EXISTS enqueue_daily_digest();
DROP FUNCTION IF EXISTS run_low_stock_scan();
DROP TRIGGER IF EXISTS t6_ledger_low_stock ON inventory_transactions;
DROP FUNCTION IF EXISTS ledger_low_stock();
DROP FUNCTION IF EXISTS enqueue_low_stock(text);
DROP TRIGGER IF EXISTS t6_projects_notify ON projects;
DROP FUNCTION IF EXISTS notify_project();
DROP TRIGGER IF EXISTS t6_proc_notify ON procurement_requests;
DROP FUNCTION IF EXISTS notify_proc();
DROP TRIGGER IF EXISTS t6_tickets_notify ON customer_tickets;
DROP FUNCTION IF EXISTS notify_ticket();
DROP TRIGGER IF EXISTS t6_tasks_notify ON technician_tasks;
DROP FUNCTION IF EXISTS notify_task();
DROP TRIGGER IF EXISTS t6_reqs_notify_status ON technician_requisitions;
DROP FUNCTION IF EXISTS notify_req_status();
DROP TRIGGER IF EXISTS t6_reqs_notify_insert ON technician_requisitions;
DROP FUNCTION IF EXISTS notify_req_insert();
DROP FUNCTION IF EXISTS low_stock_recipients();
DROP FUNCTION IF EXISTS requester_email(uuid, text);
DROP FUNCTION IF EXISTS mark_notification(bigint, boolean, text);
DROP FUNCTION IF EXISTS claim_notifications(int);
DROP FUNCTION IF EXISTS enqueue_email(text, text, text[], text, text);
DROP FUNCTION IF EXISTS emails_for_roles(text[], text);
DROP FUNCTION IF EXISTS email_of(text);
DROP TABLE IF EXISTS notification_outbox;
DROP VIEW IF EXISTS v_unit_history;
DROP TRIGGER IF EXISTS t9_settings_audit ON settings;
DROP TRIGGER IF EXISTS t9_notes_audit ON delivery_notes;
DROP TRIGGER IF EXISTS t9_proc_audit ON procurement_requests;
DROP TRIGGER IF EXISTS t9_reqs_audit ON technician_requisitions;
DROP TRIGGER IF EXISTS t9_tasks_audit ON technician_tasks;
DROP TRIGGER IF EXISTS t9_tickets_audit ON customer_tickets;
DROP TRIGGER IF EXISTS t9_replace_audit ON device_replacements;
DROP TRIGGER IF EXISTS t9_install_audit ON device_installations;
DROP TRIGGER IF EXISTS t9_splitters_audit ON splitters;
DROP TRIGGER IF EXISTS t9_enclosures_audit ON enclosures;
DROP TRIGGER IF EXISTS t9_hotspots_audit ON hotspots;
DROP TRIGGER IF EXISTS t9_customers_audit ON customers;
DROP TRIGGER IF EXISTS t9_projects_audit ON projects;
DROP TRIGGER IF EXISTS t9_serialized_audit ON serialized_inventory;
DROP TRIGGER IF EXISTS t9_catalog_audit ON item_catalog;
DROP TRIGGER IF EXISTS t9_users_audit ON users;
DROP FUNCTION IF EXISTS audit_row();
DROP FUNCTION IF EXISTS audit_verify();
DROP FUNCTION IF EXISTS audit_append(text, text, text, text, text, text, text, text, text);
DROP FUNCTION IF EXISTS audit_hash(text, bigint, timestamptz, text, text, text, text, text, text, text, text, text);
DROP FUNCTION IF EXISTS html_esc(text);
