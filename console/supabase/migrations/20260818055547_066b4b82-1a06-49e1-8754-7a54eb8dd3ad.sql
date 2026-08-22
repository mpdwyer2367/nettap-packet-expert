-- ============ MATRIX integration layer ============
CREATE TABLE public.matrix_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  site text NOT NULL DEFAULT 'default',
  mode text NOT NULL DEFAULT 'simulator',
  base_url text,
  secret_name text,
  verify_tls boolean NOT NULL DEFAULT true,
  poll_interval_seconds integer NOT NULL DEFAULT 60,
  status text NOT NULL DEFAULT 'unknown',
  last_error text,
  last_polled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.matrix_connections TO authenticated;
GRANT ALL ON public.matrix_connections TO service_role;
ALTER TABLE public.matrix_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own matrix connections" ON public.matrix_connections FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "admins read matrix connections" ON public.matrix_connections FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER matrix_connections_updated_at BEFORE UPDATE ON public.matrix_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.matrix_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.matrix_connections(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  device_key text NOT NULL,
  name text NOT NULL,
  site text,
  role text NOT NULL DEFAULT 'broker',
  model text,
  serial text,
  os_version text,
  mgmt_ip text,
  health_status text NOT NULL DEFAULT 'unknown',
  health jsonb NOT NULL DEFAULT '{}'::jsonb,
  p4_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, device_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.matrix_devices TO authenticated;
