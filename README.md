# LuckyFinexis

Lucky draw pass management for a financial advisory firm's client campaign: a consultant sees every client on
their book, how many valid boarding passes each holds, and exactly how each one was earned.

This repository currently holds the **front end** — a Vite + React + TypeScript app built for
Cloudflare Pages, talking to Supabase. It runs today against a built-in demo dataset, so the
whole portal can be clicked through before a Supabase project exists.

```bash
npm install
npm run dev          # http://localhost:5173, demo data, no backend needed
npm test             # 171 tests over the pass arithmetic, CSV parser, ingest rules and providers
npm run build        # tsc -b && vite build -> dist/
```

## The two views

| Role | Route | What it shows |
|---|---|---|
| **Consultant** | `/clients` | Every client of theirs holding passes — name, mobile, email, live gold and blue totals, a Winner badge on anyone who has taken a draw — with the full breakdown behind the magnifier icon, campaign details, and past monthly winners. |
| **Admin** | `/admin` | CSV upload for pass activity, with a dry run before anything is written. |
| **Admin** | `/admin/draws` | Record the result of a draw — winners by mobile number, and what they won. |
| **Both** | `/winners` | Every draw that has been run, month by month — every winner in the firm, named, with what they won. |
| **Both** | `/profile` | Your own account details, and changing your password. Reached from the person icon in the rail. |

One sign-in form serves both. Which portal you land on is decided by the role on your
record, not by the form you used.

**Clients are records, not users.** They do not sign in and have no page of their own: the
database carries no auth link on `clients`, and a client's standing reaches them through
their consultant. The full statement — totals, the activity breakdown, prizes won — is
rendered behind the magnifier icon on the consultant's table.

A consultant with no qualifying clients still gets their page, with an empty table — being at
zero early in a campaign is a normal state, not an error.

## How passes work

Two pass types, gold and blue, each earned through campaign activities that are **data, not
code**. Adding "Refer a colleague — 4 passes per referral" is a row in `activities`; the
statement, the totals and the CSV importer all pick it up with no code change.

The demo campaign ships the activities from the campaign brief:

| Activity | Pass type | Rate |
|---|---|---|
| Purchase Qualifying Product | Gold | 21 per case |
| Successful Referral Purchase | Gold | 21 per referral |
| Submit Referrals | Blue | 2 per referral |
| Attend Client Events | Blue | 5 per event |
| Bring Guests For Events | Blue | 10 per guest |
| Submit A Testimonial | Blue | 3 |
| Download finConnect | Blue | 1 |

**A pass has a status.** `valid` counts toward a draw. `pending` is earned but not yet
countable — a policy still inside its free-look window, a referral that has not completed.
`void` is a pass that was clawed back, kept rather than deleted so the ledger stays auditable.
Only valid passes appear in a total; pending and voided ones are summarised beneath the table
so a client can see why a number is lower than they expected.

**A pass belongs to one ballot, and is used up by it.** Not used up on winning — used up on
entering. Everyone who put passes into August's draw comes out of it with those passes gone.
Entry is automatic: anything in the ledger for a month is in that month's ballot.

**Which ballot depends on the pass type**, because gold and blue are drawn on different
schedules. `drawSchedule` in `getCampaign` holds this:

| Pass type | Schedule | Effect |
|---|---|---|
| Blue | `monthly` | Enters the draw for the month it was earned. Never carried forward. |
| Gold | `campaign_end` | Accumulates until the single draw at campaign close, then all of it goes at once. |

If gold turns out to be drawn monthly too, that one value is the only thing that changes.

**A confirmed pass is therefore in one of four states**, decided in one place — `passState`
in `src/lib/passes.ts` — and everything on screen derives from it:

| State | Condition | Shown as |
|---|---|---|
| `live` | its ballot is the one now collecting | counted in the headline total |
| `upcoming` | deferred to a later ballot via `draw_month` | "enters a later draw" |
| `awaiting` | its ballot closed, the draw is not recorded yet | "Awaiting result" |
| `drawn` | its ballot has been run | "Won — *prize*", or "Unsuccessful" |

