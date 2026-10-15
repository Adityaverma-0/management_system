FROM node:24-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv tesseract-ocr tesseract-ocr-eng ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

COPY backend/invoice_extraction/requirements.txt ./invoice_extraction/requirements.txt
RUN python3 -m venv /opt/invoice-venv \
    && /opt/invoice-venv/bin/pip install --no-cache-dir -r invoice_extraction/requirements.txt

COPY backend/index.js backend/security.js backend/operations.js backend/billing.js backend/day-events.js backend/log-pagination.js backend/migrate.js ./
COPY backend/migrations/ ./migrations/
COPY backend/invoice_extraction/*.py ./invoice_extraction/
COPY backend/invoice_extraction/templates/ ./invoice_extraction/templates/
COPY schema.sql /app/schema.sql

# Resolve the complete startup import graph without connecting to a database.
RUN NODE_ENV=test node --input-type=module -e "const { pool } = await import('./index.js'); await pool.end();"

ENV NODE_ENV=production \
    PORT=10000 \
    INVOICE_PYTHON=/opt/invoice-venv/bin/python \
    TESSERACT_CMD=/usr/bin/tesseract \
    PYTHONDONTWRITEBYTECODE=1

USER node
EXPOSE 10000
CMD ["sh", "-c", "node migrate.js && exec node index.js"]
