-- Drop the existing table to recreate it with the new schema
drop table if exists vault_media cascade;

-- Create the table for VAULT media (Telegram Archive only)
create table vault_media (
  id bigint primary key generated always as identity,
  file_hash text unique not null,
  filename text not null,
  display_name text,
  notes text,
  type text not null,
  tier text not null,
  size_bytes text not null,
  date_added text not null,
  telegram_file_id text,
  telegram_url text,
  link_verified_at timestamp,
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
