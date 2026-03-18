-- Create the table for VAULT media
create table if not exists vault_media (
  id bigint primary key generated always as identity,
  filename text not null,
  type text not null, -- 'IMG', 'VID', 'AUDIO', 'DOC'
  source text not null, -- 'telegram' or 'discord'
  size_bytes text not null, -- using text to store strings like '4.1 MB' directly for frontend ease
  date_added text not null, -- 'YYYY-MM-DD'
  url text not null,
  tags text[] default array[]::text[],
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS
alter table vault_media enable row level security;

-- Create policy for anon access (adjust as needed for true security)
create policy "Allow anon read access"
  on vault_media
  for select
  to anon
  using (true);

create policy "Allow anon insert access"
  on vault_media
  for insert
  to anon
  with check (true);