The split between `live` and `awaiting` is the one that earns its keep. September's draw is
run *in* October, so for a few days a client holds both September's closed ballot and
October's open one. Adding them into a single "Blue Passes" number would show two ballots as
one, so the column is the ballot now collecting and nothing else — with the rest accounted
for beneath the table and, month by month, behind **Previous Passes**.

**None of this is stored.** A pass is used up once `draws.is_drawn` is true for its ballot,
so recording a draw needs no writes to the ledger at all — which matters, because Cloudflare
Pages Functions have no cron triggers and there is therefore no scheduled job to miss.
`consumedByDrawId` on the ledger still retires an individual pass by hand, for administrative
corrections.

`draw_month` defaults to the month of `earned_on` and can be set later to defer a pass into a
following draw, never earlier.

**Some activities count once per client.** Downloading the app and submitting a testimonial
happen once; further ledger rows for them are the same event re-exported, not a second award.
`ONCE_PER_CLIENT` in `src/lib/campaignRules.ts` names them by activity code — `finconnect`
and `testimonial`. These must match `challenge_types.code` exactly: a code that does not
exist makes the cap silently do nothing, which is what happened when the list was first
written from the demo dataset's codes rather than the database's.

The cap is applied **on read**, not only on import. The importer refuses a second one, but
rows already in the ledger from before it existed — or written straight into Supabase — would
otherwise keep counting. Of a
client's non-void rows for such an activity the earliest survives, capped to **one unit**;
the rest are ignored silently. It is a cap on units rather than passes, which is what keeps
a capped testimonial worth its full 3 passes rather than 1. A voided row never holds the
slot, so a cancelled testimonial does not block the real one.

To move the list into the database: add a boolean column to `challenge_types`, read it in
`toActivity`, and delete `campaignRules.ts`. Nothing else refers to those codes.

## The ledger, and why uploads are safe to repeat

Pass activity is an **append-only ledger**. An upload never overwrites anything: each row either
becomes a new pass event, is recognised as one already stored, or is rejected with a reason.

A row is "already stored" when its client, activity, date and reference all match an existing
entry. That is the natural key, and it is why re-uploading last month's export adds nothing
rather than doubling everybody's passes. `reference` — a policy number, a referral name, an
event name — is what separates two genuinely different events on the same day.

**A reference is not globally unique, and must not be.** Two clients at the same briefing
carry the same `reference`, and that is the correct record of what happened — the pair
(client, activity, date, reference) is what has to be unique, not the reference alone.
`pass_ledger` originally had `unique (external_ref)` across the whole table, which forced the
loader to synthesise strings like `August:someone@example.com:purchase_product` to get past
it. That is the snapshot's signature: the constraint did not merely coexist with the
double-counting bug, it required the shape that caused it. `0006` drops it, leaving the
natural-key index from `0005` to do the job properly.

The key is built from the **resolved client**, not from whatever text the file used to name
them. A spreadsheet may identify a client by email one month and by a client code the next;
keyed on the raw text those are two different keys for one event, and re-running a load would
double the passes. `pass_ledger` carries a unique index on the same five values, so the
guarantee survives the application layer being bypassed, or two admins loading the same file
at once.

For a once-per-client activity the date and reference are exactly what must *not* make a
second one distinct, so those rows are matched on client and activity alone — against the
ledger and against earlier rows in the same file, so one upload carrying two finConnect rows
for a client lands only the first.

Uploading is two steps on purpose. The file is validated and reported on first, and nothing is
written until the counts are confirmed, so a mis-mapped column shows up as a page of rejected
rows instead of a month of wrong pass counts.

### CSV columns

Required: `client_ref`, `activity_code`, `units`, `earned_on`.
Optional: `fc_code`, `client_name`, `client_email`, `client_mobile`, `reference`, `draw_month`,
`status`, `void_reason`.

Header names are matched loosely, so `Client Ref` and `client_ref` both land. The admin page
documents every column, lists the live activity codes, and offers a blank template built from
that same rate card — so the example rows are, by construction, rows that import.

### How `client_ref` is matched

**Any identifier that names one client**: their email address, their client code, or their id.
Every choice of a single one was wrong for someone — `clients` has no reference column, so the
Supabase mapping puts the primary key in `externalRef`, and nobody types UUIDs into a
spreadsheet. Accepting all three works with emails today and with a proper client code the day
one exists, with no further change.

