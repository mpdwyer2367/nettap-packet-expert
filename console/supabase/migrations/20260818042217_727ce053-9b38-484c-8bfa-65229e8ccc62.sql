-- roles
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin','moderator','user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- datasets retention flags
ALTER TABLE public.datasets
  ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS retention_tier text NOT NULL DEFAULT 'raw';

-- settings
CREATE TABLE IF NOT EXISTS public.retention_settings (
  user_id uuid PRIMARY KEY,
  raw_hours integer NOT NULL DEFAULT 24,
  metadata_days integer NOT NULL DEFAULT 7,
  summary_days integer NOT NULL DEFAULT 90,
  chunk_cap integer NOT NULL DEFAULT 2000,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.retention_settings TO authenticated;
GRANT ALL ON public.retention_settings TO service_role;
ALTER TABLE public.retention_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own retention settings" ON public.retention_settings FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER update_retention_settings_updated_at BEFORE UPDATE ON public.retention_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- tier 1 rollups
CREATE TABLE IF NOT EXISTS public.flow_rollups (
  id bigserial PRIMARY KEY,
  dataset_id uuid NOT NULL REFERENCES public.datasets(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  bucket_ts timestamptz NOT NULL,
  src_ip text,
  dst_ip text,
  src_port integer,
  dst_port integer,
  protocol text,
  app_protocol text,
  service text,
  vantage text,
  packets bigint NOT NULL DEFAULT 0,
  bytes bigint NOT NULL DEFAULT 0,
  flow_count integer NOT NULL DEFAULT 0,
  tcp_flag_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  risk_tags text[] NOT NULL DEFAULT '{}'::text[],
  rolled_up boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dataset_id, bucket_ts, src_ip, dst_ip, src_port, dst_port, protocol)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.flow_rollups TO authenticated;
GRANT ALL ON public.flow_rollups TO service_role;
ALTER TABLE public.flow_rollups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own flow rollups" ON public.flow_rollups FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS flow_rollups_dataset_bucket_idx ON public.flow_rollups (dataset_id, bucket_ts DESC);

-- tier 2 summaries
CREATE TABLE IF NOT EXISTS public.retention_summaries (
  id bigserial PRIMARY KEY,
  dataset_id uuid NOT NULL REFERENCES public.datasets(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  hour_ts timestamptz NOT NULL,
  packets bigint NOT NULL DEFAULT 0,
  bytes bigint NOT NULL DEFAULT 0,
  flow_count bigint NOT NULL DEFAULT 0,
  top_talkers jsonb NOT NULL DEFAULT '[]'::jsonb,
  top_services jsonb NOT NULL DEFAULT '[]'::jsonb,
  protocol_mix jsonb NOT NULL DEFAULT '[]'::jsonb,
  risk_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dataset_id, hour_ts)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.retention_summaries TO authenticated;
GRANT ALL ON public.retention_summaries TO service_role;
ALTER TABLE public.retention_summaries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own retention summaries" ON public.retention_summaries FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS retention_summaries_dataset_hour_idx ON public.retention_summaries (dataset_id, hour_ts DESC);

-- run history
CREATE TABLE IF NOT EXISTS public.retention_runs (
  id bigserial PRIMARY KEY,
  user_id uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms integer,
  rows_rolled bigint NOT NULL DEFAULT 0,
  rows_deleted bigint NOT NULL DEFAULT 0,
  chunks_deleted bigint NOT NULL DEFAULT 0,
  summaries_written bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'ok',
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text
);
GRANT SELECT ON public.retention_runs TO authenticated;
GRANT ALL ON public.retention_runs TO service_role;
ALTER TABLE public.retention_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own retention runs" ON public.retention_runs FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE INDEX IF NOT EXISTS retention_runs_started_idx ON public.retention_runs (started_at DESC);

-- purge/rollup helper indexes
CREATE INDEX IF NOT EXISTS packet_records_dataset_ts_idx ON public.packet_records (dataset_id, ts);
CREATE INDEX IF NOT EXISTS flow_records_dataset_ts_idx ON public.flow_records (dataset_id, ts);
CREATE INDEX IF NOT EXISTS log_records_dataset_ts_idx ON public.log_records (dataset_id, ts);

-- retention engine
CREATE OR REPLACE FUNCTION public.run_retention(p_user uuid DEFAULT NULL)
RETURNS TABLE(rows_rolled bigint, rows_deleted bigint, chunks_deleted bigint, summaries_written bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d record;
  s record;
  raw_cutoff timestamptz;
  meta_cutoff timestamptz;
  sum_cutoff timestamptz;
  v_rolled bigint := 0;
  v_deleted bigint := 0;
  v_chunks bigint := 0;
  v_sum bigint := 0;
  n bigint;
  t0 timestamptz := clock_timestamp();
  run_id bigint;
BEGIN
  INSERT INTO public.retention_runs (user_id) VALUES (p_user) RETURNING id INTO run_id;

  FOR d IN SELECT id, user_id, vantage, pinned FROM public.datasets
           WHERE pinned = false AND (p_user IS NULL OR user_id = p_user)
  LOOP
    SELECT COALESCE(rs.raw_hours,24) AS raw_hours, COALESCE(rs.metadata_days,7) AS metadata_days,
           COALESCE(rs.summary_days,90) AS summary_days, COALESCE(rs.chunk_cap,2000) AS chunk_cap,
           COALESCE(rs.enabled,true) AS enabled
      INTO s
      FROM (SELECT 1) x LEFT JOIN public.retention_settings rs ON rs.user_id = d.user_id;
    IF NOT s.enabled THEN CONTINUE; END IF;

    raw_cutoff := now() - make_interval(hours => s.raw_hours);
    meta_cutoff := now() - make_interval(days => s.metadata_days);
    sum_cutoff := now() - make_interval(days => s.summary_days);

    -- 1. roll raw packets into minute rollups
    INSERT INTO public.flow_rollups AS fr
      (dataset_id, user_id, bucket_ts, src_ip, dst_ip, src_port, dst_port, protocol,
       app_protocol, service, vantage, packets, bytes, flow_count, risk_tags)
    SELECT p.dataset_id, p.user_id, date_trunc('minute', p.ts), p.src_ip, p.dst_ip, p.src_port, p.dst_port,
           p.protocol, min(p.app_protocol), min(p.service), d.vantage,
           count(*), COALESCE(sum(p.length),0), count(DISTINCT COALESCE(p.src_port,0)::text || '-' || COALESCE(p.dst_port,0)::text),
           COALESCE((SELECT array_agg(DISTINCT tag) FROM unnest(array_agg(p.risk_tags)) AS a(arr), unnest(a.arr) AS tag), '{}'::text[])
    FROM public.packet_records p
    WHERE p.dataset_id = d.id AND p.ts IS NOT NULL AND p.ts < raw_cutoff
    GROUP BY p.dataset_id, p.user_id, date_trunc('minute', p.ts), p.src_ip, p.dst_ip, p.src_port, p.dst_port, p.protocol
    ON CONFLICT (dataset_id, bucket_ts, src_ip, dst_ip, src_port, dst_port, protocol) DO UPDATE
      SET packets = fr.packets + EXCLUDED.packets,
          bytes = fr.bytes + EXCLUDED.bytes,
          flow_count = fr.flow_count + EXCLUDED.flow_count,
          risk_tags = (SELECT COALESCE(array_agg(DISTINCT t), '{}'::text[])
                       FROM unnest(fr.risk_tags || EXCLUDED.risk_tags) t);
    GET DIAGNOSTICS n = ROW_COUNT; v_rolled := v_rolled + n;

    DELETE FROM public.packet_records p WHERE p.dataset_id = d.id AND p.ts IS NOT NULL AND p.ts < raw_cutoff;
    GET DIAGNOSTICS n = ROW_COUNT; v_deleted := v_deleted + n;

    -- 2. summarise rollups that are about to expire (and recent hours)
    INSERT INTO public.retention_summaries AS rsm
      (dataset_id, user_id, hour_ts, packets, bytes, flow_count, top_talkers, top_services, protocol_mix, risk_counts)
    SELECT d.id, d.user_id, date_trunc('hour', bucket_ts), sum(packets), sum(bytes), sum(flow_count),
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('ip', ip, 'bytes', b) ORDER BY b DESC), '[]'::jsonb) FROM (
          SELECT src_ip AS ip, sum(bytes) b FROM public.flow_rollups f2
          WHERE f2.dataset_id = d.id AND date_trunc('hour', f2.bucket_ts) = date_trunc('hour', f.bucket_ts)
          GROUP BY 1 ORDER BY b DESC LIMIT 10) tt),
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('service', svc, 'bytes', b) ORDER BY b DESC), '[]'::jsonb) FROM (
          SELECT COALESCE(service, app_protocol, protocol, 'unknown') AS svc, sum(bytes) b FROM public.flow_rollups f3
          WHERE f3.dataset_id = d.id AND date_trunc('hour', f3.bucket_ts) = date_trunc('hour', f.bucket_ts)
          GROUP BY 1 ORDER BY b DESC LIMIT 10) ts2),
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('protocol', pr, 'packets', pk) ORDER BY pk DESC), '[]'::jsonb) FROM (
          SELECT COALESCE(protocol,'unknown') AS pr, sum(packets) pk FROM public.flow_rollups f4
          WHERE f4.dataset_id = d.id AND date_trunc('hour', f4.bucket_ts) = date_trunc('hour', f.bucket_ts)
          GROUP BY 1 ORDER BY pk DESC LIMIT 10) pm),
      (SELECT COALESCE(jsonb_object_agg(tag, c), '{}'::jsonb) FROM (
          SELECT tag, count(*) c FROM public.flow_rollups f5, unnest(f5.risk_tags) tag
          WHERE f5.dataset_id = d.id AND date_trunc('hour', f5.bucket_ts) = date_trunc('hour', f.bucket_ts)
          GROUP BY 1) rc)
    FROM public.flow_rollups f
    WHERE f.dataset_id = d.id
    GROUP BY date_trunc('hour', f.bucket_ts), f.bucket_ts
    ON CONFLICT (dataset_id, hour_ts) DO UPDATE
      SET packets = EXCLUDED.packets, bytes = EXCLUDED.bytes, flow_count = EXCLUDED.flow_count,
          top_talkers = EXCLUDED.top_talkers, top_services = EXCLUDED.top_services,
          protocol_mix = EXCLUDED.protocol_mix, risk_counts = EXCLUDED.risk_counts;
    GET DIAGNOSTICS n = ROW_COUNT; v_sum := v_sum + n;

    -- 3. purge tier-1 metadata past the retention window
    DELETE FROM public.flow_rollups WHERE dataset_id = d.id AND bucket_ts < meta_cutoff;
    GET DIAGNOSTICS n = ROW_COUNT; v_deleted := v_deleted + n;
    DELETE FROM public.flow_records WHERE dataset_id = d.id AND ts IS NOT NULL AND ts < meta_cutoff;
    GET DIAGNOSTICS n = ROW_COUNT; v_deleted := v_deleted + n;
    DELETE FROM public.log_records WHERE dataset_id = d.id AND ts IS NOT NULL AND ts < meta_cutoff;
    GET DIAGNOSTICS n = ROW_COUNT; v_deleted := v_deleted + n;
    DELETE FROM public.snmp_records WHERE dataset_id = d.id AND ts IS NOT NULL AND ts < meta_cutoff;
    GET DIAGNOSTICS n = ROW_COUNT; v_deleted := v_deleted + n;
    DELETE FROM public.wmi_records WHERE dataset_id = d.id AND ts IS NOT NULL AND ts < meta_cutoff;
    GET DIAGNOSTICS n = ROW_COUNT; v_deleted := v_deleted + n;

    -- 4. purge tier-2 summaries past the summary window
    DELETE FROM public.retention_summaries WHERE dataset_id = d.id AND hour_ts < sum_cutoff;
    GET DIAGNOSTICS n = ROW_COUNT; v_deleted := v_deleted + n;

    -- 5. trim embedded chunks over the per-dataset cap
    DELETE FROM public.telemetry_chunks tc
    WHERE tc.dataset_id = d.id AND tc.id IN (
      SELECT id FROM public.telemetry_chunks WHERE dataset_id = d.id
      ORDER BY created_at DESC OFFSET s.chunk_cap);
    GET DIAGNOSTICS n = ROW_COUNT; v_chunks := v_chunks + n;

    UPDATE public.datasets SET retention_tier = CASE
        WHEN EXISTS (SELECT 1 FROM public.packet_records WHERE dataset_id = d.id LIMIT 1) THEN 'raw'
        WHEN EXISTS (SELECT 1 FROM public.flow_rollups WHERE dataset_id = d.id LIMIT 1) THEN 'metadata'
        ELSE 'summary' END
      WHERE id = d.id;
  END LOOP;

  UPDATE public.retention_runs
     SET finished_at = now(),
         duration_ms = (EXTRACT(EPOCH FROM (clock_timestamp() - t0)) * 1000)::int,
         rows_rolled = v_rolled, rows_deleted = v_deleted,
         chunks_deleted = v_chunks, summaries_written = v_sum, status = 'ok'
   WHERE id = run_id;

  RETURN QUERY SELECT v_rolled, v_deleted, v_chunks, v_sum;
END $$;

REVOKE ALL ON FUNCTION public.run_retention(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.run_retention_for_me()
RETURNS TABLE(rows_rolled bigint, rows_deleted bigint, chunks_deleted bigint, summaries_written bigint)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.run_retention(auth.uid())
$$;
GRANT EXECUTE ON FUNCTION public.run_retention_for_me() TO authenticated;

-- storage/usage stats for the admin view
CREATE OR REPLACE FUNCTION public.retention_storage_stats()
RETURNS TABLE(table_name text, live_rows bigint, total_bytes bigint)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT c.relname::text, s.n_live_tup::bigint, pg_total_relation_size(c.oid)::bigint
  FROM pg_stat_user_tables s JOIN pg_class c ON c.oid = s.relid
  WHERE s.schemaname = 'public'
  ORDER BY pg_total_relation_size(c.oid) DESC
$$;
GRANT EXECUTE ON FUNCTION public.retention_storage_stats() TO authenticated;

-- hourly rolling overwrite
CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $$ BEGIN
  PERFORM cron.unschedule('amdai-retention-hourly');
EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('amdai-retention-hourly', '7 * * * *', $$SELECT public.run_retention(NULL);$$);