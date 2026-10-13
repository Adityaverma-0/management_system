-- Database Schema for Admin & Salesman Dashboard
-- Note: Designed for PostgreSQL.
-- Using BIGINT for paise/monetary amounts to prevent overflow.

-- ENUMS
CREATE TYPE day_state AS ENUM ('NOT_STARTED', 'LOADING', 'ON_ROUTE', 'UNLOAD_REQUESTED', 'SENT_BACK', 'APPROVED', 'CLOSED');
CREATE TYPE payment_mode AS ENUM ('CASH', 'UPI', 'CREDIT');
CREATE TYPE invoice_status AS ENUM ('VALID', 'VOID');
CREATE TYPE ledger_entry_type AS ENUM ('LOAD_OUT', 'LOAD_IN', 'SALE', 'SALE_CANCEL', 'UNLOAD_OUT', 'UNLOAD_IN', 'HOLD_CARRY_FORWARD', 'ADJ_PLUS', 'ADJ_MINUS');
CREATE TYPE accounting_entry_type AS ENUM ('SALES_CASH', 'SALES_UPI', 'SALES_CREDIT', 'CUSTOMER_RECEIVABLE', 'REVERSAL_CASH', 'REVERSAL_UPI', 'REVERSAL_CREDIT', 'REVERSAL_RECEIVABLE');

-- MASTER DATA

