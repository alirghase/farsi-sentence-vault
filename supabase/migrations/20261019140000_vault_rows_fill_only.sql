-- A change dated 0 only fills a gap. Signing in on a second device pushes its
-- settings dated 0, and they must not reset the account's to that device's
-- defaults when the account already has some.
create or replace function public.vault_rows_newest_wins() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.saved_at < old.saved_at or new.saved_at = 0 then
    return null;
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
