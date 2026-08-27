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
  });

  document.querySelectorAll('dialog[data-aa-dialog]').forEach((dialog) => {
    if (!(dialog instanceof HTMLDialogElement)) {
      return;
    }
    dialog.addEventListener('cancel', unlockScroll);
    dialog.addEventListener('close', unlockScroll);
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) {
        dialog.close();
      }
    });
    dialog.addEventListener('keydown', (event) => trapTab(event, dialog));
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

function bindNotices() {
  // A Notice is server-rendered in normal flow, so dismissal is the only client behaviour it has:
  // remove the element the user asked to be rid of, and nothing else on the page moves sideways.
  document.addEventListener('click', (event) => {
    const trigger =
      event.target instanceof Element ? event.target.closest('[data-aa-notice-dismiss]') : null;
    if (!(trigger instanceof HTMLElement)) {
      return;
    }
    trigger.closest('.aa-notice')?.remove();
  });
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

bindCopyBlocks();
bindDialogs();
bindToasts();
bindNotices();
bindTabs();
bindDrawer();
