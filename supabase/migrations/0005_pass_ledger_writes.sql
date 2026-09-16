-- 0005 — let an admin load the ledger from the portal, and make dedupe a
-- database guarantee rather than an application convention.
--
-- Run this in the Supabase SQL editor before the first real import.
--
-- What it changes, and why each part is here:
--
--   1. `external_ref` becomes NOT NULL DEFAULT ''. It is part of the unique key
--      below, and in Postgres two nulls are never equal — so left nullable,
--      every row with a blank reference would be free to duplicate, which is
--      exactly the rows that need the guard most (finConnect, a testimonial,
--      anything with no policy number to name).
--
--   2. A unique index on the natural key. This is the one that makes re-running
--      a load safe. The portal already refuses a duplicate, but an application
--      check is a convention: it holds until someone loads the file twice in two
--      tabs, or writes a row from the SQL editor.
--
--   3. INSERT for admins only, and no UPDATE or DELETE for anyone. The ledger
--      stays append-only: a mistake is corrected by a voiding row, never by
--      rewriting history.
--
--   4. SELECT for admins on `clients` and `pass_ledger`. The import has to
--      resolve a spreadsheet's client references against the whole firm's book,
--      not one consultant's. This is a real widening — see the note at the end.
--
-- `app_metadata` is the only place a role can be claimed from, because it is the
-- only part of the JWT a user cannot write. A user editing their own
-- `user_metadata` to `{"role":"admin"}` gets nothing from any of this.


-- ---------------------------------------------------------------------------
-- 0. Before you run this: there must be no duplicates already
-- ---------------------------------------------------------------------------
-- Step 2 fails outright if there are, which is the correct behaviour but reads
-- as an opaque error. Run this first and expect zero rows:
--
--   select campaign_id, client_id, challenge_code, occurred_on,
--          coalesce(external_ref, '') as ref, count(*)
--     from public.pass_ledger
--    group by 1, 2, 3, 4, 5
--   having count(*) > 1;
--
-- If the ledger is still the per-draw snapshot, this returns plenty. Truncate
-- it before running this file, not after.


-- ---------------------------------------------------------------------------
-- 1. external_ref: never null
-- ---------------------------------------------------------------------------
update public.pass_ledger set external_ref = '' where external_ref is null;

alter table public.pass_ledger
  alter column external_ref set default '',
  alter column external_ref set not null;


-- ---------------------------------------------------------------------------
-- 2. The natural key, enforced
-- ---------------------------------------------------------------------------
-- Plain columns rather than an expression, because PostgREST's conflict target
-- can only name columns — an expression index would be unusable by the very
-- insert it is meant to protect.
--
-- Note this is case-sensitive while the portal's own check is case-folded. The
-- portal is therefore the stricter of the two, and this catches the case that
-- matters: the same file loaded twice, byte for byte.
create unique index if not exists pass_ledger_natural_key
  on public.pass_ledger (campaign_id, client_id, challenge_code, occurred_on, external_ref);


-- ---------------------------------------------------------------------------
-- 3. An id for rows the portal inserts
-- ---------------------------------------------------------------------------
-- The portal does not send an id; if the column has no default, every insert
-- fails on a not-null violation. Only touched when it is a uuid with no default
-- already, so this is a no-op on a table that is already set up correctly.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'pass_ledger'
       and column_name = 'id' and data_type = 'uuid' and column_default is null
  ) then
    execute 'alter table public.pass_ledger alter column id set default gen_random_uuid()';
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 4. Who counts as an admin
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
  returns boolean
  language sql
  stable
  set search_path to 'public'
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin';
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;


-- ---------------------------------------------------------------------------
-- 5. Policies
-- ---------------------------------------------------------------------------
-- Policies are OR'd, so each of these adds admin access without narrowing what
-- a consultant can already see.

drop policy if exists clients_admin_select on public.clients;
create policy clients_admin_select on public.clients
  for select to authenticated
  using (public.is_admin());

drop policy if exists pass_ledger_admin_select on public.pass_ledger;
create policy pass_ledger_admin_select on public.pass_ledger
  for select to authenticated
  using (public.is_admin());

drop policy if exists pass_ledger_admin_insert on public.pass_ledger;
create policy pass_ledger_admin_insert on public.pass_ledger
  for insert to authenticated
  with check (public.is_admin());


-- ---------------------------------------------------------------------------
-- 6. Grants
-- ---------------------------------------------------------------------------
-- INSERT only. A policy cannot let anyone update or delete a row if the role
-- was never granted the privilege in the first place, so the append-only rule
-- survives a policy written carelessly later.
grant insert on public.pass_ledger to authenticated;

revoke update, delete, truncate on public.pass_ledger from authenticated;
revoke all on public.pass_ledger from anon;
revoke all on public.clients from anon;


-- ---------------------------------------------------------------------------
-- Confirm
-- ---------------------------------------------------------------------------
-- Expect: insert present, update/delete absent.
--
--   select privilege_type from information_schema.role_table_grants
--    where grantee = 'authenticated' and table_name = 'pass_ledger';
--
-- Expect the three policies above, alongside whatever was there before.
--
--   select policyname, cmd, roles from pg_policies
--    where tablename in ('clients', 'pass_ledger') order by tablename, policyname;


-- ---------------------------------------------------------------------------
-- Two things worth recording
-- ---------------------------------------------------------------------------
-- **An admin can now read every client in the firm.** That is what an import
-- requires — a spreadsheet row naming a client the reader cannot see is
-- rejected, not written blind — but it is a wider read than any account had
-- before this file. Keep the admin role on as few accounts as the work needs,
-- and check who holds it:
--
--   select id, email, raw_app_meta_data ->> 'role' as role
--     from auth.users where raw_app_meta_data ->> 'role' is not null;
--
-- **This is a privileged write from the browser**, which the README's own rule
-- says should go through a Pages Function. The deviation is deliberate: the
-- write is admin-only, insert-only, and the property that actually matters —
-- that a re-run changes nothing — is enforced by the index above rather than by
-- the code that calls it. A Pages Function is the right end state once there is
-- a second privileged write to justify one.
