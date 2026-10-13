# Initial inspection (before changes)

Two independent React/TypeScript/Vite applications (React 19 admin, React 18 salesman) share Express `backend/index.js`, routes in `operations.js`, security in `security.js`, and a PostgreSQL pg pool (max 15). Root and salesman `main.tsx` are separate entry points; each has its own login, build and Vercel rewrite. Existing passwords use scrypt, sessions are hashed in auth_sessions, and server middleware enforces roles. Keep legacy endpoints compatible.

Products, salesmen, vehicles and godowns feed work_days. Invoices own sale_items, stock_ledger tracks movement, accounting_ledger tracks collections/receivables, customers track balances, api_operations stores idempotent results, and audit_log preserves actions. Global app_settings CGST/SGST are tax-exclusive; product-specific GST, IGST, discounts and inclusive pricing are not implemented and will not be invented.

Sale flow: validate/lock day, load authoritative products, acquire ordered advisory stock locks, aggregate each product balance, calculate taxes, lock customer, insert invoice and per-item stock/accounting records, audit and commit. Transactions and retry keys already exist. Frontend then downloads the entire snapshot and sequentially rebuilds IndexedDB before printing. Admin audit/history stop at 200 rows with no pagination. Snapshot repeatedly filters all sale items for each invoice. Existing migration 005 already adds stock/location and salesman invoice indexes.

Target changes: shared login endpoint and same-origin deployment with salesman mounted at /salesman/ (preserves incompatible React runtimes and existing screens); exact final whole-rupee billing with stored adjustment; batch sale balance/item writes; indexed snapshot grouping and faster IndexedDB writes; cursor log pagination. Relevant files: security.js, operations.js, migrations/index.js, auth/login and routing, Vite/build/rewrite config, realApi.ts, invoice type/print, audit/history views and regression tests.

Risks: legacy invoices must retain their original totals; same-origin login needs both builds published together; old separate deployments retain legacy entry points until redirected by their operator. No production settings, secrets, accounts or data will be changed. Existing untracked performance-audit files belong to prior work and will be preserved. Live timings/query plans are not yet measured; source inspection identifies round trips, not real latency gains.

# Final implementation report

## A. Login and dashboard unification

Added `/api/v2/login`, accepting an admin username or salesman mobile plus the existing password. The server selects and authenticates the account; a submitted role is ignored. The existing role middleware, hashed opaque sessions, password hashes, account status checks, CORS, logout endpoint, and legacy login endpoints remain. Bearer tokens remain in the existing browser storage scheme; no cookie/CSRF architecture change was introduced.

The root login directs admin to `/` and salesman to `/salesman/`. One root build produces both apps in `dist/`. Separate React runtimes remain isolated to avoid an unrelated framework migration. Vite proxies the nested salesman app in development; Vercel rewrites support direct refresh in production. Both apps show a not-found message for unknown authenticated routes. Existing standalone salesman build remains available for rollout compatibility. Old deployment redirects require hosting-owner configuration; no production links were changed.

## B. Database optimization

Local query plans confirmed a stock-history scan/sort over 20,660 rows. Migration 007 adds `(location_id, timestamp DESC, id DESC)`; the resulting plan uses the index and reads only the requested page. Existing stock-balance and salesman-invoice indexes are preserved. The pre-existing duplicate location/product indexes remain untouched pending production catalog review.

Audit and location-history APIs now support bounded `limit` (1–200) and deterministic `before`/`beforeId` cursors, preserving the existing array response. All three log views offer older-record loading. No audit rows are deleted. Existing godown filtering still applies to loaded rows; comprehensive server-side search/date filters are not added.

Snapshot invoice-item mapping now uses a map rather than repeatedly scanning all items. IndexedDB queues each store's writes together. No new cache or infrastructure dependency was added. The existing pg pool, acquisition timeout, transaction release/rollback and pool size are unchanged because local measurements do not justify retuning them.

Migrations 006 and 007 were applied only to disposable local test schemas. Fresh schema initialization had an existing forward-reference error: stock_requests was declared before work_days. Only declaration order changed.

## C. Bill-generation optimization

