const bootElement = document.getElementById('aa-boot');
const boot = bootElement ? JSON.parse(bootElement.textContent || '{}') : {};
const root = document.querySelector('[data-aa-viewer-root]');
const gate = document.querySelector('[data-aa-password-gate]');
const documentShell = document.querySelector('[data-aa-document]');
const form = document.querySelector('[data-aa-password-form]');
const passwordInput = document.getElementById('aa-share-password');
const passwordError = document.querySelector('[data-aa-password-error]');
const passwordSubmit = document.querySelector('[data-aa-password-submit]');
const titleNode = document.querySelector('[data-aa-title]');
const bylineNode = document.querySelector('[data-aa-byline]');
const updatedNode = document.querySelector('[data-aa-updated-at]');
const contentNode = document.querySelector('[data-aa-content]');
const refreshButton = document.querySelector('[data-aa-refresh]');
const downloadLink = document.querySelector('[data-aa-download]');
const versionPicker = document.querySelector('[data-aa-version-picker]');
const versionBanner = document.querySelector('[data-aa-version-banner]');
const versionBannerText = document.querySelector('[data-aa-version-banner-text]');
const viewLatestLink = document.querySelector('[data-aa-view-latest]');
const updatedPill = document.querySelector('[data-aa-updated-pill]');
const statusRegion = document.querySelector('[data-aa-viewer-status-region]');

const POLL_INTERVAL_MS = 30_000;
// A sanity floor against a broken or zero-ish measurement, not a default. It used to sit at the
// frame's own CSS height, which meant an honest short answer — a two-line fragment measuring 60px —
// was silently clamped back up to the box it was trying to shrink.
const FRAME_MIN_HEIGHT = 48;
const FRAME_MAX_HEIGHT = 2400;
let contentHash = boot.initialContent?.content_hash || null;
let contentRequestInFlight = false;
let stopped = false;
let viewerToken = null;
let updatePillTimer = null;
const pinnedVersion = Number.isSafeInteger(Number(boot.pinnedVersion))
  ? Number(boot.pinnedVersion)
  : null;

if (root) {
  if (boot.initialContent) {
    applyContent(boot.initialContent, { showUpdated: false, preserveScroll: false });
  }

  fetchContent({ poll: false });
  installPasswordGate();
  installRefreshButton();
  installVersionPicker();
  installLiveRevalidation();
  installFrameHeightBridge();
}

function installPasswordGate() {
  if (!form) {
    return;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!passwordInput || !boot.verifyUrl) {
      return;
    }

    // The hand-rolled field carried `required`, so the browser's own constraint validation stopped
    // an empty submit before this handler ran. The registered field has no `required` pass-through
    // yet, and without a guard an empty box would POST "", spend a rate-limit attempt, and come
    // back "Incorrect password." to someone who typed nothing.
    if (!passwordInput.value) {
      setPasswordError('Enter the password to view this artifact.');
      passwordInput.focus();
      return;
    }

    setPasswordError('');
    setPasswordBusy(true);
    try {
      const response = await fetch(boot.verifyUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ password: passwordInput.value }),
      });

      if (response.status === 401) {
        setPasswordError('Incorrect password.');
        return;
      }

      if (response.status === 429) {
        setPasswordError('Too many attempts. Try again in a few minutes.');
        return;
      }

      if (!response.ok) {
        setPasswordError('Could not verify the password. Try again.');
        return;
      }

      const payload = await response.json();
      viewerToken = payload.viewer_token || null;
      await fetchContent({ poll: false });
    } finally {
      setPasswordBusy(false);
    }
  });
}

function installRefreshButton() {
  if (!refreshButton) {
    return;
  }

  refreshButton.addEventListener('click', () => {
    if (contentRequestInFlight) {
      setRefreshBusy(true);
      return;
    }
    fetchContent({ poll: true, manual: true });
  });
}

function installVersionPicker() {
  if (!versionPicker) {
    return;
  }

  versionPicker.addEventListener('change', () => {
    const value = versionPicker.value;
    if (!value) {
      window.location.href = boot.canonicalUrl || `/a/${boot.shareId}`;
      return;
    }

    const url = new URL(boot.canonicalUrl || window.location.href, window.location.origin);
    url.searchParams.set('v', value);
    window.location.href = url.toString();
  });
}

