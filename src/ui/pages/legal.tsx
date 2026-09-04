import type { Child } from 'hono/jsx';
import { Layout } from '../components/layout.js';
import { MarketingHeader } from '../components/marketing.js';

/**
 * The legal pages: Terms, Refund & Cancellation, Privacy.
 *
 * Server-rendered from the app's own Layout rather than hosted anywhere else, for two reasons that
 * are both about the checkout. Stripe's terms-of-service checkbox links to a URL the customer must
 * be able to open BEFORE paying, and a payment page that links off to a third-party document is a
 * page that can break without anyone noticing. Keeping them here means they deploy, version and
 * answer 200 with the rest of the product.
 *
 * The documents are DATA, not markup: `LEGAL_DOCUMENTS` holds the text, and one renderer turns it
 * into pages. That is what keeps a wording change a content edit — no layout, no routes, no
 * checkout wiring moves when the lawyers do.
 */

/** Published date for all three documents. */
export const LEGAL_UPDATED = '30 August 2026';

/** The operating entity, stated once and reused, so three pages cannot disagree about it. */
export const LEGAL_ENTITY = {
  name: 'Zero Point Studio d.o.o.',
  address: 'Rudeška cesta 179, 10000 Zagreb, Croatia',
  vat: 'HR52438945902',
  email: 'hello@agentartifact.ai',
} as const;

export interface LegalSection {
  /** Omitted for a lead-in section that sits directly under the title. */
  heading?: string;
  /** Paragraphs. `**bold**` is honoured; everything else is escaped as text. */
  body?: string[];
  bullets?: string[];
}

export interface LegalDocument {
  slug: string;
  title: string;
  /** Meta description and page standfirst. */
  summary: string;
  sections: LegalSection[];
}

