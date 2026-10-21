-- When each person last caught up on Today ("Since you were last here"). Empty until their first visit.
ALTER TABLE users ADD COLUMN caught_up_at DATETIME(6);
