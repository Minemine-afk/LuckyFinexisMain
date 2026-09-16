-- 0008 — record the winner's name on the prize row.
--
-- Run after 0007. The winners page shows full names across the whole firm, and
-- this is what makes that possible without widening anything.
--
--
-- ## Why a column rather than a policy
--
-- The winners page reads `prizes_won`, which 0007 opened to every signed-in
-- user. A prize row carries a client **id**, so a name has to come from
-- `clients` — and `clients` is scoped per consultant, which is what made other
-- consultants' winners read as "A client".
--
-- The obvious fix is a policy letting anyone read the `clients` row of anyone
-- who has won a published draw. It works, and it hands every consultant in the
-- firm the email address and mobile number of every winner, because a policy
-- admits a row and the row has columns. The page wants a name.
--
-- So the name is written onto the prize row when the draw is recorded. Three
-- things follow, and all of them are improvements:
--
--   * Nothing about `clients` changes. A consultant reading another's winner
--     gets a name and a prize, and no route to anything else.
--   * The winners list becomes a record of what was published rather than a
--     live join. A client renamed or removed next year does not silently
--     rewrite or erase a result the firm has already announced.
--   * One fewer round trip on every read of the page.
--
-- The trade is that a name corrected after the fact does not propagate. For a
-- published result that is the right way round; correct it by undoing the draw
-- and recording it again, which is what the Undo button is for.

alter table public.prizes_won
  add column if not exists winner_name text;


-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------
-- Rows recorded before this column existed. Runs as the table owner in the SQL
-- editor, so row level security does not narrow it — every existing prize gets
-- its name, including winners belonging to consultants other than yours.
--
-- The app falls back to the `clients` join for any row still missing a name, so
-- this is a performance and completeness fix rather than something the page
-- depends on.
update public.prizes_won p
   set winner_name = c.client_name
  from public.clients c
 where c.id = p.client_id
   and p.winner_name is null;


-- ---------------------------------------------------------------------------
-- Confirm
-- ---------------------------------------------------------------------------
-- Expect no rows: every prize should now name its winner.
--
--   select id, client_id, prize_won from public.prizes_won where winner_name is null;
--
-- And the list the firm will see:
--
--   select d.monthly_draw, p.winner_name, p.prize_won
--     from public.prizes_won p join public.draws d on d.id = p.draw_id
--    where d.is_drawn order by d.draw_date desc, p.winner_name;
--
--
-- ## Worth deciding once, now
--
-- Every consultant can now see every winner's full name. That is the point of a
-- firm-wide winners list, and it is a wider thing than the portal did before —
-- previously a consultant could only ever learn the names of their own clients.
-- Prize values are visible alongside them.
--
-- To narrow it again later: drop `prizes_won_firm_read` from 0007 and the page
-- becomes own-clients-only, with no code change and no need to undo this file.