function installLiveRevalidation() {
  window.setInterval(() => {
    if (!pinnedVersion && !document.hidden) {
      fetchContent({ poll: true });
    }
  }, POLL_INTERVAL_MS);

  window.addEventListener('focus', () => {
    if (!pinnedVersion && !document.hidden) {
      fetchContent({ poll: true });
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (!pinnedVersion && !document.hidden) {
      fetchContent({ poll: true });
    }
  });
}

async function fetchContent({ poll, manual = false }) {
  if (stopped) {
    return;
  }

  if (contentRequestInFlight) {
    if (manual) {
      setRefreshBusy(true);
    }
    return;
  }

  if (!boot.contentUrl) {
    return;
  }

  contentRequestInFlight = true;
  setRefreshBusy(true);
  try {
    const url = new URL(boot.contentUrl, window.location.origin);
    if (poll) {
      url.searchParams.set('poll', '1');
    }
    if (pinnedVersion) {
      url.searchParams.set('v', String(pinnedVersion));
    }

    const headers = { Accept: 'application/json' };
    if (poll && contentHash) {
      headers['If-None-Match'] = `"${contentHash}"`;
    }
    if (viewerToken) {
      headers['X-AA-Share-Token'] = viewerToken;
    }

    let response;
    try {
      response = await fetch(url.toString(), {
        credentials: 'same-origin',
        headers,
      });
    } catch {
      // A hard network failure makes fetch *reject*; it never reaches the `!response.ok` branch
      // below. That is why an offline refresh used to produce no feedback at all — the page went
      // on presenting stale content as live.
      showViewerStatus('offline');
      return;
    }

    if (response.status === 304) {
      clearViewerStatus();
      return;
    }

    if (response.status === 401) {
      showGate();
      return;
    }

    if (response.status === 404 || response.status === 410) {
      stopped = true;
      // The envelope names the cause, and always has. Reading it is what lets an expired link and a
      // revoked one say different things mid-read, exactly as they already do on a full page load.
      showTerminal(await terminalCause(response), response.status);
      return;
    }

    if (!response.ok) {
      showViewerStatus('stale');
      return;
    }

    clearViewerStatus();
    const payload = await response.json();
    const changed = Boolean(
      contentHash && payload.content_hash && payload.content_hash !== contentHash
    );
    applyContent(payload, { showUpdated: changed, preserveScroll: changed });
  } finally {
    contentRequestInFlight = false;
    setRefreshBusy(false);
  }
}

function applyContent(payload, { showUpdated, preserveScroll }) {
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  contentHash = payload.content_hash || contentHash;

  hideGate();
  if (documentShell) {
    documentShell.hidden = false;
  }
  if (titleNode) {
    titleNode.textContent = payload.title || 'Untitled artifact';
  }
  if (bylineNode) {
    const byline = formatByline(payload.bot);
    bylineNode.textContent = byline;
    bylineNode.hidden = !byline;
  }
  if (updatedNode) {
    updatedNode.textContent = payload.updated_at
      ? `updated ${formatRelativeTime(payload.updated_at)}`
      : '';
  }
  if (downloadLink) {
    const downloadUrl = new URL(boot.downloadUrl, window.location.origin);
    if (pinnedVersion) {
      downloadUrl.searchParams.set('v', String(pinnedVersion));
    }
    downloadLink.setAttribute('href', downloadUrl.toString());
  }

  renderVersionControls(payload);
  renderArtifactContent(payload);

  if (showUpdated) {
    showUpdatedPill();
  }
  if (preserveScroll) {
    window.scrollTo(scrollX, scrollY);
  }
}

function renderArtifactContent(payload) {
  if (!contentNode) {
    return;
  }

  if (payload.type === 'html') {
    let frame = contentNode.querySelector('[data-aa-frame]');
    if (!frame) {
      contentNode.textContent = '';
      frame = document.createElement('iframe');
      frame.className = 'aa-viewer-frame';
      frame.setAttribute('data-aa-frame', 'true');
      frame.setAttribute('data-aa-frame-height', 'default');
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.setAttribute('title', payload.title || 'Artifact HTML frame');
      contentNode.append(frame);
    }
    frame.style.height = '';
    frame.setAttribute('data-aa-frame-height', 'default');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('src', payload.frame_url || 'about:blank');
    frame.setAttribute('title', payload.title || 'Artifact HTML frame');
    return;
  }

  // Same wrapper the server renders: `.aa-md` is prose scope only, and `.aa-prose-page` is the
  // reading column. Building it here keeps the polled DOM identical to the delivered DOM.
  let prose = contentNode.querySelector('.aa-prose-page');
  if (!prose) {
    contentNode.textContent = '';
    prose = document.createElement('div');
    prose.className = 'aa-prose-page';
    contentNode.append(prose);
  }
  prose.innerHTML = payload.html || '';
}

function installFrameHeightBridge() {
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || typeof data !== 'object' || data.type !== 'aa:frame-height') {
      return;
    }

    const frame = Array.from(document.querySelectorAll('[data-aa-frame]')).find(
      (candidate) => candidate.contentWindow === event.source
    );
    if (!(frame instanceof HTMLIFrameElement)) {
      return;
    }

    const requestedHeight = Number(data.height);
    if (!Number.isFinite(requestedHeight) || requestedHeight <= 0) {
      return;
    }

    const height = Math.min(
      Math.max(Math.ceil(requestedHeight), FRAME_MIN_HEIGHT),
      FRAME_MAX_HEIGHT
    );
    frame.style.height = `${height}px`;
    frame.setAttribute('data-aa-frame-height', 'measured');
  });
}

