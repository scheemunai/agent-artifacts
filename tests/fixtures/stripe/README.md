# Real Stripe payloads

These are not constructed fixtures. Each file is the verbatim `event` JSON Stripe delivered to
`POST /stripe/webhook` on **production**, read back out of the `stripe_events` ledger — which is why
that table stores the whole payload.

A payload we wrote ourselves can only ever assert what we already believed. `cancel_at_period_end`
was read for eighteen months on the belief that a portal cancellation sets it, and every test in
`stripe-webhook.test.ts` agreed, because every one of them was built by a helper that set the field
by hand. Stripe's own bytes are the only thing that can disagree with us.

## `live-cancellation-2026-09-06.json`

Five events, in delivery order, from one real subscription: checkout → paid → portal cancellation.

| # | Event | Type | `created` |
|---|---|---|---|
| 1 | `evt_1UCYLlDUb8k2DuQ8C6Rjc9vU` | `customer.subscription.created` | 1788671438 |
| 2 | `evt_1UCYLpDUb8k2DuQ8M2Dz9YHR` | `invoice.paid` | 1788671438 |
| 3 | `evt_1UCYLjDUb8k2DuQ8aw1CdMuP` | `checkout.session.completed` | 1788671439 |
| 4 | `evt_1UCYMpDUb8k2DuQ8KGAzU0dS` | `customer.subscription.updated` | 1788671506 |
| 5 | `evt_1UCYMqDUb8k2DuQ8rWzLoud0` | `customer.subscription.updated` | 1788671507 |

API version `2026-08-26.dahlia` — the version `createStripeClient` pins.

Event 4 is the cancellation, and it is the one that matters:

```
status                 active
cancel_at_period_end   false        <- the only field the mapping used to read
cancel_at              1791263432   <- where Stripe actually put the end date
canceled_at            1788671506
previous_attributes    { cancel_at: null, canceled_at: null, cancellation_details: { reason: null } }
```

`previous_attributes` does not mention `cancel_at_period_end`, so Stripe did not merely leave it
false — it never touched it. Event 5 is the same subscription a second later carrying only the
customer's written cancellation reason.

### Redactions

Personal data and tokenised URLs only. **No field any mapping reads was altered**, and no value was
reshaped — the redacted fields are replaced with obviously-fake constants, not deleted:

- `invoice.customer_email`, `invoice.customer_name`
- `invoice.hosted_invoice_url`, `invoice.invoice_pdf` (each embeds a bearer-ish access token)
- `checkout.session.customer_details.email`, `.name`
- `checkout.session.id` — the only high-entropy id in the set; nothing reads it
- `event.request.idempotency_key` on all five — Stripe's own request keys, nothing reads them, and
  they are exactly the shape a secret scanner is built to stop

Every other VALUE is exactly what Stripe sent, including the live `cus_`, `sub_`, `in_` and `price_`
ids — those are object identifiers, not credentials, and keeping them means the fixture still
reproduces the plan lookup production actually performed. The file is re-indented (it comes out of a
`TEXT` column and is formatted by Biome like every other file here), so it is the same JSON rather
than the same bytes; no key was added, removed or reordered.
