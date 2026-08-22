ALTER TABLE public.datasets
  ADD COLUMN IF NOT EXISTS vantage TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS observation_point TEXT;