-- Run once in the Supabase SQL editor. No public access to uploaded CSVs.
begin;
create table public.pnl_uploads (
  user_id uuid primary key references auth.users(id) on delete cascade,
  csv text not null check (octet_length(csv) <= 2097152),
  filename text not null check (length(filename) <= 1024),
  time_zone text not null check (length(time_zone) <= 128),
  updated_at timestamptz not null default now()
);
alter table public.pnl_uploads enable row level security;
revoke all on public.pnl_uploads from anon;
grant select, insert, update, delete on public.pnl_uploads to authenticated;
create policy "Read own upload" on public.pnl_uploads for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Insert own upload" on public.pnl_uploads for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Update own upload" on public.pnl_uploads for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Delete own upload" on public.pnl_uploads for delete to authenticated
  using ((select auth.uid()) = user_id);
commit;
