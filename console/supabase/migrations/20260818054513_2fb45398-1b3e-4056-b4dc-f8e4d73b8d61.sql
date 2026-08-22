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

  -- Strip string literals and comments before inspection so literal text can
  -- never trip a guard and comments can never hide a payload.
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

  -- Relations named right after FROM/JOIN must be history views.
  FOR ident IN
    SELECT DISTINCT lower(m[1])
      FROM regexp_matches(lowered, '(?:from|join)\s+([a-z_][a-z0-9_$."]*)', 'g') m
  LOOP
    ident := regexp_replace(replace(ident, '"', ''), '^public\.', '');
    IF NOT (ident = ANY (allowed)) THEN
      RAISE EXCEPTION 'Query may only read the history views (got: %)', ident;
    END IF;
  END LOOP;

  -- Defense in depth: a comma-separated FROM list, subquery or alias trick can
  -- reference a relation that the pattern above never sees. Reject the query if
  -- ANY bare identifier in it resolves to a real table/view that is not allowed.
  FOR ident IN
    SELECT DISTINCT lower(m[1]) FROM regexp_matches(lowered, '([a-z_][a-z0-9_]*)', 'g') m
  LOOP
    IF NOT (ident = ANY (allowed))
       AND EXISTS (
         SELECT 1 FROM pg_class c
          WHERE lower(c.relname) = ident
            AND c.relkind IN ('r','v','m','f','p')
       ) THEN
      RAISE EXCEPTION 'Query references a relation outside the history views (got: %)', ident;
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