GRANT ALL ON public.matrix_devices TO service_role;
ALTER TABLE public.matrix_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own matrix devices" ON public.matrix_devices FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.matrix_ports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.matrix_connections(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES public.matrix_devices(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  port_key text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'network',
  speed_bps bigint,
  admin_state text NOT NULL DEFAULT 'up',
  oper_state text NOT NULL DEFAULT 'up',
  media text,
  description text,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (device_id, port_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.matrix_ports TO authenticated;
GRANT ALL ON public.matrix_ports TO service_role;
ALTER TABLE public.matrix_ports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own matrix ports" ON public.matrix_ports FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.matrix_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.matrix_connections(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  src_port_id uuid REFERENCES public.matrix_ports(id) ON DELETE CASCADE,
  dst_port_id uuid REFERENCES public.matrix_ports(id) ON DELETE CASCADE,
  link_key text NOT NULL,
  kind text NOT NULL DEFAULT 'fabric',
  status text NOT NULL DEFAULT 'up',
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, link_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.matrix_links TO authenticated;
GRANT ALL ON public.matrix_links TO service_role;
ALTER TABLE public.matrix_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own matrix links" ON public.matrix_links FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.matrix_port_counters (
  id bigserial PRIMARY KEY,
  connection_id uuid NOT NULL REFERENCES public.matrix_connections(id) ON DELETE CASCADE,
  port_id uuid NOT NULL REFERENCES public.matrix_ports(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  bucket_ts timestamptz NOT NULL DEFAULT now(),
  rx_bytes bigint NOT NULL DEFAULT 0,
  tx_bytes bigint NOT NULL DEFAULT 0,
  rx_packets bigint NOT NULL DEFAULT 0,
  tx_packets bigint NOT NULL DEFAULT 0,
  errors bigint NOT NULL DEFAULT 0,
  discards bigint NOT NULL DEFAULT 0,
  crc_errors bigint NOT NULL DEFAULT 0,
  utilization_pct double precision,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX matrix_port_counters_port_ts ON public.matrix_port_counters (port_id, bucket_ts DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.matrix_port_counters TO authenticated;
GRANT ALL ON public.matrix_port_counters TO service_role;
ALTER TABLE public.matrix_port_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own matrix counters" ON public.matrix_port_counters FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.matrix_alarms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.matrix_connections(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  alarm_key text NOT NULL,
  device_key text,
  port_key text,
  severity text NOT NULL DEFAULT 'minor',
  state text NOT NULL DEFAULT 'active',
  category text,
  message text NOT NULL,
  raised_at timestamptz NOT NULL DEFAULT now(),
  cleared_at timestamptz,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (connection_id, alarm_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.matrix_alarms TO authenticated;
GRANT ALL ON public.matrix_alarms TO service_role;
ALTER TABLE public.matrix_alarms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own matrix alarms" ON public.matrix_alarms FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.matrix_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.matrix_connections(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  policy_key text NOT NULL,
  name text NOT NULL,
  device_key text,
  enabled boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 100,
  ingress_ports text[] NOT NULL DEFAULT '{}',
  egress_ports text[] NOT NULL DEFAULT '{}',
  actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  match_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  revision integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, policy_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.matrix_policies TO authenticated;
GRANT ALL ON public.matrix_policies TO service_role;
ALTER TABLE public.matrix_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own matrix policies" ON public.matrix_policies FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.matrix_config_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.matrix_connections(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  revision integer NOT NULL,
  author text,
  summary text,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  captured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, revision)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.matrix_config_revisions TO authenticated;
GRANT ALL ON public.matrix_config_revisions TO service_role;
ALTER TABLE public.matrix_config_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own matrix revisions" ON public.matrix_config_revisions FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============ Documentation RAG ============
CREATE TABLE public.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  doc_class text NOT NULL DEFAULT 'manual',
  product text,
  version text,
  source_filename text,
  tags text[] NOT NULL DEFAULT '{}',
  min_role public.app_role NOT NULL DEFAULT 'user',
  chunk_count integer NOT NULL DEFAULT 0,
  char_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'ready',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.documents TO authenticated;
GRANT ALL ON public.documents TO service_role;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own documents" ON public.documents FOR ALL TO authenticated
  USING (auth.uid() = user_id AND (min_role = 'user' OR public.has_role(auth.uid(), min_role)))
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "admins read documents" ON public.documents FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER documents_updated_at BEFORE UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.document_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  chunk_index integer NOT NULL,
  section text,
  page integer,
  anchor text,
  content text NOT NULL,
  embedding vector(3072),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX document_chunks_doc_idx ON public.document_chunks (document_id, chunk_index);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_chunks TO authenticated;
GRANT ALL ON public.document_chunks TO service_role;
ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own document chunks" ON public.document_chunks FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.match_document_chunks(
  query_embedding vector(3072),
  match_count integer DEFAULT 8,
  filter_doc_class text DEFAULT NULL
)
RETURNS TABLE (
  chunk_id uuid,
  document_id uuid,
  title text,
  doc_class text,
  product text,
  version text,
  section text,
  page integer,
  anchor text,
  content text,
  similarity double precision
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT c.id, d.id, d.title, d.doc_class, d.product, d.version,
         c.section, c.page, c.anchor, c.content,
         1 - (c.embedding <=> query_embedding) AS similarity
  FROM public.document_chunks c
  JOIN public.documents d ON d.id = c.document_id
  WHERE c.embedding IS NOT NULL
    AND (filter_doc_class IS NULL OR d.doc_class = filter_doc_class)
  ORDER BY c.embedding <=> query_embedding
  LIMIT GREATEST(LEAST(match_count, 40), 1)
$$;

-- ============ Case & evidence workspace ============
CREATE TABLE public.cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  case_number bigint GENERATED BY DEFAULT AS IDENTITY,
  title text NOT NULL,
  summary text,
  severity text NOT NULL DEFAULT 'medium',
  status text NOT NULL DEFAULT 'open',
  owner text,
  sites text[] NOT NULL DEFAULT '{}',
  devices text[] NOT NULL DEFAULT '{}',
  investigation_id uuid REFERENCES public.investigations(id) ON DELETE SET NULL,
  dataset_id uuid REFERENCES public.datasets(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cases TO authenticated;
GRANT ALL ON public.cases TO service_role;
ALTER TABLE public.cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own cases" ON public.cases FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "admins read cases" ON public.cases FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER cases_updated_at BEFORE UPDATE ON public.cases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.case_events (
  id bigserial PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'note',
  actor text,
  body text NOT NULL,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX case_events_case_idx ON public.case_events (case_id, created_at DESC);
GRANT SELECT, INSERT ON public.case_events TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.case_events_id_seq TO authenticated;
GRANT ALL ON public.case_events TO service_role;
GRANT ALL ON SEQUENCE public.case_events_id_seq TO service_role;
ALTER TABLE public.case_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own case events" ON public.case_events FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "append own case events" ON public.case_events FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.case_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  label text NOT NULL,
  evidence_kind text NOT NULL DEFAULT 'flow',
  dataset_id uuid REFERENCES public.datasets(id) ON DELETE SET NULL,
  record_ids bigint[] NOT NULL DEFAULT '{}',
  document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  chunk_id uuid REFERENCES public.document_chunks(id) ON DELETE SET NULL,
  connection_id uuid REFERENCES public.matrix_connections(id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text,
  vantage text,
  fidelity_tier text,
  window_start timestamptz,
  window_end timestamptz,
  content_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX case_evidence_case_idx ON public.case_evidence (case_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_evidence TO authenticated;
GRANT ALL ON public.case_evidence TO service_role;
ALTER TABLE public.case_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own case evidence" ON public.case_evidence FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.case_custody (
  id bigserial PRIMARY KEY,
  evidence_id uuid NOT NULL REFERENCES public.case_evidence(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  action text NOT NULL,
  actor text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX case_custody_evidence_idx ON public.case_custody (evidence_id, created_at);
GRANT SELECT, INSERT ON public.case_custody TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.case_custody_id_seq TO authenticated;
GRANT ALL ON public.case_custody TO service_role;
GRANT ALL ON SEQUENCE public.case_custody_id_seq TO service_role;
ALTER TABLE public.case_custody ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own custody" ON public.case_custody FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "append own custody" ON public.case_custody FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.case_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  connection_id uuid REFERENCES public.matrix_connections(id) ON DELETE SET NULL,
  title text NOT NULL,
  rationale text NOT NULL,
  target text,
  change_kind text NOT NULL DEFAULT 'policy',
  proposed_change jsonb NOT NULL DEFAULT '{}'::jsonb,
  risk text NOT NULL DEFAULT 'medium',
  status text NOT NULL DEFAULT 'proposed',
  reviewer_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_proposals TO authenticated;
GRANT ALL ON public.case_proposals TO service_role;
ALTER TABLE public.case_proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own case proposals" ON public.case_proposals FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER case_proposals_updated_at BEFORE UPDATE ON public.case_proposals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ Audit log ============
CREATE TABLE public.audit_events (
  id bigserial PRIMARY KEY,
  user_id uuid,
  actor text,
  category text NOT NULL,
  action text NOT NULL,
  target text,
  outcome text NOT NULL DEFAULT 'ok',
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_user_idx ON public.audit_events (user_id, created_at DESC);
GRANT SELECT, INSERT ON public.audit_events TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.audit_events_id_seq TO authenticated;
GRANT ALL ON public.audit_events TO service_role;
GRANT ALL ON SEQUENCE public.audit_events_id_seq TO service_role;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own audit events" ON public.audit_events FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "append own audit events" ON public.audit_events FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);