export const LEGAL_DOCUMENTS: Record<string, LegalDocument> = {
  terms: {
    slug: 'terms',
    title: 'Terms of Service',
    summary: 'The terms that govern your use of Agent Artifacts.',
    sections: [
      {
        body: [
          'These Terms of Service ("Terms") govern your access to and use of Agent Artifacts (the "Service") at agentartifact.ai. By creating an account or using the Service, you agree to these Terms. If you do not agree, do not use the Service.',
          `**Who we are.** The Service is operated by **${LEGAL_ENTITY.name}**, ${LEGAL_ENTITY.address} (VAT **${LEGAL_ENTITY.vat}**) ("Agent Artifacts", "we", "us"). Contact: **${LEGAL_ENTITY.email}**.`,
        ],
      },
      {
        heading: '1. The Service',
        body: [
          'Agent Artifacts lets you and your automated agents create, version, and publish web-based artifacts (Markdown and HTML documents) and share them via links. Features, limits, and availability may change over time.',
        ],
      },
      {
        heading: '2. Eligibility',
        body: [
          'You must be at least 16 (or the age of digital consent where you live) and able to form a binding contract. If you use the Service for an organization, you represent that you may bind it to these Terms.',
        ],
      },
      {
        heading: '3. Accounts and API keys',
        body: [
          'You are responsible for your account, your API/bot keys, and all activity under them. Keep your keys secret — anyone holding a key can act on your account. Tell us promptly of any unauthorized use. We may suspend accounts that create security or abuse risk.',
        ],
      },
      {
        heading: '4. Acceptable use',
        body: [
          "You are responsible for the content your account and agents publish. You must not use the Service to store, publish, or distribute content that is unlawful, infringing, or violates others' rights; is malicious (malware, phishing, or code intended to harm); harasses, defames, or violates privacy; or attempts to disrupt, overload, or gain unauthorized access to the Service or others. We may remove content or suspend accounts that breach these Terms and may cooperate with lawful requests.",
        ],
      },
      {
        heading: '5. Your content and license',
        body: [
          'You own the content you create ("Your Content"). You grant us a worldwide, non-exclusive licence to host, store, reproduce, and serve Your Content solely to operate and provide the Service — including rendering it on shareable pages when you choose to publish it. **Artifacts are private by default** and become publicly accessible only when you explicitly publish or password-protect them. You are responsible for having the rights to the content you publish.',
        ],
      },
      {
        heading: '6. Fees, payment, and refunds',
        body: [
          'The Service offers a free tier and a paid "Pro" plan (currently **€9/month or €90/year**, plus applicable taxes shown at checkout). Paid plans renew automatically each billing period until cancelled. Payments and taxes are processed by **Stripe**; by subscribing you also agree to Stripe\'s terms.',
          'You may cancel at any time from your dashboard. Cancellation takes effect at the end of the current billing period, and you keep Pro access until then. Except where required by law, fees are non-refundable and we do not provide pro-rata refunds for partial periods. Refunds are at our discretion and are generally limited to documented duplicate charges or a clear billing error on our part. We may change plans and pricing prospectively, with notice to existing subscribers.',
        ],
      },
      {
        heading: '7. Availability and changes',
        body: [
          'We work to keep the Service available but do not guarantee uninterrupted operation, and we may modify, suspend, or discontinue features. Free-tier artifacts may be subject to retention limits (e.g., automatic expiry) as described in the product; paid plans may offer extended retention.',
        ],
      },
      {
        heading: '8. Warranty disclaimer',
        body: [
          'The Service is provided "as is" and "as available", without warranties of any kind, express or implied, including merchantability, fitness for a particular purpose, and non-infringement. We do not warrant that the Service will be error-free or secure.',
        ],
      },
      {
        heading: '9. Limitation of liability',
        body: [
          'To the maximum extent permitted by law, we will not be liable for indirect, incidental, special, consequential, or exemplary damages, or for loss of data, profits, or goodwill. Our total liability for any claim relating to the Service will not exceed the greater of the amounts you paid us in the 12 months before the claim, or €50.',
        ],
      },
      {
        heading: '10. Indemnification',
        body: [
          'You agree to indemnify and hold us harmless from claims arising out of Your Content, your use of the Service, or your breach of these Terms.',
        ],
      },
      {
        heading: '11. Term and termination',
        body: [
          'These Terms apply while you use the Service. You may stop using it and delete your account at any time. We may suspend or terminate access if you breach these Terms or create risk for the Service or others. Provisions that by their nature should survive (fees owed, disclaimers, liability limits) will survive termination.',
        ],
      },
      {
        heading: '12. Governing law and disputes',
        body: [
          'These Terms are governed by the laws of **Croatia**, without regard to conflict-of-laws rules, and the competent courts of Zagreb, Croatia have exclusive jurisdiction, except where mandatory consumer-protection law provides otherwise.',
        ],
      },
      {
        heading: '13. Changes to these Terms',
        body: [
          'We may update these Terms from time to time. Material changes will be notified via the Service or by email. Continued use after changes take effect constitutes acceptance.',
        ],
      },
      {
        heading: '14. Contact',
        body: [`Questions about these Terms: **${LEGAL_ENTITY.email}**.`],
      },
    ],
  },

  'refund-policy': {
    slug: 'refund-policy',
    title: 'Refund & Cancellation Policy',
    summary: 'How cancellation, refunds and taxes work for Agent Artifacts Pro.',
    sections: [
      {
        bullets: [
          '**Cancel anytime.** Manage or cancel your subscription from your dashboard. Cancellation takes effect at the end of your current billing period; you keep Pro access until then.',
          "**No pro-rata refunds.** Except where required by law, we don't refund partial billing periods.",
          `**Billing errors.** Charged in error (e.g., a duplicate charge)? Email **${LEGAL_ENTITY.email}** and we'll make it right.`,
          '**Taxes** are shown at checkout and handled by Stripe.',
        ],
      },
      {
        body: [`Operated by ${LEGAL_ENTITY.name}, Zagreb, Croatia.`],
      },
    ],
  },

  privacy: {
    slug: 'privacy',
    title: 'Privacy Policy',
    summary: 'How Agent Artifacts handles personal data.',
    sections: [
      {
        body: [
          'This Privacy Policy explains how we handle personal data for Agent Artifacts (agentartifact.ai).',
          `**Data controller.** **${LEGAL_ENTITY.name}**, ${LEGAL_ENTITY.address} (VAT ${LEGAL_ENTITY.vat}). Contact: **${LEGAL_ENTITY.email}**.`,
        ],
      },
      {
        heading: '1. What we collect',
        bullets: [
          '**Account data** — your email address and authentication details.',
          '**Content** — the artifacts and related data you or your agents create and store.',
          '**Billing data** — if you subscribe, our payment processor (Stripe) handles your card details; we store only a customer/subscription reference and plan status, never full card numbers.',
          '**Usage and technical data** — logs, IP address, and basic device/browser information needed to run and secure the Service.',
          '**Product analytics** — we use privacy-friendly, cookieless analytics that do not build advertising profiles.',
        ],
      },
      {
        heading: '2. How we use it',
        body: [
          'To provide and operate the Service, authenticate you, process subscriptions and taxes, secure the Service and prevent abuse, provide support, and understand and improve the product.',
        ],
      },
      {
        heading: '3. Legal bases',
        body: [
          'Performance of our contract with you (providing the Service and billing), our legitimate interests (security, prevention of abuse, product improvement), consent where required, and compliance with legal obligations.',
        ],
      },
      {
        heading: '4. Processors we share data with',
        body: [
          'We share data only with providers that process it on our behalf to run the Service: **Stripe** (payments and tax), our **email provider** (account and transactional email), our **hosting provider** (infrastructure), and our **analytics provider**. We do not sell your personal data.',
        ],
      },
      {
        heading: '5. Retention',
        body: [
          'We keep account and content data while your account is active and as needed to provide the Service, comply with legal obligations, resolve disputes, and enforce agreements. Free-tier artifacts may expire automatically as described in the product. You can delete your account at any time.',
        ],
      },
      {
        heading: '6. Your rights',
        body: [
          `Subject to applicable law (including the GDPR), you may request access to, correction of, deletion of, or a copy of your personal data, and object to or restrict certain processing. Contact **${LEGAL_ENTITY.email}**. You may also complain to your local data-protection authority (in Croatia, AZOP).`,
        ],
      },
      {
        heading: '7. Security',
        body: [
          'We use appropriate technical and organizational measures to protect personal data, but no method of transmission or storage is completely secure.',
        ],
      },
      {
        heading: '8. International transfers',
        body: [
          'Where data is processed outside the EEA by our providers, we rely on appropriate safeguards (such as the EU Standard Contractual Clauses).',
        ],
      },
      {
        heading: '9. Changes',
        body: [
          'We may update this Policy from time to time; material changes will be notified via the Service or by email.',
        ],
      },
      {
        heading: '10. Contact',
        body: [`Privacy questions or requests: **${LEGAL_ENTITY.email}**.`],
      },
    ],
  },
};

