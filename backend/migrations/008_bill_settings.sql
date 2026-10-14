CREATE TABLE IF NOT EXISTS app_settings (
    id VARCHAR(50) PRIMARY KEY,
    data JSONB NOT NULL DEFAULT {}::jsonb
);

INSERT INTO app_settings (id, data)
VALUES ('bill', '{"businessName": "FMCG Van Sales", "gstin": ""}'::jsonb)
ON CONFLICT (id) DO NOTHING;
