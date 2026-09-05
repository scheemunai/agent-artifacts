import { TEMPLATE_CATEGORIES, type TemplateCategory } from '../../lib/schemas/templates.js';

/**
 * What each category is called, and what it is FOR, in the words a visitor reads.
 *
 * Separate from the enum on purpose: the enum is an API value that agents filter on and must stay
 * short and stable, while this is marketing copy that will be rewritten. Keeping them in one object
 * would mean every wording change was an API change.
 *
 * The blurb answers "why would I open this section", not "what is in it" — a list of template names
 * is already directly underneath, so repeating them in prose says nothing.
 */
export interface TemplateCategoryCopy {
  label: string;
  blurb: string;
}

export const TEMPLATE_CATEGORY_COPY: Record<TemplateCategory, TemplateCategoryCopy> = {
  meetings: {
    label: 'Meetings & recaps',
    blurb: 'What was said, what was decided, and who owes what by when.',
  },
  decisions: {
    label: 'Decisions & proposals',
    blurb: 'The options, the recommendation, and the ask — with a deadline on it.',
  },
  research: {
    label: 'Research & reports',
    blurb: 'Long-form work somebody will read properly and probably forward.',
  },
  status: {
    label: 'Status & dashboards',
    blurb: 'Where things stand, with every number against a target.',
  },
  releases: {
    label: 'Releases & announcements',
    blurb: 'What shipped, what broke, and what a reader has to do about it.',
  },
  plans: {
    label: 'Plans & runbooks',
    blurb: 'What happens next, in the order it happens, with an owner on each step.',
  },
};

/** The order the browse page reads in — the enum's own order, which is a design decision. */
export const TEMPLATE_CATEGORY_ORDER: readonly TemplateCategory[] = TEMPLATE_CATEGORIES;
