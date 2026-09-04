const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const lockScroll = () => {
  document.documentElement.classList.add('aa-lock-scroll');
  document.body.classList.add('aa-lock-scroll');
};
const unlockScroll = () => {
  document.documentElement.classList.remove('aa-lock-scroll');
  document.body.classList.remove('aa-lock-scroll');
};

function focusableWithin(root) {
  return Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR)).filter((element) => {
    if (!(element instanceof HTMLElement)) {
      return false;
    }
    return !element.hasAttribute('hidden') && element.offsetParent !== null;
  });
}

function focusFirst(root, preferredSelector) {
  const preferred = preferredSelector ? root.querySelector(preferredSelector) : null;
  if (preferred instanceof HTMLElement) {
    preferred.focus();
    return;
  }
  const first = focusableWithin(root)[0];
  if (first) {
    first.focus();
  }
}

function trapTab(event, root) {
  if (event.key !== 'Tab') {
    return;
  }
  const focusable = focusableWithin(root);
  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!first || !last) {
    return;
  }
  if (event.shiftKey && document.activeElement === first) {
    last.focus();
    event.preventDefault();
  }
  if (!event.shiftKey && document.activeElement === last) {
    first.focus();
    event.preventDefault();
  }
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.inset = '0 auto auto 0';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

function setCopyStatus(button, message) {
  const statusId = button.getAttribute('data-aa-copy-status');
  const status = statusId ? document.getElementById(statusId) : null;
  if (status) {
    status.textContent = message;
  }
}

function bindCopyBlocks() {
  document.addEventListener('click', async (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-aa-copy]') : null;
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }
    const targetId = button.getAttribute('data-aa-copy');
    const target = targetId ? document.getElementById(targetId) : null;
    if (!target) {
      return;
    }
    const original = button.textContent || 'Copy';
    button.disabled = true;
    button.textContent = 'Copying…';
    try {
      await copyText(target.textContent || '');
      button.textContent = 'Copied';
      setCopyStatus(button, 'Copied');
    } catch {
      button.textContent = 'Try again';
      setCopyStatus(button, 'Copy failed');
    } finally {
      window.setTimeout(() => {
        button.disabled = false;
        button.textContent = original;
        setCopyStatus(button, '');
      }, 1600);
    }
  });
}

/**
 * Every dialog behaviour is delegated from the document, like everything else in this bundle.
 *
 * It used to be half and half: opening and the close button were delegated, while the scrim click,
 * the tab trap and the scroll release were attached with `querySelectorAll` at bind time — ten
 * lines apart, in one function, with nothing marking the difference. Nothing was broken, because
 * every dialog in the product is server-rendered at load and therefore present when that ran. The
 * asymmetry was the defect: a dialog inserted afterwards would open, lock the page's scrolling, and
 * then have no scrim close, no tab trap and no release — leaving the reader in a modal they can
 * dismiss only with Escape, on a page that no longer scrolls.
 *
 * Delegation is not a style preference here. It is the difference between "works for the markup
 * that happened to exist" and "works for the component".
 */
