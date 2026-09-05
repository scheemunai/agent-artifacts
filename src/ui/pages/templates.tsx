import { renderMarkdown } from '../../lib/markdown.js';
import type { TemplateCategory } from '../../lib/schemas/templates.js';
import type { StarterTemplate } from '../../services/templates.js';
import { Layout } from '../components/layout.js';
import { MarketingHeader } from '../components/marketing.js';
import { Button } from '../components/primitives.js';
import { TEMPLATE_CATEGORY_COPY, TEMPLATE_CATEGORY_ORDER } from '../copy/template-categories.js';
import { LegalFooterLinks } from './legal.js';

export const TEMPLATES_TITLE = 'Templates — start from something an agent can rewrite';
export const TEMPLATES_SUBLINE =
  'Blueprints your agent fetches, rewrites in your words, and publishes as a page you can send to someone. Browse by the job, then make them yours.';

function groupByCategory(
  templates: StarterTemplate[]
): Array<[TemplateCategory, StarterTemplate[]]> {
  return TEMPLATE_CATEGORY_ORDER.map(
    (category) =>
      [category, templates.filter((template) => template.category === category)] as [
        TemplateCategory,
        StarterTemplate[],
      ]
  ).filter(([, group]) => group.length > 0);
}

/**
 * The public browse page: what a visitor sees when they want to know what an agent can actually
 * make.
 *
 * Reads the shipped manifest rather than the database. That is not a shortcut — this page has no
 * account, runs before login, and must render on a fresh install that has never booted a seeder.
 * The manifest is what SEEDS the built-ins, so the two cannot disagree; going through the database
 * would add a dependency to buy nothing.
 *
 * Grouped by category and never flattened: a flat grid of nineteen cards says "we have a lot", and
 * the thing worth saying is "there is one for the job you are doing".
 */
