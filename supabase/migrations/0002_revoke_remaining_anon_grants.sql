-- Finish what 0001 started.
--
-- 0001 revoked SELECT from `anon`, which closed the read risk, but Supabase's
-- default setup grants ALL on public tables — so TRIGGER, TRUNCATE and
-- REFERENCES survived it. Verified against the live project: every table still
-- listed those three for anon.
--
-- None of them is reachable through PostgREST (there is no TRUNCATE verb, and
-- `anon` is a NOLOGIN role only ever assumed by role-switching), so this is
-- defence in depth rather than an open door. It is also one line, and a
-- privilege that cannot be exercised today is still a privilege that does not
-- belong to an identity compiled into the public JavaScript bundle.
--
-- Safe to run more than once.

begin;

revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;

commit;

-- Expect zero rows:
--
--   select table_name, string_agg(privilege_type, ', ' order by privilege_type)
--     from information_schema.role_table_grants
--    where table_schema = 'public' and grantee = 'anon'
--    group by table_name order by table_name;