function renderVersionControls(payload) {
  const latest = Number(payload.latest_version_num || payload.version_num || 1);
  if (versionPicker) {
    versionPicker.hidden = latest <= 1;
    if (latest > 1 && versionPicker.options.length !== latest) {
      versionPicker.textContent = '';
      for (let index = 1; index <= latest; index += 1) {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = `v${index}`;
        versionPicker.append(option);
      }
    }
    versionPicker.value = String(pinnedVersion || payload.version_num || latest);
  }

  // Same predicate as `src/ui/components/version-banner.tsx`. The banner is a pinned-version
  // affordance: on the latest version there is nothing to go back to, so both the banner and its
  // "View latest" link must be gone rather than pointing at the page already on screen.
  const pinned = isPinnedVersion(pinnedVersion, latest);
  if (versionBanner) {
    versionBanner.hidden = !pinned;
    versionBanner.setAttribute('data-aa-pinned', pinned ? 'true' : 'false');
  }
  if (versionBannerText) {
    versionBannerText.textContent = pinned ? `Viewing v${pinnedVersion} of v${latest}` : '';
  }
  if (viewLatestLink) {
    viewLatestLink.hidden = !pinned;
    if (boot.canonicalUrl) {
      viewLatestLink.setAttribute('href', boot.canonicalUrl);
    }
  }
}

function isPinnedVersion(shownVersion, latestVersion) {
  return (
    typeof shownVersion === 'number' &&
    Number.isFinite(shownVersion) &&
    shownVersion > 0 &&
    shownVersion !== latestVersion
  );
}

function showGate() {
  if (gate) {
    gate.hidden = false;
  }
  if (documentShell) {
    documentShell.hidden = true;
  }
}

function hideGate() {
  if (gate) {
    gate.hidden = true;
  }
}

function setPasswordError(message) {
  // The line stays in flow with a reserved height so the submit button never shifts; only the
  // text and the field's invalid state change.
  if (passwordError) {
    passwordError.textContent = message;
  }
  if (passwordInput) {
    if (message.length > 0) {
      passwordInput.setAttribute('aria-invalid', 'true');
    } else {
      passwordInput.removeAttribute('aria-invalid');
    }
  }
}

function setPasswordBusy(isBusy) {
  if (!passwordSubmit) {
    return;
  }
  passwordSubmit.disabled = isBusy;
  passwordSubmit.textContent = isBusy ? 'Verifying…' : 'View artifact';
}

