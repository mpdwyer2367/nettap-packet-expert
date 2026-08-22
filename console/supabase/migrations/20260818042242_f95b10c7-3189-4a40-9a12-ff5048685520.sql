REVOKE ALL ON FUNCTION public.run_retention_for_me() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.retention_storage_stats() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_retention_for_me() TO authenticated;
GRANT EXECUTE ON FUNCTION public.retention_storage_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;