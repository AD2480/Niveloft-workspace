-- Phase 4: optional effort estimate per task, in working days (Mon–Fri).
-- Used only by the planning simulation; always shown labelled as an estimate.
ALTER TABLE tasks ADD COLUMN estimate_days INT NULL;