function setRefreshBusy(isBusy) {
  if (!refreshButton) {
    return;
  }
  // The mark stays put: swapping it for the word "Refreshing…" used to reflow a control that is
  // now a fixed 44px square. Busy is carried by state and by the accessible name instead.
  refreshButton.disabled = isBusy;
  refreshButton.setAttribute('aria-busy', isBusy ? 'true' : 'false');
  refreshButton.setAttribute('aria-label', isBusy ? 'Refreshing artifact' : 'Refresh artifact');
  refreshButton.setAttribute('title', isBusy ? 'Refreshing artifact' : 'Refresh artifact');
}

function showUpdatedPill() {
  if (!updatedPill) {
    return;
  }
  window.clearTimeout(updatePillTimer);
  updatedPill.hidden = false;
  updatedPill.setAttribute('data-aa-visible', 'true');
  updatePillTimer = window.setTimeout(() => {
    updatedPill.removeAttribute('data-aa-visible');
    updatedPill.hidden = true;
  }, 4000);
}

/**
 * Enters the terminal state by replacing the whole viewer root with the markup the server would
 * have sent for the same status.
 *
 * A screen's header is part of its state, not a constant. Decorating the live page instead — which
 * is what this used to do — left the version picker, Download and refresh live on a dead page, put
 * the failure message on screen twice (chrome title and card heading), and pushed the footer's
 * "Report abuse" below the fold, because `.aa-viewer-terminal` is sized as a full page and was
 * being stacked under 76-123px of chrome. Replacing the root takes all of that with it.
 *
 * The markup comes from `<template data-aa-terminal-template>`, rendered by the same component the
 * server page uses, so there is exactly one implementation of this screen. The template is chosen by
 * the cause in the error envelope when there is one, and by the bare status when there is not.
 */
async function terminalCause(response) {
  try {
    const body = await response.json();
    const code = body?.error?.code;
    return typeof code === 'string' ? code : null;
  } catch {
    // A body that will not parse is not a reason to show nothing; the status template still applies.
    return null;
  }
}

function showTerminal(cause, status) {
  const template =
    (cause && document.querySelector(`[data-aa-terminal-template="${cause}"]`)) ||
    document.querySelector(`[data-aa-terminal-template="${status}"]`);
  const currentRoot = document.querySelector('[data-aa-viewer-root]');

  if (!(template instanceof HTMLTemplateElement) || !currentRoot) {
    // No template to swap in — ask the server, which owns the canonical terminal page and knows
    // the cause behind the status. Never hand-build the card here.
    window.location.reload();
    return;
  }

  currentRoot.replaceWith(template.content.cloneNode(true));
}

/**
 * Reveals one of the refresh-failure notices the server rendered under the chrome.
 *
 * The copy lives in `viewer.tsx`, not here: this only chooses which of the two parked states is
 * true right now. The old version built a bare `<p class="aa-error">` and prepended it *outside*
 * the prose column, so on the rare occasion it did fire it landed full-bleed at x=0 with no
 * measure and no padding.
 */
function showViewerStatus(kind) {
  if (!statusRegion) {
    return;
  }
  for (const slot of statusRegion.querySelectorAll('[data-aa-viewer-status]')) {
    slot.hidden = slot.getAttribute('data-aa-viewer-status') !== kind;
  }
}

function clearViewerStatus() {
  if (!statusRegion) {
    return;
  }
  for (const slot of statusRegion.querySelectorAll('[data-aa-viewer-status]')) {
    slot.hidden = true;
  }
}

function formatByline(bot) {
  if (!bot?.name) {
    return '';
  }
  return bot.byline ? `by ${bot.name} · ${bot.byline}` : `by ${bot.name}`;
}

function formatRelativeTime(input) {
  const timestamp = Date.parse(input);
  if (!Number.isFinite(timestamp)) {
    return '';
  }
  const deltaSeconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (deltaSeconds < 60) {
    return 'just now';
  }
  const deltaMinutes = Math.round(deltaSeconds / 60);
  if (deltaMinutes < 60) {
    return `${deltaMinutes}m ago`;
  }
  const deltaHours = Math.round(deltaMinutes / 60);
  if (deltaHours < 48) {
    return `${deltaHours}h ago`;
  }
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(
    timestamp
  );
}
