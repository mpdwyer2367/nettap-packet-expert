-- ============================================================
-- 1. History views. Every view self-scopes to auth.uid() so it stays safe
--    even when read through a SECURITY DEFINER executor.
-- ============================================================

CREATE OR REPLACE VIEW public.history_flow_timeline
WITH (security_invoker = on) AS
  SELECT p.dataset_id,
         date_trunc('minute', p.ts) AS bucket_ts,
         'raw'::text                AS tier,
         count(*)::bigint           AS packets,
         COALESCE(sum(p.length), 0)::bigint AS bytes,
         count(DISTINCT (COALESCE(p.src_ip,'') || '|' || COALESCE(p.dst_ip,'') || '|' ||
                         COALESCE(p.src_port::text,'') || '|' || COALESCE(p.dst_port::text,'') || '|' ||
                         COALESCE(p.protocol,'')))::bigint AS flows
    FROM public.packet_records p
   WHERE p.user_id = auth.uid() AND p.ts IS NOT NULL
   GROUP BY 1, 2
  UNION ALL
  SELECT f.dataset_id,
         date_trunc('minute', f.bucket_ts) AS bucket_ts,
         'metadata'::text,
         sum(f.packets)::bigint,
         sum(f.bytes)::bigint,
         sum(f.flow_count)::bigint
    FROM public.flow_rollups f
   WHERE f.user_id = auth.uid()
   GROUP BY 1, 2
  UNION ALL
  SELECT s.dataset_id,
         s.hour_ts AS bucket_ts,
         'summary'::text,
         s.packets,
         s.bytes,
         s.flow_count
    FROM public.retention_summaries s
   WHERE s.user_id = auth.uid();

CREATE OR REPLACE VIEW public.history_top_talkers
WITH (security_invoker = on) AS
  SELECT dataset_id, tier, src_ip, dst_ip,
         sum(bytes)::bigint   AS bytes,
         sum(packets)::bigint AS packets,
         sum(flows)::bigint   AS flows,
         min(first_seen)      AS first_seen,
         max(last_seen)       AS last_seen
    FROM (
      SELECT p.dataset_id, 'raw'::text AS tier, p.src_ip, p.dst_ip,
             COALESCE(p.length, 0)::bigint AS bytes, 1::bigint AS packets, 0::bigint AS flows,
             p.ts AS first_seen, p.ts AS last_seen
        FROM public.packet_records p
       WHERE p.user_id = auth.uid()
      UNION ALL
      SELECT f.dataset_id, 'metadata'::text, f.src_ip, f.dst_ip,
             f.bytes, f.packets, f.flow_count::bigint,
             f.bucket_ts, f.bucket_ts
        FROM public.flow_rollups f
       WHERE f.user_id = auth.uid()
    ) t
   GROUP BY 1, 2, 3, 4;

CREATE OR REPLACE VIEW public.history_service_mix
WITH (security_invoker = on) AS
  SELECT dataset_id, tier, service, app_protocol, protocol, dst_port,
         sum(bytes)::bigint   AS bytes,
         sum(packets)::bigint AS packets,
         sum(flows)::bigint   AS flows,
         min(first_seen)      AS first_seen,
         max(last_seen)       AS last_seen
    FROM (
      SELECT p.dataset_id, 'raw'::text AS tier,
             COALESCE(p.service, p.app_protocol, p.protocol, 'unknown') AS service,
             p.app_protocol, p.protocol, p.dst_port,
             COALESCE(p.length, 0)::bigint AS bytes, 1::bigint AS packets, 0::bigint AS flows,
             p.ts AS first_seen, p.ts AS last_seen
        FROM public.packet_records p
       WHERE p.user_id = auth.uid()
      UNION ALL
      SELECT f.dataset_id, 'metadata'::text,
             COALESCE(f.service, f.app_protocol, f.protocol, 'unknown'),
             f.app_protocol, f.protocol, f.dst_port,
             f.bytes, f.packets, f.flow_count::bigint,
             f.bucket_ts, f.bucket_ts
        FROM public.flow_rollups f
       WHERE f.user_id = auth.uid()
    ) t
   GROUP BY 1, 2, 3, 4, 5, 6;

CREATE OR REPLACE VIEW public.history_coverage
WITH (security_invoker = on) AS
  SELECT 'packet_records'::text AS source, 'raw'::text AS tier, dataset_id,
         count(*)::bigint AS rows_count, min(ts) AS oldest, max(ts) AS newest
    FROM public.packet_records WHERE user_id = auth.uid() GROUP BY 3
  UNION ALL
  SELECT 'flow_records', 'metadata', dataset_id,
         count(*)::bigint, min(ts), max(ts)
    FROM public.flow_records WHERE user_id = auth.uid() GROUP BY 3
  UNION ALL
  SELECT 'flow_rollups', 'metadata', dataset_id,
         count(*)::bigint, min(bucket_ts), max(bucket_ts)
    FROM public.flow_rollups WHERE user_id = auth.uid() GROUP BY 3
  UNION ALL
  SELECT 'retention_summaries', 'summary', dataset_id,
         count(*)::bigint, min(hour_ts), max(hour_ts)
    FROM public.retention_summaries WHERE user_id = auth.uid() GROUP BY 3
  UNION ALL
  SELECT 'log_records', 'metadata', dataset_id,
         count(*)::bigint, min(ts), max(ts)
    FROM public.log_records WHERE user_id = auth.uid() GROUP BY 3
  UNION ALL
  SELECT 'snmp_records', 'metadata', dataset_id,
         count(*)::bigint, min(ts), max(ts)
    FROM public.snmp_records WHERE user_id = auth.uid() GROUP BY 3
  UNION ALL
  SELECT 'wmi_records', 'metadata', dataset_id,
         count(*)::bigint, min(ts), max(ts)
    FROM public.wmi_records WHERE user_id = auth.uid() GROUP BY 3;

