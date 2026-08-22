ALTER TABLE public.datasets DROP CONSTRAINT IF EXISTS datasets_kind_check;
ALTER TABLE public.datasets ADD CONSTRAINT datasets_kind_check CHECK (kind IN ('flow','log','packet','snmp','wmi'));