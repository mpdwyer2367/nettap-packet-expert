CREATE TABLE public.live_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  dataset_id uuid NOT NULL REFERENCES public.datasets(id) ON DELETE CASCADE,
  os text NOT NULL DEFAULT 'windows',
  interface_name text NOT NULL,
  capture_filter text,
  slice_seconds integer NOT NULL DEFAULT 5,
  vantage text NOT NULL DEFAULT 'host_agent',
  observation_point text,
  token_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending',
  packet_count integer NOT NULL DEFAULT 0,
  byte_count bigint NOT NULL DEFAULT 0,
  batch_count integer NOT NULL DEFAULT 0,
  last_error text,
  last_seen_at timestamp with time zone,
  expires_at timestamp with time zone NOT NULL DEFAULT (now() + interval '12 hours'),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.live_sessions TO authenticated;
GRANT ALL ON public.live_sessions TO service_role;
ALTER TABLE public.live_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own live sessions" ON public.live_sessions FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX live_sessions_user_created_idx ON public.live_sessions (user_id, created_at DESC);
CREATE INDEX live_sessions_dataset_idx ON public.live_sessions (dataset_id);

CREATE TRIGGER update_live_sessions_updated_at
BEFORE UPDATE ON public.live_sessions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.live_session_metrics (
  id bigserial PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES public.live_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  bucket_ts timestamp with time zone NOT NULL,
  packets integer NOT NULL DEFAULT 0,
  bytes bigint NOT NULL DEFAULT 0,
  top jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.live_session_metrics TO authenticated;
GRANT ALL ON public.live_session_metrics TO service_role;
ALTER TABLE public.live_session_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own live session metrics" ON public.live_session_metrics FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE UNIQUE INDEX live_session_metrics_bucket_idx ON public.live_session_metrics (session_id, bucket_ts);

ALTER TABLE public.live_session_metrics REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.live_session_metrics;