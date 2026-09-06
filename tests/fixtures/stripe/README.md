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

## `test-refund-dispute-2026-09-06.json`

One €9 refund and one €9 chargeback, produced deliberately in **TEST mode** on the app's own Stripe
account and read back from `GET /v1/events`. Test mode, not production, because the production
equivalent is a real customer's money — and Stripe will not manufacture a chargeback on demand in
live mode. Same account, same pinned API version `2026-08-26.dahlia`, same code path: these are
Stripe's bytes, not ours.

```
{ "events": [ …4 events, in delivery order… ], "disputedCharge": { …one charge object… } }
```

| # | Event | Type | `created` |
|---|---|---|---|
| 1 | `evt_3UCZ6WDcuIe00H3n05poySbX` | `charge.refunded` | 1788674342 |
| 2 | `evt_3UCZ6WDcuIe00H3n0JnCpJ0O` | `charge.refund.updated` | 1788674343 |
| 3 | `evt_1UCZ6gDcuIe00H3n3CZd5j4d` | `charge.dispute.created` | 1788674350 |
| 4 | `evt_1UCZ6pDcuIe00H3nalbA7FGz` | `charge.dispute.closed` | 1788674359 |

`disputedCharge` is `ch_3UCZ6eDcuIe00H3n0rBqRNKv`, the charge event 3 points at. It is here because
of the fact this capture exists to prove:

```
charge.refunded        data.object.customer   "cus_VCz4YUkqHDx30A"
charge.refund.updated  data.object.customer   "cus_VCz4YUkqHDx30A"
charge.dispute.created data.object            has no "customer" key at all
charge.dispute.closed  data.object            has no "customer" key at all
```

A dispute cannot be resolved to an account the way every other handled event is, so the handler
reads the charge to get there — and the stub in `stripe-refunds-disputes.test.ts` answers that read
with this object rather than one we invented.

Two more things the real bytes settled, both of which a hand-written fixture would have got wrong:

- One refund fires **four** events — `refund.created`, `charge.refunded`, `refund.updated`,
  `charge.refund.updated`. The `refund.*` pair is not subscribed; it would log every refund twice.
- One chargeback fires `charge.dispute.created` **and** `charge.dispute.funds_withdrawn` in the same
  second. The second is the balance-transaction restatement of the first and is not subscribed.

### Redactions

Two fields, replaced with obviously-fake constants rather than deleted, exactly as above:

- `charge.receipt_url` wherever it appears, including inside `data.previous_attributes` — each embeds
  an access token
- `event.request.idempotency_key` on the three events that have one

Nothing else was altered. The card is Stripe's public test card, the billing details Stripe sent are
all `null`, and every `cus_`, `ch_`, `re_`, `du_`, `pi_` id is a test-mode object identifier, not a
credential. **No field any mapping reads was changed.** The file is re-indented by Biome like every
other file here.
