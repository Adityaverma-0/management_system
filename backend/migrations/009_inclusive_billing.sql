BEGIN;
-- Serialize startup migrations and prevent sales while invoice identities are backfilled.
LOCK TABLE invoices IN ACCESS EXCLUSIVE MODE;
CREATE TABLE IF NOT EXISTS invoice_counters (
    salesman_id VARCHAR(50) NOT NULL REFERENCES salesmen(id),
    invoice_date DATE NOT NULL,
    last_seq INTEGER NOT NULL CHECK (last_seq > 0),
    PRIMARY KEY (salesman_id, invoice_date)
);
ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS business_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS gstin VARCHAR(15),
    ADD COLUMN IF NOT EXISTS invoice_date DATE,
    ADD COLUMN IF NOT EXISTS invoice_seq INTEGER;
-- Before this release the print template used this literal title and no GSTIN.
-- Never backfill old receipts with today's admin settings.
UPDATE invoices SET business_name='FMCG Van Sales' WHERE business_name IS NULL;
UPDATE invoices SET gstin='' WHERE gstin IS NULL;
UPDATE invoices SET invoice_date=COALESCE(
    (to_timestamp(created_at / 1000.0) AT TIME ZONE 'Asia/Kolkata')::date,calendar_date)
WHERE invoice_date IS NULL;
-- Keep historical printed identifiers; reserve sequence slots for VALID and VOID bills.
WITH ranked AS (
    SELECT id, row_number() OVER (PARTITION BY salesman_id,invoice_date ORDER BY created_at,id) AS seq
    FROM invoices
) UPDATE invoices i SET invoice_seq=r.seq FROM ranked r WHERE r.id=i.id AND i.invoice_seq IS NULL;
ALTER TABLE invoices ALTER COLUMN business_name SET NOT NULL, ALTER COLUMN gstin SET NOT NULL,
    ALTER COLUMN invoice_date SET NOT NULL, ALTER COLUMN invoice_seq SET NOT NULL,
    ALTER COLUMN salesman_id SET NOT NULL;
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_invoice_number_key;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_salesman_date_seq_key ON invoices(salesman_id,invoice_date,invoice_seq);
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='invoices'::regclass AND conname='invoices_salesman_date_seq_key') THEN
        ALTER TABLE invoices ADD CONSTRAINT invoices_salesman_date_seq_key UNIQUE USING INDEX invoices_salesman_date_seq_key;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='invoices'::regclass AND conname='invoices_invoice_seq_check') THEN
        ALTER TABLE invoices ADD CONSTRAINT invoices_invoice_seq_check CHECK(invoice_seq > 0);
    END IF;
END $$;
INSERT INTO invoice_counters(salesman_id,invoice_date,last_seq)
SELECT salesman_id,invoice_date,MAX(invoice_seq) FROM invoices GROUP BY salesman_id,invoice_date
ON CONFLICT(salesman_id,invoice_date) DO UPDATE SET last_seq=GREATEST(invoice_counters.last_seq,EXCLUDED.last_seq);
-- Retain charged historical totals and ledger balances. Only obsolete components go away.
ALTER TABLE invoices DROP COLUMN IF EXISTS cgst_percent, DROP COLUMN IF EXISTS sgst_percent,
    DROP COLUMN IF EXISTS cgst_amount_paise, DROP COLUMN IF EXISTS sgst_amount_paise,
    DROP COLUMN IF EXISTS round_off_paise, DROP COLUMN IF EXISTS subtotal_paise;
DELETE FROM app_settings WHERE id='tax';
-- Retried pre-upgrade sale requests must not return obsolete response fields.
UPDATE api_operations SET response=response - ARRAY['cgstPercent','sgstPercent','cgstAmountPaise','sgstAmountPaise','roundOffPaise','subtotalPaise','unroundedTotalPaise','vehicleId']
WHERE operation='sale';
COMMIT;
