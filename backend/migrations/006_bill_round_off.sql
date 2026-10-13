-- Historical invoices retain their charged amount and have no adjustment.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS round_off_paise BIGINT NOT NULL DEFAULT 0;
