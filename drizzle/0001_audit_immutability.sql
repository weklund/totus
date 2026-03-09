-- Custom migration: audit_events immutability trigger
-- Defense-in-depth: prevents UPDATE and DELETE on audit_events even if GRANT is misconfigured.

CREATE OR REPLACE FUNCTION prevent_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'audit_events table is immutable: % operations are not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_events_immutable
    BEFORE UPDATE OR DELETE ON audit_events
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();

COMMENT ON TABLE audit_events IS 'Immutable audit log. INSERT and SELECT only. No UPDATE or DELETE permitted.';
COMMENT ON COLUMN audit_events.owner_id IS 'User whose data was accessed. Not an FK — persists after account deletion.';
COMMENT ON COLUMN audit_events.grant_id IS 'Share grant involved, if any. Not an FK — persists after grant deletion.';
