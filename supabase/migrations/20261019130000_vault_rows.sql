-- Everything the app keeps online, one row per thing: a card's schedule, one
-- attempt, a sentence you wrote, your settings. The phone's IndexedDB stays the
-- working copy; this is the copy that survives the phone. Each account can only
-- see and change its own rows.
create table public.vault_rows (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  store text not null check (store in ('reviews', 'attempts', 'sentences', 'settings')),
  key text not null check (length(key) between 1 and 200),
  -- null is a deletion, kept so other devices hear about it.
  data jsonb check (data is null or (jsonb_typeof(data) = 'object' and pg_column_size(data) < 20000)),
  -- When the device made the change (ms). The newest change wins.
  saved_at bigint not null,
  -- When the server took it. Devices pull what changed since they last looked.
  updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, store, key)
);

create index vault_rows_changed on public.vault_rows (user_id, updated_at);

-- Two devices that were both offline push in any order: an older change
-- arriving second is dropped rather than overwriting a newer one.
create function public.vault_rows_newest_wins() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.saved_at < old.saved_at then
    return null;
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger newest_wins before update on public.vault_rows
  for each row execute function public.vault_rows_newest_wins();

alter table public.vault_rows enable row level security;

revoke all on public.vault_rows from anon;
grant select, insert, update, delete on public.vault_rows to authenticated;

create policy "read own rows" on public.vault_rows
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "add own rows" on public.vault_rows
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "change own rows" on public.vault_rows
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "delete own rows" on public.vault_rows
  for delete to authenticated using ((select auth.uid()) = user_id);
