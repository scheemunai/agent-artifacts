import { describe, expect, it } from 'vitest';
import { classifyView, type ViewRequestFacts } from '../../src/services/analytics.js';
import {
  BOT_SIGNATURES,
  classifyDevice,
  INTERNAL_USER_AGENT,
  matchBotSignature,
} from '../../src/services/bot-signatures.js';

function facts(overrides: Partial<ViewRequestFacts> = {}): ViewRequestFacts {
  return {
    method: 'GET',
    ip: '198.51.100.5',
    userAgent: CHROME,
    referer: null,
    secPurpose: null,
    purpose: null,
    xMoz: null,
    secFetchDest: 'document',
    ...overrides,
  };
}

const CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

/**
 * EVERY ONE OF THESE WAS MEASURED COUNTING AS A VIEW — AND AS A UNIQUE VISITOR — ON THE BUILD THIS
 * REPLACES. Uniqueness keyed on a cookie, so a crawler that stores none looked like a brand-new
 * person on every request it made. They are listed by name so the fix is anchored to the evidence
 * rather than to a category.
 */
const MEASURED_INFLATORS = [
  ['Googlebot', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
  [
    'GPTBot',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.0; +https://openai.com/gptbot',
  ],
  ['curl', 'curl/8.5.0'],
  ['python-requests', 'python-requests/2.31.0'],
  ['Slackbot', 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)'],
] as const;

const CRAWLERS: ReadonlyArray<readonly [string, string]> = [
  ...MEASURED_INFLATORS,
  ['bingbot', 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)'],
  ['DuckDuckBot', 'DuckDuckBot/1.1; (+http://duckduckgo.com/duckduckbot.html)'],
  ['YandexBot', 'Mozilla/5.0 (compatible; YandexBot/3.0)'],
  ['Baiduspider', 'Mozilla/5.0 (compatible; Baiduspider/2.0)'],
  ['Applebot', 'Mozilla/5.0 (compatible; Applebot/0.1)'],
  ['ClaudeBot', 'Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)'],
  ['PerplexityBot', 'Mozilla/5.0 (compatible; PerplexityBot/1.0)'],
  ['CCBot', 'CCBot/2.0 (https://commoncrawl.org/faq/)'],
  ['Bytespider', 'Mozilla/5.0 (compatible; Bytespider)'],
  ['Amazonbot', 'Mozilla/5.0 (compatible; Amazonbot/0.1)'],
  ['Discordbot', 'Mozilla/5.0 (compatible; Discordbot/2.0)'],
  ['Twitterbot', 'Twitterbot/1.0'],
  [
    'facebookexternalhit',
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  ],
  ['LinkedInBot', 'LinkedInBot/1.0 (compatible; Mozilla/5.0)'],
  ['WhatsApp', 'WhatsApp/2.23.20.0'],
  ['TelegramBot', 'TelegramBot (like TwitterBot)'],
  ['SkypeUriPreview', 'Mozilla/5.0 (compatible; SkypeUriPreview Preview/0.5)'],
  ['redditbot', 'Mozilla/5.0 (compatible; redditbot/1.0)'],
  ['Mastodon', 'http.rb/5.1.1 (Mastodon/4.2.1; +https://mastodon.social/)'],
  ['Embedly', 'Mozilla/5.0 (compatible; Embedly/0.2)'],
  ['wget', 'Wget/1.21.3'],
  ['HTTPie', 'HTTPie/3.2.2'],
  ['httpx', 'python-httpx/0.27.0'],
  ['Scrapy', 'Scrapy/2.11.0 (+https://scrapy.org)'],
  ['Go client', 'Go-http-client/2.0'],
  ['Java', 'Java/17.0.9'],
  ['OkHttp', 'okhttp/4.12.0'],
  ['axios', 'axios/1.6.7'],
  ['node-fetch', 'node-fetch/1.0 (+https://github.com/bitinn/node-fetch)'],
  ['libwww-perl', 'libwww-perl/6.72'],
  ['Guzzle', 'GuzzleHttp/7'],
  ['PowerShell', 'Mozilla/5.0 (Windows NT; WindowsPowerShell/5.1.19041.4291)'],
  ['HeadlessChrome', 'Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/120.0.0.0 Safari/537.36'],
  ['PhantomJS', 'Mozilla/5.0 (Unknown; Linux x86_64) PhantomJS/2.1.1'],
  ['Playwright', 'Mozilla/5.0 Playwright/1.40'],
  ['UptimeRobot', 'Mozilla/5.0+(compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)'],
  ['Pingdom', 'Pingdom.com_bot_version_1.4'],
  ['Datadog', 'Datadog/Synthetics'],
  ['AhrefsBot', 'Mozilla/5.0 (compatible; AhrefsBot/7.0)'],
  ['SemrushBot', 'Mozilla/5.0 (compatible; SemrushBot/7~bl)'],
  ['Censys', 'Mozilla/5.0 (compatible; CensysInspect/1.1)'],
  ['ia_archiver', 'ia_archiver (+http://www.alexa.com/site/help/webmasters)'],
  ['Feedly', 'Feedly/1.0 (+http://www.feedly.com/fetcher.html)'],
];

/**
 * THE FAILURE NOBODY NOTICES. A pattern that eats a real browser silently zeroes a customer's
 * numbers, and nothing about the product looks broken while it does. It is the more expensive
 * mistake of the two, so it gets the same weight of testing as the crawlers.
 */
const REAL_BROWSERS: ReadonlyArray<readonly [string, string]> = [
  ['Chrome macOS', CHROME],
  [
    'Chrome Windows',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  ],
  [
    'Safari macOS',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  ],
  [
    'Safari iPhone',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  ],
  ['Firefox', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0'],
  ['Firefox Android', 'Mozilla/5.0 (Android 14; Mobile; rv:124.0) Gecko/124.0 Firefox/124.0'],
  [
    'Edge',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  ],
  [
    'Samsung Internet',
    'Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36',
  ],
  [
    'Chrome Android',
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  ],
  [
    'iPad',
    'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/604.1',
  ],
  [
    'Opera',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 OPR/126.0.0.0',
  ],
];

describe('the bot table', () => {
  it.each(CRAWLERS)('refuses to count %s', (_name, userAgent) => {
    expect(matchBotSignature(userAgent)).not.toBeNull();
    const verdict = classifyView(facts({ userAgent }), { isOwner: false, surface: 'page' });
    expect(verdict.countable).toBe(false);
  });

  it.each(REAL_BROWSERS)('counts %s', (_name, userAgent) => {
    expect(matchBotSignature(userAgent)).toBeNull();
    expect(classifyView(facts({ userAgent }), { isOwner: false, surface: 'page' })).toEqual({
      countable: true,
    });
  });

  it('names the family it matched, so a surprise is traceable to one row', () => {
    expect(matchBotSignature('Mozilla/5.0 (compatible; Googlebot/2.1)')).toBe('googlebot');
    expect(matchBotSignature('curl/8.5.0')).toBe('curl');
    const verdict = classifyView(facts({ userAgent: 'curl/8.5.0' }), {
      isOwner: false,
      surface: 'page',
    });
    expect(verdict).toEqual({ countable: false, reason: 'bot:curl' });
  });

  it('keeps the catch-all last, so a named family wins over "it told us"', () => {
    expect(BOT_SIGNATURES.at(-1)?.name).toBe('self-declared');
    expect(matchBotSignature('SomeUnknownBot/1.0')).toBe('self-declared');
  });
});

describe('the layers either side of the table', () => {
  it('refuses anything that is not a GET', () => {
    expect(classifyView(facts({ method: 'HEAD' }), { isOwner: false, surface: 'page' })).toEqual({
      countable: false,
      reason: 'method',
    });
  });

  it.each([
    ['sec-purpose', { secPurpose: 'prefetch;prerender' }],
    ['purpose', { purpose: 'prefetch' }],
    ['x-moz', { xMoz: 'prefetch' }],
  ])('refuses a %s prefetch', (_name, override) => {
    expect(classifyView(facts(override), { isOwner: false, surface: 'page' })).toEqual({
      countable: false,
      reason: 'prefetch',
    });
  });

  it('refuses an empty user agent, which every browser sends', () => {
    expect(classifyView(facts({ userAgent: '' }), { isOwner: false, surface: 'page' })).toEqual({
      countable: false,
      reason: 'ua_missing',
    });
  });

  it('refuses anything that never claims to be a browser', () => {
    expect(
      classifyView(facts({ userAgent: 'MyCompany Internal Tool 4.2' }), {
        isOwner: false,
        surface: 'page',
      })
    ).toEqual({ countable: false, reason: 'ua_not_browser' });
  });

  it('refuses our own traffic before calling it a bot, so logs stay honest', () => {
    expect(
      classifyView(facts({ userAgent: `${INTERNAL_USER_AGENT}/1.0` }), {
        isOwner: false,
        surface: 'page',
      })
    ).toEqual({ countable: false, reason: 'internal' });
  });

  it('refuses the owner', () => {
    expect(classifyView(facts(), { isOwner: true, surface: 'page' })).toEqual({
      countable: false,
      reason: 'owner',
    });
  });

  it('refuses a page read that is plainly a sub-resource fetch', () => {
    expect(
      classifyView(facts({ secFetchDest: 'image' }), { isOwner: false, surface: 'page' })
    ).toEqual({ countable: false, reason: 'not_navigation' });
  });

  it('does not apply the navigation rule to an unlock, which is a fetch by definition', () => {
    // A password-protected artifact is read through `fetch`, so `Sec-Fetch-Dest: empty` is the
    // correct and expected value there. Applying the page rule would refuse every unlocked read.
    expect(
      classifyView(facts({ secFetchDest: 'empty' }), { isOwner: false, surface: 'unlock' })
    ).toEqual({ countable: true });
  });

  it('withholds a verdict when the browser sends no fetch metadata', () => {
    expect(
      classifyView(facts({ secFetchDest: null }), { isOwner: false, surface: 'page' })
    ).toEqual({
      countable: true,
    });
  });
});

describe('device buckets', () => {
  it.each([
    ['desktop', CHROME],
    ['mobile', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) Mobile/15E148 Safari/604.1'],
    ['mobile', 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/141.0 Mobile Safari/537.36'],
    ['tablet', 'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) Version/17.4 Safari/604.1'],
    ['tablet', 'Mozilla/5.0 (Linux; Android 13; SM-X710) Chrome/141.0 Safari/537.36'],
  ])('reads %s', (expected, userAgent) => {
    expect(classifyDevice(userAgent)).toBe(expected);
  });
});
