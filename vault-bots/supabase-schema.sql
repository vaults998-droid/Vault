-- Drop the existing table to recreate it with the new schema (only if it's safe for early testing)
drop table if exists vault_media cascade;

-- Create the two-tier table for VAULT media
create table vault_media (
  id bigint primary key generated always as identity,
  filename text not null,
  type text not null, -- 'IMG', 'VID', 'AUDIO', 'DOC'
  tier text not null, -- 'ARCHIVE', 'HOT', 'BOTH'
  size_bytes text not null, 
  date_added text not null, 
  telegram_url text, -- Represents Archive Storage (Permanent)
  discord_url text,  -- Represents Hot Cache Storage (Temporary)
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
