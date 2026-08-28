import type { Child } from 'hono/jsx';
import { Button, cx, ProductMark } from './primitives.js';

export interface MarketingArtifactEmbedProps {
  href: string;
  agentLabel: string;
  slugLabel: string;
  /** Omitted when the live artifact state is unknown: the strip never guesses. */
  version?: string | undefined;
  /** Omitted when the live artifact state is unknown: the strip never guesses. */
  updatedLabel?: string | undefined;
  title: string;
  children: Child;
  ariaLabel?: string | undefined;
  headingLevel?: 2 | 3;
}

export function MarketingArtifactEmbed({
  href,
  agentLabel,
  slugLabel,
  version,
  updatedLabel,
  title,
  children,
  ariaLabel,
  headingLevel = 3,
}: MarketingArtifactEmbedProps) {
  const heading =
    headingLevel === 2 ? (
      <h2 class="aa-marketing-artifact__title">{title}</h2>
    ) : (
      <h3 class="aa-marketing-artifact__title">{title}</h3>
    );

  return (
    <article class="aa-marketing-artifact">
      <a class="aa-marketing-artifact__cover" href={href} aria-label={ariaLabel ?? title}>
        <span class="sr-only">{ariaLabel ?? title}</span>
      </a>
      <header class="aa-marketing-artifact__meta">
        <span class="aa-marketing-artifact__dot" aria-hidden="true"></span>
        <span class="aa-marketing-artifact__agent">{agentLabel}</span>
        <span class="aa-marketing-artifact__sep" aria-hidden="true">
          ·
        </span>
        <span class="aa-marketing-artifact__slug">{slugLabel}</span>
        {version ? <span class="aa-marketing-chip">{version}</span> : null}
        {updatedLabel ? <span class="aa-marketing-artifact__updated">{updatedLabel}</span> : null}
      </header>
      <div class="aa-marketing-artifact__body">
        {heading}
        <div class="aa-marketing-artifact__content">{children}</div>
      </div>
    </article>
  );
}

export function MarketingSectionLabel({ children }: { children: Child }) {
  return <p class="aa-marketing-section-label">{children}</p>;
}

export interface MarketingExampleCardProps {
  number: string;
  children: Child;
}

export function MarketingExampleCard({ number, children }: MarketingExampleCardProps) {
  return (
    <article class="aa-marketing-example">
      <span class="aa-marketing-example__number">{number}</span>
      <div class="aa-marketing-example__text">{children}</div>
    </article>
  );
}

export interface MarketingApiBlockProps {
  id: string;
  label: string;
  children: Child;
}

export function MarketingApiBlock({ id, label, children }: MarketingApiBlockProps) {
  // A-14. This block is `white-space: pre; overflow-x: auto`, so at 375 it truncated line 2
  // mid-token — `{ "title": "Weekly Ops Report", "content"` — with no fade, no visible scrollbar
  // and nothing to say more existed. It *was* scrollable; the page just never admitted it.
  //
  // The affordance is CopyBlock's, not a second implementation of it: same `aa-copy__hint` class,
  // same `data-aa-scroll-region` / `data-aa-scroll-hint-for` contract, so the measurement already
  // shipped in ui-foundation drives this block from markup alone. Horizontal overflow depends on
  // the viewport and cannot be known while rendering, so the hint starts hidden and is revealed
  // only if the block actually overflows.
  const hintId = `${id}-scroll-hint`;

  return (
    <section class="aa-marketing-api" aria-labelledby={`${id}-label`}>
      <div class="aa-marketing-api__bar">
        <span class="aa-marketing-api__label" id={`${id}-label`}>
          {label}
        </span>
        <span class="aa-marketing-api__actions">
          <span class="aa-marketing-api__status" id={`${id}-status`} aria-live="polite" />
          <Button
            variant="ghost"
            size="sm"
            class="aa-marketing-api__copy"
            dataAttrs={{
              'data-aa-copy': id,
              'data-aa-copy-status': `${id}-status`,
            }}
          >
            Copy
          </Button>
        </span>
      </div>
      <pre
        class="aa-marketing-api__code"
        id={id}
        tabindex={0}
        aria-describedby={hintId}
        data-aa-scroll-region="true"
        data-aa-scroll-hint-for={hintId}
      >
        <code>{children}</code>
      </pre>
      <p class="aa-copy__hint" id={hintId} hidden>
        Scroll inside the block to view everything. Copy includes the full text.
      </p>
    </section>
  );
}

export function MarketingFeatureLine({ children }: { children: Child }) {
  return (
    <div class="aa-marketing-feature">
      <p>{children}</p>
    </div>
  );
}

export function MarketingWorksWith({ children }: { children: Child }) {
  return <p class="aa-marketing-works">{children}</p>;
}

export interface MarketingOriginNoteProps {
  quote: string;
  byline?: string | undefined;
}

export function MarketingOriginNote({ quote, byline }: MarketingOriginNoteProps) {
  return (
    <aside class="aa-marketing-origin">
      <p class="aa-marketing-origin__mark" aria-hidden="true">
        “
      </p>
      <p class="aa-marketing-origin__quote">{quote}</p>
      {byline ? <p class="aa-marketing-origin__byline">{byline}</p> : null}
    </aside>
  );
}

export interface MarketingTermsCardProps {
  price: Child;
  oss: Child;
}

export function MarketingTermsCard({ price, oss }: MarketingTermsCardProps) {
  return (
    <section class="aa-marketing-terms" aria-labelledby="home-pricing-title">
      <h2 class="sr-only" id="home-pricing-title">
        Pricing and open source
      </h2>
      <p class="aa-marketing-terms__price">{price}</p>
      <p class="aa-marketing-terms__oss">{oss}</p>
    </section>
  );
}

export interface MarketingFinalCtaProps {
  href: string;
  label: string;
  /** Reassurance microcopy, rendered directly under the button. */
  note?: Child | undefined;
}

export function MarketingFinalCta({ href, label, note }: MarketingFinalCtaProps) {
  return (
    <div class="aa-marketing-cta">
      <Button variant="primary" href={href}>
        {label}
      </Button>
      {note ? <p class="aa-marketing-cta__note">{note}</p> : null}
    </div>
  );
}

export function MarketingFooter({ children }: { children: Child }) {
  return (
    <footer class="aa-marketing-footer">
      <div class="aa-shell aa-marketing-shell">
        <ProductMark />
        <p class="aa-marketing-footer__line">Agent Artifacts · open source, MIT</p>
        <p class="aa-marketing-footer__links">{children}</p>
      </div>
    </footer>
  );
}

export function MarketingSection({
  id,
  label,
  title,
  children,
  class: className,
}: {
  id: string;
  label: string;
  title?: string | undefined;
  children: Child;
  class?: string | undefined;
}) {
  return (
    <section class={cx('aa-marketing-section', className)} aria-labelledby={`${id}-title`}>
      {/* A-44. The kicker and the headline are one unit and now say so structurally. They used to
          be two siblings in a grid with a 24px gap, and the title clawed 16px of it back with a
          negative margin — which meant the pair's spacing was the difference between two numbers in
          different rules, and any change to the section gap silently retuned it. */}
      <header class="aa-marketing-section-header">
        <MarketingSectionLabel>{label}</MarketingSectionLabel>
        {title ? (
          <h2 class="aa-marketing-section-title" id={`${id}-title`}>
            {title}
          </h2>
        ) : (
          <h2 class="sr-only" id={`${id}-title`}>
            {label}
          </h2>
        )}
      </header>
      {children}
    </section>
  );
}