`operations.js` now aggregates requested stock balances in one query and batches sale-item/stock-ledger inserts into two statements. Ordered stock advisory locks, row locks, ownership, validation, audit insertion, accounting updates, transaction rollback and persisted idempotency responses remain in force.

After committing a sale, the frontend navigates directly to an owner-scoped invoice endpoint. Printing no longer waits for an entire snapshot download and IndexedDB rebuild. The next stock/history view refreshes its data. Saved receipt totals come from the backend. The idempotency key remains available after ambiguous network failures; the existing synchronous submit guard prevents double-clicks.

Actual local benchmark: PostgreSQL on loopback; 20 products, 20,000 initial movements, 30 sequential measured requests per endpoint after three sale warmups. Auth middleware was excluded from both versions. No simulated WAN latency. These results cannot predict production performance.

| Endpoint | Before p50 / p95 / p99 (ms) | After p50 / p95 / p99 (ms) | SQL calls before → after |
|---|---:|---:|---:|
| 20-item cash bill | 7.72 / 14.14 / 16.38 | 6.77 / 7.17 / 7.19 | 92 → 35 |
| Inventory logs | 7.08 / 7.54 / 7.84 | 0.71 / 1.05 / 3.60 | 1 → 1 |
| Salesman snapshot | 32.43 / 40.26 / 44.20 | 31.11 / 43.08 / 54.34 | 13 → 13 |

Inventory-log database execution in EXPLAIN ANALYZE: 8.063 → 0.142 ms. Log payload remained 54,021 bytes. Snapshot payload remained approximately 3.10 MB. Bill response grew from 83 to 213 bytes because it now returns authoritative monetary components. Snapshot tail latency did not improve; no dashboard speedup is claimed. Thirty samples are insufficient for robust production p99 estimates. Full results and plans are in `PERFORMANCE-RESULTS.json`; reproducible loopback-only harness is `backend/tests/performance.mjs` (baseline comes from Git HEAD).

## D. Billing and round-off fix

`billing.js` uses BigInt arithmetic for configured percentage taxes and half-up whole-rupee rounding. Prices and quantities remain integer paise/pieces. Existing global tax-exclusive CGST and SGST are preserved; IGST, product-specific tax, inclusive prices and discounts are not existing features and were not introduced.

The backend rounds only the combined payable amount: `(unroundedPaise + 50) / 100`, integer division, then multiply by 100. `round_off_paise` stores payable minus unrounded total. Historical invoices default to zero adjustment and retain their previously charged amounts. New totals drive invoices, accounting, customer credit balance, cancellation reversals, work-day collections and admin reports. The receipt displays whole rupees and a separate adjustment; historical decimal bills retain decimals. Aggregated report formatting still displays `.00`, with no change to the charged value.

All requested examples passed: 125.35→125, 125.49→125, 125.50→126, 125.99→126, 250.60→251, 499.80→500. Product/tax preview consistency checks remain; optional component comparisons prevent small price changes from being hidden by final rounding. Legacy unrounded request totals remain accepted only when they equal the authoritative unrounded calculation.

## E. Important files changed

- `backend/security.js`: shared authentication endpoint, existing endpoints retained.
- `src/features/auth/{Login,AuthContext}.tsx`, both `App.tsx` files: shared entry and role routing/session restoration.
- `package.json`, both Vite configurations, `vercel.json`, `scripts/copy-salesman.mjs`: single deployable build and nested route hosting.
- `backend/billing.js`, `operations.js`: exact billing, batched queries, owner-scoped receipt retrieval, efficient item grouping.
- `backend/log-pagination.js`, admin log pages and `OlderLogs.tsx`: bounded seek pagination.
- `backend/migrations/006_bill_round_off.sql`, `007_log_pagination_index.sql`, `index.js`: additive schema and index registration.
- `backend/Dockerfile`: include new backend modules in the existing image.
- `schema.sql`: dependency-safe table declaration order only.
- Salesman `realApi.ts`, invoice types, money formatting, SaleEntry and InvoicePrint: direct receipt loading, payable preview/display and adjustment.
- Backend billing/integration/benchmark/browser harnesses: local verification; legacy integration fixtures updated to the stock-adjustment and approval APIs already present in the application.
- `README.md`: unified local/deployment instructions.