export function legalDocument(slug: string): LegalDocument | undefined {
  return LEGAL_DOCUMENTS[slug];
}

/** Every legal slug, so the routes and the tests read from one list. */
export const LEGAL_SLUGS = Object.keys(LEGAL_DOCUMENTS);

/**
 * Renders `**bold**` and leaves everything else as text.
 *
 * A deliberately tiny reader rather than the markdown pipeline used for artifacts: this content is
 * ours and static, the only inline mark it uses is emphasis, and running it through a parser and a
 * sanitiser would be a larger surface for no gain. Odd segments of the split are the emphasised
 * ones; JSX escapes every segment either way, so no markup can come out of the text.
 */
function inline(text: string): Child[] {
  return text
    .split('**')
    .map((segment, index) => (index % 2 === 1 ? <strong>{segment}</strong> : segment));
}

export function LegalPage({ document }: { document: LegalDocument }) {
  return (
    <Layout title={`${document.title} · Agent Artifacts`} description={document.summary}>
      <MarketingHeader />

      <main class="aa-main aa-shell aa-legal">
        {/* A reading column, not a stack. `.aa-stack`'s uniform 2rem gap put the same distance
            between a heading and its own first paragraph as between two sections, so nothing read
            as belonging to anything; prose needs more space before a heading than after it. */}
        <article class="aa-legal__doc">
          <header class="aa-section-header">
            <p class="aa-page-kicker">Legal</p>
            <h1 class="aa-section-title">{document.title}</h1>
            <p class="aa-section-note">{document.summary}</p>
            <p class="aa-hint">Last updated: {LEGAL_UPDATED}</p>
          </header>

          {document.sections.map((section) => (
            <section class="aa-legal__section">
              {section.heading ? <h2 class="aa-legal__heading">{section.heading}</h2> : null}
              {(section.body ?? []).map((paragraph) => (
                <p>{inline(paragraph)}</p>
              ))}
              {section.bullets ? (
                <ul class="aa-legal__list">
                  {section.bullets.map((bullet) => (
                    <li>{inline(bullet)}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
        </article>
      </main>

      <footer class="aa-marketing-footer">
        <div class="aa-shell aa-marketing-shell">
          <p class="aa-marketing-footer__line">
            {LEGAL_ENTITY.name} · {LEGAL_ENTITY.address} · VAT {LEGAL_ENTITY.vat}
          </p>
          <p class="aa-marketing-footer__links">
            <LegalFooterLinks />
          </p>
        </div>
      </footer>
    </Layout>
  );
}

/**
 * The three legal links, in one place.
 *
 * Shared by the marketing footer, the coming-soon footer and each legal page's own footer, so the
 * set cannot drift — a checkout that promises a Terms link and a site that has lost it is exactly
 * the kind of gap that only surfaces in an audit.
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