function bindDialogs() {
  document.addEventListener('click', (event) => {
    const opener =
      event.target instanceof Element ? event.target.closest('[data-aa-open-dialog]') : null;
    if (opener instanceof HTMLElement) {
      const dialogId = opener.getAttribute('data-aa-open-dialog');
      const dialog = dialogId ? document.getElementById(dialogId) : null;
      if (dialog instanceof HTMLDialogElement) {
        dialog.showModal();
        lockScroll();
        focusFirst(dialog, '[data-aa-cancel]');
      }
    }

    const closer =
      event.target instanceof Element ? event.target.closest('[data-aa-close-dialog]') : null;
    if (closer instanceof HTMLElement) {
      const dialog = closer.closest('dialog');
      if (dialog instanceof HTMLDialogElement) {
        dialog.close();
      }
    }

    // The scrim. A click on the backdrop reports the DIALOG as its target — the panel and
    // everything in it report themselves — so "target is the dialog" is exactly "outside the
    // panel", with no geometry involved.
    if (event.target instanceof HTMLDialogElement && event.target.matches('[data-aa-dialog]')) {
      event.target.close();
    }
  });

  /*
   * `cancel` and `close` DO NOT BUBBLE. That is the whole reason these two are registered with
   * `capture: true` rather than alongside the delegated handlers above: a normal document listener
   * never sees them, but the capture phase still walks document → target for a non-bubbling event,
   * so this reaches every dialog including ones that did not exist at bind time.
   *
   * Verified rather than assumed — a bubble-phase listener for these two fires zero times in
   * Chromium while the capture-phase one fires for Escape (cancel then close) and for `.close()`.
   */
  const releaseScroll = (event) => {
    if (event.target instanceof HTMLDialogElement && event.target.matches('[data-aa-dialog]')) {
      unlockScroll();
    }
  };
  document.addEventListener('cancel', releaseScroll, true);
  document.addEventListener('close', releaseScroll, true);

  document.addEventListener('keydown', (event) => {
    const dialog =
      event.target instanceof Element ? event.target.closest('dialog[data-aa-dialog]') : null;
    if (dialog instanceof HTMLDialogElement) {
      trapTab(event, dialog);
    }
  });
}

function toastRole(tone) {
  return tone === 'danger' || tone === 'warn' ? 'alert' : 'status';
}

function bindToasts() {
  document.addEventListener('click', (event) => {
    const closeTrigger =
      event.target instanceof Element
        ? event.target.closest(
            '[data-aa-toast-close], .aa-toast button[aria-label="Dismiss toast"]'
          )
        : null;
    if (closeTrigger instanceof HTMLElement) {
      closeTrigger.closest('.aa-toast')?.remove();
      return;
    }

    const trigger =
      event.target instanceof Element ? event.target.closest('[data-aa-toast-trigger]') : null;
    if (!(trigger instanceof HTMLElement)) {
      return;
    }
    const region = document.querySelector('[data-aa-toast-region]');
    if (!region) {
      return;
    }
    const tone = trigger.getAttribute('data-aa-toast-tone') || 'info';
    const message = trigger.getAttribute('data-aa-toast-message') || 'Saved.';
    const toast = document.createElement('div');
    toast.className = `aa-toast aa-toast--${tone}`;
    toast.setAttribute('role', toastRole(tone));

    const text = document.createElement('span');
    text.textContent = message;
    const close = document.createElement('button');
    close.className = 'aa-btn aa-btn--ghost aa-btn--sm';
    close.type = 'button';
    close.setAttribute('aria-label', 'Dismiss toast');
    close.setAttribute('title', 'Dismiss toast');
    close.setAttribute('data-aa-toast-close', 'true');
    close.textContent = '×';

    toast.append(text, close);
    region.append(toast);
    window.setTimeout(() => toast.remove(), 4200);
  });
}

/**
 * Keeps a destructive confirmation inert until the typed value matches exactly.
 *
 * This is a courtesy, not a control. The server revalidates the typed confirmation and must keep
 * doing so — nothing on this side of the wire is a security boundary.
 */
function bindConfirmDestructive() {
  document.addEventListener('input', (event) => {
    const field =
      event.target instanceof Element ? event.target.closest('[data-aa-confirm-match]') : null;
    if (!(field instanceof HTMLInputElement)) {
      return;
    }

    const expected = field.getAttribute('data-aa-confirm-match') || '';
    const owner = field.getAttribute('data-aa-confirm-for');
    const submit = owner
      ? document.querySelector(`[data-aa-confirm-submit="${owner}"]`)
      : field.closest('dialog')?.querySelector('[data-aa-confirm-submit]');
    if (!(submit instanceof HTMLButtonElement)) {
      return;
    }

    const blocked = field.value !== expected;
    if (submit.disabled === blocked) {
      // Nothing changed, so there is nothing to say. Announcing on every keystroke would make the
      // region narrate typing instead of reporting the one event that matters.
      return;
    }

    submit.disabled = blocked;

    // A disabled button leaves the tab order entirely, so without this the destructive action
    // appears and disappears with no signal to anyone not watching it dim.
    const status = owner ? document.getElementById(`${owner}-state`) : null;
    if (status instanceof HTMLElement) {
      const action = (submit.textContent || 'The action').trim();
      status.textContent = blocked
        ? `${action} is unavailable until the confirmation matches.`
        : `Confirmation matches. ${action} is now available.`;
    }
  });
}

