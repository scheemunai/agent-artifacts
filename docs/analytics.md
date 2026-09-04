# Readership analytics

How a view is counted, why the bot list is load-bearing, and how to maintain it.

## What counts

One read is recorded when the **artifact page is served** — `GET /a/:share_id`, in
`src/routes/public.ts`. The page carries the artifact inline, so a reader has read it whether or not
their browser runs any of our JavaScript. That is the whole reason counting lives there: the
previous mechanism recorded views on `/a/:id/content`, which only our own boot script requests, so
anyone blocking scripts read the artifact and counted zero.

`/content` counts nothing now, with one exception: a password-protected share renders a gate with no
content, so its read is the first `/content` request that carries a valid token.

Never counted: `HEAD`, prefetches, polls, refreshes, conditional 304s, downloads, OG cards, sandbox
frames, and the owner's own visits.

## Why the deny-list is load-bearing

`robots.txt` deliberately **invites** crawling of `/a/` (`src/routes/robots.ts`) — shared artifacts
are meant to be findable. Combined with server-side counting, that means every crawler that accepts
the invitation reaches the code path that records a read.

JS-based analytics products get bot rejection almost free, because crawlers do not execute
JavaScript. Counting server-side gives that up deliberately, in exchange for seeing readers who
block scripts. **The deny-list is what replaces it.** It is not belt-and-braces; it is the filter.

## Where it lives

| File | What it holds |
| --- | --- |
| `src/services/bot-signatures.ts` | `BOT_SIGNATURES` — the table, one row per family. Also the browser-shape check and the device buckets. |
| `src/services/analytics.ts` | `classifyView` — the seven layers the table sits inside. |
| `tests/unit/bot-signatures.test.ts` | Every row exercised, plus real browsers asserted to survive. |

## Adding a signature

It is a data change, not a code change:

1. Add a row to `BOT_SIGNATURES` in `src/services/bot-signatures.ts`. Give it a `name` — it is
   reported as the reject reason, so a surprise stays traceable to one row.
2. Add the user agent to `CRAWLERS` in `tests/unit/bot-signatures.test.ts`.
3. Run `pnpm test`. The suite also renders every real browser in `REAL_BROWSERS` through the table.

**Keep the catch-all last.** `self-declared` matches `bot|crawler|spider|…` and exists to catch what
nobody has listed. A named row above it gives a useful reason; the catch-all only says "it told us".

### The mistake to avoid

A pattern that is too broad silently zeroes a customer's numbers, and nothing about the product
looks wrong while it does. That is the more expensive failure of the two and the one nobody reports,
which is why `REAL_BROWSERS` is tested with the same weight as the crawlers. Anchor patterns where
you can (`/^curl\//`, not `/curl/`) and prefer a named family over widening the catch-all.

## Noticing a miss

`js_confirmed` exists for this. The viewer posts to `/a/:id/pulse` after boot, which stamps reads
already recorded for that reader. It never creates or removes a view — it only tells us whether the
client executes JavaScript.

So the signal is a **ratio**: of the reads on an artifact, how many were confirmed by something that
runs scripts. A healthy artifact sits high. An artifact whose ratio collapses is being read by
something that does not run scripts and is not in the table — which is either a crawler to add, or a
genuine audience of script-blockers. Both are worth knowing; only one is a bug.

```sql
-- Confirmation ratio per artifact, last 7 days. A sharp drop is the thing to look at.
SELECT artifact_id,
       COUNT(*) AS reads,
       SUM(js_confirmed) AS confirmed,
       ROUND(100.0 * SUM(js_confirmed) / COUNT(*)) AS pct
  FROM view_events
 WHERE at > (strftime('%s','now') - 7*86400) * 1000
 GROUP BY artifact_id
 HAVING reads > 50
 ORDER BY pct ASC;
```

There is no alerting on this yet. It is a query to run when a number looks wrong, and the honest
statement of where the filter's blind spot is.

## Retention and privacy

- `view_events` — 90 days, purged nightly by `runBackgroundSweeps`.
- `share_visitor_days` — same cutoff; it exists only to answer "was this reader new today", and a
  row that outlived its events would be a hash with nothing left to explain.
- `analytics_salts` — 48 hours. This is the privacy claim: once a day's salt is gone, that day's
  hashes cannot be re-derived or linked to any other day.

No IP address or user agent is ever written to disk. They exist in memory for at most one flush
interval and are reduced to a salted hash before anything is stored.

## What "readers" means

Identity rotates daily, so a reader is recognisable only within one UTC day on one artifact:

- over **24 hours**, readers is distinct readers;
- over **7 or 30 days**, it is the sum of each day's distinct readers.

It is labelled `readers` with the qualifier *counted once per artifact per day* everywhere it
appears (`src/ui/copy/analytics-copy.ts`). It was previously called "unique viewers", which claimed
a headcount over the whole range — true while a year-long cookie backed it, and false the moment
that cookie was removed.
