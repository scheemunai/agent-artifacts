// Loaded only by the homepage and the style-guide specimen. No discovery, prefetch, autoplay,
// resize listener or third-party player. Only the explicit button handler may attach media URLs.
function bindMarketingVideo(root) {
  const fallback = root.querySelector('[data-aa-video-play]');
  const video = root.querySelector('video');
  const poster = root.querySelector('[data-aa-video-poster]');
  const file = root.querySelector('[data-aa-video-file]');
  const status = root.querySelector('.aa-marketing-video__status');
  const frame = root.querySelector('.aa-marketing-video__frame');
  if (
    !(fallback instanceof HTMLAnchorElement) ||
    !(video instanceof HTMLVideoElement) ||
    !(poster instanceof HTMLElement) ||
    !(file instanceof HTMLAnchorElement) ||
    !(status instanceof HTMLElement) ||
    !(frame instanceof HTMLElement)
  ) {
    return;
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.className = fallback.className;
  button.id = fallback.id;
  button.textContent = fallback.textContent;
  button.setAttribute('data-aa-video-play', 'true');
  button.setAttribute('aria-controls', video.id);
  fallback.replaceWith(button);

  let selected = '';
  let attempt = 0;
  let deadline;
  const clearDeadline = () => window.clearTimeout(deadline);
  const failed = () => {
    clearDeadline();
    button.disabled = false;
    status.textContent = 'Playback failed. Press Watch again or open the file.';
    const returnFocus = document.activeElement === video;
    poster.hidden = false;
    video.hidden = true;
    if (returnFocus) {
      button.focus({ preventScroll: true });
    }
  };

  video.addEventListener('playing', () => {
    clearDeadline();
    poster.hidden = true;
    video.hidden = false;
    button.disabled = false;
    status.textContent = 'Playing. Use the native video controls.';
  });
  video.addEventListener('pause', () => {
    if (!video.ended && !video.error) {
      status.textContent = 'Paused. Use Play to continue.';
    }
  });
  video.addEventListener('ended', () => {
    status.textContent = 'Demo finished. You can watch it again.';
  });
  video.addEventListener('error', failed);

  button.addEventListener('click', async () => {
    if (!video.paused && !video.ended && video.readyState >= 3) {
      video.focus({ preventScroll: true });
      return;
    }
    const thisAttempt = ++attempt;
    clearDeadline();
    button.disabled = true;
    status.textContent = 'Loading… You can also open the video file.';
    video.hidden = false;
    video.focus({ preventScroll: true });

    if (!selected) {
      const width = frame.getBoundingClientRect().width;
      // A phone-sized box always keeps the 720px rendition, even at DPR 3. CSS width is the
      // deliberate byte-budget policy, not a promise of pixel-for-pixel retina video. Wider boxes
      // get the 960px film. Pin the choice: resize/fullscreen never fetches a second movie.
      const needsDesktop = width > 480;
      selected = needsDesktop ? root.dataset.aaVideoDesktop : root.dataset.aaVideoPhone;
      video.src = selected;
      file.href = selected;
      const track = video.querySelector('[data-aa-video-captions]');
      if (track instanceof HTMLTrackElement) {
        track.src = track.dataset.aaVideoCaptions;
      }
      video.load();
    } else if (video.error || video.readyState === 0) {
      // Retrying is another explicit user action, never a fallback download of the other file.
      video.load();
    }
    if (video.ended) {
      video.currentTime = 0;
    }

    deadline = window.setTimeout(() => {
      button.disabled = false;
      status.textContent = 'Still loading. Press Watch again or open the file.';
    }, 15_000);
    try {
      await video.play();
      if (thisAttempt === attempt) {
        clearDeadline();
        button.disabled = false;
      }
    } catch {
      if (thisAttempt === attempt) {
        failed();
      }
    }
  });
}

for (const root of document.querySelectorAll('[data-aa-marketing-video]')) {
  bindMarketingVideo(root);
}
