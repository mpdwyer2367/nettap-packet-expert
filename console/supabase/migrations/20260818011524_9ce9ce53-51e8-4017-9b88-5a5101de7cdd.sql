ALTER TABLE public.packet_records
  ADD COLUMN IF NOT EXISTS app_protocol text,
  ADD COLUMN IF NOT EXISTS service text,
  ADD COLUMN IF NOT EXISTS risk_tags text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS decryption text NOT NULL DEFAULT 'cleartext';

ALTER TABLE public.flow_records
  ADD COLUMN IF NOT EXISTS app_protocol text,
  ADD COLUMN IF NOT EXISTS service text,
  ADD COLUMN IF NOT EXISTS risk_tags text[] NOT NULL DEFAULT '{}'::text[];

CREATE INDEX IF NOT EXISTS packet_records_dataset_app_protocol_idx
  ON public.packet_records (dataset_id, app_protocol);
CREATE INDEX IF NOT EXISTS packet_records_dataset_service_idx
  ON public.packet_records (dataset_id, service);
CREATE INDEX IF NOT EXISTS packet_records_risk_tags_idx
  ON public.packet_records USING gin (risk_tags);
CREATE INDEX IF NOT EXISTS flow_records_dataset_service_idx
  ON public.flow_records (dataset_id, service);

ALTER TABLE public.datasets
  ADD COLUMN IF NOT EXISTS decryption_summary jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'investigation',
  ADD COLUMN IF NOT EXISTS playbook text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ready';

CREATE UNIQUE INDEX IF NOT EXISTS reports_living_investigation_idx
  ON public.reports (investigation_id)
  WHERE source = 'living';