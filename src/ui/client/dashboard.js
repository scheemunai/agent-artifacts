const copied = new Set();

/**
 * DataBull deliberately has no queue shim here. Its tag is deferred in the document head, so it
 * runs before DOMContentLoaded; if the tag is absent (the default for self-hosts) these functions
 * are quiet rather than inventing a global that could make an off deployment look half-on.
 */
function databull() {
  return typeof globalThis.datacheap === 'function' ? globalThis.datacheap : null;
}

export function sendDatabullGoal(goal) {
  const track = databull();
  if (!track) {
    return false;
  }
  track(goal);
  return true;
}

export function identifyDatabullUser(userId) {
  const track = databull();
  if (!track) {
    return false;
  }
  // Never grow this object with profile data. The internal account id is the whole identity
  // contract: no email, name or image leaves our infrastructure.
  track('identify', { user_id: userId });
  return true;
}

function clearOutcomeParameter(name) {
  const url = new URL(window.location.href);
  url.searchParams.delete(name);
  history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

function reportPageOutcomes() {
  const identifyMarker = document.querySelector('[data-dc-identify-user]');
  const userId = identifyMarker?.getAttribute('data-dc-identify-user');
  if (userId && identifyDatabullUser(userId)) {
    // A refresh is not another sign-in. Removing only our instruction keeps range and notice
    // parameters intact while making this outcome exactly once for ordinary browser history.
    clearOutcomeParameter('identify');
  }

  const goalMarker = document.querySelector('[data-dc-page-goal]');
  const goal = goalMarker?.getAttribute('data-dc-page-goal');
  if (goal === 'artifact_published' && sendDatabullGoal(goal)) {
    // The success notice stays rendered in this document, but a refresh must not count a second
    // publication merely because its URL still described the first one.
    clearOutcomeParameter('notice');
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', reportPageOutcomes, { once: true });
  } else {
    reportPageOutcomes();
  }
}

function noteCopied(id) {
  copied.add(id);
  const continueButton = document.querySelector('[data-aa-setup-continue]');
  if (continueButton && (copied.has('setup-key') || copied.has('setup-install-prompt'))) {
    continueButton.removeAttribute('aria-disabled');
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-aa-copy]') : null;
    const id = button?.getAttribute('data-aa-copy');
    if (id) {
      noteCopied(id);
    }
  });
}
