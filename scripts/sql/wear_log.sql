-- Per-garment wear history log.
CREATE TABLE IF NOT EXISTS wear_log (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    text NOT NULL,
    garment_id text NOT NULL REFERENCES garments(id) ON DELETE CASCADE,
    worn_date  date NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wear_log_user_date
    ON wear_log (user_id, worn_date DESC);

CREATE INDEX IF NOT EXISTS idx_wear_log_garment
    ON wear_log (garment_id);
