-- Local EXPLAIN showed full scan + sort for location history (20,660 rows).
-- This index serves both the initial page and timestamp/id seek pagination.
CREATE INDEX IF NOT EXISTS idx_stock_ledger_location_history
ON stock_ledger(location_id, timestamp DESC, id DESC);