A value matching **two** clients is rejected with a reason rather than assigned to one of them.
Couples who are both clients of the same consultant often share an email address, and silently
filing one person's passes against their spouse is worse than refusing the row. Worth knowing
before a first load:

```sql
select client_email, count(*) from clients
 where client_email is not null group by client_email having count(*) > 1;
```

### What the database enforces

Worth knowing before writing an importer or loading by hand:

| Constraint | Effect |
|---|---|
| `passes_awarded` is **generated** as `units * rate_applied` | An insert that supplies a value for it is refused outright. Write the rate; the total is derived. |
| `status` CHECK | Only `pending`, `confirmed`, `rejected`. The app's `valid` and `void` are mapped on write by `STATUS_TO_DB` and read back by `asStatus`. |
| `challenge_code` foreign key | A typo'd activity code is refused rather than silently earning nothing. |
| `units > 0`, `rate_applied > 0` | Checked before the row lands, as well as in the preview. |

### Reloading the ledger

`supabase/migrations/0005_pass_ledger_writes.sql` is what makes the importer able to write, and
`supabase/checks/ledger-shape.sql` is a read-only file of queries that confirm a load landed as
an event log rather than as a snapshot. Both carry their own instructions.

## Recording a draw

Draws are run offline; the portal records the outcome. `/admin/draws` takes the winners of one
draw — identified by **mobile number**, because that is what comes back on a draw sheet — and
publishes them.

Publishing is two writes, and **the order is the whole of the safety**, because there is no
transaction spanning them:

1. The prize rows go into `prizes_won` while the draw is still open. Every read of a prize
   gates on `is_drawn`, so until step 2 those rows are invisible to everyone. A failure here
   leaves the campaign exactly as it was.
2. `draws.is_drawn` is set true. **This is what spends the passes** — every pass in that ballot
   goes from `awaiting` to `drawn`, and each entrant sees either "Won — *prize*" or
   "Unsuccessful".

Reversed, a failure between the two would spend the firm's passes with no winners to show for
it. `undoDraw` mirrors the same reasoning in the opposite direction: reopen first, then delete.

A mobile number that matches **two** clients is refused rather than guessed at — the same rule
as the importer's `client_ref`, for the same reason. A client holding no passes in the draw is
refused too: they were not entered into it, so a number that resolves to them is a typo that
happens to hit a real person.

### The winners page names everyone

`/winners` lists every winner in the firm in full, not only the reader's own clients. The names
come from `prizes_won.winner_name`, written when the draw is recorded, rather than from a join
onto `clients`.

That choice is the reason the page can name everyone without widening anything. A policy
letting any consultant read the `clients` row of any winner would work, and would hand over
those winners' email addresses and mobile numbers too — a policy admits a row, and the row has
columns. The page only ever wanted a name, so the name is what it stores.

It also makes the list a record of what was announced rather than a live lookup: a client
renamed or removed next year does not rewrite a result the firm has already published. The
trade is that a name corrected afterwards does not propagate — correct it by undoing the draw
and recording it again.

To make the page own-clients-only instead, drop the `prizes_won_firm_read` policy from `0007`.
No code changes: rows the reader cannot see simply stop appearing.

Undo reopens the draw and removes its winners. It is the one place the app deletes anything,
and that is deliberate: `pass_ledger` records things that happened and is corrected by voiding
rows, while `prizes_won` records a *published result*, and a result typed in wrongly was never
a result. See `supabase/migrations/0007_draw_results.sql`.

## Architecture

```
Browser ──► Cloudflare Pages (static React app)
   │
   ├──► Supabase PostgREST      reads, constrained by row level security
   │                            plus the admin-only CSV import (see below)
   └──► Supabase Auth           email + password for consultants and admins
```

There are no Pages Functions and no service role key anywhere. **The CSV import writes to
`pass_ledger` from the browser**, which is a deliberate exception to the rule that privileged
writes go through a server: the write is admin-only and insert-only, admin is claimed from
`app_metadata` — the one part of the JWT a user cannot edit — and the property that actually
matters, that re-running a load changes nothing, is enforced by a unique index rather than by
the code that calls it. There is no UPDATE or DELETE grant at all, so the ledger stays
append-only whatever a policy says later. A Pages Function becomes the right answer once there
is a second privileged write to justify one.

