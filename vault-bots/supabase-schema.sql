-- Drop existing tables to recreate with new schema
drop table if exists vault_album_media cascade;
drop table if exists vault_albums cascade;
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

-- Albums table
create table if not exists vault_albums (
  id bigint primary key generated always as identity,
  name text not null,
  description text,
  cover_media_id bigint references vault_media(id) on delete set null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Album media junction table
create table vault_album_media (
  album_id bigint references vault_albums(id) on delete cascade,
  media_id bigint references vault_media(id) on delete cascade,
  position integer default 0,
  added_at timestamp with time zone default timezone('utc'::text, now()) not null,
  primary key (album_id, media_id)
);

-- Enable RLS on albums
alter table vault_albums enable row level security;
alter table vault_album_media enable row level security;

-- Album policies
create policy "Allow anon read access" on vault_albums for select to anon using (true);
create policy "Allow anon insert access" on vault_albums for insert to anon with check (true);
create policy "Allow anon update access" on vault_albums for update to anon using (true) with check (true);
create policy "Allow anon delete access" on vault_albums for delete to anon using (true);

create policy "Allow anon read access" on vault_album_media for select to anon using (true);
create policy "Allow anon insert access" on vault_album_media for insert to anon with check (true);
create policy "Allow anon delete access" on vault_album_media for delete to anon using (true);
