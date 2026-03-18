-- Drop the existing table to recreate it with the new schema (only if it's safe for early testing)
drop table if exists vault_media cascade;

-- Create the two-tier table for VAULT media
create table vault_media (
  id bigint primary key generated always as identity,
  file_hash text unique not null,
  filename text not null,
  display_name text,                -- User-editable label shown in the UI
  notes text,                       -- Free-text annotations
  type text not null,               -- 'IMG', 'VID', 'AUDIO', 'DOC'
  tier text not null,               -- 'ARCHIVE', 'HOT', 'BOTH', 'EXPIRED'
  size_bytes text not null,
  date_added text not null,
  telegram_file_id text,            -- FIX #1: Permanent Telegram file_id — survives URL rotation
  telegram_url text,                -- Cached download URL (regenerated from file_id on demand)
  discord_url text,
  promote_attempts int default 0,   -- FIX #4: Retry counter — prevents silent auto-promote failures
  link_verified_at timestamp,       -- FIX #7: Last time both links were verified reachable
  tags text[] default array[]::text[],
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS
alter table vault_media enable row level security;

-- Create policy for anon access
create policy "Allow anon read access"
  on vault_media for select to anon using (true);

create policy "Allow anon insert access"
  on vault_media for insert to anon with check (true);

create policy "Allow anon update access"
  on vault_media for update to anon using (true) with check (true);

-- ── If your table already exists, run these instead of the DROP above ─────────
-- ALTER TABLE vault_media ADD COLUMN IF NOT EXISTS display_name text;
-- ALTER TABLE vault_media ADD COLUMN IF NOT EXISTS notes text;
-- ALTER TABLE vault_media ADD COLUMN IF NOT EXISTS telegram_file_id text;
-- ALTER TABLE vault_media ADD COLUMN IF NOT EXISTS promote_attempts int default 0;
-- ALTER TABLE vault_media ADD COLUMN IF NOT EXISTS link_verified_at timestamp;
