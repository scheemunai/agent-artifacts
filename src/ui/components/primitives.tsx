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

interface ButtonProps {
  children: Child;
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg' | undefined;
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
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  optional?: boolean | undefined;
  children: Child;
}

function FieldShell({ id, label, hint, error, optional = false, children }: FieldDescription) {
  return (
    <div class="aa-field">
      <div class="aa-label-row">
        <label class="aa-label" for={id}>
          {label}
        </label>
        {optional ? <span class="aa-optional">Optional</span> : null}
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
  label: string;
  type?: string | undefined;
  value?: string | undefined;
  placeholder?: string | undefined;
  hint?: string | undefined;
  error?: string | undefined;
  optional?: boolean | undefined;
  disabled?: boolean | undefined;
  state?: ComponentState | undefined;
  name?: string | undefined;
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
}: InputProps) {
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} optional={optional}>
      <input
        class="aa-control"
        id={id}
        name={name ?? id}
        type={type}
        value={value}
        placeholder={placeholder}
        disabled={disabled || state === 'disabled'}
        aria-invalid={error || state === 'error' ? 'true' : undefined}
        aria-describedby={describedBy(id, hint, error)}
        {...stateData(state)}
      />
    </FieldShell>
  );
}

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
  rows = 5,
}: TextareaProps) {
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} optional={optional}>
      <textarea
        class="aa-control"
        id={id}
        name={name ?? id}
        rows={rows}
        placeholder={placeholder}
        disabled={disabled || state === 'disabled'}
        aria-invalid={error || state === 'error' ? 'true' : undefined}
        aria-describedby={describedBy(id, hint, error)}
        {...stateData(state)}
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
}: SelectProps) {
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} optional={optional}>
      <select
        class="aa-control"
        id={id}
        name={name ?? id}
        disabled={disabled || state === 'disabled'}
        aria-invalid={error || state === 'error' ? 'true' : undefined}
        aria-describedby={describedBy(id, hint, error)}
        {...stateData(state)}
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

export function Badge({ children, tone = 'neutral', size = 'sm' }: BadgeProps) {
  return (
    <span class={cx('aa-badge', `aa-badge--${tone}`, size === 'md' && 'aa-badge--md')}>
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
}

export function Card({ title, description, children, footer, raised = false, notice }: CardProps) {
  return (
    <section class={cx('aa-card', raised && 'aa-card--raised')}>
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
  const hintId = `${id ?? 'aa-table'}-scroll-hint`;
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
}: ConfirmDestructiveProps) {
  const dialogId = `${id}-dialog`;
  const formId = `${id}-form`;
  const inputId = `${id}-confirm`;

  return (
    <>
      <Button variant="danger" dataAttrs={{ 'data-aa-open-dialog': dialogId }}>
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
          <div class="aa-field">
            <div class="aa-label-row">
              <label class="aa-label" for={inputId}>
                Type <code>{confirmValue}</code> to confirm
              </label>
            </div>
            <input
              class="aa-control"
              id={inputId}
              name="confirm"
              type="text"
              autocomplete="off"
              autocapitalize="none"
              spellcheck={false}
              data-aa-confirm-match={confirmValue}
              data-aa-confirm-for={id}
            />
          </div>
        </form>
      </Dialog>
    </>
  );
}

interface ToastProps {
  tone?: BadgeTone;
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
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <section class="aa-empty" aria-labelledby="empty-title">
      <div class="aa-empty__icon">
        <ProductMark />
      </div>
      <h3 class="aa-empty__title" id="empty-title">
        {title}
      </h3>
      <p class="aa-empty__description">{description}</p>
      {action ? <div class="aa-empty__action">{action}</div> : null}
    </section>
  );
}

interface CopyBlockProps {
  id: string;
  label: string;
  value: string;
}

export function CopyBlock({ id, label, value }: CopyBlockProps) {
  const hintId = `${id}-hint`;
  const labelId = `${id}-label`;

  return (
    <section class="aa-copy" aria-labelledby={labelId}>
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
        </ButtonRow>
      </header>
      <pre id={id} tabindex={0} aria-describedby={hintId}>
        <code>{value}</code>
      </pre>
      <p class="aa-copy__hint" id={hintId}>
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
}

export function Pagination({
  label,
  pageDescription,
  previousDisabled = false,
  nextDisabled = false,
  previousDataAttrs = {},
  nextDataAttrs = {},
}: PaginationProps) {
  return (
    <nav class="aa-pagination" aria-label={label}>
      <span class="aa-pagination__meta">{pageDescription}</span>
      <div class="aa-pagination__actions">
        <Button
          size="sm"
          variant="secondary"
          disabled={previousDisabled}
          dataAttrs={previousDataAttrs}
        >
          Previous
        </Button>
        <Button size="sm" variant="secondary" disabled={nextDisabled} dataAttrs={nextDataAttrs}>
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
}

export function NavShell({ items, children }: NavShellProps) {
  const drawerId = 'aa-mobile-drawer';

  return (
    <>
      <header class="aa-app-header">
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
      <div class="aa-drawer" id={drawerId} hidden data-aa-drawer="true" data-state="closed">
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
            <Button
              variant="ghost"
              size="sm"
              ariaLabel="Close navigation"
              dataAttrs={{ 'data-aa-drawer-close': drawerId }}
            >
              Close
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
          <footer class="aa-drawer__footer">{children}</footer>
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
