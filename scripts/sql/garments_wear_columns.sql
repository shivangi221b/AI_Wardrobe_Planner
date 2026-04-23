-- Add wear-tracking and laundry-status columns to the garments table.
-- Safe to re-run: each ADD COLUMN uses IF NOT EXISTS.

ALTER TABLE garments
  ADD COLUMN IF NOT EXISTS laundry_status text NOT NULL DEFAULT 'clean',
  ADD COLUMN IF NOT EXISTS last_worn_date date,
  ADD COLUMN IF NOT EXISTS times_worn integer NOT NULL DEFAULT 0;
