-- Append-only audit log, enforced by the database rather than by convention
-- (security-model.md §6). A trigger is used in preference to GRANT/REVOKE so
-- the guarantee holds regardless of which role the application connects as.

CREATE OR REPLACE FUNCTION neolloyds_audit_is_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'AuditRecord is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_record_no_update ON "AuditRecord";
CREATE TRIGGER audit_record_no_update
  BEFORE UPDATE ON "AuditRecord"
  FOR EACH ROW EXECUTE FUNCTION neolloyds_audit_is_append_only();

DROP TRIGGER IF EXISTS audit_record_no_delete ON "AuditRecord";
CREATE TRIGGER audit_record_no_delete
  BEFORE DELETE ON "AuditRecord"
  FOR EACH ROW EXECUTE FUNCTION neolloyds_audit_is_append_only();