function bindNotices() {
  // A page-level notice is one that could not be attached to what it describes. That costs
  // something, and this is the price: it is focusable, and focus goes to it on load, so a message
  // the reader would otherwise have to scroll to find is announced and brought on screen. An
  // attached notice needs none of this, which is the point of preferring one.
  const detached = document.querySelector('[data-aa-notice-page]');
  if (detached instanceof HTMLElement) {
    detached.focus();
  }

  // A Notice is server-rendered in normal flow, so dismissal is the only other client behaviour it
  // has: remove the element the user asked to be rid of, and nothing else on the page moves.
  document.addEventListener('click', (event) => {
    const trigger =
      event.target instanceof Element ? event.target.closest('[data-aa-notice-dismiss]') : null;
    if (!(trigger instanceof HTMLElement)) {
      return;
    }
    trigger.closest('.aa-notice')?.remove();
  });
}

/**
 * Reveals a scroll affordance only when there is genuinely something past the edge.
 *
 * A hint that is always on — the shape the CopyBlock ships — is a hint people learn to ignore, so
 * this one is a measurement: `scrollWidth > clientWidth`, re-taken whenever the box or the content
 * changes, plus an end-of-scroll flag so the edge fade lifts once the last column is visible.
 */
function updateScrollRegion(region) {
  // Both axes, for different consumers. `data-aa-overflow` drives an edge fade, which is a
  // sideways affordance, so it stays horizontal. The hint answers "is there more here", which is
  // true in either direction — a region that scrolls only vertically used to measure as "no
  // overflow" and have its hint hidden, so callers with that shape had to settle the question
  // themselves and withhold the hint from this measurement.
  //
  // The constraint that comes with the second axis: a region whose hint copy names a direction
  // must not be able to overflow the other one. Held by
  // `tests/unit/ui-scroll-affordance-axes.test.ts`, not by this file.
  const overflowingX = region.scrollWidth - region.clientWidth > 1;
  const overflowingY = region.scrollHeight - region.clientHeight > 1;
  region.setAttribute('data-aa-overflow', overflowingX ? 'true' : 'false');

  const atEnd = region.scrollLeft + region.clientWidth >= region.scrollWidth - 1;
  region.setAttribute('data-aa-scroll-end', overflowingX && atEnd ? 'true' : 'false');

  const hintId = region.getAttribute('data-aa-scroll-hint-for');
  const hint = hintId ? document.getElementById(hintId) : null;
  if (hint) {
    hint.hidden = !(overflowingX || overflowingY);
  }
}

/**
 * IT HAS TO REACH CONTENT THAT ARRIVES LATER, WHICH IS THE SAME LESSON `bindDialogs` RECORDS.
 *
 * This collected `querySelectorAll` once and stopped, which was correct for the surfaces that
 * existed when it was written — every table, copy block and API sample is server-rendered at load.
 * Markdown tables are not: the viewer replaces the whole prose column on every live update, so a
 * table that arrived from a poll had a scroll container, a fade rule and a hint, and nothing
 * measuring any of them. The reader would have got a clipped table with no fade and no way to know
 * it scrolled — the exact defect the affordance exists to prevent, reappearing an update later.
 *
 * `bound` is the guard that makes rescanning free: a region already wired is skipped, so the
 * observer can be as eager as it likes without stacking listeners on the same element.
 */
const boundScrollRegions = new WeakSet();
let scrollRegionResizeObserver = null;

function bindScrollRegion(region) {
  if (boundScrollRegions.has(region)) {
    return;
  }
  boundScrollRegions.add(region);

  updateScrollRegion(region);
  region.addEventListener('scroll', () => updateScrollRegion(region), { passive: true });

  // Rotating a phone, opening the drawer or loading a webfont all change the answer.
  if (scrollRegionResizeObserver) {
    scrollRegionResizeObserver.observe(region);
  }
}