The existing untracked `performance-audit/` directory was not modified. No production credentials, accounts, settings or business records were edited.

## F. Testing

- Root frontend: 13 tests passed.
- Salesman frontend: 22 tests passed.
- Backend with explicit local TEST_DATABASE_URL and RUN_ISOLATED_DB_TESTS=1: 15 tests passed, none skipped.
- Combined production build: passed for both apps.
- `git diff --check`: passed.
- Database tests cover shared and legacy logins, invalid/expired sessions, role spoofing and restricted APIs, logout, invoice ownership, all rounding boundaries, fractional GST, multiple products, credit limit and balance/reversal, invalid quantities, insufficient stock, concurrent sales, persisted retries, forced audit failure rollback, inventory import, stock approvals, cancellation, unload approval, closing/reopening work days, receipt persistence, report/accounting totals and cursor pagination.
- Local browser: admin and salesman shared login, both session refreshes, nested navigation, unknown route, logout, one-product cash sale, printable receipt refresh and collection total verified. A ₹125.35 test product yielded ₹125 with −₹0.35 adjustment; screenshot: `billing-verification.png`. No physical printer was used.
- Lint does not pass: 5 pre-existing errors (unused initial assignment/arguments in operations.js; unused catch variables in ManualStockPage.tsx and TaxSettings.tsx), plus warnings. Unrelated cleanup was intentionally excluded.

## G. Deployment instructions

Completed locally only. Nothing deployed to staging or production.

1. Install dependencies from repository root:
   ```sh
   npm ci
   npm --prefix backend ci
   npm --prefix salesman-dashboard ci
   ```
2. Back up the existing database and validate this build on staging. Migration 006 takes a table schema lock; migration 007 builds an index and can block writes when run inside the existing startup transaction. For a large production ledger, prebuild the exact index outside a transaction during an approved rollout:
   ```sh
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c 'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stock_ledger_location_history ON stock_ledger(location_id, timestamp DESC, id DESC)'
   ```
   Check that this index is valid before continuing (a failed concurrent build can leave an invalid index). Do not run this automatically against production.
3. With the approved target database environment configured, apply additive migrations:
   ```sh
   npm --prefix backend run migrate
   ```
   Existing Render Docker configuration uses repository-root context and `backend/Dockerfile`; it also runs migration at startup. Deploy the backend before the new frontend so the new login/receipt endpoints and round-off column exist. Keep one migrating instance, as documented in the existing deployment setup.
4. Set the existing production API URL as `VITE_API_BASE_URL` for the root Vercel project. The root `vercel.json` installs both dependency sets. Build command `npm run build`, output directory `dist`. Both frontend builds inherit that API URL. Keep existing backend credentials; ensure the unified origin is included in the approved CORS configuration.
5. Verify login for each role, receipt refresh, API access denial, collections and logs on staging before production promotion. Keep the previous build and the additive columns/index when rolling back application code; never reverse historical charged amounts.
6. Local development: `npm run dev:all`, then visit `http://localhost:5174/login`. Legacy salesman-host redirects are an operator-managed final rollout step; origin-bound sessions cannot be carried across domains.

## H. Remaining limitations

Full salesman snapshots still load historical work days, stock movements, invoices and customer records. Their 3.10 MB synthetic payload and unchanged query count remain the primary dashboard scalability concern. Changing to incremental/history APIs requires a wider cache/reporting contract change and was not silently introduced. Admin sales reports still return the selected period's complete invoice list. Existing duplicate indexes and production connection capacity require live catalog/workload review.

Production query plans, WAN/mobile timings, cold starts, CPU/memory profiles and representative concurrent load have not been measured. No production migration or actual Vercel/Render deployment was exercised. Existing token storage and cross-tab session behavior retain their architectural limitations. Browser checks used a local static SPA fallback equivalent to the configured routes, not the hosted Vercel service. Broader business behavior was preserved rather than rewritten to meet unmeasured infrastructure assumptions.
