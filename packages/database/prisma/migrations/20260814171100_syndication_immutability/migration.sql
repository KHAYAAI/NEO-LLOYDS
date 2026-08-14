-- Two invariants enforced at the database level, not merely by application
-- code, because a binding commitment must not be alterable through any path
-- (docs/reports/phase-5.md).

-- 1. The allocation history is append-only, forever — same pattern as
--    AuditRecord. Nothing may UPDATE or DELETE a recorded event, including a
--    REMOVED event for an allocation that was later withdrawn: the fact that
--    it was proposed and then withdrawn must remain provable.
CREATE OR REPLACE FUNCTION neolloyds_syndication_events_are_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'SyndicationAllocationEvent is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS syndication_allocation_event_no_update ON "SyndicationAllocationEvent";
CREATE TRIGGER syndication_allocation_event_no_update
  BEFORE UPDATE ON "SyndicationAllocationEvent"
  FOR EACH ROW EXECUTE FUNCTION neolloyds_syndication_events_are_append_only();

DROP TRIGGER IF EXISTS syndication_allocation_event_no_delete ON "SyndicationAllocationEvent";
CREATE TRIGGER syndication_allocation_event_no_delete
  BEFORE DELETE ON "SyndicationAllocationEvent"
  FOR EACH ROW EXECUTE FUNCTION neolloyds_syndication_events_are_append_only();

-- 2. Once a syndication is BOUND, its SyndicationAllocation rows are frozen:
--    no UPDATE, no DELETE, regardless of which role or code path attempts
--    it. This is the database-level enforcement of "binding means binding" —
--    the application layer also refuses this, but the guarantee does not
--    depend on the application being correct.
CREATE OR REPLACE FUNCTION neolloyds_syndication_allocation_frozen_once_bound()
RETURNS TRIGGER AS $$
DECLARE
  parent_status TEXT;
BEGIN
  SELECT status INTO parent_status
  FROM "Syndication"
  WHERE id = COALESCE(OLD."syndicationId", NEW."syndicationId");

  IF parent_status = 'BOUND' THEN
    RAISE EXCEPTION
      'SyndicationAllocation is immutable once its syndication is BOUND: % is not permitted', TG_OP
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS syndication_allocation_frozen_update ON "SyndicationAllocation";
CREATE TRIGGER syndication_allocation_frozen_update
  BEFORE UPDATE ON "SyndicationAllocation"
  FOR EACH ROW EXECUTE FUNCTION neolloyds_syndication_allocation_frozen_once_bound();

DROP TRIGGER IF EXISTS syndication_allocation_frozen_delete ON "SyndicationAllocation";
CREATE TRIGGER syndication_allocation_frozen_delete
  BEFORE DELETE ON "SyndicationAllocation"
  FOR EACH ROW EXECUTE FUNCTION neolloyds_syndication_allocation_frozen_once_bound();