Reads go straight from the browser to Supabase. **Row level security is the access control** —
a consultant asking for every pass event in the firm simply receives their own clients'. The
`.eq()` filters in `src/data/supabaseApi.ts` keep responses small; they
are not what keeps them safe. `RequireRole` in the router is the same: a convenience that
avoids showing someone a page of failed queries, not a security boundary.

Because of that, **the client list is not filtered on `advisor_id` at all.** That value
reaches the query from React state, which anyone can edit in devtools, so filtering on it
would make a browser-supplied string the thing that decides whose book comes back. The query
asks for every client and row level security returns exactly the caller's own. The result is
then checked against the signed-in consultant, and a mismatch throws rather than renders —
so a policy loosened by accident surfaces as a refusal instead of a quiet leak.

The same reasoning runs through the error messages. Postgres errors name tables, columns and
policies, and the sign-in screen is reachable by anyone; so the detail goes to the console and
the user gets a message that tells them what to do next and nothing about the schema.

Privileged writes never happen from the browser. The service role key belongs only in a Worker
secret. Anything named `VITE_*` is compiled into the JavaScript the browser downloads.

### Sessions

A session must never outlive the app's willingness to use it. `signInWithPassword` writes a
session to browser storage *before* anything knows whether the account maps to a consultant
record, so every path that refuses a user — no `advisors` row, an unreadable `advisors`
table — calls `signOut()` on the way out. Without that, a refused sign-in leaves a live,
auto-refreshing token in `localStorage` while the app reports the user as signed out: a
session nobody can see and nothing ends.

`onSessionChange` watches for the session ending underneath the app — an expired or revoked
token, a failed refresh, a sign-out in another tab — and on a token refresh re-checks that
the account still resolves, which is what catches an advisor record removed mid-session.

This matters more than it looks, because **row level security answers a denied read with an
empty result, not an error**. A dead session does not produce a single error message; it
produces a consultant being told their book is empty. The watch is what turns that into
"your session has ended, please sign in again".

Grants are `SELECT` to `authenticated` only. `anon` is revoked: the app never queries before
sign-in, so an anonymous key should reach nothing at all.

`supabase/migrations/` holds the changes that got it there, each with its reasoning and its
undo in the comments. They are run by hand in the SQL editor — there is no migration runner
wired up, so the numbering is a record of what was applied and in what order rather than
something a tool enforces. A gap in the sequence means a migration was written and then
superseded before it ran.

**A view is the one thing that can walk past all of this.** Views run with their owner's
permissions unless `security_invoker` is set, and the owner of these tables is exempt from
their RLS — so a view over `pass_ledger` returns the whole firm's ledger whatever the
policies say. `0004` drops the one that existed. Any view added later needs
`with (security_invoker = true)` or it reopens the same hole.

### Headers

`public/_headers` carries a Content-Security-Policy, and it is load-bearing rather than
decorative: the signed-in session lives in `localStorage`, so any script running on this
origin can read it. `script-src 'self'` means only the hashed bundle runs, and `connect-src`
pins the single backend the app may talk to — so a compromised dependency has nowhere to send
a stolen token. `'unsafe-inline'` appears in `style-src` only, for React's `style={{ }}`
attributes; scripts get no such exemption.

Production builds emit no source map. Pages serves `dist/` wholesale, so an emitted `.map`
is published next to the bundle and hands any visitor the full annotated source.

### Changing your own password

`/profile` is the only page in the portal that writes anything, and it writes nothing to the
campaign — only to the signed-in user's own auth record. Name, role and sign-in email are
shown there but are read-only; they are set by an administrator.

**The change requires the current password.** Supabase will set a new one on the strength of
a session alone, which makes an unattended laptop enough to take a consultant's account away
from them. `reauthenticate` in `src/data/supabaseApi.ts` signs in again with the current
password first, and nothing is written if that fails. Naming the reason — "that is not your
current password" — is safe here in a way it is not on the login screen: whoever is asking is
already signed in as this account.

