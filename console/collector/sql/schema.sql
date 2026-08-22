-- AMDAI collector: local Postgres history schema.
--
-- Base telemetry tables (packets, flows, flow_rollups, interface_metrics, ...)
-- are created by src/store/pg.ts so the same DDL works for both TimescaleDB
-- hypertables and native range partitions. This file adds everything on top:
-- the retention bookkeeping table, the history views the LLM queries, and the
-- rollup / cleanup / partition-maintenance jobs. It is idempotent and applied
-- on every collector start.

-- ---------------------------------------------------------------- bookkeeping

create table if not exists retention_runs (
  id bigserial primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer,
  rows_rolled bigint not null default 0,
  rows_deleted bigint not null default 0,
  partitions_dropped integer not null default 0,
  status text not null default 'running',
  detail jsonb not null default '{}'::jsonb,
  error text
);

create index if not exists idx_retention_runs_started on retention_runs (started_at desc);

-- --------------------------------------------------------------- history views

-- Minute-level flow timeline stitched from raw flows plus the rolled-up
-- metadata tier, so a query spanning the raw window and older history returns
-- one continuous series. `tier` tells the model which fidelity it is reading.
create or replace view history_flow_timeline as
  select date_trunc('minute', ts) as bucket_ts,
         'raw'::text              as tier,
         protocol,
         coalesce(service, app_protocol, protocol, 'unknown') as service,
         sum(packets)::bigint     as packets,
         sum(bytes)::bigint       as bytes,
         count(*)::bigint         as flow_count
    from flows
   where ts is not null
   group by 1, 2, 3, 4
  union all
  select date_trunc('minute', bucket_ts) as bucket_ts,
         'metadata'::text                as tier,
         protocol,
         coalesce(service, app_protocol, protocol, 'unknown') as service,
         sum(packets)::bigint,
         sum(bytes)::bigint,
         sum(flow_count)::bigint
    from flow_rollups
   group by 1, 2, 3, 4;

create or replace view history_top_talkers as
  select date_trunc('hour', bucket_ts) as hour_ts,
         src_ip,
         dst_ip,
         sum(packets)::bigint as packets,
         sum(bytes)::bigint   as bytes,
         sum(flow_count)::bigint as flow_count
    from flow_rollups
   group by 1, 2, 3;

create or replace view history_service_mix as
  select date_trunc('hour', bucket_ts) as hour_ts,
         coalesce(service, app_protocol, protocol, 'unknown') as service,
         sum(bytes)::bigint   as bytes,
         sum(packets)::bigint as packets
    from flow_rollups
   group by 1, 2;

-- What history actually exists right now, per tier. Used by the LLM before it
-- answers a time-range question so it never claims data it no longer has.
create or replace view history_coverage as
  select 'packets'::text as source, 'raw'::text as tier,
         min(ts) as first_ts, max(ts) as last_ts, count(*)::bigint as rows_count
    from packets
  union all
  select 'flows', 'raw', min(ts), max(ts), count(*)::bigint from flows
  union all
  select 'flow_rollups', 'metadata', min(bucket_ts), max(bucket_ts), count(*)::bigint from flow_rollups
  union all
  select 'interface_metrics', 'metadata', min(bucket_ts), max(bucket_ts), count(*)::bigint from interface_metrics;

-- ----------------------------------------------------------------- rollup job

-- Rolls raw `flows` older than `p_raw_hours` into minute buckets in
-- `flow_rollups`. Idempotent: a bucket already present is topped up instead of
-- duplicated, and only buckets that are fully closed are processed.
create or replace function amdai_rollup_flows(p_raw_hours integer)
returns bigint
language plpgsql
as $$
declare
  cutoff timestamptz := now() - make_interval(hours => greatest(p_raw_hours, 0));
  n bigint := 0;
begin
  insert into flow_rollups as fr
    (bucket_ts, src_ip, dst_ip, src_port, dst_port, protocol, app_protocol,
     service, packets, bytes, flow_count, risk_tags, vantage)
  select date_trunc('minute', f.ts), f.src_ip, f.dst_ip, f.src_port, f.dst_port,
         f.protocol, min(f.app_protocol), min(f.service),
         coalesce(sum(f.packets), 0)::bigint,
         coalesce(sum(f.bytes), 0)::bigint,
         count(*)::bigint,
         coalesce((select array_agg(distinct t)
                     from unnest(array_remove(array_agg(f.risk_tags::text), null)) raw_tag,
                          unnest(raw_tag::text[]) t), '{}'::text[]),
         min(f.vantage)
    from flows f
   where f.ts is not null
     and f.ts < cutoff
     and f.ts < date_trunc('minute', now())
   group by 1, 2, 3, 4, 5, 6;
  get diagnostics n = row_count;

  delete from flows f where f.ts is not null and f.ts < cutoff and f.ts < date_trunc('minute', now());
  return n;
end $$;

-- --------------------------------------------------- partition maintenance

-- Creates today's plus `p_days_ahead` future daily partitions for every
-- range-partitioned telemetry table. No-op for TimescaleDB hypertables.
create or replace function amdai_ensure_partitions(p_days_ahead integer default 2)
returns integer
language plpgsql
as $$
declare
  t record;
  d date;
  part text;
  made integer := 0;