export function TemplatesPage({ templates }: { templates: StarterTemplate[] }) {
  const groups = groupByCategory(templates);

  return (
    <Layout title={`${TEMPLATES_TITLE} · Agent Artifacts`} description={TEMPLATES_SUBLINE}>
      <MarketingHeader />

      <main class="aa-main aa-shell aa-templates">
        <header class="aa-section-header aa-templates__intro">
          <p class="aa-page-kicker">Templates</p>
          <h1 class="aa-section-title">Start from something an agent can rewrite.</h1>
          <p class="aa-section-note">{TEMPLATES_SUBLINE}</p>
        </header>

        <nav class="aa-templates__jump" aria-label="Template categories">
          {groups.map(([category]) => (
            <a class="aa-templates__jump-link" href={`#category-${category}`}>
              {TEMPLATE_CATEGORY_COPY[category].label}
            </a>
          ))}
        </nav>

        {groups.map(([category, group]) => (
          <section
            class="aa-templates__group"
            id={`category-${category}`}
            aria-labelledby={`category-${category}-heading`}
          >
            <header class="aa-templates__group-head">
              <h2 class="aa-templates__group-title" id={`category-${category}-heading`}>
                {TEMPLATE_CATEGORY_COPY[category].label}
              </h2>
              <p class="aa-templates__group-note">{TEMPLATE_CATEGORY_COPY[category].blurb}</p>
            </header>

            <ul class="aa-templates__grid">
              {group.map((template) => (
                <li class="aa-templates__card">
                  <a class="aa-templates__card-link" href={`/templates/${template.slug}`}>
                    <span class="aa-templates__cover">
                      {template.thumbnail ? (
                        <img
                          class="aa-templates__image"
                          src={template.thumbnail}
                          alt=""
                          loading="lazy"
                        />
                      ) : (
                        <span class="aa-templates__placeholder" aria-hidden="true" />
                      )}
                    </span>
                    <span class="aa-templates__card-body">
                      <span class="aa-templates__card-title">{template.name}</span>
                      <span class="aa-templates__card-note">{template.description}</span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <section class="aa-templates__how" aria-labelledby="templates-how-heading">
          <h2 class="aa-templates__group-title" id="templates-how-heading">
            How your agent uses one
          </h2>
          <p class="aa-templates__group-note">
            Your agent lists what is here, fetches the one that fits, rewrites it in your words and
            your colours, and publishes the result as its own page. These are starting points — the
            templates you keep are the ones you have made yours.
          </p>
          <pre class="aa-templates__code">
            <code>{'GET /v1/templates?category=meetings\nGET /v1/templates/meeting-recap'}</code>
          </pre>
          <p class="aa-templates__group-note">
            The same call returns your own saved templates alongside these, so an agent browsing for
            a starting point sees your work and ours in one answer.
          </p>
        </section>
      </main>

      <footer class="aa-marketing-footer">
        <div class="aa-shell aa-marketing-shell">
          <p class="aa-marketing-footer__links">
            <LegalFooterLinks />
          </p>
        </div>
      </footer>
    </Layout>
  );
}

/**
 * One template, at the size a decision is made at.
 *
 * The HTML ones get a live frame — the same sandboxed document the published artifact renders in,
 * so what a visitor sees here is what a reader would receive. The frame is BOUNDED here and only
 * here: this is a specimen inside a gallery, not the artifact itself, and a page of nineteen
 * full-height documents is not a gallery.
 *
 * `frameUrl` arrives built rather than assembled here, because which host serves it is a property
 * of the deployment and not of the page: `lib/template-frame.ts` makes the one choice, this renders
 * whatever it made. Spelling the path inline is what shipped a frame the cloud CSP refuses.
 */
export function TemplateDetailPage({
  template,
  frameUrl,
}: {
  template: StarterTemplate;
  frameUrl: string;
}) {
  const category = TEMPLATE_CATEGORY_COPY[template.category];
  const markdownPreview =
    template.type === 'markdown' ? renderMarkdown(template.content, { headingOffset: 1 }) : null;

  return (
    <Layout
      title={`${template.name} — template · Agent Artifacts`}
      description={template.description}
    >
      <MarketingHeader />

      <main class="aa-main aa-shell aa-templates">
        <header class="aa-section-header aa-templates__intro">
          <p class="aa-page-kicker">
            <a class="aa-templates__back" href="/templates">
              Templates
            </a>{' '}
            · {category.label}
          </p>
          <h1 class="aa-section-title">{template.name}</h1>
          <p class="aa-section-note">{template.description}</p>
        </header>

        {markdownPreview ? (
          <div
            class="aa-templates__markdown"
            data-aa-dashboard-preview="markdown"
            // Sanitized upstream: `renderMarkdown` runs the content through DOMPurify and wraps the
            // result itself, which is the same path the dashboard preview and the public viewer use.
            dangerouslySetInnerHTML={{ __html: markdownPreview }}
          />
        ) : (
          <div class="aa-templates__preview">
            <div class="aa-templates__preview-box">
              <iframe
                class="aa-templates__frame"
                title={`${template.name} preview`}
                sandbox="allow-scripts"
                loading="lazy"
                src={frameUrl}
              ></iframe>
            </div>
            <p class="aa-templates__preview-note">
              A preview, bounded to fit this page — scroll inside it. Published as an artifact, this
              document grows to its own full height and the reader scrolls the page instead.
            </p>
          </div>
        )}

        <section class="aa-templates__how" aria-labelledby="template-how-heading">
          <h2 class="aa-templates__group-title" id="template-how-heading">
            Fetch it, rewrite it, publish it
          </h2>
          <pre class="aa-templates__code">
            <code>{`GET /v1/templates/${template.slug}`}</code>
          </pre>
          <p class="aa-templates__group-note">
            Your agent gets the whole document back, rewrites the content while keeping the layout
            and the styling, and publishes the result as its own artifact. Change the colours and
            the words and it stops being ours.
          </p>
          <p>
            <Button variant="secondary" href="/templates">
              Browse all templates
            </Button>
          </p>
        </section>
      </main>

      <footer class="aa-marketing-footer">
        <div class="aa-shell aa-marketing-shell">
          <p class="aa-marketing-footer__links">
            <LegalFooterLinks />
          </p>
        </div>
      </footer>
    </Layout>
  );
}