The minimum length is set in `ProfilePage.tsx`, not in Supabase, and is stricter than
Supabase's own floor. The server is still the authority; this just fails faster and with a
better message.

### Paging

PostgREST answers at most `db-max-rows` — 1000 on Supabase by default — and **says nothing
when it truncates**. There is no error and no flag; the response is simply short. Left
unpaged, a consultant's pass totals would quietly lose whatever fell past the cap, and the
number on screen would look entirely plausible while being wrong.

So every read that can grow is paged through `fetchAll` in `src/data/supabaseApi.ts`, which
follows `range()` until a short page comes back. The ledger is the one that actually grows —
one row per qualifying activity per client for a whole campaign — and it is fetched in
chunks of 100 client ids, because every id goes into the query string and a few hundred
UUIDs makes a URL long enough to be rejected outright.

**Every paged query orders by something unique.** `range()` pages by offset, so rows the
database is free to return in any order can appear on two pages or on none. Where the natural
sort is not unique — a client's name, a draw's date — the primary key is added as a tiebreak.
That detail is easy to miss and produces duplicated or missing rows rather than an error.

### When something throws

React unmounts the whole tree on an unhandled render error, so without a boundary a crash is
a blank white page — no message, no way back, and nothing to tell a consultant whether the
problem is theirs or ours.

There are two, and the placement is the point. The one inside `AppShell` wraps the page
content only, so a crash leaves the rail, the account bar and **sign-out** working: on a
shared machine, still being able to end the session matters more than a tidier error page.
The one in `main.tsx` is the last resort, covering what sits outside the shell — the login
page, the router, the auth provider.

The inner boundary is keyed on the path. React does not clear a boundary's error state when
the route changes, so without that the error follows you as you navigate and the way out is
not a way out.

What reaches the user is the error's name and message in a collapsed block — enough to paste
into a support message — and no stack trace. The console gets everything.
`componentDidCatch` is the one line that changes when an error tracker is wired up, and
until then a support call is the first anyone hears about a crash.

### Freshness

Pass counts get read out to clients, so the consultant's page refetches when the tab comes
back to the foreground — throttled to once every 30 seconds — and carries a Refresh control
for when that is not enough. Reads go directly to Postgres; there is no cache in between, so
what is on screen is what the database held at the moment of the last fetch.

### Layout

```
src/
  lib/         types, pass arithmetic, CSV parser, ingest rules, formatting   (no React)
  data/        api.ts (the interface) + mockApi / supabaseApi + the selector
  auth/        AuthProvider, RequireRole
  components/  AppShell, ClientStatementPanel, Modal, CampaignDetailsModal, icons
  pages/       LoginPage, AdvisorPage, AdminPage
  styles/      tokens.css, app.css
```

Pages import the `PortalApi` interface, never a provider, so swapping the backend touches only
`src/data/`. The pass rules live in `src/lib/` with no React import, which is what makes them
testable and what will let the Worker reuse them.

The client statement is one component, `ClientStatementPanel` — so there is exactly one
description of how a client's passes add up, wherever it is shown.

## How the app maps onto the database

The schema this connects to uses its own names, and `src/data/supabaseApi.ts` is the whole
of the translation — nothing outside `src/data/` knows the database exists.

| App concept | Table | Notes |
|---|---|---|
| Pass event | `pass_ledger` | `passes_awarded`, falling back to `units × rate_applied` |
| Activity | `challenge_types` | Keyed by `code`; a global rate card, not per-campaign |
| Draw | `draws` | One row per month **per pass type**; `is_drawn` is what spends the passes entered into it |
| Winner | `prizes_won` | No display name column, so names are shortened from `clients` |
| Consultant | `advisors` | Linked to auth by `auth_user_id` |

Some judgement calls worth knowing about:

- **The draw month comes from `monthly_draw`, not `draw_date`.** This was the other way
  round and it was wrong: `draw_date` is when the draw is *held*, and the convention in
  this schema is the 7th of the following month — July's draw runs on 2026-08-07,
  December's on 2027-01-07. Slicing the year-month off it put every draw one month late,
  which shifts every pass into the neighbouring ballot. `monthly_draw` is free text, so it
  is matched on its first three letters and paired with the year that places it at or
  before the draw date; that is what keeps December 2026's draw out of 2027.