function scanScrollRegions(root) {
  const scope = root instanceof Element ? root : document;
  if (scope instanceof Element && scope.matches('[data-aa-scroll-region]')) {
    bindScrollRegion(scope);
  }
  for (const region of scope.querySelectorAll('[data-aa-scroll-region]')) {
    bindScrollRegion(region);
  }
}

function bindScrollRegions() {
  if (typeof ResizeObserver === 'function') {
    scrollRegionResizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        updateScrollRegion(entry.target);
      }
    });
  } else {
    // No ResizeObserver: `scanScrollRegions` only wires regions it has not seen, so remeasuring
    // the ones it has is a separate pass rather than a side effect of scanning.
    window.addEventListener('resize', () => {
      for (const region of document.querySelectorAll('[data-aa-scroll-region]')) {
        updateScrollRegion(region);
      }
      scanScrollRegions(document);
    });
  }

  scanScrollRegions(document);

  // The delegated equivalent for a thing that cannot be delegated: `scroll` does not bubble and a
  // region has to be measured before it is touched, so the listener cannot wait for an event on
  // it. Watching for the element instead is the same contract every other behaviour here gets.
  if (typeof MutationObserver === 'function') {
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element) {
            scanScrollRegions(node);
          }
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
}

function selectTab(tab) {
  const root = tab.closest('[data-aa-tabs]');
  if (!root) {
    return;
  }
  root.querySelectorAll('[role="tab"]').forEach((candidate) => {
    const selected = candidate === tab;
    candidate.setAttribute('aria-selected', selected ? 'true' : 'false');
    candidate.setAttribute('tabindex', selected ? '0' : '-1');
  });
  root.querySelectorAll('[role="tabpanel"]').forEach((panel) => {
    panel.hidden = panel.id !== tab.getAttribute('data-aa-tab');
  });
  tab.focus();
}

function bindTabs() {
  document.querySelectorAll('[data-aa-tabs]').forEach((root) => {
    root.addEventListener('click', (event) => {
      const tab = event.target instanceof Element ? event.target.closest('[role="tab"]') : null;
      if (tab instanceof HTMLButtonElement) {
        selectTab(tab);
      }
    });
    root.addEventListener('keydown', (event) => {
      const tab = event.target instanceof Element ? event.target.closest('[role="tab"]') : null;
      if (!(tab instanceof HTMLButtonElement)) {
        return;
      }
      const tabs = Array.from(root.querySelectorAll('[role="tab"]')).filter(
        (candidate) => candidate instanceof HTMLButtonElement
      );
      const current = tabs.indexOf(tab);
      let next = current;
      if (event.key === 'ArrowRight') {
        next = (current + 1) % tabs.length;
      } else if (event.key === 'ArrowLeft') {
        next = (current - 1 + tabs.length) % tabs.length;
      } else if (event.key === 'Home') {
        next = 0;
      } else if (event.key === 'End') {
        next = tabs.length - 1;
      } else {
        return;
      }
      event.preventDefault();
      const nextTab = tabs[next];
      if (nextTab instanceof HTMLButtonElement) {
        selectTab(nextTab);
      }
    });
  });
}

function openDrawer(drawer) {
  drawer.hidden = false;
  requestAnimationFrame(() => {
    drawer.setAttribute('data-state', 'open');
    lockScroll();
    focusFirst(drawer, '[data-aa-drawer-panel]');
  });
}

function closeDrawer(drawer) {
  drawer.setAttribute('data-state', 'closed');
  unlockScroll();
  window.setTimeout(() => {
    drawer.hidden = true;
  }, 180);
}

