-- Full-outfit log: records which garments were worn together on a given date.
CREATE TABLE IF NOT EXISTS outfit_log (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     text NOT NULL,
    worn_date   date NOT NULL,
    garment_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
    event_type  text,
    notes       text,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outfit_log_user_date
    ON outfit_log (user_id, worn_date DESC);