CREATE TABLE godowns (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    location_name VARCHAR(255),
    active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE vehicles (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    plate VARCHAR(100),
    godown_id VARCHAR(50) REFERENCES godowns(id),
    active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE salesmen (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    password_hash VARCHAR(255),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    vehicle_id VARCHAR(50) REFERENCES vehicles(id),
    location_name VARCHAR(255),
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
);

CREATE TABLE products (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    price_paise BIGINT NOT NULL DEFAULT 0,
    units_per_strip INTEGER NOT NULL DEFAULT 1,
    strips_per_box INTEGER NOT NULL DEFAULT 1,
    pieces_per_box INTEGER NOT NULL DEFAULT 1,
    active BOOLEAN DEFAULT TRUE,
    sku VARCHAR(100),
    barcode VARCHAR(100),
    hsn VARCHAR(20),
    uom VARCHAR(30)
);

CREATE TABLE customers (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    mobile VARCHAR(20),
    shop_name VARCHAR(255),
    area VARCHAR(255),
    credit_limit_paise BIGINT,
    outstanding_balance_paise BIGINT DEFAULT 0,
    last_sold_timestamp BIGINT
);

-- DAILY OPERATIONS & WORKFLOW

CREATE TABLE work_days (
    work_day_id VARCHAR(50) PRIMARY KEY,
    calendar_date DATE NOT NULL,
    state day_state NOT NULL DEFAULT 'NOT_STARTED',
    salesman_id VARCHAR(50) REFERENCES salesmen(id),
    vehicle_id VARCHAR(50) REFERENCES vehicles(id),
    godown_id VARCHAR(50) REFERENCES godowns(id),
    route_id VARCHAR(50),
    opened_at BIGINT,
    route_started_at BIGINT,
    closed_at BIGINT,
    cash_collected_paise BIGINT DEFAULT 0,
    admin_note TEXT,
    invoice_counter INTEGER DEFAULT 0,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    request_data JSONB,
    requested_at BIGINT
);

-- STOCK REQUESTS (for approval workflow)
CREATE TABLE IF NOT EXISTS stock_requests (
    id VARCHAR(50) PRIMARY KEY,
    work_day_id VARCHAR(50) REFERENCES work_days(work_day_id),
    salesman_id VARCHAR(50) REFERENCES salesmen(id),
    vehicle_id VARCHAR(50) REFERENCES vehicles(id),
    godown_id VARCHAR(50) REFERENCES godowns(id),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    items JSONB NOT NULL,
    requested_at BIGINT NOT NULL,
    processed_at BIGINT,
    admin_note TEXT
);

CREATE INDEX IF NOT EXISTS idx_stock_requests_status ON stock_requests(status);
CREATE INDEX IF NOT EXISTS idx_stock_requests_salesman ON stock_requests(salesman_id);
CREATE INDEX IF NOT EXISTS idx_stock_requests_workday ON stock_requests(work_day_id);

-- INVOICES & SALES

CREATE TABLE invoices (
    id VARCHAR(50) PRIMARY KEY,
    invoice_number VARCHAR(100) UNIQUE NOT NULL,
    created_at BIGINT,
    calendar_date DATE,
    work_day_id VARCHAR(50) REFERENCES work_days(work_day_id),
    salesman_id VARCHAR(50) REFERENCES salesmen(id),
    vehicle_id VARCHAR(50) REFERENCES vehicles(id),
    outlet_id VARCHAR(50),
    customer_id VARCHAR(50) REFERENCES customers(id),
    customer_name VARCHAR(255),
    total_amount_paise BIGINT NOT NULL,
    payment_mode payment_mode NOT NULL,
    payment_ref VARCHAR(255),
    previous_balance_paise BIGINT,
    new_balance_paise BIGINT,
    status invoice_status DEFAULT 'VALID'
);

CREATE TABLE sale_items (
    id SERIAL PRIMARY KEY,
    invoice_id VARCHAR(50) REFERENCES invoices(id) ON DELETE CASCADE,
    product_id VARCHAR(50) REFERENCES products(id),
    quantity_pieces INTEGER NOT NULL,
    line_total_paise BIGINT NOT NULL,
    product_snapshot JSONB
);

-- IMMUTABLE LEDGERS (Inventories and Financials)

CREATE TABLE stock_ledger (
    id VARCHAR(50) PRIMARY KEY,
    timestamp BIGINT NOT NULL,
    type ledger_entry_type NOT NULL,
    product_id VARCHAR(50) REFERENCES products(id),
    quantity_pieces INTEGER NOT NULL,
    location_id VARCHAR(50) NOT NULL, -- Refers to either godowns.id or vehicles.id depending on context
    reference_id VARCHAR(100),
    work_day_id VARCHAR(50),
    reason VARCHAR(100),
    note TEXT
);

CREATE TABLE accounting_ledger (
    id VARCHAR(50) PRIMARY KEY,
    timestamp BIGINT NOT NULL,
    type accounting_entry_type NOT NULL,
    amount_paise BIGINT NOT NULL,
    customer_id VARCHAR(50) REFERENCES customers(id),
    invoice_id VARCHAR(50) REFERENCES invoices(id),
    work_day_id VARCHAR(50) REFERENCES work_days(work_day_id)
);

-- PURCHASES (Godown Receipt)
CREATE TABLE purchases (
    id VARCHAR(50) PRIMARY KEY,
    timestamp BIGINT NOT NULL,
    invoice_ref VARCHAR(255) UNIQUE NOT NULL,
    godown_id VARCHAR(50) REFERENCES godowns(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE purchase_lines (
    id SERIAL PRIMARY KEY,
    purchase_id VARCHAR(50) REFERENCES purchases(id) ON DELETE CASCADE,
    product_id VARCHAR(50) REFERENCES products(id),
    quantity_pieces INTEGER NOT NULL
);

-- AUDIT TRAIL
CREATE TABLE audit_log (
    id VARCHAR(50) PRIMARY KEY,
    timestamp BIGINT NOT NULL,
    action VARCHAR(255) NOT NULL,
    entity VARCHAR(255),
    details JSONB
);

-- Indexes for performance
CREATE INDEX idx_stock_ledger_location_product ON stock_ledger(location_id, product_id);
CREATE INDEX idx_accounting_customer ON accounting_ledger(customer_id);
CREATE INDEX idx_work_days_state ON work_days(state);
CREATE INDEX idx_invoices_workday ON invoices(work_day_id);

-- INVENTORY IMPORTS (Independent of Purchase Receipt)
CREATE TABLE inventory_imports (
    id VARCHAR(50) PRIMARY KEY,
    timestamp BIGINT NOT NULL,
    import_ref VARCHAR(255) UNIQUE NOT NULL,
    supplier_name VARCHAR(255),
    godown_id VARCHAR(50) REFERENCES godowns(id),
    invoice_date DATE,
    supplier_gstin VARCHAR(15),
    reviewed_lines JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE UNIQUE INDEX inventory_imports_normalized_ref_key
ON inventory_imports (lower(regexp_replace(btrim(import_ref), '\s+', '', 'g')));
