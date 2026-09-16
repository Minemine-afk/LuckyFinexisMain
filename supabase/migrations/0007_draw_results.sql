-- 0007 — let an administrator record the result of a draw from the portal.
--
-- Run this before using the "Record a draw" screen. Requires 0005, which
-- created `public.is_admin()`.
--
--
-- ## What recording a draw actually does
--
-- Two writes. A row per winner in `prizes_won`, and `draws.is_drawn` set true.
--
-- The second is the one that matters. A pass belongs to one ballot and is used
-- up by it, and `is_drawn` is the whole of that record — nothing is ever written
-- back to `pass_ledger` when a draw runs. So flipping this one boolean turns
-- every entrant's passes from "awaiting a result" into either "Won — prize" or
-- "Unsuccessful", across the whole firm, at once.
--
-- That is why the grants below are narrower than they look like they need to be.
--
--
-- ## Before running: see what is already there
--
-- `prizes_won` has never been inspected. Expect a primary key and foreign keys,
-- and check for a unique constraint that would conflict with the index below:
--
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'public.prizes_won'::regclass order by conname;
--
--   select policyname, cmd, roles, qual from pg_policies
--    where tablename in ('draws', 'prizes_won') order by tablename, policyname;
--
-- The SELECT policies already there are what let consultants read winners. This
-- file does not touch them.


-- ---------------------------------------------------------------------------
-- 0. Row level security actually on
-- ---------------------------------------------------------------------------
-- Both should already have it, and on this database they do — so these two
-- lines are expected to change nothing. They are here because of what happens
-- if that assumption is ever wrong.
--
-- A policy does not enforce anything by existing. With RLS off, Postgres ignores
-- every policy on the table and the GRANT alone decides — so the `draws` grant
-- below would let *any* signed-in consultant close a draw, spending every pass
-- in it across the whole firm, with the admin-only policy sitting right there
-- looking like it was preventing exactly that.
--
-- Found by testing this file against a replica where RLS happened to be off on
-- `draws`: the consultant's UPDATE succeeded, and nothing about the migration
-- said it would.
alter table public.draws enable row level security;
alter table public.prizes_won enable row level security;


-- ---------------------------------------------------------------------------
-- 1. One prize per client per draw
-- ---------------------------------------------------------------------------
-- Makes a double-submit idempotent, the same way `pass_ledger_natural_key` does
-- for the importer: the second click is absorbed by the database rather than
-- listing a winner twice. The portal's insert names this index as its conflict
-- target, so without it `on conflict` has nothing to arbitrate on and the call
-- fails outright.
--
-- Run the duplicate check first if the table already has rows:
--
--   select draw_id, client_id, count(*) from public.prizes_won
--    group by 1, 2 having count(*) > 1;
create unique index if not exists prizes_won_draw_client
  on public.prizes_won (draw_id, client_id);


-- ---------------------------------------------------------------------------
-- 2. Policies
-- ---------------------------------------------------------------------------
-- OR'd on top of the existing SELECT policies, which stay as they are.

drop policy if exists prizes_won_admin_insert on public.prizes_won;
create policy prizes_won_admin_insert on public.prizes_won
  for insert to authenticated
  with check (public.is_admin());

-- Delete is what the Undo button needs, and it is a real departure from how
-- `pass_ledger` is treated — that is append-only, and a mistake there is
-- corrected by a voiding row rather than by removing history.
--
-- The difference is what the two tables are. The ledger records things that
-- happened: a client did attend that event, and no later correction makes that
-- untrue. `prizes_won` records a *published result*, and a result typed in
-- wrongly was never a result at all. Withdrawing it is the honest correction,
-- and leaving a wrong winner on a firm-wide list because the schema preferred
-- purity would be the worse outcome.
drop policy if exists prizes_won_admin_delete on public.prizes_won;
create policy prizes_won_admin_delete on public.prizes_won
  for delete to authenticated
  using (public.is_admin());

-- No UPDATE policy on either table beyond the column grant below. A wrong prize
-- is undone and re-recorded, which leaves the draw visibly reopened in between
-- rather than silently changing what a client was told they won.
drop policy if exists draws_admin_update on public.draws;
create policy draws_admin_update on public.draws
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());


-- ---------------------------------------------------------------------------
-- 3. Grants
-- ---------------------------------------------------------------------------
grant insert, delete on public.prizes_won to authenticated;

-- **Column-level, and that is the point.** `monthly_draw` and `draw_date` are
-- what decide which ballot a draw *is* — the portal reads the period from
-- `monthly_draw` because `draw_date` is the 7th of the following month. A screen
-- able to rewrite either could move every pass in the campaign into a different
-- draw, and nothing on screen would look wrong while it did it. Recording a
-- result needs exactly one column, so it gets exactly one.
grant update (is_drawn) on public.draws to authenticated;

revoke update, delete, truncate on public.draws from authenticated;
grant update (is_drawn) on public.draws to authenticated;

revoke update, truncate on public.prizes_won from authenticated;
revoke all on public.prizes_won from anon;
revoke all on public.draws from anon;

-- `revoke update` above strips the column grant as well, so it is granted again
-- after. Ordering matters here: a table-level revoke is not a no-op against a
-- column-level grant, and doing these the other way round leaves no update
-- privilege at all and a screen that fails with "permission denied for table
-- draws" at the moment it tries to close a draw.


-- ---------------------------------------------------------------------------
-- Confirm
-- ---------------------------------------------------------------------------
-- Expect INSERT and DELETE on prizes_won, and UPDATE on draws limited to
-- is_drawn:
--
--   select table_name, privilege_type from information_schema.role_table_grants
--    where grantee = 'authenticated' and table_name in ('draws', 'prizes_won')
--    order by table_name, privilege_type;
--
--   select table_name, column_name, privilege_type
--     from information_schema.column_privileges
--    where grantee = 'authenticated' and table_name = 'draws';
--
-- Expect the three new policies alongside the existing SELECT ones:
--
--   select tablename, policyname, cmd from pg_policies
--    where tablename in ('draws', 'prizes_won') order by tablename, policyname;
