# LuckyFinexis

Lucky draw pass management for a financial advisory firm's client campaign: a consultant sees every client on
their book, how many valid boarding passes each holds, and exactly how each one was earned.

This repository currently holds the **front end** — a Vite + React + TypeScript app built for
Cloudflare Pages, talking to Supabase. It runs today against a built-in demo dataset, so the
whole portal can be clicked through before a Supabase project exists.

```bash
npm install
npm run dev          # http://localhost:5173, demo data, no backend needed
npm test             # 65 tests over the pass arithmetic, CSV parser and ingest rules
npm run build        # tsc -b && vite build -> dist/
```

## The two views

| Role | Route | What it shows |
|---|---|---|
| **Consultant** | `/clients` | Every client of theirs holding passes — name, mobile, email, live gold and blue totals, a Winner badge on anyone who has taken a draw — with the full breakdown behind the magnifier icon, campaign details, and past monthly winners. |
| **Admin** | `/admin` | CSV upload for pass activity, with a dry run before anything is written. |
| **Both** | `/profile` | Your own account: the sign-in email and the password. Reached from the person icon in the rail. |

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

The cap is applied **on read**, not only on import — the ledger is loaded into Supabase
outside this portal, so duplicates already stored would otherwise keep counting. Of a
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
documents every column and offers a blank template.

## Architecture

```
Browser ──► Cloudflare Pages (static React app)
   │
   ├──► Supabase PostgREST      reads, constrained by row level security
   ├──► Supabase Auth           email + password for consultants and admins
   └──► Pages Functions ──► Supabase service role   CSV ingest and other privileged writes
```

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

### Headers

`public/_headers` carries a Content-Security-Policy, and it is load-bearing rather than
decorative: the signed-in session lives in `localStorage`, so any script running on this
origin can read it. `script-src 'self'` means only the hashed bundle runs, and `connect-src`
pins the single backend the app may talk to — so a compromised dependency has nowhere to send
a stolen token. `'unsafe-inline'` appears in `style-src` only, for React's `style={{ }}`
attributes; scripts get no such exemption.

Production builds emit no source map. Pages serves `dist/` wholesale, so an emitted `.map`
is published next to the bundle and hands any visitor the full annotated source.

### Changing your own account

`/profile` is the only page in the portal that writes anything, and it writes nothing to the
campaign — only to the signed-in user's own auth record.

**Both changes require the current password.** Supabase will change a password or a sign-in
email on the strength of a session alone, which makes an unattended laptop enough to take a
consultant's account away from them. `reauthenticate` in `src/data/supabaseApi.ts` signs in
again with the current password first, and nothing is written if that fails. Naming the
reason — "that is not your current password" — is safe here in a way it is not on the login
screen: whoever is asking is already signed in as this account.

Changing the email does not change it. Supabase sends a confirmation link and the current
address keeps working until it is followed; with *secure email change* enabled (the default)
a link goes to the current address too and both must be confirmed. The page says so rather
than implying the change has happened.

**Two things need to be right in the Supabase project** for the email half to work:

1. `https://<your-pages-domain>/profile` is in **Authentication → URL Configuration →
   Redirect URLs**. Supabase refuses a redirect that is not on the list.
2. Email templates and SMTP are working. The built-in sender is rate-limited and not meant
   for production.

`advisors.email` is not touched, and nothing in the app reads it — the sign-in identity lives
in `auth.users`. If you keep that column for your own records it will drift.

The minimum password length is set in `ProfilePage.tsx`, not in Supabase, and is stricter
than Supabase's own floor. The server is still the authority; this just fails faster and with
a better message.

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
real deployment set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, and keep the service
role key out of the browser entirely:

```bash
npx wrangler pages secret put SUPABASE_SERVICE_ROLE_KEY
```

`public/_redirects` serves the shell for every path, so a deep link like `/clients` returns
the app rather than a 404. `public/_headers` sets the security headers and caches hashed
assets. `.nvmrc` pins the build to Node 22.

This targets Pages, not Workers. The two use different deploy paths: a Pages project needs
`pages_build_output_dir` in `wrangler.jsonc` (as here), while a Worker needs an `assets`
block instead — `wrangler deploy` refuses to run against a config carrying the Pages key,
and vice versa.

## Not built yet

This pass is the front end. Still to come, in rough order:

1. **SQL migrations** — the tables above, plus the row level security policies the whole
   security model rests on. Nothing should reach production before these exist and are tested.
2. **Pages Functions** — `POST /api/uploads/preview` and `POST /api/uploads/commit`, which
   verify the caller's JWT, re-check that they are an admin, and reuse `src/lib/ingest.ts` so
   the browser and the server agree on what a valid row is. `supabaseApi` already calls them.
3. **Admin: record a draw** — draws are run offline and the result recorded. The app reads
   `draws.is_drawn` and `prizes_won` correctly, but has no screen to set them: both are
   entered in Supabase for now. The screen is a short one — pick the winner, name the prize,
   mark the draw drawn — and marking it drawn is what uses up every pass entered into it, so
   it needs saying plainly on the button. This is the most visible gap: until a draw is
   recorded, everyone who entered it sits in `awaiting`, looking at passes with no outcome.
4. **Admin: campaign artwork and winners** — the mockups have an admin uploading the campaign
   details image and publishing each month's winners. Both are read correctly by the
   consultant view; neither has an editor yet. Until artwork is uploaded, the details pop-up
   falls back to the campaign's earning rules rendered from the activity table.
5. **Account provisioning** — invite, first-login password set, and password reset.
6. **Sub-admin role** — a restricted admin that can import data but not manage campaigns.

Winners are listed to other consultants by first name and last initial. Revisit that with
whoever owns client privacy before launch.
