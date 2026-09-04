import type { Child } from 'hono/jsx';

export type ComponentState =
  | 'default'
  | 'hover'
  | 'focus'
  | 'active'
  | 'disabled'
  | 'loading'
  | 'error';
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warn' | 'danger' | 'info';
export type BadgeSize = 'sm' | 'md';

const stateData = (state?: ComponentState) => (state ? { 'data-aa-state': state } : {});

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/**
 * An id fragment derived from the human text a component was given.
 *
 * A component that hard-codes an id is unique only until a page uses it twice — which is an
 * ordinary page, not an edge case: two empty lists, two tables, two terminal states. Deriving from
 * content makes the common case unique without the caller thinking about it; every component that
 * uses this also takes an explicit `id` for the cases where the content is not distinct either.
 */
export function slugId(value: string | undefined, fallback: string): string {
  const slug = (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 48)
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

interface ButtonProps {
  children: Child;
  variant?: ButtonVariant;
  size?: 'xs' | 'sm' | 'md' | 'lg' | undefined;
  state?: ComponentState | undefined;
  type?: 'button' | 'submit' | 'reset' | undefined;
  disabled?: boolean | undefined;
  loading?: boolean | undefined;
  /**
   * Width is a decision the button makes, not one it inherits from whichever parent it lands in.
   * Default is intrinsic width; set this where the design calls for a full-bleed action.
   */
  fullWidth?: boolean | undefined;
  /** Associates a submit button with a form it is not nested inside — dialog footers need this. */
  form?: string | undefined;
  /**
   * A control whose whole label is a mark. It gets a square 44px box and the same border treatment
   * as a labelled button, because a bare glyph beside a bordered button does not read as a control
   * at all — and `min-height` alone left icon buttons 33px wide, under the touch floor.
   */
  iconOnly?: boolean | undefined;
  href?: string | undefined;
  /**
   * Open this link in a new tab.
   *
   * One flag, not two, because `target="_blank"` without `rel="noopener"` hands the opened page a
   * `window.opener` handle to navigate the tab it came from. Exposing `target` and `rel` as
   * separate props would make the unsafe pair expressible; this makes it unrepresentable. Ignored
   * without `href`, since a `<button>` has nowhere to go.
   */
  newTab?: boolean | undefined;
  class?: string | undefined;
  id?: string | undefined;
  ariaLabel?: string | undefined;
  title?: string | undefined;
  dataAttrs?: Record<string, string>;
}

export function Button({
  children,
  variant = 'secondary',
  size = 'md',
  state,
  type = 'button',
  disabled = false,
  loading = false,
  fullWidth = false,
  form,
  iconOnly = false,
  href,
  newTab = false,
  class: className,
  id,
  ariaLabel,
  title,
  dataAttrs = {},
}: ButtonProps) {
  const isDisabled = disabled || loading || state === 'disabled';
  const classes = cx(
    'aa-btn',
    `aa-btn--${variant}`,
    size !== 'md' && `aa-btn--${size}`,
    fullWidth && 'aa-btn--full',
    iconOnly && 'aa-btn--icon',
    className
  );
  const content = (
    <>
      {loading ? <Spinner label="Loading" size="sm" /> : null}
      <span>{children}</span>
    </>
  );

  if (href) {
    return (
      <a
        id={id}
        class={classes}
        href={isDisabled ? undefined : href}
        {...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        aria-disabled={isDisabled ? 'true' : undefined}
        aria-label={ariaLabel}
        title={title}
        tabindex={isDisabled ? -1 : undefined}
        {...stateData(loading ? 'loading' : state)}
        {...dataAttrs}
      >
        {content}
      </a>
    );
  }

  return (
    <button
      id={id}
      class={classes}
      type={type}
      form={form}
      disabled={isDisabled}
      aria-busy={loading ? 'true' : undefined}
      aria-label={ariaLabel}
      title={title}
      {...stateData(loading ? 'loading' : state)}
      {...dataAttrs}
    >
      {content}
    </button>
  );
}

export type ButtonRowAlign = 'start' | 'center' | 'end' | 'between';

interface ButtonRowProps {
  children: Child;
  align?: ButtonRowAlign | undefined;
  class?: string | undefined;
}

/**
 * The product's one action row. Every screen needs "some buttons, side by side, wrapping on a
 * phone"; before this they hand-rolled it with `aa-specimen-row`, a class named after the style
 * guide, at 25 production call sites.
 */
export function ButtonRow({ children, align = 'start', class: className }: ButtonRowProps) {
  return (
    <div class={cx('aa-button-row', align !== 'start' && `aa-button-row--${align}`, className)}>
      {children}
    </div>
  );
}

interface FieldDescription {
  id: string;
  /**
   * `Child`, not `string`: a label legitimately contains markup — the confirm-to-delete field names
   * the phrase you must type inside a <code>. Widened when `ConfirmDestructive` stopped hand-rolling
   * its own field shell; nothing here ever treated it as a string.
   */
  label: Child;
  hint?: string | undefined;
  error?: string | undefined;
  optional?: boolean | undefined;
  required?: boolean | undefined;
  children: Child;
}

function FieldShell({
  id,
  label,
  hint,
  error,
  optional = false,
  required = false,
  children,
}: FieldDescription) {
  return (
    <div class="aa-field">
      <div class="aa-label-row">
        <label class="aa-label" for={id}>
          {label}
        </label>
        {/* `required` and `optional` are opposites, so the tag answers to both. A field cannot be
            each at once, and a label row that says "Optional" on a required box is the N-5 failure
            with the two words swapped — one statement of optionality, and only when it is true. */}
        {optional && !required ? <span class="aa-optional">Optional</span> : null}
      </div>
      {children}
      {hint ? (
        <p class="aa-hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p class="aa-error" id={`${id}-error`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

function describedBy(id: string, hint?: string, error?: string): string | undefined {
  return (
    [hint ? `${id}-hint` : undefined, error ? `${id}-error` : undefined]
      .filter(Boolean)
      .join(' ') || undefined
  );
}

interface InputProps {
  id: string;
  label: Child;
  type?: string | undefined;
  value?: string | undefined;
  placeholder?: string | undefined;
  hint?: string | undefined;
  error?: string | undefined;
  optional?: boolean | undefined;
  disabled?: boolean | undefined;
  state?: ComponentState | undefined;
  name?: string | undefined;
  /**
   * The browser's own vocabulary for what this field holds. Without it a password manager cannot
   * tell a current password from a new one, so it offers to fill all three boxes of a change-password
   * form with the same value — and offers to save the wrong one afterwards.
   */
  autocomplete?: string | undefined;
  /**
   * Focus this field on load. For the FIRST actionable field of a page whose only job is that
   * form — a login, a gate — where the reader's next act is certainly to type into it. Not for a
   * field inside a larger page: moving focus on load scrolls the viewport and steals the caret
   * from someone who arrived to read.
   */
  autofocus?: boolean | undefined;
  /**
   * The three opt-outs a machine-generated value needs, and the reason they are separate props
   * rather than one `hardened` flag: they are independent browser behaviours and a caller usually
   * wants a specific one. `autocapitalize="none"` is the load-bearing one on iOS, which otherwise
   * uppercases the first character of a token — silently turning a correct paste into a failed
   * login.
   */
  spellcheck?: boolean | undefined;
  /** The element's own vocabulary, not a widened string — a typo here fails silently at runtime. */
  autocapitalize?: 'none' | 'off' | 'on' | 'sentences' | 'words' | 'characters' | undefined;
  autocorrect?: 'on' | 'off' | undefined;
  /**
   * Arbitrary data attributes, spread onto the control — the same escape hatch `Button` has, and
   * for the same reason: the client bundle binds behaviour by data attribute, so a field that
   * cannot carry one cannot participate in any of it. This is what let `ConfirmDestructive` stop
   * hand-rolling a raw <input> to keep its two.
   */
  dataAttrs?: Record<string, string> | undefined;
  /**
   * The browser's own constraint validation. Declarative on purpose: the platform blocks an empty
   * submit before any handler runs, which is the difference between a field that cannot be sent
   * empty and one that is merely checked after it has already cost a request.
   *
   * A client-side guard is still right wherever a script owns the submit — it has to be, because a
   * script can submit without the form ever validating — but that guard should be the second line,
   * not the only one. Mutually exclusive with `optional`; the label row will not print the Optional
   * tag on a required field.
   */
  required?: boolean | undefined;
}

export function Input({
  id,
  label,
  type = 'text',
  value,
  placeholder,
  hint,
  error,
  optional,
  disabled,
  state,
  name,
  autocomplete,
  autofocus,
  spellcheck,
  autocapitalize,
  autocorrect,
  dataAttrs = {},
  required,
}: InputProps) {
  return (
    <FieldShell
      id={id}
      label={label}
      hint={hint}
      error={error}
      optional={optional}
      required={required}
    >
      <input
        class="aa-control"
        id={id}
        name={name ?? id}
        type={type}
        value={value}
        placeholder={placeholder}
        autocomplete={autocomplete}
        autofocus={autofocus}
        spellcheck={spellcheck}
        autocapitalize={autocapitalize}
        autocorrect={autocorrect}
        required={required}
        disabled={disabled || state === 'disabled'}
        aria-invalid={error || state === 'error' ? 'true' : undefined}
        aria-describedby={describedBy(id, hint, error)}
        {...stateData(state)}
        {...dataAttrs}
      />
    </FieldShell>
  );
}

/**
 * A password field that can be read back, and that says so when Caps Lock is on.
 *
 * Two constraints, both earned rather than chosen, and both about the same failure — a control
 * that describes a state instead of an action:
 *
 *  - THE TOGGLE IS A REAL CONTROL. It is a 44px `iconOnly` button with the product's border
 *    treatment, not a glyph floating in the field. A bare mark beside a bordered input does not
 *    read as pressable, and `min-height` alone leaves an icon button 33px wide — under the touch
 *    floor, which is the whole of A-26.
 *  - ITS LABEL NAMES WHAT IT WILL DO, NOT WHAT YOU ARE LOOKING AT. Masked, it says "Show
 *    password"; revealed, "Hide password". The tempting version labels the current state, which
 *    puts the control one step out of phase with every reader who takes it at its word.
 *
 * `aria-pressed` carries the state for assistive tech, so the visible label is free to be an
 * instruction rather than doing both jobs badly.
 *
 * The caps hint is always in the DOM — it must be, or there would be nothing to reveal — but it is
 * REFERENCED only while it applies, and the client adds and removes the id in the same breath as
 * `hidden`. That is a deliberate departure from the CopyBlock rule, which always references its
 * hint: there the hint is the only description a block has and the server cannot know the answer,
 * so a permanent reference is the honest one. Here the field usually has a hint or an error already,
 * and the client CAN know, so describing the field as "…and Caps Lock is on" while Caps Lock is off
 * would be the guide-showing-an-impossible-state failure aimed at the accessibility tree. Both
 * halves move together in one handler, so they cannot disagree.
 */
export interface PasswordInputProps extends Omit<InputProps, 'type'> {
  /** Reveal by default. The toggle still governs it; this is the initial position only. */
  revealed?: boolean | undefined;
}

export function PasswordInput({
  id,
  label,
  value,
  placeholder,
  hint,
  error,
  optional,
  disabled,
  state,
  name,
  autocomplete,
  autofocus,
  spellcheck,
  autocapitalize,
  autocorrect,
  dataAttrs = {},
  required,
  revealed = false,
}: PasswordInputProps) {
  const capsId = `${id}-caps`;

  return (
    <FieldShell
      id={id}
      label={label}
      hint={hint}
      error={error}
      optional={optional}
      required={required}
    >
      <div class="aa-password" data-aa-password="true">
        <input
          class="aa-control aa-password__input"
          id={id}
          name={name ?? id}
          type={revealed ? 'text' : 'password'}
          value={value}
          placeholder={placeholder}
          autocomplete={autocomplete}
          autofocus={autofocus}
          spellcheck={spellcheck}
          autocapitalize={autocapitalize}
          autocorrect={autocorrect}
          required={required}
          disabled={disabled || state === 'disabled'}
          aria-invalid={error || state === 'error' ? 'true' : undefined}
          aria-describedby={describedBy(id, hint, error)}
          data-aa-password-input="true"
          {...stateData(state)}
          {...dataAttrs}
        />
        {/* `secondary`, not `ghost`: ghost is transparent with no border, which is precisely the
            bare-glyph-beside-a-field this is required not to be. */}
        <Button
          variant="secondary"
          iconOnly
          class="aa-password__toggle"
          ariaLabel={revealed ? 'Hide password' : 'Show password'}
          title={revealed ? 'Hide password' : 'Show password'}
          disabled={disabled || state === 'disabled'}
          dataAttrs={{
            'data-aa-password-toggle': id,
            'aria-controls': id,
            'aria-pressed': revealed ? 'true' : 'false',
          }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" />
            <circle cx="12" cy="12" r="2.75" />
            <path class="aa-password__slash" d="M4 20 20 4" />
          </svg>
        </Button>
      </div>
      <p class="aa-password__caps" id={capsId} data-aa-password-caps="true" hidden>
        Caps Lock is on.
      </p>
    </FieldShell>
  );
}

/**
 * Everything `Input` takes except its `type`, including `autocomplete` — which is inherited here
 * because a textarea has a browser vocabulary too (`street-address` is the obvious one), not
 * because the `Omit` was easier to write than the list. Whatever this interface declares has to
 * reach the element: a prop that type-checks and does nothing is the same lie as a specimen
 * painting a state the product cannot produce.
 */
interface TextareaProps extends Omit<InputProps, 'type'> {
  rows?: number;
}

export function Textarea({
  id,
  label,
  value,
  placeholder,
  hint,
  error,
  optional,
  disabled,
  state,
  name,
  autocomplete,
  autofocus,
  spellcheck,
  autocapitalize,
  autocorrect,
  dataAttrs = {},
  required,
  rows = 5,
}: TextareaProps) {
  return (
    <FieldShell
      id={id}
      label={label}
      hint={hint}
      error={error}
      optional={optional}
      required={required}
    >
      <textarea
        class="aa-control"
        id={id}
        name={name ?? id}
        rows={rows}
        placeholder={placeholder}
        autocomplete={autocomplete}
        autofocus={autofocus}
        spellcheck={spellcheck}
        autocapitalize={autocapitalize}
        autocorrect={autocorrect}
        required={required}
        disabled={disabled || state === 'disabled'}
        aria-invalid={error || state === 'error' ? 'true' : undefined}
        aria-describedby={describedBy(id, hint, error)}
        {...stateData(state)}
        {...dataAttrs}
      >
        {value}
      </textarea>
    </FieldShell>
  );
}

interface SelectOption {
  label: string;
  value: string;
}

interface SelectProps extends Omit<InputProps, 'type' | 'placeholder' | 'value'> {
  value?: string | undefined;
  options: SelectOption[];
}

export function Select({
  id,
  label,
  value,
  options,
  hint,
  error,
  optional,
  disabled,
  state,
  name,
  autocomplete,
  autofocus,
  spellcheck,
  autocapitalize,
  autocorrect,
  dataAttrs = {},
  required,
}: SelectProps) {
  return (
    <FieldShell
      id={id}
      label={label}
      hint={hint}
      error={error}
      optional={optional}
      required={required}
    >
      <select
        class="aa-control"
        id={id}
        name={name ?? id}
        autocomplete={autocomplete}
        autofocus={autofocus}
        spellcheck={spellcheck}
        autocapitalize={autocapitalize}
        autocorrect={autocorrect}
        required={required}
        disabled={disabled || state === 'disabled'}
        aria-invalid={error || state === 'error' ? 'true' : undefined}
        aria-describedby={describedBy(id, hint, error)}
        {...stateData(state)}
        {...dataAttrs}
      >
        {options.map((option) => (
          <option value={option.value} selected={option.value === value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

interface BadgeProps {
  children: Child;
  tone?: BadgeTone;
  size?: BadgeSize;
}

/**
 * `neutral` emits no modifier, because there is no `.aa-badge--neutral` to emit — `.aa-badge` IS
 * the neutral badge, and every modifier only retones it. The class was in the markup of every
 * badge-bearing screen in the product and matched zero rules: a vocabulary token that existed only
 * in HTML, which reads to anyone inspecting an element as a style that must be defined somewhere.
 *
 * Same form `Toast` and `Notice` already use. Dropping it is a zero-pixel change; the point is that
 * the markup stops naming something the stylesheet does not have.
 */
export function Badge({ children, tone = 'neutral', size = 'sm' }: BadgeProps) {
  return (
    <span
      class={cx(
        'aa-badge',
        tone !== 'neutral' && `aa-badge--${tone}`,
        size === 'md' && 'aa-badge--md'
      )}
    >
      {children}
    </span>
  );
}

export type NoticeTone = 'info' | 'success' | 'warn' | 'danger';

/**
 * Where a notice sits relative to the thing it is about.
 *
 * `attached` — the default and the point of the component — means it renders inside the container
 * whose outcome it reports: a `Card`'s `notice` slot, a form's own region, the panel that just
 * acted. `page` means it could not be, and that costs something: a detached notice must be
 * focusable and focused on load, because a message the reader has to go looking for is a message
 * that gets missed. Measured across this product, every status except the viewer's Updated pill was
 * detached — "Link sent" 32px above its own heading, a validation error ~300px above its field.
 */
export type NoticePlacement = 'attached' | 'page';

interface NoticeProps {
  tone?: NoticeTone;
  title?: string | undefined;
  children?: Child;
  /** Renders a 44px dismiss control wired to `ui-foundation`. */
  dismissible?: boolean | undefined;
  id?: string | undefined;
  /** Optional follow-up action, e.g. "Undo" or "Back to artifacts". */
  action?: Child;
  placement?: NoticePlacement | undefined;
}

/**
 * Page-level feedback about something that just happened: "Artifact deleted.", "Key regenerated.
 * Old key is invalid now.", "That page no longer exists."
 *
 * Not a `Badge` — a badge is an inline status marker attached to the object whose state it
 * describes (the viewer's "Updated ✓" pill is the correct use). Not a `Toast` either — a toast is
 * transient and floats over the page. A `Notice` is server-rendered in normal flow at the top of
 * the region it reports on, so it is present in the first paint and shifts nothing; dismissal is
 * the user's decision, never a timer's.
 */
export function Notice({
  tone = 'info',
  title,
  children,
  dismissible = false,
  id,
  action,
  placement = 'attached',
}: NoticeProps) {
  const interrupts = tone === 'warn' || tone === 'danger';
  const detached = placement === 'page';

  return (
    <div
      class={cx('aa-notice', `aa-notice--${tone}`, detached && 'aa-notice--page')}
      id={id}
      role={interrupts ? 'alert' : 'status'}
      data-aa-notice={tone}
      data-aa-notice-page={detached ? 'true' : undefined}
      tabindex={detached ? -1 : undefined}
    >
      <span class="aa-notice__icon" aria-hidden="true">
        <NoticeIcon tone={tone} />
      </span>
      <div class="aa-notice__body">
        {title ? <p class="aa-notice__title">{title}</p> : null}
        {children ? <p class="aa-notice__message">{children}</p> : null}
        {action ? <ButtonRow class="aa-notice__actions">{action}</ButtonRow> : null}
      </div>
      {dismissible ? (
        <button
          class="aa-notice__dismiss"
          type="button"
          aria-label="Dismiss notice"
          title="Dismiss notice"
          data-aa-notice-dismiss="true"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M6 6 18 18" />
            <path d="M18 6 6 18" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}

/** One stroke weight, one optical size, one mark per meaning. */
function NoticeIcon({ tone }: { tone: NoticeTone }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
      role="presentation"
    >
      {tone === 'success' ? (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="m8.25 12.4 2.6 2.6 4.9-5.4" />
        </>
      ) : null}
      {tone === 'info' ? (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11.25v5" />
          <path d="M12 7.75h.01" />
        </>
      ) : null}
      {tone === 'warn' ? (
        <>
          <path d="M12 4.25 21 19.75H3z" />
          <path d="M12 10v4" />
          <path d="M12 17h.01" />
        </>
      ) : null}
      {tone === 'danger' ? (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="m9.2 9.2 5.6 5.6" />
          <path d="m14.8 9.2-5.6 5.6" />
        </>
      ) : null}
    </svg>
  );
}

interface StatusHeadingProps {
  children: Child;
  level?: 1 | 2 | 3 | 4;
  /** The status this heading's subject is in, e.g. "Link sent", "Revoked", "Expires soon". */
  status?: string | undefined;
  tone?: BadgeTone | undefined;
  class?: string | undefined;
}

/**
 * A heading with its status attached to it.
 *
 * This is the viewer's "Updated ✓" pill generalised — the one status in the product the audit
 * found correctly placed, because it sits *inside* the title row of the thing that changed. Every
 * other status floats: "Link sent" 32px above the "Check your email" heading it belongs to, a
 * validation error ~300px above its field. A badge in a stack gap is a chip with no owner; a badge
 * in the heading row is a status.
 */
export function StatusHeading({
  children,
  level = 2,
  status,
  tone = 'neutral',
  class: className,
}: StatusHeadingProps) {
  const Heading = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4';

  return (
    <div class={cx('aa-status-heading', className)}>
      <Heading class="aa-status-heading__title">{children}</Heading>
      {status ? <Badge tone={tone}>{status}</Badge> : null}
    </div>
  );
}

interface CardProps {
  title?: string;
  description?: string | undefined;
  children: Child;
  footer?: Child | undefined;
  raised?: boolean | undefined;
  /**
   * A `Notice` about this card's own outcome. It renders between the header and the body — beside
   * what it describes — so a panel's result never has to travel to the top of the page to be seen.
   */
  notice?: Child | undefined;
  /**
   * `danger` reddens the border and tints the header, for a card whose subject is destructive. The
   * tint stops at the header on purpose: tinting the body would make the card's contents read as
   * the warning, when the contents are usually the thing being protected.
   */
  tone?: 'danger' | undefined;
}

export function Card({
  title,
  description,
  children,
  footer,
  raised = false,
  notice,
  tone,
}: CardProps) {
  return (
    <section
      class={cx('aa-card', raised && 'aa-card--raised', tone === 'danger' && 'aa-card--danger')}
    >
      {title || description ? (
        <header class="aa-card__header">
          {title ? <h3 class="aa-card__title">{title}</h3> : null}
          {description ? <p class="aa-card__description">{description}</p> : null}
        </header>
      ) : null}
      {notice ? <div class="aa-card__notice">{notice}</div> : null}
      <div class="aa-card__body">{children}</div>
      {footer ? <footer class="aa-card__footer">{footer}</footer> : null}
    </section>
  );
}

export interface TableColumn {
  label: string;
  /**
   * `secondary` columns are the first to go when a table has to survive a 375px viewport. They are
   * only dropped when the table opts into `columnPriority`; everywhere else every column stays and
   * the region scrolls.
   */
  priority?: 'primary' | 'secondary';
}

interface TableProps {
  caption?: string | undefined;
  columns: Array<string | TableColumn>;
  rows: Child[][];
  /** Accessible name for the scroll region when the table has no visible caption. */
  label?: string | undefined;
  /** Opt into hiding `secondary` columns below 480px instead of scrolling to them. */
  columnPriority?: boolean | undefined;
  id?: string | undefined;
}

/**
 * A horizontally scrollable table.
 *
 * The scrolling was always correct; the silence around it was the defect. A `tabindex=0` container
 * with no role and no name announced nothing, and there was no fade, no resting scrollbar and no
 * hint — so a column clipped mid-glyph at the card's edge read as broken content rather than as
 * "there is more this way". The hint here is revealed from a real measurement, never asserted:
 * a hint that is always on is a hint people learn to ignore.
 */
export function Table({ caption, columns, rows, label, columnPriority = false, id }: TableProps) {
  const normalized = columns.map((column) =>
    typeof column === 'string' ? { label: column } : column
  );
  const hintId = `${id ?? `aa-table-${slugId(caption ?? label, 'unnamed')}`}-scroll-hint`;
  const regionLabel = caption ?? label ?? 'Table';

  return (
    <div class="aa-table-wrap">
      {/* A named `<section>` is a landmark region implicitly, which is what a focusable scroll
          container needs: before this it was a `tabindex=0` div that announced nothing at all. */}
      <section
        class={cx('aa-table-scroll', columnPriority && 'aa-table-scroll--priority')}
        tabindex={0}
        aria-label={regionLabel}
        aria-describedby={hintId}
        data-aa-scroll-region="true"
        data-aa-scroll-hint-for={hintId}
      >
        <table class="aa-table" id={id}>
          {caption ? <caption>{caption}</caption> : null}
          <thead>
            <tr>
              {normalized.map((column) => (
                <th
                  scope="col"
                  data-aa-priority={column.priority === 'secondary' ? 'secondary' : undefined}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr>
                {row.map((cell, index) => (
                  <td
                    data-aa-priority={
                      normalized[index]?.priority === 'secondary' ? 'secondary' : undefined
                    }
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p class="aa-table__hint" id={hintId} data-aa-scroll-hint="true" hidden>
        Scroll the table sideways to see every column.
      </p>
    </div>
  );
}

interface DialogProps {
  id: string;
  title: string;
  description?: string | undefined;
  children: Child;
  actions: Child;
  destructive?: boolean | undefined;
}

export function Dialog({
  id,
  title,
  description,
  children,
  actions,
  destructive = false,
}: DialogProps) {
  return (
    <dialog
      class={cx('aa-dialog', destructive && 'aa-dialog--destructive')}
      id={id}
      aria-labelledby={`${id}-title`}
      aria-describedby={description ? `${id}-description` : undefined}
      data-aa-dialog="true"
    >
      <div class="aa-dialog__panel">
        <header class="aa-dialog__header">
          <h2 class="aa-dialog__title" id={`${id}-title`}>
            {title}
          </h2>
          {description ? (
            <p class="aa-dialog__description" id={`${id}-description`}>
              {description}
            </p>
          ) : null}
        </header>
        <div class="aa-dialog__body">{children}</div>
        <footer class="aa-dialog__actions">{actions}</footer>
      </div>
    </dialog>
  );
}

interface ConfirmationDialogProps {
  id: string;
  title: string;
  description: string;
  confirmLabel: string;
}

export function ConfirmationDialog({
  id,
  title,
  description,
  confirmLabel,
}: ConfirmationDialogProps) {
  return (
    <Dialog
      id={id}
      title={title}
      description={description}
      destructive
      actions={
        <>
          <Button
            variant="secondary"
            dataAttrs={{ 'data-aa-close-dialog': 'true', 'data-aa-cancel': 'true' }}
          >
            Cancel
          </Button>
          <Button variant="danger" dataAttrs={{ 'data-aa-close-dialog': 'true' }}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p class="aa-hint">
        Safe default: Cancel receives initial focus; the destructive action is styled separately.
      </p>
    </Dialog>
  );
}

export interface ConfirmDestructiveProps {
  /** Base id; the dialog, form and input derive theirs from it. */
  id: string;
  triggerLabel: string;
  title: string;
  description: string;
  /** The one sentence about what cannot be taken back. */
  consequence: string;
  /** The exact words that must be typed — the slug, the bot name, the account email. */
  confirmValue: string;
  confirmLabel: string;
  /** Where the confirmed action posts. */
  action: string;
  /** Extra fields the action needs, rendered as hidden inputs. */
  fields?: Record<string, string> | undefined;
  /** Size for the trigger button; dialog actions keep their own confirmation sizing. */
  size?: 'xs' | 'sm' | 'md' | 'lg' | undefined;
}

/**
 * The product's canonical destructive action: **trigger → dialog → typed confirmation inside the
 * dialog**.
 *
 * What it replaces is eight always-open, permanently expanded type-to-confirm forms sitting live
 * at rest on a single page, with no deliberate second step and no "this cannot be undone" moment
 * anywhere. Progressive disclosure is the point: at rest this is one button.
 *
 * Two deliberate choices. Cancel takes initial focus, because the safe option should be the one
 * under the reader's hands. And the confirming button is inert until the typed value matches —
 * which is a courtesy, not a control: the server revalidates the typed confirmation, and must
 * continue to, because nothing here is a security boundary.
 */
export function ConfirmDestructive({
  id,
  triggerLabel,
  title,
  description,
  consequence,
  confirmValue,
  confirmLabel,
  action,
  fields = {},
  size = 'md',
}: ConfirmDestructiveProps) {
  const dialogId = `${id}-dialog`;
  const formId = `${id}-form`;
  const inputId = `${id}-confirm`;

  return (
    <>
      <Button variant="danger" size={size} dataAttrs={{ 'data-aa-open-dialog': dialogId }}>
        {triggerLabel}
      </Button>
      <Dialog
        id={dialogId}
        title={title}
        description={description}
        destructive
        actions={
          <>
            <Button
              variant="secondary"
              dataAttrs={{ 'data-aa-close-dialog': 'true', 'data-aa-cancel': 'true' }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              type="submit"
              form={formId}
              disabled
              dataAttrs={{ 'data-aa-confirm-submit': id }}
            >
              {confirmLabel}
            </Button>
          </>
        }
      >
        <form class="aa-confirm-form" id={formId} method="post" action={action}>
          {Object.entries(fields).map(([name, value]) => (
            <input type="hidden" name={name} value={value} />
          ))}
          <p class="aa-confirm-form__consequence">{consequence}</p>
          {/* This field reasoned its way to the hardening treatment first — a string a human must
              transcribe exactly, where autocorrect is not a convenience but a corruption — and held
              it as three hard-coded attributes on a hand-rolled input beside a hand-rolled label
              row. Now the treatment is props on `Input` and this consumes what it pioneered, so
              there is one field shell in the product rather than one plus this.

              `autocomplete` stays stated per field rather than folded into the generalisation: it
              answers "what IS this value", and the answers differ — "off" for a phrase that exists
              only to be retyped, "one-time-code" for a setup token. The other three answer "how
              should the keyboard behave", which is the same wherever a value must survive
              transcription intact. */}
          <Input
            id={inputId}
            name="confirm"
            label={
              <>
                Type <code>{confirmValue}</code> to confirm
              </>
            }
            autocomplete="off"
            autocapitalize="none"
            autocorrect="off"
            spellcheck={false}
            dataAttrs={{
              'data-aa-confirm-match': confirmValue,
              'data-aa-confirm-for': id,
            }}
          />
          {/* The typed phrase gates a `disabled` button, and until now that gate was legible only
              to someone who could see it undim. A disabled control is not in the tab order at all,
              so a screen-reader user tabbing this dialog found two controls and no destructive
              action — no error, nothing announced, just an action that silently began to exist once
              the transcription happened to be right.

              `disabled` stays: it is the platform stopping the submit, and a real attribute beats a
              script guard, the same reasoning `required` gets on the field shell. What is added is
              the missing half — saying so. The client writes here only when the state CHANGES, in
              both directions, so a deleted character is as audible as a completed phrase and a
              polite region is not narrating every keystroke.

              Same shape as CopyBlock's status: server renders the empty region, client owns the
              text, no announcement can outlive the state it describes. */}
          <p class="sr-only" id={`${id}-state`} aria-live="polite" />
        </form>
      </Dialog>
    </>
  );
}

/**
 * Toast's own tones, narrowed to the ones it can actually render.
 *
 * It borrowed `BadgeTone`, which includes `accent` — and there is no `.aa-toast--accent`. Nothing
 * passed it, so nothing broke, but the type was an offer the component could not honour: a caller
 * following the types to `tone="accent"` would have got an unstyled toast and no error from
 * anywhere. `NoticeTone` had already solved this by declaring exactly the four it defines; this is
 * the same move, and it is the reason a shared union between components is worth distrusting —
 * `neutral` is real here and meaningless on a Notice, `accent` is real on a Badge and absent here.
 */
export type ToastTone = 'neutral' | 'success' | 'warn' | 'danger' | 'info';

interface ToastProps {
  tone?: ToastTone;
  children: Child;
}

export function Toast({ tone = 'neutral', children }: ToastProps) {
  return (
    <div class={cx('aa-toast', tone !== 'neutral' && `aa-toast--${tone}`)} role="status">
      <span>{children}</span>
      <button
        class="aa-btn aa-btn--ghost aa-btn--sm"
        type="button"
        aria-label="Dismiss toast"
        title="Dismiss toast"
        data-aa-toast-close="true"
      >
        ×
      </button>
    </div>
  );
}

export function ToastRegion() {
  return (
    <div
      class="aa-toast-region"
      aria-live="polite"
      aria-atomic="true"
      data-aa-toast-region="true"
    />
  );
}

interface EmptyStateProps {
  title: string;
  description: string;
  action?: Child;
  /** Override the derived id where two empty states share a title. */
  id?: string | undefined;
}

export function EmptyState({ title, description, action, id }: EmptyStateProps) {
  const titleId = `${id ?? `aa-empty-${slugId(title, 'state')}`}-title`;

  return (
    <section class="aa-empty" aria-labelledby={titleId}>
      <div class="aa-empty__icon">
        <ProductMark />
      </div>
      <h3 class="aa-empty__title" id={titleId}>
        {title}
      </h3>
      <p class="aa-empty__description">{description}</p>
      {action ? <div class="aa-empty__action">{action}</div> : null}
    </section>
  );
}

export type CopyBlockVariant = 'text' | 'credential';

interface CopyBlockProps {
  id: string;
  label: string;
  value: string;
  /**
   * `credential` for a copy-once secret a human may transcribe: an API key, a setup token. The
   * block stops wrapping, so the token never breaks across lines. Prose and commands stay `text`,
   * where wrapping is what you want.
   */
  variant?: CopyBlockVariant | undefined;
  /**
   * An extra control beside Copy — "Open" for a URL block, for instance. It sits in the header row
   * the block already owns, so a second affordance costs no new layout and cannot drift out of
   * alignment with the first.
   */
  action?: Child | undefined;
}

export function CopyBlock({ id, label, value, variant = 'text', action }: CopyBlockProps) {
  const hintId = `${id}-hint`;
  const labelId = `${id}-label`;
  // Two axes, two ways of knowing.
  //
  // A multi-line value overflows the block's `max-height`, and the server can prove that from the
  // value alone. A single-line value cannot overflow vertically — but a `credential` block does
  // not wrap, so a long API key overflows *sideways*, and no amount of looking at the string tells
  // you whether it does at this viewport. That case is measured: `data-aa-scroll-region` and
  // `data-aa-scroll-hint-for` are the generic contract `ui-foundation` already implements for the
  // Table, and it needs no knowledge of this component to serve it.
  //
  // The hint element is always rendered so the measurement has something to reveal, and so
  // `aria-describedby` never points at an element that is not there. A hidden target is correctly
  // ignored by assistive tech, which is the right answer when there is nothing to say.
  //
  // Every block is now handed to the measurement. This used to be withheld from multi-line values:
  // `updateScrollRegion` read only `scrollWidth`, so a block that scrolls vertically measured as
  // "no overflow" and would have had its hint hidden — the server had to settle that case itself
  // and keep the measurement away from it. a4a5508 gave the reading its second axis, so the reason
  // is spent, and one mechanism answers "is there more here" instead of two that had to agree.
  //
  // What survives is the server's opening guess, and it is only a guess: a value with a newline
  // usually overflows the block's `max-height`, but a two-line value inside a three-line box does
  // not. Rendering the hint for it is the right default anyway — before any script runs it is the
  // only thing that can speak, and the measurement now corrects it in BOTH directions the moment
  // it can. Starting hidden instead would trade a wrong hint nobody sees for a missing hint every
  // no-JavaScript reader gets.
  const mayOverflowUnaided = value.includes('\n');

  return (
    <section
      class={cx('aa-copy', variant === 'credential' && 'aa-copy--credential')}
      aria-labelledby={labelId}
    >
      <header class="aa-copy__header">
        <span class="aa-copy__label" id={labelId}>
          {label}
        </span>
        <ButtonRow>
          <span class="aa-copy__status" id={`${id}-status`} aria-live="polite" />
          <Button
            variant="secondary"
            size="sm"
            dataAttrs={{
              'data-aa-copy': id,
              'data-aa-copy-status': `${id}-status`,
            }}
          >
            Copy
          </Button>
          {action}
        </ButtonRow>
      </header>
      <pre
        id={id}
        tabindex={0}
        aria-describedby={hintId}
        data-aa-scroll-region="true"
        data-aa-scroll-hint-for={hintId}
      >
        <code>{value}</code>
      </pre>
      <p class="aa-copy__hint" id={hintId} hidden={mayOverflowUnaided ? undefined : true}>
        Scroll inside the block to view everything. Copy includes the full text.
      </p>
    </section>
  );
}

interface TabItem {
  id: string;
  label: string;
  content: Child;
}

interface TabsProps {
  id: string;
  tabs: TabItem[];
}

export function Tabs({ id, tabs }: TabsProps) {
  return (
    <section class="aa-tabs" data-aa-tabs="true">
      <div class="aa-tabs__list" role="tablist" aria-label="Style guide sections">
        {tabs.map((tab, index) => (
          <button
            class="aa-tab"
            id={`${id}-${tab.id}-tab`}
            type="button"
            role="tab"
            aria-selected={index === 0 ? 'true' : 'false'}
            aria-controls={`${id}-${tab.id}-panel`}
            tabindex={index === 0 ? 0 : -1}
            data-aa-tab={`${id}-${tab.id}-panel`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab, index) => (
        <div
          class="aa-tab-panel"
          id={`${id}-${tab.id}-panel`}
          role="tabpanel"
          aria-labelledby={`${id}-${tab.id}-tab`}
          hidden={index !== 0}
        >
          {tab.content}
        </div>
      ))}
    </section>
  );
}

interface PaginationProps {
  label: string;
  pageDescription: string;
  previousDisabled?: boolean | undefined;
  nextDisabled?: boolean | undefined;
  previousDataAttrs?: Record<string, string> | undefined;
  nextDataAttrs?: Record<string, string> | undefined;
  /**
   * Where each step goes, when paging is navigation rather than script.
   *
   * The dashboard pages a server-rendered list through cursor URLs, so its steps are links: they
   * open in a new tab, they can be copied, and they work before any JavaScript does. Without these
   * the component could only ever be driven by a client that was not written, which is most of why
   * it sat defined-and-unused while the list hand-rolled a Button and a Badge instead.
   */
  previousHref?: string | undefined;
  nextHref?: string | undefined;
}

export function Pagination({
  label,
  pageDescription,
  previousDisabled = false,
  nextDisabled = false,
  previousDataAttrs = {},
  nextDataAttrs = {},
  previousHref,
  nextHref,
}: PaginationProps) {
  return (
    <nav class="aa-pagination" aria-label={label}>
      <span class="aa-pagination__meta">{pageDescription}</span>
      <div class="aa-pagination__actions">
        <Button
          size="sm"
          variant="secondary"
          disabled={previousDisabled}
          href={previousHref}
          dataAttrs={previousDataAttrs}
        >
          Previous
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={nextDisabled}
          href={nextHref}
          dataAttrs={nextDataAttrs}
        >
          Next
        </Button>
      </div>
    </nav>
  );
}

interface AvatarProps {
  name: string;
  size?: 'sm' | 'md' | 'lg' | undefined;
}

export function Avatar({ name, size = 'md' }: AvatarProps) {
  return (
    <span
      class={cx('aa-avatar', size !== 'md' && `aa-avatar--${size}`)}
      aria-label={name}
      role="img"
    >
      {initials(name)}
    </span>
  );
}

/**
 * The product's only brand mark.
 *
 * The notch is a real cut-out — one path, two subpaths, `fill-rule="evenodd"` — not a second shape
 * painted over the first. It used to be painted `#FFFFFF`, the sole hard-coded hex in the component
 * layer, so on the Fresh Air canvas and in the drawer the notch rendered *lighter* than its
 * surroundings and read as a stray white shard rather than negative space, turning the diamond
 * into a "◀". As a cut-out it shows whatever surface it sits on, at any tint.
 *
 * The two subpaths are the vector `src/lib/og.ts` draws for the OG card, held identical by
 * `tests/unit/og-image.test.ts`; the OG keeps two painted paths because it renders onto a card
 * whose background is known to be white.
 */
export function ProductMark() {
  return (
    <span class="aa-mark" aria-hidden="true">
      <svg viewBox="0 0 32 32" focusable="false" aria-hidden="true" role="presentation">
        <g transform="rotate(45 16 16)">
          <path
            fill="currentColor"
            fill-rule="evenodd"
            d="M6 6 H16 L26 16 V26 H6 Z M16 6 L26 16 H16 Z"
          />
        </g>
      </svg>
    </span>
  );
}

interface SpinnerProps {
  label?: string;
  size?: 'sm' | 'md';
}

export function Spinner({ label = 'Loading', size = 'md' }: SpinnerProps) {
  return (
    <span
      class={cx('aa-spinner', size === 'sm' && 'aa-spinner--sm')}
      role="status"
      aria-label={label}
    >
      <span class="sr-only">{label}</span>
    </span>
  );
}

interface SkeletonProps {
  variant?: 'line' | 'block';
  label?: string;
}

export function Skeleton({ variant = 'line', label = 'Loading content' }: SkeletonProps) {
  return <span class={`aa-skeleton aa-skeleton--${variant}`} role="status" aria-label={label} />;
}

interface NavItem {
  label: string;
  href: string;
  current?: boolean;
}

interface NavShellProps {
  items: NavItem[];
  children?: Child | undefined;
  /**
   * Optional scope class for pages that need a themed chrome without changing the global app shell.
   * Dashboard uses this to square its controls while marketing, auth and public viewer chrome keep
   * the product's rounded defaults.
   */
  class?: string | undefined;
  /**
   * Who you are signed in as, and what you can do about it. Rendered in the header on desktop and
   * in the drawer footer on a phone — from ONE prop, mounted by this component in both places.
   *
   * The duplication is deliberate and it is the safe direction. Identity has to be reachable at
   * every width, but the header row is the one a phone can least spare: a second block there
   * competes with the page title. So `.aa-app-nav__account` is `display: none` below 760px and the
   * drawer carries it instead — and above 760px the drawer cannot be opened at all, because its
   * only trigger is hidden.
   *
   * The guarantee is AT MOST ONE LIVE, AND EXACTLY ONE WAY TO REACH IT. Not "exactly one live at
   * any width", which is what this said first and is false: below 760px AT REST the live count is
   * zero — the header has stood down and the drawer is closed, so identity is deliberately behind
   * the Menu button — and it becomes one when the drawer opens. The weaker claim is the true one,
   * and the stronger phrasing described a component nobody ships.
   *
   * Either way it is this component's guarantee rather than something two callers have to agree
   * about. 122c3c5 fixed the version where both copies were live at 375 with the drawer open; the
   * invariant now lives where it cannot be re-broken by mounting the thing twice by hand.
   *
   * One consequence to know: the content really is in the DOM twice, so anything with an `id`
   * belongs in `children` or nowhere. `tests/unit/ui-duplicate-ids.test.ts` will say so loudly.
   */
  account?: Child | undefined;
}

export function NavShell({ items, children, class: className, account }: NavShellProps) {
  const drawerId = 'aa-mobile-drawer';

  return (
    <>
      <header class={cx('aa-app-header', className)}>
        <div class="aa-shell aa-app-nav">
          <a class="aa-brand" href="/">
            <ProductMark />
            <span>Agent Artifacts</span>
          </a>
          <nav class="aa-desktop-nav" aria-label="Main">
            {items.map((item) => (
              <a
                class="aa-nav-link"
                href={item.href}
                aria-current={item.current ? 'page' : undefined}
              >
                {item.label}
              </a>
            ))}
          </nav>
          {/* After the nav and before the menu button, so the tab order reads brand, sections,
              identity — and so the trigger stays last on a phone, where it is the only one of the
              three that is visible. */}
          {account ? <div class="aa-app-nav__account">{account}</div> : null}
          <Button
            variant="ghost"
            class="aa-mobile-trigger"
            ariaLabel="Open navigation"
            dataAttrs={{
              'data-aa-drawer-open': drawerId,
              'aria-controls': drawerId,
            }}
          >
            Menu
          </Button>
        </div>
      </header>
      <div
        class={cx('aa-drawer', className)}
        id={drawerId}
        hidden
        data-aa-drawer="true"
        data-state="closed"
      >
        <aside
          class="aa-drawer__panel"
          aria-label="Mobile navigation"
          role="dialog"
          aria-modal="true"
          tabindex={-1}
          data-aa-drawer-panel="true"
        >
          <header class="aa-drawer__header">
            <a class="aa-brand" href="/">
              <ProductMark />
              <span>Agent Artifacts</span>
            </a>
            {/* A-45. The drawer closed with the word "Close" while every other dismissable surface
                in the product closes with an ✕ — the notice dismiss is the same glyph, the same
                stroke, the same 44px target. A drawer header is exactly where the icon convention
                is strongest and where the word costs the most, because it competes with the brand
                lockup for the one line above the navigation. The accessible name is unchanged, so
                this is the visible affordance moving to the pattern, not a rename. */}
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              ariaLabel="Close navigation"
              title="Close navigation"
              dataAttrs={{ 'data-aa-drawer-close': drawerId }}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.75"
                stroke-linecap="round"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M6 6 18 18" />
                <path d="M18 6 6 18" />
              </svg>
            </Button>
          </header>
          <nav class="aa-drawer__body" aria-label="Mobile main">
            {items.map((item) => (
              <a
                class="aa-nav-link"
                href={item.href}
                aria-current={item.current ? 'page' : undefined}
              >
                {item.label}
              </a>
            ))}
          </nav>
          {/* Only rendered when something was given: an empty footer is a 1px rule and a gap
              under the last nav link, which reads as a section that failed to load.
              The account block leads, because on a phone this footer is the only place identity
              appears and it should not be found underneath whatever else the page put here. */}
          {account || children ? (
            <footer class="aa-drawer__footer">
              {account}
              {children}
            </footer>
          ) : null}
        </aside>
        <button
          class="aa-drawer__scrim"
          type="button"
          aria-label="Close navigation"
          data-aa-drawer-close={drawerId}
        />
      </div>
    </>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? 'A';
  const second = parts.length > 1 ? parts[parts.length - 1]?.[0] : parts[0]?.[1];
  return `${first}${second ?? ''}`.toUpperCase();
}

/**
 * ── THE CHART PRIMITIVES ──────────────────────────────────────────────────────────────────────
 *
 * SERVER-RENDERED SVG, NO SCRIPT. The app-origin CSP is `script-src 'self'` with no nonce and no
 * hash mechanism, and a test asserts the product ships zero inline scripts — so a chart library is
 * not merely discouraged here, it is unreachable without widening the policy. Inline SVG is markup:
 * `img-src` never engages, `style-src 'unsafe-inline'` already permits the attributes, and the
 * whole thing costs zero bytes of JavaScript.
 *
 * Which is fitting rather than merely convenient. This feature exists because the previous counting
 * mechanism could only see readers who ran our JavaScript; presenting its results in a chart that
 * needs JavaScript would be a poor joke.
 *
 * Interaction without script: an invisible `<rect>` per bucket carrying a native `<title>`, which
 * the browser renders as a tooltip and a screen reader announces. Plus a `.sr-only` table of the
 * same numbers, so the data is readable, selectable and copyable rather than trapped in a picture.
 */

export interface SparklinePoint {
  /** Rendered into the hover tooltip and the table — already formatted, never a raw timestamp. */
  label: string;
  value: number;
}

export interface SparklineProps {
  id: string;
  points: SparklinePoint[];
  /** Names the measure in the accessible summary and the table header. */
  measure: string;
  /** Shorter charts for a stat tile, taller for the headline. */
  size?: 'sm' | 'lg';
}

const SPARKLINE_VIEWBOX = { sm: { width: 320, height: 64 }, lg: { width: 640, height: 168 } };
const SPARKLINE_PAD = 3;

/**
 * An area sparkline that stays legible at every size a real account produces — including the three
 * that a launch actually starts with.
 *
 * NO DATA, ONE POINT AND TWO POINTS ARE DESIGNED STATES, not accidents of the maths. A curve fitted
 * through one reading is a fiction; a y-axis scaled to a single value implies a trend that has not
 * happened yet. So one point draws a level, an all-zero series draws a resting baseline rather than
 * a jagged nothing, and an empty series draws the baseline alone. Every one of them reads as
 * "so far, this" instead of as a broken widget — which matters, because it is the state this ships
 * in and the first thing every new account will see.
 */
export function Sparkline({ id, points, measure, size = 'lg' }: SparklineProps) {
  const box = SPARKLINE_VIEWBOX[size];
  const geometry = sparklineGeometry(points, box);
  const total = points.reduce((sum, point) => sum + point.value, 0);
  const peak = points.reduce((max, point) => Math.max(max, point.value), 0);
  const summary =
    points.length === 0
      ? `No ${measure} recorded yet.`
      : `${measure}: ${total} across ${points.length} points, peaking at ${peak}.`;

  return (
    <figure class={cx('aa-sparkline', size === 'sm' && 'aa-sparkline--sm')} id={id}>
      <svg
        class="aa-sparkline__plot"
        viewBox={`0 0 ${box.width} ${box.height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={summary}
      >
        <defs>
          <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop class="aa-sparkline__fill-top" offset="0%" />
            <stop class="aa-sparkline__fill-bottom" offset="100%" />
          </linearGradient>
        </defs>
        {geometry.area ? (
          <path class="aa-sparkline__area" d={geometry.area} fill={`url(#${id}-fill)`} />
        ) : null}
        <path class="aa-sparkline__line" d={geometry.line} />
        {geometry.dot ? (
          <circle class="aa-sparkline__dot" cx={geometry.dot.x} cy={geometry.dot.y} r="4" />
        ) : null}
        {geometry.bands.map((band) => (
          <rect
            class="aa-sparkline__band"
            key={band.label}
            x={band.x}
            y="0"
            width={band.width}
            height={box.height}
          >
            <title>{band.label}</title>
          </rect>
        ))}
      </svg>
      <table class="sr-only">
        <caption>{summary}</caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            <th scope="col">{measure}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.label}>
              <th scope="row">{point.label}</th>
              <td>{point.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

interface SparklineGeometry {
  line: string;
  area: string | null;
  dot: { x: number; y: number } | null;
  bands: Array<{ x: number; width: number; label: string }>;
}

function sparklineGeometry(
  points: SparklinePoint[],
  box: { width: number; height: number }
): SparklineGeometry {
  const top = SPARKLINE_PAD;
  const bottom = box.height - SPARKLINE_PAD;
  const left = SPARKLINE_PAD;
  const right = box.width - SPARKLINE_PAD;

  // Nothing to draw. A baseline says "this axis exists and is empty", which is a statement; an
  // absent chart is just a hole in the layout.
  if (points.length === 0) {
    return { line: `M ${left} ${bottom} L ${right} ${bottom}`, area: null, dot: null, bands: [] };
  }

  const peak = points.reduce((max, point) => Math.max(max, point.value), 0);
  // A flat zero series is a resting baseline. Scaling it to fill the box would draw a full-height
  // shape out of nothing at all.
  const scale = (value: number): number =>
    peak === 0 ? bottom : bottom - (value / peak) * (bottom - top);

  if (points.length === 1) {
    const y = scale(points[0]?.value ?? 0);
    return {
      line: `M ${left} ${y} L ${right} ${y}`,
      area:
        peak === 0
          ? null
          : `M ${left} ${y} L ${right} ${y} L ${right} ${bottom} L ${left} ${bottom} Z`,
      // One reading is a level, not a trend — the dot says where the single measurement sits.
      dot: { x: (left + right) / 2, y },
      bands: [{ x: left, width: right - left, label: bandLabel(points[0]) }],
    };
  }

  const step = (right - left) / (points.length - 1);
  const coords = points.map((point, index) => [left + index * step, scale(point.value)] as const);

  // Catmull-Rom through the points, converted to cubic béziers. Two points degenerate to the
  // straight segment they should be, which is why there is no special case for it.
  let line = `M ${round(coords[0]?.[0])} ${round(coords[0]?.[1])}`;
  for (let index = 0; index < coords.length - 1; index += 1) {
    const p0 = coords[index - 1] ?? coords[index];
    const p1 = coords[index];
    const p2 = coords[index + 1];
    const p3 = coords[index + 2] ?? coords[index + 1];
    if (!(p0 && p1 && p2 && p3)) {
      continue;
    }
    line += ` C ${round(p1[0] + (p2[0] - p0[0]) / 6)} ${round(p1[1] + (p2[1] - p0[1]) / 6)}, ${round(
      p2[0] - (p3[0] - p1[0]) / 6
    )} ${round(p2[1] - (p3[1] - p1[1]) / 6)}, ${round(p2[0])} ${round(p2[1])}`;
  }

  const bandWidth = (right - left) / points.length;
  return {
    line,
    area: peak === 0 ? null : `${line} L ${round(right)} ${bottom} L ${round(left)} ${bottom} Z`,
    dot: null,
    bands: points.map((point, index) => ({
      x: left + index * bandWidth,
      width: bandWidth,
      label: bandLabel(point),
    })),
  };
}

function bandLabel(point: SparklinePoint | undefined): string {
  return point ? `${point.label}: ${point.value}` : '';
}

function round(value: number | undefined): string {
  return (value ?? 0).toFixed(1);
}

export interface StatCardProps {
  label: string;
  value: string;
  /** Percent change against the preceding window. Null when there is nothing to compare against. */
  change?: number | null | undefined;
  /** The definition the number carries with it — "counted once per artifact per day". */
  hint?: string | undefined;
  chart?: Child | undefined;
  /** The one figure a view leads with. Exactly one per screen. */
  hero?: boolean | undefined;
}

export function StatCard({ label, value, change, hint, chart, hero = false }: StatCardProps) {
  const delta = change === null || change === undefined || change === 0 ? null : change;
  const direction = delta === null ? null : delta > 0;

  return (
    <section class={cx('aa-stat', hero && 'aa-stat--hero')}>
      <p class="aa-stat__label">{label}</p>
      <p class="aa-stat__value">
        {value}
        {delta === null || direction === null ? null : (
          <span
            class={cx(
              'aa-stat__change',
              direction ? 'aa-stat__change--up' : 'aa-stat__change--down'
            )}
          >
            {/* The arrow is decorative; the sign in the text carries the meaning, so the two
                never have to be read together to be understood. */}
            <span aria-hidden="true">{direction ? '▲' : '▼'}</span>
            {` ${delta > 0 ? '+' : ''}${delta}%`}
          </span>
        )}
      </p>
      {hint ? <p class="aa-stat__hint">{hint}</p> : null}
      {chart ? <div class="aa-stat__chart">{chart}</div> : null}
    </section>
  );
}

export interface BarListItem {
  label: Child;
  /** Sorted and scaled against the largest value in the list. */
  value: number;
  /** Printed at the end of the row; defaults to the value. */
  display?: string | undefined;
  href?: string | undefined;
}

export interface BarListProps {
  items: BarListItem[];
  /** Names the measure for screen readers, since the bars themselves carry no label. */
  measure: string;
}

/**
 * A ranked list where the bar is the row's own background rather than a separate column — so the
 * label stays left-aligned and readable at 390px, where a real bar column would have nothing left
 * to give it.
 */
export function BarList({ items, measure }: BarListProps) {
  const peak = items.reduce((max, item) => Math.max(max, item.value), 0);

  return (
    <ol class="aa-barlist" aria-label={measure}>
      {items.map((item, index) => {
        const width = peak === 0 ? 0 : Math.max(2, Math.round((item.value / peak) * 100));
        const body = (
          <>
            <span class="aa-barlist__fill" style={`width:${width}%`} aria-hidden="true" />
            <span class="aa-barlist__label">{item.label}</span>
            <span class="aa-barlist__value">{item.display ?? String(item.value)}</span>
          </>
        );
        return (
          <li class="aa-barlist__row" key={`${index}-${item.value}`}>
            {item.href ? (
              <a class="aa-barlist__link" href={item.href}>
                {body}
              </a>
            ) : (
              <span class="aa-barlist__link">{body}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
