import { expect, type Locator, test } from '@playwright/test';

const base =
  process.env.E2E_CLOUD_BASE_URL ?? `http://127.0.0.1:${process.env.E2E_CLOUD_PORT ?? 3198}`;
const movie = (url: string) => new URL(url).pathname.endsWith('.mp4');
// Document coordinates: native focus scrolling is not a layout shift.
const geometry = (frame: Locator) =>
  frame.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height };
  });

test('homepage film stays inert through scroll, hover and focus, then plays one native rendition', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (movie(request.url())) requests.push(new URL(request.url()).pathname);
  });
  await page.goto(base);
  const root = page.locator('[data-aa-marketing-video]');
  const frame = root.locator('.aa-marketing-video__frame');
  const video = root.locator('video');
  const play = root.getByRole('button', { name: 'Watch the 46-second demo' });
  await expect(play).toBeVisible();
  await frame.scrollIntoViewIfNeeded();
  await root.hover();
  await play.focus();
  await page.waitForTimeout(300);
  expect(requests).toEqual([]);
  await expect(video).not.toHaveAttribute('src');
  await expect(video.locator('track')).not.toHaveAttribute('src');
  const before = await geometry(frame);
  const expected = await root.evaluate((element) => {
    const box = element.querySelector('.aa-marketing-video__frame');
    if (!box) throw new Error('Missing reserved movie frame');
    const width = box.getBoundingClientRect().width;
    return width > 480
      ? element.getAttribute('data-aa-video-desktop')
      : element.getAttribute('data-aa-video-phone');
  });
  await play.press('Enter');
  await expect(video).toBeFocused();
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeGreaterThan(0);
  expect([...new Set(requests)]).toEqual([expected]);
  expect(await geometry(frame)).toEqual(before);
  expect(
    await video.evaluate((element: HTMLVideoElement) => ({
      controls: element.controls,
      inline: element.playsInline,
      muted: element.muted,
      autoplay: element.autoplay,
      loop: element.loop,
      duration: element.duration,
    }))
  ).toEqual({
    controls: true,
    inline: true,
    muted: false,
    autoplay: false,
    loop: false,
    duration: 46,
  });

  // The optional visual alternative must really parse, not merely satisfy a markup lint rule.
  await video.evaluate((element: HTMLVideoElement) => {
    const track = element.textTracks[0];
    if (!track) throw new Error('Missing native visual transcript');
    track.mode = 'showing';
  });
  await expect
    .poll(() => video.locator('track').evaluate((element: HTMLTrackElement) => element.readyState))
    .toBe(2);
  expect(
    await video.evaluate((element: HTMLVideoElement) => element.textTracks[0]?.cues?.length)
  ).toBe(5);
  await video.evaluate((element: HTMLVideoElement) => {
    const track = element.textTracks[0];
    if (!track) throw new Error('Missing native visual transcript');
    track.mode = 'disabled';
  });

  // Native keyboard controls, followed by a real range-backed seek near the end (no media mocks).
  await video.press('Space');
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
  // Native controls live in Chromium's closed shadow tree; reach the actual timeline by Tab,
  // not by assuming arrow keys on the outer VIDEO seek (or a fixed five-second increment).
  const pausedAt = await video.evaluate((element: HTMLVideoElement) => element.currentTime);
  const cdp = await page.context().newCDPSession(page);
  await video.focus();
  let timeline = false;
  for (let step = 0; step < 9; step += 1) {
    const tree = await cdp.send('Accessibility.getFullAXTree');
    timeline = tree.nodes.some(
      (node) =>
        node.role?.value === 'slider' &&
        node.name?.value === 'video time scrubber' &&
        node.properties?.some(
          (property) => property.name === 'focused' && property.value.value === true
        )
    );
    if (timeline) break;
    await page.keyboard.press('Tab');
  }
  expect(timeline).toBe(true);
  await page.keyboard.press('ArrowRight');
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeGreaterThan(pausedAt);
  await cdp.detach();
  await video.evaluate((element: HTMLVideoElement) => {
    element.currentTime = 45.4;
  });
  await video.press('Space');
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.ended)).toBe(true);
  await expect(root.locator('.aa-marketing-video__status')).toContainText('Demo finished');
  await page.setViewportSize({ width: 1000, height: 800 });
  await root.getByRole('button', { name: 'Watch the 46-second demo' }).click();
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeLessThan(10);
  expect([...new Set(requests)]).toEqual([expected]);
  await root.getByText('Read the demo transcript', { exact: true }).click();
  await expect(
    root.getByText('This film illustrates a workflow with fictional example content.')
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('a failed movie request has a visible focused retry and never switches renditions', async ({
  page,
}) => {
  // Deliberate negative control only. Successful playback in the preceding test uses real HTTP.
  await page.route('**/*.mp4', (route) => route.abort('failed'));
  await page.goto(base);
  const root = page.locator('[data-aa-marketing-video]');
  const frame = root.locator('.aa-marketing-video__frame');
  const initialBox = await geometry(frame);
  await root.getByRole('button', { name: 'Watch the 46-second demo' }).click();
  await expect(root.locator('.aa-marketing-video__status')).toContainText('Playback failed');
  const selected = await root.locator('video').getAttribute('src');
  if (!selected) throw new Error('Activation did not select a movie');
  await expect(root.getByRole('button', { name: 'Watch the 46-second demo' })).toBeFocused();
  await expect(root.locator('[data-aa-video-poster]')).toBeVisible();
  expect(await geometry(frame)).toEqual(initialBox);
  await expect(root.getByRole('link', { name: 'Open video file' })).toHaveAttribute(
    'href',
    selected
  );
  await page.unroute('**/*.mp4');
  await root.getByRole('button', { name: 'Watch the 46-second demo' }).click();
  await expect
    .poll(() => root.locator('video').evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeGreaterThan(0);
  await expect(root.locator('video')).toHaveAttribute('src', selected);
});

test('no JavaScript keeps a real file-navigation fallback and a native transcript, not a dead button', async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: testInfo.project.use.viewport ?? { width: 1440, height: 1000 },
  });
  try {
    const page = await context.newPage();
    const requests: string[] = [];
    page.on('request', (request) => {
      if (movie(request.url())) requests.push(request.url());
    });
    await page.goto(base);
    const root = page.locator('[data-aa-marketing-video]');
    const link = root.getByRole('link', { name: 'Watch the 46-second demo' });
    await link.scrollIntoViewIfNeeded();
    await link.hover();
    await link.focus();
    await page.waitForTimeout(200);
    expect(requests).toEqual([]);
    await expect(root.getByRole('button')).toHaveCount(0);
    await root.getByText('Read the demo transcript', { exact: true }).click();
    await expect(root.locator('details')).toHaveAttribute('open');
    const source = await root.getAttribute('data-aa-video-phone');
    if (!source) throw new Error('Missing progressive fallback source');
    await expect(link).toHaveAttribute('href', source);
    const response = page.waitForResponse((response) => movie(response.url()));
    const bounds = await link.boundingBox();
    if (!bounds) throw new Error('Fallback link is not visible');
    // Raw browser input avoids waiting for a media-document navigation to finish streaming.
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    expect([200, 206]).toContain((await response).status());
    expect([...new Set(requests.map((url) => new URL(url).pathname))]).toEqual([source]);
  } finally {
    await context.close();
  }
});

test('a rejected play promise exposes the same usable retry rather than a silent or automatic fallback', async ({
  page,
}) => {
  // Simulate one browser policy rejection, not a different server or invented movie response.
  await page.addInitScript(() => {
    const original = HTMLMediaElement.prototype.play;
    let first = true;
    HTMLMediaElement.prototype.play = function () {
      if (first) {
        first = false;
        return Promise.reject(new DOMException('Test-only policy rejection', 'NotAllowedError'));
      }
      return original.call(this);
    };
  });
  await page.goto(base);
  const root = page.locator('[data-aa-marketing-video]');
  const button = root.getByRole('button', { name: 'Watch the 46-second demo' });
  await button.click();
  await expect(root.locator('.aa-marketing-video__status')).toContainText('Playback failed');
  await expect(button).toBeEnabled();
  await expect(button).toBeFocused();
  expect(await root.locator('video').evaluate((element: HTMLVideoElement) => element.paused)).toBe(
    true
  );
  await button.press('Enter');
  await expect
    .poll(() => root.locator('video').evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeGreaterThan(0);
});
