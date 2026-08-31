import { Layout } from '../components/layout.js';
import { ProductMark } from '../components/primitives.js';

/**
 * The legal pages: Terms, Refund & Cancellation, Privacy.
 *
 * Server-rendered from the app's own Layout rather than hosted anywhere else, for two reasons that
 * are both about the checkout. Stripe's `consent_collection.terms_of_service` renders a checkbox
 * linking to a URL the customer must be able to open BEFORE paying, and a payment page that links
 * off to a third-party document is a page that can break without anyone noticing. Keeping them here
 * means they deploy, version and 200 with the rest of the product.
 *
 * The BODY of each document is content, not code: `LEGAL_DOCUMENTS` below holds placeholder prose
 * that the founder's real text drops straight into. The routes, the links, the layout and the
 * checkout wiring are finished and do not change when the words do.
 */

export interface LegalSection {
  heading: string;
  /** Paragraphs. Rendered in order; each becomes its own <p>. */
  body: string[];
  /** Optional bullet list rendered after the paragraphs. */
  bullets?: string[];
}

export interface LegalDocument {
  slug: string;
  title: string;
  /** Shown under the title, e.g. "Last updated 31 August 2026". */
  updated: string;
  /** One-line summary, used as the meta description and the page standfirst. */
  summary: string;
  sections: LegalSection[];
}

/**
 * PLACEHOLDER CONTENT — awaiting the founder's final text.
 *
 * Every document says plainly that it is a draft, because the alternative is worse: a page that
 * looks like a finished contract but was written by neither a lawyer nor the company is a document
 * a customer could reasonably rely on. Saying "draft" costs nothing before launch and is honest.
 *
 * The company identity block is deliberately marked rather than invented. Guessing a legal entity
 * name, address or VAT number on a page that governs payments would be worse than leaving a
 * visible gap.
 */
const COMPANY_PLACEHOLDER =
  '[Company legal name], [registered address], [company registration number], [VAT number]. Contact: [contact email].';

const DRAFT_NOTICE =
  'This document is a placeholder pending final legal text. It does not yet state the binding terms of service.';