- **`pass_ledger.draw_id` is read as the draw a pass is entered into**, setting the month it
  counts for. Without one, the month comes from `occurred_on`.
- **`pass_ledger.status` is folded from free text** — anything containing "void", "cancel",
  "reversed" and similar is void; "pending", "provisional", "free-look" and similar are
  pending; everything else counts. Narrow `VOID_WORDS` / `PENDING_WORDS` if the column
  carries states those miss.
- **Whether a pass is used up reads `draws.is_drawn`, not a column on the ledger.** There is
  no consumed column, and none is needed: a pass is used up by the ballot it is in, so
  marking a draw drawn is the whole of the write.
- **`drawSchedule` is stated in code, not stored.** `campaigns` has no column for it yet, so
  `getCampaign` sets blue monthly and gold at campaign close. Move it to the table when a
  second campaign needs different terms.
- **Once-per-client activities are stated in code too**, in `src/lib/campaignRules.ts`,
  because `challenge_types` is a rate card with no column for it.
- **Roles.** There is no profiles table: the `advisors` row is the source of truth, and an
  admin is marked by `app_metadata.role`, which only the service role can set. A sign-in
  matching neither is refused rather than defaulted.
- **Clients cannot sign in.** `clients` has no auth column; they are records, not users.
- **Winner names follow RLS.** They are read from `clients`, so an advisor sees their own
  clients named and everyone else's as "A client" — the firm-wide list is only as legible
  as the policies allow.

## Running against Supabase

```bash
cp .env.example .env
# VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, and VITE_USE_MOCK=false
```

If either key is missing the app falls back to demo data rather than failing — the yellow
"Demo data" banner is how you tell.

The app expects these tables — `profiles`, `advisors`, `clients`, `campaigns`, `activities`,
`pass_events`, `draws`, `draw_winners` — and a private `campaign-assets` storage bucket. Column
names are the snake_case of the types in `src/lib/types.ts`; `src/data/supabaseApi.ts` has the
exact shape of every row it reads.

## Deploying to Cloudflare Pages

Connect the repo in the Cloudflare dashboard under Workers & Pages → Create → **Pages**
→ Connect to Git, and set:

| Setting | Value |
|---|---|
| Production branch | `main` |
| Framework preset | Vite |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | (leave empty) |

Or from your machine:

```bash
npx wrangler login
npm run pages:deploy
```

Environment variables are build-time, so changing one needs a fresh build to take effect.
For a demo deployment with no backend, `VITE_USE_MOCK=true` is the only one required. For a
real deployment set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

The **service role key has no home in this project at all** — not as a `VITE_` variable, where
it would be compiled into the bundle every visitor downloads, and not as a Pages secret either,
since there is no server-side code to read one. Anything that needs it is run by hand in the
Supabase SQL editor. The anon key is safe to commit: its only claim is `role: anon`, and row
level security gates every table.

`public/_redirects` serves the shell for every path, so a deep link like `/clients` returns
the app rather than a 404. `public/_headers` sets the security headers and caches hashed
assets. `.nvmrc` pins the build to Node 22.

This targets Pages, not Workers. The two use different deploy paths: a Pages project needs
`pages_build_output_dir` in `wrangler.jsonc` (as here), while a Worker needs an `assets`
block instead — `wrangler deploy` refuses to run against a config carrying the Pages key,
and vice versa.

## Not built yet

Still to come, in rough order:

1. **Admin: campaign artwork** — the mockups have an admin uploading the campaign
   details image. It is read correctly by the consultant view but has no editor yet, so the
   details pop-up falls back to the campaign's earning rules rendered from the activity table.
2. **Account provisioning** — invite, first-login password set, and password reset.
3. **Sub-admin role** — a restricted admin that can import data but not manage campaigns.
4. **Error monitoring** — the error boundary keeps a crash from blanking the page, but nobody
   is told it happened. Until something reports them, a crash is only ever discovered by the
   person it happened to.

Winners are listed to other consultants by first name and last initial. Revisit that with
whoever owns client privacy before launch.
