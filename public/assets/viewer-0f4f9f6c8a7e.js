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

const POLL_INTERVAL_MS = 30_000;
const FRAME_MIN_HEIGHT = 288;
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

    const response = await fetch(url.toString(), {
      credentials: 'same-origin',
      headers,
    });

    if (response.status === 304) {
      return;
    }

    if (response.status === 401) {
      showGate();
      return;
    }

    if (response.status === 404 || response.status === 410) {
      stopped = true;
      showTerminal(response.status === 410 ? 'This link is no longer available.' : 'Not found');
      return;
    }

    if (!response.ok) {
      showInlineError('Could not refresh this artifact.');
      return;
    }

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

  contentNode.innerHTML = payload.html || '';
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

  if (versionBanner && versionBannerText) {
    versionBanner.hidden = !pinnedVersion;
    if (pinnedVersion) {
      versionBannerText.textContent = `Viewing v${pinnedVersion} of v${latest}`;
    }
  }
  if (viewLatestLink && boot.canonicalUrl) {
    viewLatestLink.setAttribute('href', boot.canonicalUrl);
  }
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
  refreshButton.disabled = isBusy;
  refreshButton.textContent = isBusy ? 'Refreshing…' : '↻';
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

function showTerminal(message) {
  if (documentShell) {
    documentShell.hidden = false;
  }
  hideGate();
  if (titleNode) {
    titleNode.textContent = message;
  }
  if (bylineNode) {
    bylineNode.hidden = true;
  }
  if (updatedNode) {
    updatedNode.textContent = '';
  }
  if (contentNode) {
    const currentUrl = escapeHtml(window.location.href);
    contentNode.innerHTML = `<section class="aa-viewer-terminal"><section class="aa-viewer-terminal-card"><span class="aa-mark" aria-hidden="true">◆</span><h1>${escapeHtml(message)}</h1><div class="aa-button-row aa-button-row--center aa-viewer-terminal-actions"><a class="aa-btn aa-btn--secondary" href="${currentUrl}"><span>Try again</span></a><a class="aa-btn aa-btn--ghost" href="/"><span>Go home</span></a></div></section></section>`;
  }
}

function showInlineError(message) {
  if (!contentNode) {
    return;
  }
  const error = document.createElement('p');
  error.className = 'aa-error';
  error.textContent = message;
  contentNode.prepend(error);
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

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