export const LEGAL_DOCUMENTS: Record<string, LegalDocument> = {
  terms: {
    slug: 'terms',
    title: 'Terms of Service',
    updated: 'Draft — pending final text',
    summary: 'The terms that govern use of Agent Artifacts.',
    sections: [
      {
        heading: 'Who we are',
        body: [COMPANY_PLACEHOLDER],
      },
      {
        heading: 'The service',
        body: [
          'Agent Artifacts lets you and your agents publish versioned documents and share them at stable public links. A free tier and a paid Pro subscription are available; what each includes is described on the pricing page.',
        ],
      },
      {
        heading: 'Your account and your content',
        body: [
          'You are responsible for the content you publish and for keeping your API keys secret. You retain ownership of what you publish. You grant us only the permission needed to store, render and serve it at the links you create.',
        ],
      },
      {
        heading: 'Acceptable use',
        body: [
          'Do not use the service to publish unlawful content, to infringe anyone else’s rights, or to attack the service or its other users. We may suspend an account that does.',
        ],
      },
      {
        heading: 'Subscriptions and billing',
        body: [
          'Pro is billed in advance, monthly or annually, through Stripe. Prices are shown in EUR on the pricing page. Applicable VAT is calculated by Stripe Tax at checkout based on your billing location.',
          'Your subscription renews automatically until you cancel it. You can cancel at any time from the billing portal in your account settings; access continues until the end of the period you have already paid for.',
        ],
      },
      {
        heading: 'Retention',
        body: [
          'Free artifacts are retained for the period stated on the pricing page. Pro artifacts are retained for as long as the subscription is active. Accounts that existed before paid plans were introduced keep unlimited retention.',
        ],
      },
      {
        heading: 'Availability and liability',
        body: [DRAFT_NOTICE],
      },
      {
        heading: 'Changes',
        body: [
          'We may update these terms. Material changes will be announced before they take effect.',
        ],
      },
    ],
  },
  'refund-policy': {
    slug: 'refund-policy',
    title: 'Refund & Cancellation Policy',
    updated: 'Draft — pending final text',
    summary: 'How cancellations and refunds work for Agent Artifacts Pro.',
    sections: [
      {
        heading: 'Cancelling',
        body: [
          'You can cancel a Pro subscription at any time from Settings → Billing → Manage billing. Cancellation takes effect at the end of the period you have already paid for; Pro features stay active until then, and you are not billed again.',
        ],
      },
      {
        heading: 'What happens to your artifacts',
        body: [
          'Cancelling does not delete anything immediately. When the paid period ends the account returns to the free tier and the free tier’s retention and footer rules apply from that point on.',
        ],
      },
      {
        heading: 'Refunds',
        body: [DRAFT_NOTICE],
        bullets: [
          'Statutory rights for consumers in the EU and elsewhere are unaffected by this policy.',
          'If you were charged in error, contact us and we will put it right.',
        ],
      },
      {
        heading: 'Failed payments',
        body: [
          'If a renewal payment fails, we retry it over several days and email you. Pro features stay active during that window. If every retry fails, the subscription ends and the account returns to the free tier.',
        ],
      },
      {
        heading: 'Contact',
        body: [COMPANY_PLACEHOLDER],
      },
    ],
  },
  privacy: {
    slug: 'privacy',
    title: 'Privacy Policy',
    updated: 'Draft — pending final text',
    summary: 'What data Agent Artifacts collects and why.',
    sections: [
      {
        heading: 'Who we are',
        body: [COMPANY_PLACEHOLDER],
      },
      {
        heading: 'What we store',
        body: [
          'Your account email, the artifacts and versions you publish, and view counts for the links you share. API keys are stored only as hashes.',
        ],
      },
      {
        heading: 'Payments',
        body: [
          'Card details are handled entirely by Stripe and never reach our servers. We store a Stripe customer id, a subscription id, your plan and its status so we know what your account is entitled to.',
        ],
      },
      {
        heading: 'Your rights',
        body: [DRAFT_NOTICE],
      },
    ],
  },
};

export function legalDocument(slug: string): LegalDocument | undefined {
  return LEGAL_DOCUMENTS[slug];
}

export function LegalPage({ document }: { document: LegalDocument }) {
  return (
    <Layout title={`${document.title} · Agent Artifacts`} description={document.summary}>
      <div class="aa-page-shell">
        <header class="aa-marketing-header">
          <a class="aa-marketing-brand" href="/">
            <ProductMark />
          </a>
        </header>

        <main class="aa-shell aa-legal">
          <article class="aa-stack">
            <header class="aa-section-header">
              <p class="aa-page-kicker">Legal</p>
              <h1 class="aa-section-title">{document.title}</h1>
              <p class="aa-section-note">{document.summary}</p>
              <p class="aa-hint">{document.updated}</p>
            </header>

            {document.sections.map((section) => (
              <section class="aa-stack">
                <h2 class="aa-legal__heading">{section.heading}</h2>
                {section.body.map((paragraph) => (
                  <p>{paragraph}</p>
                ))}
                {section.bullets ? (
                  <ul>
                    {section.bullets.map((bullet) => (
                      <li>{bullet}</li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ))}
          </article>
        </main>

        <footer class="aa-marketing-footer">
          <div class="aa-shell aa-marketing-shell">
            <p class="aa-marketing-footer__links">
              <LegalFooterLinks />
            </p>
          </div>
        </footer>
      </div>
    </Layout>
  );
}

/**
 * The three legal links, in one place.
 *
 * Shared by the marketing footer and each legal page's own footer so the set cannot drift — a
 * checkout that promises a Terms link and a site that has lost it is exactly the kind of gap that
 * only shows up in an audit.
 */
export function LegalFooterLinks() {
  return (
    <>
      <a href="/terms">Terms</a>
      <span class="aa-marketing-separator" aria-hidden="true">
        ·
      </span>
      <a href="/refund-policy">Refunds</a>
      <span class="aa-marketing-separator" aria-hidden="true">
        ·
      </span>
      <a href="/privacy">Privacy</a>
    </>
  );
}
