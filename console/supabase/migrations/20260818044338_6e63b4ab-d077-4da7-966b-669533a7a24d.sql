-- 1. Registered appliances
CREATE TABLE public.collectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  os text NOT NULL DEFAULT 'linux',
  version text,
  hostname text,
  status text NOT NULL DEFAULT 'pending',
  last_seen_at timestamptz,
  last_error text,
  token_hash text NOT NULL,
  dataset_id uuid REFERENCES public.datasets(id) ON DELETE SET NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  config_revision integer NOT NULL DEFAULT 1,
  applied_revision integer NOT NULL DEFAULT 0,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.collectors TO authenticated;
GRANT ALL ON public.collectors TO service_role;
ALTER TABLE public.collectors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own collectors" ON public.collectors FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER update_collectors_updated_at BEFORE UPDATE ON public.collectors
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX collectors_user_idx ON public.collectors (user_id, created_at DESC);
CREATE UNIQUE INDEX collectors_token_idx ON public.collectors (token_hash);

-- 2. Interfaces reported by an appliance
CREATE TABLE public.collector_interfaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collector_id uuid NOT NULL REFERENCES public.collectors(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  mac text,
  addresses jsonb NOT NULL DEFAULT '[]'::jsonb,
  link_speed_bps bigint,
  is_up boolean NOT NULL DEFAULT true,
  is_loopback boolean NOT NULL DEFAULT false,
  capture_enabled boolean NOT NULL DEFAULT false,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (collector_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.collector_interfaces TO authenticated;
GRANT ALL ON public.collector_interfaces TO service_role;
ALTER TABLE public.collector_interfaces ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own collector interfaces" ON public.collector_interfaces FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 3. Interface utilization buckets
CREATE TABLE public.interface_metrics (
  id bigserial PRIMARY KEY,
  collector_id uuid NOT NULL REFERENCES public.collectors(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  interface_name text NOT NULL,
  bucket_ts timestamptz NOT NULL,
  rx_bytes bigint NOT NULL DEFAULT 0,
  tx_bytes bigint NOT NULL DEFAULT 0,
  rx_packets bigint NOT NULL DEFAULT 0,
  tx_packets bigint NOT NULL DEFAULT 0,
  errors bigint NOT NULL DEFAULT 0,
  discards bigint NOT NULL DEFAULT 0,
  utilization_pct double precision,
  source text NOT NULL DEFAULT 'host',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (collector_id, interface_name, bucket_ts)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.interface_metrics TO authenticated;
GRANT ALL ON public.interface_metrics TO service_role;
ALTER TABLE public.interface_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own interface metrics" ON public.interface_metrics FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX interface_metrics_lookup_idx
  ON public.interface_metrics (collector_id, interface_name, bucket_ts DESC);

-- 4. Flow exporters observed by the receivers
CREATE TABLE public.flow_exporters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collector_id uuid NOT NULL REFERENCES public.collectors(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  exporter_ip text NOT NULL,
  protocol text NOT NULL DEFAULT 'netflow',
  version text,
  templates integer NOT NULL DEFAULT 0,
  sampling_rate integer,
  flows bigint NOT NULL DEFAULT 0,
  packets_dropped bigint NOT NULL DEFAULT 0,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (collector_id, exporter_ip, protocol)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.flow_exporters TO authenticated;
GRANT ALL ON public.flow_exporters TO service_role;
ALTER TABLE public.flow_exporters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own flow exporters" ON public.flow_exporters FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 5. ICMP / SNMP / WMI monitoring samples
CREATE TABLE public.probe_results (
  id bigserial PRIMARY KEY,
  collector_id uuid NOT NULL REFERENCES public.collectors(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  kind text NOT NULL,
  target text NOT NULL,
  metric text NOT NULL,
  value double precision,
  value_text text,
  unit text,
  status text NOT NULL DEFAULT 'ok',
  ts timestamptz NOT NULL DEFAULT now(),
  extra jsonb NOT NULL DEFAULT '{}'::jsonb
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.probe_results TO authenticated;
GRANT ALL ON public.probe_results TO service_role;
ALTER TABLE public.probe_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own probe results" ON public.probe_results FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX probe_results_lookup_idx
  ON public.probe_results (collector_id, kind, target, ts DESC);

-- 6. Read-only device configuration facts
CREATE TABLE public.device_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collector_id uuid NOT NULL REFERENCES public.collectors(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  host text NOT NULL,
  source text NOT NULL DEFAULT 'snmp',
  kind text NOT NULL DEFAULT 'system',
  summary text,
  content text NOT NULL DEFAULT '',
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  collected_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (collector_id, host, source, kind)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.device_facts TO authenticated;
GRANT ALL ON public.device_facts TO service_role;
ALTER TABLE public.device_facts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own device facts" ON public.device_facts FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 7. Appliance activity log
CREATE TABLE public.collector_events (
  id bigserial PRIMARY KEY,
  collector_id uuid NOT NULL REFERENCES public.collectors(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  level text NOT NULL DEFAULT 'info',
  kind text NOT NULL,
  message text NOT NULL,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.collector_events TO authenticated;
GRANT ALL ON public.collector_events TO service_role;
ALTER TABLE public.collector_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own collector events" ON public.collector_events FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX collector_events_lookup_idx ON public.collector_events (collector_id, created_at DESC);