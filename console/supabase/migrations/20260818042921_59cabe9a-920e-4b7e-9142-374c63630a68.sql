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
           count(*), COALESCE(sum(p.length),0), 1,
           COALESCE((
             SELECT array_agg(DISTINCT tg) FROM public.packet_records p2, unnest(p2.risk_tags) tg
             WHERE p2.dataset_id = p.dataset_id
               AND date_trunc('minute', p2.ts) = date_trunc('minute', p.ts)
               AND p2.src_ip IS NOT DISTINCT FROM p.src_ip
               AND p2.dst_ip IS NOT DISTINCT FROM p.dst_ip
               AND p2.src_port IS NOT DISTINCT FROM p.src_port
               AND p2.dst_port IS NOT DISTINCT FROM p.dst_port
               AND p2.protocol IS NOT DISTINCT FROM p.protocol
           ), '{}'::text[])
    FROM public.packet_records p
    WHERE p.dataset_id = d.id AND p.ts IS NOT NULL AND p.ts < raw_cutoff
    GROUP BY p.dataset_id, p.user_id, date_trunc('minute', p.ts), p.src_ip, p.dst_ip, p.src_port, p.dst_port, p.protocol
    ON CONFLICT (dataset_id, bucket_ts, src_ip, dst_ip, src_port, dst_port, protocol) DO UPDATE
      SET packets = fr.packets + EXCLUDED.packets,
          bytes = fr.bytes + EXCLUDED.bytes,
          risk_tags = (SELECT COALESCE(array_agg(DISTINCT t), '{}'::text[])
                       FROM unnest(fr.risk_tags || EXCLUDED.risk_tags) t);
    GET DIAGNOSTICS n = ROW_COUNT; v_rolled := v_rolled + n;

    DELETE FROM public.packet_records p WHERE p.dataset_id = d.id AND p.ts IS NOT NULL AND p.ts < raw_cutoff;
    GET DIAGNOSTICS n = ROW_COUNT; v_deleted := v_deleted + n;

    -- 2. refresh hourly summaries from remaining rollups
    INSERT INTO public.retention_summaries AS rsm
      (dataset_id, user_id, hour_ts, packets, bytes, flow_count, top_talkers, top_services, protocol_mix, risk_counts)
    SELECT d.id, d.user_id, h.hour_ts, h.packets, h.bytes, h.flow_count,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('ip', ip, 'bytes', b) ORDER BY b DESC), '[]'::jsonb) FROM (
          SELECT src_ip AS ip, sum(bytes) b FROM public.flow_rollups f2
          WHERE f2.dataset_id = d.id AND date_trunc('hour', f2.bucket_ts) = h.hour_ts
          GROUP BY 1 ORDER BY b DESC LIMIT 10) tt),
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('service', svc, 'bytes', b) ORDER BY b DESC), '[]'::jsonb) FROM (
          SELECT COALESCE(service, app_protocol, protocol, 'unknown') AS svc, sum(bytes) b FROM public.flow_rollups f3
          WHERE f3.dataset_id = d.id AND date_trunc('hour', f3.bucket_ts) = h.hour_ts
          GROUP BY 1 ORDER BY b DESC LIMIT 10) ts2),
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('protocol', pr, 'packets', pk) ORDER BY pk DESC), '[]'::jsonb) FROM (
          SELECT COALESCE(protocol,'unknown') AS pr, sum(packets) pk FROM public.flow_rollups f4
          WHERE f4.dataset_id = d.id AND date_trunc('hour', f4.bucket_ts) = h.hour_ts
          GROUP BY 1 ORDER BY pk DESC LIMIT 10) pm),
      (SELECT COALESCE(jsonb_object_agg(tag, c), '{}'::jsonb) FROM (
          SELECT tag, count(*) c FROM public.flow_rollups f5, unnest(f5.risk_tags) tag
          WHERE f5.dataset_id = d.id AND date_trunc('hour', f5.bucket_ts) = h.hour_ts
          GROUP BY 1) rc)
    FROM (
      SELECT date_trunc('hour', bucket_ts) AS hour_ts, sum(packets) AS packets,
             sum(bytes) AS bytes, sum(flow_count) AS flow_count
      FROM public.flow_rollups WHERE dataset_id = d.id
      GROUP BY 1
    ) h
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
        WHEN EXISTS (SELECT 1 FROM public.packet_records WHERE dataset_id = d.id) THEN 'raw'
        WHEN EXISTS (SELECT 1 FROM public.flow_rollups WHERE dataset_id = d.id) THEN 'metadata'
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

REVOKE ALL ON FUNCTION public.run_retention(uuid) FROM PUBLIC, anon;