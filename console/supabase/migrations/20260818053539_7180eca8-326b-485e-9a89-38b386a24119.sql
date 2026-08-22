-- 1. The multi-user retention routine must never be callable by end users:
--    run_retention(NULL) would purge every user's telemetry. Reserve it for
--    backend/service paths only.
REVOKE ALL ON FUNCTION public.run_retention(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.run_retention(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.run_retention(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.run_retention(uuid) TO service_role;

-- 2. Keep the self-service wrapper, but require an authenticated caller so a
--    definer function can never run with a NULL scope.
CREATE OR REPLACE FUNCTION public.run_retention_for_me()
RETURNS TABLE(rows_rolled bigint, rows_deleted bigint, chunks_deleted bigint, summaries_written bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  RETURN QUERY SELECT * FROM public.run_retention(auth.uid());
END $function$;

REVOKE ALL ON FUNCTION public.run_retention_for_me() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.run_retention_for_me() FROM anon;
GRANT EXECUTE ON FUNCTION public.run_retention_for_me() TO authenticated;
GRANT EXECUTE ON FUNCTION public.run_retention_for_me() TO service_role;

-- 3. Read-only definer helpers: no anonymous access, and the per-user timeline
--    requires a signed-in caller.
CREATE OR REPLACE FUNCTION public.retention_timeline(p_days integer DEFAULT 14)
RETURNS TABLE(day date, tier text, rows_count bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT d::date, 'raw'::text, count(p.id)
    FROM generate_series(now() - make_interval(days => p_days), now(), interval '1 day') g(d)
    LEFT JOIN public.packet_records p
      ON p.user_id = auth.uid() AND p.ts >= date_trunc('day', g.d) AND p.ts < date_trunc('day', g.d) + interval '1 day'
   WHERE auth.uid() IS NOT NULL
   GROUP BY 1
  UNION ALL
  SELECT d::date, 'metadata'::text, count(f.id)
    FROM generate_series(now() - make_interval(days => p_days), now(), interval '1 day') g(d)
    LEFT JOIN public.flow_rollups f
      ON f.user_id = auth.uid() AND f.bucket_ts >= date_trunc('day', g.d) AND f.bucket_ts < date_trunc('day', g.d) + interval '1 day'
   WHERE auth.uid() IS NOT NULL
   GROUP BY 1
  UNION ALL
  SELECT d::date, 'summary'::text, count(s.id)
    FROM generate_series(now() - make_interval(days => p_days), now(), interval '1 day') g(d)
    LEFT JOIN public.retention_summaries s
      ON s.user_id = auth.uid() AND s.hour_ts >= date_trunc('day', g.d) AND s.hour_ts < date_trunc('day', g.d) + interval '1 day'
   WHERE auth.uid() IS NOT NULL
   GROUP BY 1
  ORDER BY 1, 2
$function$;

REVOKE ALL ON FUNCTION public.retention_timeline(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.retention_timeline(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.retention_timeline(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.retention_timeline(integer) TO service_role;

REVOKE ALL ON FUNCTION public.retention_storage_stats() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.retention_storage_stats() FROM anon;
GRANT EXECUTE ON FUNCTION public.retention_storage_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.retention_storage_stats() TO service_role;

-- 4. retention_runs: the SELECT policy existed but the table had no grants at
--    all. Grant read-only access to signed-in users (rows still filtered by the
--    owner/admin policy) and deliberately grant no INSERT/UPDATE/DELETE, so run
--    history can only be written by the SECURITY DEFINER retention routine.
REVOKE ALL ON TABLE public.retention_runs FROM PUBLIC;
REVOKE ALL ON TABLE public.retention_runs FROM anon;
REVOKE ALL ON TABLE public.retention_runs FROM authenticated;
GRANT SELECT ON TABLE public.retention_runs TO authenticated;
GRANT ALL ON TABLE public.retention_runs TO service_role;