begin
  for t in
    select c.relname as table_name,
           (select a.attname
              from pg_partitioned_table p
              join pg_attribute a on a.attrelid = p.partrelid and a.attnum = p.partattrs[1]
             where p.partrelid = c.oid) as time_col
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where c.relkind = 'p' and n.nspname = current_schema()
  loop
    if t.time_col is null then continue; end if;
    for i in 0..greatest(p_days_ahead, 0) loop
      d := (current_date + i);
      part := format('%s_p%s', t.table_name, to_char(d, 'YYYYMMDD'));
      if not exists (select 1 from pg_class where relname = part) then
        execute format(
          'create table %I partition of %I for values from (%L) to (%L)',
          part, t.table_name, d::timestamptz, (d + 1)::timestamptz);
        made := made + 1;
      end if;
    end loop;
  end loop;
  return made;
end $$;

-- Drops daily partitions whose whole range is older than `p_before`.
create or replace function amdai_drop_partitions_before(p_table text, p_before timestamptz)
returns integer
language plpgsql
as $$
declare
  r record;
  dropped integer := 0;
  upper_bound timestamptz;
begin
  for r in
    select c.relname, pg_get_expr(c.relpartbound, c.oid) as bound
      from pg_class c
      join pg_inherits i on i.inhrelid = c.oid
      join pg_class parent on parent.oid = i.inhparent
     where parent.relname = p_table
  loop
    upper_bound := nullif(substring(r.bound from $re$TO \('([^']+)'\)$re$), '')::timestamptz;
    if upper_bound is not null and upper_bound <= p_before then
      execute format('drop table if exists %I', r.relname);
      dropped := dropped + 1;
    end if;
  end loop;
  return dropped;
end $$;

-- --------------------------------------------------------------- cleanup job

-- Enforces the tiered retention window: raw packets/flows for
-- `p_raw_hours`, flow metadata + interface metrics for `p_metadata_days`,
-- rolled-up summaries and operational records for `p_summary_days`.
-- Drops whole partitions where possible, then sweeps stragglers with DELETE.
create or replace function amdai_retention_cleanup(
  p_raw_hours integer default 24,
  p_metadata_days integer default 7,
  p_summary_days integer default 90
) returns table (rows_rolled bigint, rows_deleted bigint, partitions_dropped integer)
language plpgsql
as $$
declare
  raw_cutoff  timestamptz := now() - make_interval(hours => greatest(p_raw_hours, 0));
  meta_cutoff timestamptz := now() - make_interval(days  => greatest(p_metadata_days, 0));
  sum_cutoff  timestamptz := now() - make_interval(days  => greatest(p_summary_days, 0));
  v_rolled bigint := 0;
  v_deleted bigint := 0;
  v_parts integer := 0;
  n bigint;
  run_id bigint;
  t0 timestamptz := clock_timestamp();
begin
  insert into retention_runs default values returning id into run_id;

  -- 1. roll raw flows down into the metadata tier before anything is dropped
  v_rolled := amdai_rollup_flows(p_raw_hours);

  -- 2. raw tier
  v_parts := v_parts + amdai_drop_partitions_before('packets', raw_cutoff);
  delete from packets where ts is not null and ts < raw_cutoff;
  get diagnostics n = row_count; v_deleted := v_deleted + n;
  v_parts := v_parts + amdai_drop_partitions_before('flows', raw_cutoff);
  delete from flows where ts is not null and ts < raw_cutoff;
  get diagnostics n = row_count; v_deleted := v_deleted + n;

  -- 3. metadata tier
  v_parts := v_parts + amdai_drop_partitions_before('flow_rollups', meta_cutoff);
  delete from flow_rollups where bucket_ts < meta_cutoff;
  get diagnostics n = row_count; v_deleted := v_deleted + n;
  v_parts := v_parts + amdai_drop_partitions_before('interface_metrics', sum_cutoff);
  delete from interface_metrics where bucket_ts < sum_cutoff;
  get diagnostics n = row_count; v_deleted := v_deleted + n;

  -- 4. operational / probe records follow the summary window
  delete from logs where ts is not null and ts < meta_cutoff;
  get diagnostics n = row_count; v_deleted := v_deleted + n;
  delete from snmp_samples where ts is not null and ts < meta_cutoff;
  get diagnostics n = row_count; v_deleted := v_deleted + n;
  delete from wmi_samples where ts is not null and ts < meta_cutoff;
  get diagnostics n = row_count; v_deleted := v_deleted + n;
  delete from probe_results where ts is not null and ts < meta_cutoff;
  get diagnostics n = row_count; v_deleted := v_deleted + n;
  delete from device_facts where collected_at is not null and collected_at < sum_cutoff;
  get diagnostics n = row_count; v_deleted := v_deleted + n;
  delete from capacity_events where ts is not null and ts < sum_cutoff;
  get diagnostics n = row_count; v_deleted := v_deleted + n;
  delete from imports where started_at is not null and started_at < sum_cutoff;
  get diagnostics n = row_count; v_deleted := v_deleted + n;
  delete from retention_runs where started_at < sum_cutoff and id <> run_id;
  get diagnostics n = row_count; v_deleted := v_deleted + n;

  -- 5. keep partitions available for incoming writes
  perform amdai_ensure_partitions(2);

  update retention_runs
     set finished_at = now(),
         duration_ms = (extract(epoch from (clock_timestamp() - t0)) * 1000)::int,
         rows_rolled = v_rolled,
         rows_deleted = v_deleted,
         partitions_dropped = v_parts,
         status = 'ok',
         detail = jsonb_build_object(
           'raw_cutoff', raw_cutoff,
           'metadata_cutoff', meta_cutoff,
           'summary_cutoff', sum_cutoff)
   where id = run_id;

  return query select v_rolled, v_deleted, v_parts;
end $$;