REVOKE ALL ON public.history_flow_timeline FROM PUBLIC, anon;
REVOKE ALL ON public.history_top_talkers   FROM PUBLIC, anon;
REVOKE ALL ON public.history_service_mix   FROM PUBLIC, anon;
REVOKE ALL ON public.history_coverage      FROM PUBLIC, anon;
GRANT SELECT ON public.history_flow_timeline TO authenticated, service_role;
GRANT SELECT ON public.history_top_talkers   TO authenticated, service_role;
GRANT SELECT ON public.history_service_mix   TO authenticated, service_role;
GRANT SELECT ON public.history_coverage      TO authenticated, service_role;

-- ============================================================
-- 2. Guarded read-only executor for model-authored SQL.
--    Only single read-only statements over the four history_* views.
-- ============================================================

CREATE OR REPLACE FUNCTION public.history_query(p_sql text, p_max_rows integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  sql_clean text;
  lowered   text;
  stripped  text;
  ident     text;
  allowed   text[] := ARRAY['history_flow_timeline','history_top_talkers','history_service_mix','history_coverage'];
  banned    text[] := ARRAY['insert','update','delete','drop','alter','create','truncate','grant','revoke',
                            'comment','copy','call','do','merge','vacuum','analyze','reindex','cluster',
                            'listen','notify','lock','set','reset','begin','commit','rollback','savepoint',
                            'prepare','execute','explain','refresh','import','security','definer',
                            'pg_sleep','pg_read_file','pg_read_binary_file','pg_ls_dir','dblink','lo_import','lo_export'];
  kw text;
  result jsonb;
  limit_rows integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  limit_rows := LEAST(GREATEST(COALESCE(p_max_rows, 200), 1), 1000);
  sql_clean := btrim(COALESCE(p_sql, ''));
  sql_clean := regexp_replace(sql_clean, ';\s*$', '');

  IF sql_clean = '' THEN
    RAISE EXCEPTION 'Empty query';
  END IF;
  IF length(sql_clean) > 4000 THEN
    RAISE EXCEPTION 'Query too long';
  END IF;

  -- Strip string literals and comments before keyword/identifier inspection so
  -- literal text can never trip a guard, and comments can never hide payloads.
  stripped := regexp_replace(sql_clean, '''([^'']|'''')*''', ' ''lit'' ', 'g');
  stripped := regexp_replace(stripped, '/\*.*?\*/', ' ', 'gs');
  stripped := regexp_replace(stripped, '--[^\n]*', ' ', 'g');
  lowered  := lower(stripped);

  IF position(';' IN stripped) > 0 THEN
    RAISE EXCEPTION 'Only a single statement is allowed';
  END IF;
  IF lowered !~ '^\s*(select|with)\s' THEN
    RAISE EXCEPTION 'Only SELECT/WITH queries are allowed';
  END IF;

  FOREACH kw IN ARRAY banned LOOP
    IF lowered ~ ('(^|[^a-z0-9_])' || kw || '([^a-z0-9_]|$)') THEN
      RAISE EXCEPTION 'Disallowed keyword in query: %', kw;
    END IF;
  END LOOP;

  -- Every table-ish identifier must be one of the history views. This also
  -- blocks pg_catalog, information_schema and base telemetry tables.
  FOR ident IN
    SELECT DISTINCT lower(m[1])
      FROM regexp_matches(lowered, '(?:from|join)\s+([a-z_][a-z0-9_$.\"]*)', 'g') m
  LOOP
    ident := replace(ident, '"', '');
    ident := regexp_replace(ident, '^public\.', '');
    IF NOT (ident = ANY (allowed)) THEN
      RAISE EXCEPTION 'Query may only read the history views (got: %)', ident;
    END IF;
  END LOOP;

  PERFORM set_config('statement_timeout', '8000', true);

  EXECUTE format(
    'SELECT COALESCE(jsonb_agg(t), ''[]''::jsonb) FROM (SELECT * FROM (%s) q LIMIT %s) t',
    sql_clean, limit_rows
  ) INTO result;

  RETURN jsonb_build_object('rows', result, 'row_count', jsonb_array_length(result), 'max_rows', limit_rows);
END $function$;

REVOKE ALL ON FUNCTION public.history_query(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.history_query(text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.history_query(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.history_query(text, integer) TO service_role;