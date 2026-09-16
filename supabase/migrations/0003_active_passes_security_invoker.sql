-- Make the `active_passes` view respect the caller's row level security.
--
-- A Postgres view runs with the permissions of its OWNER, not its caller,
-- unless `security_invoker` is set. The owner is normally `postgres`, which
-- owns the underlying tables — and a table's owner is exempt from that table's
-- own RLS unless FORCE ROW LEVEL SECURITY is set (it is not, here).
--
-- So a view over `pass_ledger` hands its caller every row in the ledger,
-- whatever the policies on `pass_ledger` say. All seven base tables have RLS
-- enabled and well-formed policies; this view is the one thing that can walk
-- straight past them.
--
-- `security_invoker = true` makes the view evaluate as whoever queries it, so
-- the policies on the base tables apply normally. A consultant sees their own
-- clients' rows; `service_role` (which carries BYPASSRLS) still sees
-- everything, so any reporting job using the service key is unaffected.
--
-- Requires Postgres 15 or later. If this errors with "unrecognized parameter",
-- the project is on 14 and the fallback is to revoke access instead:
--
--   revoke all on public.active_passes from anon, authenticated;
--
-- The portal itself never queries this view — nothing in src/ references it —
-- so revoking is safe from the app's point of view. Check what else uses it
-- before choosing that route.

begin;

alter view public.active_passes set (security_invoker = true);

commit;

-- Confirm. Expect `{security_invoker=true}` in options:
--
--   select c.relname, c.reloptions
--     from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relname = 'active_passes';
--
-- Then, signed in as a consultant, confirm the view returns only their own
-- clients' rows rather than the whole firm's.
