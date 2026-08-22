-- Widen dataset kinds and add per-source telemetry tables

CREATE TABLE public.packet_records (
  id BIGSERIAL PRIMARY KEY,
  dataset_id UUID NOT NULL REFERENCES public.datasets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  frame_number INTEGER,
  ts TIMESTAMP WITH TIME ZONE,
  src_ip TEXT,
  dst_ip TEXT,
  src_port INTEGER,
  dst_port INTEGER,
  protocol TEXT,
  length INTEGER NOT NULL DEFAULT 0,
  tcp_flags TEXT,
  info TEXT,
  extra JSONB NOT NULL DEFAULT '{}'::jsonb
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.packet_records TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.packet_records_id_seq TO authenticated;
GRANT ALL ON public.packet_records TO service_role;
GRANT ALL ON SEQUENCE public.packet_records_id_seq TO service_role;
ALTER TABLE public.packet_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own packet records" ON public.packet_records FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX packet_records_dataset_idx ON public.packet_records (dataset_id, ts);

CREATE TABLE public.snmp_records (
  id BIGSERIAL PRIMARY KEY,
  dataset_id UUID NOT NULL REFERENCES public.datasets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  ts TIMESTAMP WITH TIME ZONE,
  host TEXT,
  interface_name TEXT,
  oid TEXT,
  metric TEXT NOT NULL,
  value DOUBLE PRECISION,
  value_text TEXT,
  extra JSONB NOT NULL DEFAULT '{}'::jsonb
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.snmp_records TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.snmp_records_id_seq TO authenticated;
GRANT ALL ON public.snmp_records TO service_role;
GRANT ALL ON SEQUENCE public.snmp_records_id_seq TO service_role;
ALTER TABLE public.snmp_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own snmp records" ON public.snmp_records FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX snmp_records_dataset_idx ON public.snmp_records (dataset_id, ts);

CREATE TABLE public.wmi_records (
  id BIGSERIAL PRIMARY KEY,
  dataset_id UUID NOT NULL REFERENCES public.datasets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  ts TIMESTAMP WITH TIME ZONE,
  host TEXT,
  wmi_class TEXT,
  event_id TEXT,
  level TEXT,
  message TEXT NOT NULL,
  extra JSONB NOT NULL DEFAULT '{}'::jsonb
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wmi_records TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.wmi_records_id_seq TO authenticated;
GRANT ALL ON public.wmi_records TO service_role;
GRANT ALL ON SEQUENCE public.wmi_records_id_seq TO service_role;
ALTER TABLE public.wmi_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own wmi records" ON public.wmi_records FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX wmi_records_dataset_idx ON public.wmi_records (dataset_id, ts);

CREATE TABLE public.broker_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  auth_style TEXT NOT NULL DEFAULT 'bearer',
  auth_header TEXT,
  secret_name TEXT,
  resources JSONB NOT NULL DEFAULT '[]'::jsonb,
  fetch_mode TEXT NOT NULL DEFAULT 'server',
  last_synced_at TIMESTAMP WITH TIME ZONE,
  last_status TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.broker_sources TO authenticated;
GRANT ALL ON public.broker_sources TO service_role;
ALTER TABLE public.broker_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own broker sources" ON public.broker_sources FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  investigation_id UUID REFERENCES public.investigations(id) ON DELETE CASCADE,
  dataset_id UUID REFERENCES public.datasets(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT 'Investigation report',
  markdown TEXT NOT NULL DEFAULT '',
  visuals JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reports TO authenticated;
GRANT ALL ON public.reports TO service_role;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own reports" ON public.reports FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_broker_sources_updated_at BEFORE UPDATE ON public.broker_sources
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_reports_updated_at BEFORE UPDATE ON public.reports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();