CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE public.datasets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('flow','log')),
  source_filename TEXT NOT NULL,
  record_count INTEGER NOT NULL DEFAULT 0,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  range_start TIMESTAMPTZ,
  range_end TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'ready',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.datasets TO authenticated;
GRANT ALL ON public.datasets TO service_role;
ALTER TABLE public.datasets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own datasets" ON public.datasets FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.flow_records (
  id BIGSERIAL PRIMARY KEY,
  dataset_id UUID NOT NULL REFERENCES public.datasets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  ts TIMESTAMPTZ,
  src_ip TEXT,
  dst_ip TEXT,
  src_port INTEGER,
  dst_port INTEGER,
  protocol TEXT,
  bytes BIGINT DEFAULT 0,
  packets BIGINT DEFAULT 0,
  flags TEXT,
  observation_point TEXT,
  extra JSONB NOT NULL DEFAULT '{}'::jsonb
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.flow_records TO authenticated;
GRANT ALL ON public.flow_records TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.flow_records_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.flow_records_id_seq TO service_role;
ALTER TABLE public.flow_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own flow records" ON public.flow_records FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX flow_records_dataset_idx ON public.flow_records (dataset_id);
CREATE INDEX flow_records_src_idx ON public.flow_records (dataset_id, src_ip);
CREATE INDEX flow_records_dst_idx ON public.flow_records (dataset_id, dst_ip);
CREATE INDEX flow_records_ts_idx ON public.flow_records (dataset_id, ts);

CREATE TABLE public.log_records (
  id BIGSERIAL PRIMARY KEY,
  dataset_id UUID NOT NULL REFERENCES public.datasets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  ts TIMESTAMPTZ,
  host TEXT,
  severity TEXT,
  message TEXT NOT NULL,
  extra JSONB NOT NULL DEFAULT '{}'::jsonb
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.log_records TO authenticated;
GRANT ALL ON public.log_records TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.log_records_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.log_records_id_seq TO service_role;
ALTER TABLE public.log_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own log records" ON public.log_records FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX log_records_dataset_idx ON public.log_records (dataset_id);
CREATE INDEX log_records_ts_idx ON public.log_records (dataset_id, ts);

CREATE TABLE public.telemetry_chunks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  dataset_id UUID NOT NULL REFERENCES public.datasets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  record_ids BIGINT[] NOT NULL DEFAULT '{}',
  embedding vector(3072),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.telemetry_chunks TO authenticated;
GRANT ALL ON public.telemetry_chunks TO service_role;
ALTER TABLE public.telemetry_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own chunks" ON public.telemetry_chunks FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX telemetry_chunks_dataset_idx ON public.telemetry_chunks (dataset_id);
CREATE INDEX telemetry_chunks_embedding_idx ON public.telemetry_chunks USING hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops);

CREATE TABLE public.investigations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  title TEXT NOT NULL DEFAULT 'New investigation',
  dataset_id UUID REFERENCES public.datasets(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.investigations TO authenticated;
GRANT ALL ON public.investigations TO service_role;
ALTER TABLE public.investigations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own investigations" ON public.investigations FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.investigation_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  investigation_id UUID NOT NULL REFERENCES public.investigations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role TEXT NOT NULL,
  message_id TEXT,
  parts JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.investigation_messages TO authenticated;
GRANT ALL ON public.investigation_messages TO service_role;
ALTER TABLE public.investigation_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own investigation messages" ON public.investigation_messages FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX investigation_messages_thread_idx ON public.investigation_messages (investigation_id, created_at);

CREATE OR REPLACE FUNCTION public.match_telemetry_chunks(
  query_embedding vector(3072),
  target_dataset UUID,
  match_count INT DEFAULT 8
)
RETURNS TABLE (id UUID, dataset_id UUID, kind TEXT, content TEXT, record_ids BIGINT[], similarity FLOAT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT c.id, c.dataset_id, c.kind, c.content, c.record_ids,
         1 - (c.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)) AS similarity
  FROM public.telemetry_chunks c
  WHERE c.embedding IS NOT NULL
    AND (target_dataset IS NULL OR c.dataset_id = target_dataset)
  ORDER BY c.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)
  LIMIT match_count;
$$;
GRANT EXECUTE ON FUNCTION public.match_telemetry_chunks(vector, UUID, INT) TO authenticated;