function bindDrawer() {
  document.addEventListener('click', (event) => {
    const opener =
      event.target instanceof Element ? event.target.closest('[data-aa-drawer-open]') : null;
    if (opener instanceof HTMLElement) {
      const drawerId = opener.getAttribute('data-aa-drawer-open');
      const drawer = drawerId ? document.getElementById(drawerId) : null;
      if (drawer instanceof HTMLElement) {
        openDrawer(drawer);
      }
    }

    const closer =
      event.target instanceof Element ? event.target.closest('[data-aa-drawer-close]') : null;
    if (closer instanceof HTMLElement) {
      const drawerId = closer.getAttribute('data-aa-drawer-close');
      const drawer = drawerId
        ? document.getElementById(drawerId)
        : closer.closest('[data-aa-drawer]');
      if (drawer instanceof HTMLElement) {
        closeDrawer(drawer);
      }
    }
  });

  document.addEventListener('keydown', (event) => {
    const drawer = document.querySelector('[data-aa-drawer][data-state="open"]');
    if (!(drawer instanceof HTMLElement)) {
      return;
    }
    if (event.key === 'Escape') {
      closeDrawer(drawer);
    }
    trapTab(event, drawer);
  });
}

/**
 * PasswordInput: the reveal toggle and the Caps Lock hint.
 *
 * Both are delegated from the document rather than bound per field, so a password field rendered
 * into a dialog after load works without re-binding — the same contract every other behaviour in
 * this file uses.
 *
 * The label is rewritten on toggle because it names the ACTION, not the state: revealed, the next
 * act is to hide. `aria-pressed` carries the state, so the two never have to mean the same thing.
 */
/**
 * Add or remove one id from an element's `aria-describedby`, leaving whatever else is in there
 * alone — the field usually already points at a hint or an error, and this must not become the
 * thing that drops them.
 */
function describeWith(element, id, present) {
  const ids = (element.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
  const without = ids.filter((value) => value !== id);
  const next = present ? [...without, id] : without;
  if (next.length) {
    element.setAttribute('aria-describedby', next.join(' '));
  } else {
    element.removeAttribute('aria-describedby');
  }
}

function bindPasswordInputs() {
  document.addEventListener('click', (event) => {
    const toggle =
      event.target instanceof Element ? event.target.closest('[data-aa-password-toggle]') : null;
    if (!toggle) {
      return;
    }
    const fieldId = toggle.getAttribute('data-aa-password-toggle');
    const field = fieldId ? document.getElementById(fieldId) : null;
    if (!(field instanceof HTMLInputElement)) {
      return;
    }
    const reveal = field.type === 'password';
    field.type = reveal ? 'text' : 'password';
    toggle.setAttribute('aria-pressed', reveal ? 'true' : 'false');
    const label = reveal ? 'Hide password' : 'Show password';
    toggle.setAttribute('aria-label', label);
    toggle.setAttribute('title', label);
  });

  // `getModifierState` is the only reading that is true on arrival rather than inferred from the
  // character that was typed, so a field focused with Caps Lock already down says so immediately.
  const syncCaps = (event) => {
    const field =
      event.target instanceof Element ? event.target.closest('[data-aa-password-input]') : null;
    if (!field) {
      return;
    }
    const wrap = field.closest('.aa-field');
    const hint = wrap ? wrap.querySelector('[data-aa-password-caps]') : null;
    if (!hint || typeof event.getModifierState !== 'function') {
      return;
    }
    const on = event.getModifierState('CapsLock');
    hint.hidden = !on;
    describeWith(field, hint.id, on);
  };

  document.addEventListener('keydown', syncCaps);
  document.addEventListener('keyup', syncCaps);
  document.addEventListener('focusin', syncCaps);
  document.addEventListener('focusout', (event) => {
    const field =
      event.target instanceof Element ? event.target.closest('[data-aa-password-input]') : null;
    const wrap = field ? field.closest('.aa-field') : null;
    const hint = wrap ? wrap.querySelector('[data-aa-password-caps]') : null;
    if (hint && field) {
      hint.hidden = true;
      describeWith(field, hint.id, false);
    }
  });
}

bindCopyBlocks();
bindDialogs();
bindToasts();
bindNotices();
bindConfirmDestructive();
bindScrollRegions();
bindTabs();
bindDrawer();
bindPasswordInputs();
