CREATE OR REPLACE FUNCTION public.retention_timeline(p_days integer DEFAULT 14)
RETURNS TABLE(day date, tier text, rows_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d::date, 'raw'::text, count(p.id)
    FROM generate_series(now() - make_interval(days => p_days), now(), interval '1 day') g(d)
    LEFT JOIN public.packet_records p
      ON p.user_id = auth.uid() AND p.ts >= date_trunc('day', g.d) AND p.ts < date_trunc('day', g.d) + interval '1 day'
   GROUP BY 1
  UNION ALL
  SELECT d::date, 'metadata'::text, count(f.id)
    FROM generate_series(now() - make_interval(days => p_days), now(), interval '1 day') g(d)
    LEFT JOIN public.flow_rollups f
      ON f.user_id = auth.uid() AND f.bucket_ts >= date_trunc('day', g.d) AND f.bucket_ts < date_trunc('day', g.d) + interval '1 day'
   GROUP BY 1
  UNION ALL
  SELECT d::date, 'summary'::text, count(s.id)
    FROM generate_series(now() - make_interval(days => p_days), now(), interval '1 day') g(d)
    LEFT JOIN public.retention_summaries s
      ON s.user_id = auth.uid() AND s.hour_ts >= date_trunc('day', g.d) AND s.hour_ts < date_trunc('day', g.d) + interval '1 day'
   GROUP BY 1
  ORDER BY 1, 2
$$;
REVOKE ALL ON FUNCTION public.retention_timeline(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retention_timeline(integer) TO authenticated;