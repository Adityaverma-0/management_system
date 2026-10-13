-- Migration 005: Performance and Query Optimization Indexes
-- Designed for Neon PostgreSQL to speed up stock ledger aggregations, request lookups, and audit logs.

CREATE INDEX IF NOT EXISTS idx_stock_ledger_loc_prod
ON stock_ledger(location_id, product_id);

CREATE INDEX IF NOT EXISTS idx_stock_requests_status_time
ON stock_requests(status, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_invoices_salesman_created
ON invoices(salesman_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp
ON audit_log(timestamp DESC);
