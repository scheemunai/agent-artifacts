/**
 * WHO IS NOT A READER.
 *
 * Counting moved to the page render, which is the only way a reader with JavaScript disabled can be
 * seen at all. That move costs us the strongest filter the JS-based analytics products get for
 * free: a crawler does not run scripts, so it never announces itself to Plausible or DataFast. We
 * see every one of them now, so this table has to do that work explicitly.
 *
 * It is DATA, deliberately. Adding a crawler is a new row, not new logic, and every row is a test
 * case in `tests/unit/bot-signatures.test.ts`. The inverse is tested just as hard: a pattern that
 * quietly eats Chrome would silently zero a customer's numbers, which is the worse failure and the
 * one nobody notices for a month.
 *
 * Matching is case-insensitive against the raw User-Agent.
 */

export interface BotSignature {
  /** Reported in logs and in the reject reason, so a surprise is traceable to one row. */
  readonly name: string;
  readonly pattern: RegExp;
}

export const BOT_SIGNATURES: readonly BotSignature[] = [
  // ── Search engines ────────────────────────────────────────────────────────────────────────────
  { name: 'googlebot', pattern: /googlebot|google-inspectiontool|storebot-google/i },
  { name: 'bingbot', pattern: /bingbot|adidxbot|msnbot/i },
  { name: 'duckduckbot', pattern: /duckduckbot|duckduckgo-favicons/i },
  { name: 'yandex', pattern: /yandex(bot|images|mobilebot)/i },
  { name: 'baidu', pattern: /baiduspider/i },
  { name: 'applebot', pattern: /applebot/i },
  { name: 'seznam', pattern: /seznambot/i },
  { name: 'naver', pattern: /naver(bot|\.me)/i },

  // ── AI crawlers and retrieval fetchers ────────────────────────────────────────────────────────
  { name: 'gptbot', pattern: /gptbot|oai-searchbot|chatgpt-user/i },
  { name: 'claudebot', pattern: /claudebot|claude-web|anthropic-ai/i },
  { name: 'perplexity', pattern: /perplexitybot|perplexity-user/i },
  { name: 'ccbot', pattern: /ccbot/i },
  { name: 'bytespider', pattern: /bytespider|bytedance/i },
  { name: 'google-extended', pattern: /google-extended/i },
  { name: 'meta-ai', pattern: /meta-externalagent|facebookbot/i },
  { name: 'cohere', pattern: /cohere-ai/i },
  { name: 'diffbot', pattern: /diffbot/i },
  { name: 'amazonbot', pattern: /amazonbot/i },

  // ── Link unfurlers. The big one for us: every share pasted into a chat app hits this path. ─────
  { name: 'slackbot', pattern: /slackbot|slack-imgproxy/i },
  { name: 'discordbot', pattern: /discordbot/i },
  { name: 'twitterbot', pattern: /twitterbot/i },
  { name: 'facebookexternalhit', pattern: /facebookexternalhit|facebookcatalog/i },
  { name: 'linkedinbot', pattern: /linkedinbot/i },
  { name: 'whatsapp', pattern: /whatsapp/i },
  { name: 'telegrambot', pattern: /telegrambot/i },
  { name: 'skype-preview', pattern: /skypeuripreview/i },
  { name: 'embed-service', pattern: /embedly|iframely|quora link preview|outbrain|nuzzel/i },
  { name: 'redditbot', pattern: /redditbot/i },
  { name: 'mastodon', pattern: /mastodon|pleroma|misskey/i },
  { name: 'vkshare', pattern: /vkshare/i },
  { name: 'apple-preview', pattern: /applenewsbot|apple-pubsub/i },

  // ── HTTP clients. A script, not a person. ─────────────────────────────────────────────────────
  { name: 'curl', pattern: /^curl\/|\scurl\//i },
  { name: 'wget', pattern: /^wget/i },
  { name: 'httpie', pattern: /httpie/i },
  { name: 'python', pattern: /python-requests|python-urllib|python-httpx|aiohttp|scrapy/i },
  { name: 'go-http', pattern: /go-http-client/i },
  { name: 'java', pattern: /^java\/|jakarta|apache-httpclient/i },
  { name: 'okhttp', pattern: /okhttp/i },
  { name: 'node-http', pattern: /axios|node-fetch|undici|got \(|superagent/i },
  { name: 'perl', pattern: /libwww-perl|lwp::/i },
  { name: 'php', pattern: /guzzlehttp|php-curl/i },
  { name: 'ruby', pattern: /ruby$|faraday|typhoeus/i },
  { name: 'powershell', pattern: /windowspowershell|powershell/i },

  // ── Headless browsers and automation ──────────────────────────────────────────────────────────
  { name: 'headless', pattern: /headlesschrome|headless_chrome|phantomjs|electron\//i },
  { name: 'automation', pattern: /puppeteer|playwright|selenium|webdriver|cypress/i },

  // ── Uptime and observability ──────────────────────────────────────────────────────────────────
  {
    name: 'uptime',
    pattern: /uptimerobot|pingdom|statuscake|betteruptime|site24x7|nagios|zabbix/i,
  },
  { name: 'apm', pattern: /datadog|newrelic|grafana|prometheus|blackbox_exporter/i },

  // ── SEO, security and mass scanners ───────────────────────────────────────────────────────────
  { name: 'seo', pattern: /ahrefsbot|semrushbot|mj12bot|dotbot|dataforseo|blexbot|petalbot/i },
  { name: 'scanner', pattern: /censys|shodan|masscan|zgrab|nmap|nuclei|sqlmap|nikto/i },
  { name: 'archiver', pattern: /ia_archiver|archive\.org_bot|wayback|heritrix/i },
  { name: 'feed', pattern: /feedfetcher|feedburner|rssbot|newsblur|feedly/i },

  /*
   * THE CATCH-ALL, AND IT IS LAST ON PURPOSE.
   *
   * A named row above gives a useful reject reason; this one only says "it told us". It sits at the
   * end so the specific name wins when both match. `bot` is deliberately unanchored — `Googlebot`
   * has no word boundary before `bot`, so `\bbot\b` would miss the single most common crawler on
   * the internet. The false-positive risk that buys is covered by the real-browser test.
   */
  { name: 'self-declared', pattern: /bot|crawler|crawling|spider|scraper|slurp|fetcher|monitor/i },
] as const;

/** Our own traffic: health checks, the hero-artifact poller, the docker probe, the e2e suite. */
export const INTERNAL_USER_AGENT = 'AgentArtifacts-Internal';
const INTERNAL_PATTERN = /agentartifacts-internal|agent-artifacts-probe/i;

/**
 * A browser says so. Every mainstream engine still ships the `Mozilla/5.0` prefix for exactly this
 * kind of sniffing, so its ABSENCE is a much stronger signal than any single token's presence.
 * Kept as a positive list rather than a second deny-list because the failure modes differ: missing
 * a bot costs us one inflated view, while rejecting a browser costs a customer their whole number.
 */
const BROWSER_SHAPE = /^mozilla\/\d|^opera\/|^dillo\/|^lynx\/|^w3m\/|^links /i;

export function matchBotSignature(userAgent: string): string | null {
  for (const signature of BOT_SIGNATURES) {
    if (signature.pattern.test(userAgent)) {
      return signature.name;
    }
  }
  return null;
}

export function isInternalUserAgent(userAgent: string): boolean {
  return INTERNAL_PATTERN.test(userAgent);
}

export function looksLikeBrowser(userAgent: string): boolean {
  return BROWSER_SHAPE.test(userAgent.trim());
}

/**
 * Coarse and deliberately so. Three buckets answer "should I care about mobile readers?", which is
 * the only question an artifact owner actually asks; anything finer would mean shipping a UA
 * database to answer a question nobody has.
 */
export type ViewDevice = 'mobile' | 'tablet' | 'desktop';

export function classifyDevice(userAgent: string): ViewDevice {
  const ua = userAgent.toLowerCase();
  if (/ipad|tablet|playbook|silk|kindle/.test(ua) || (/android/.test(ua) && !/mobile/.test(ua))) {
    return 'tablet';
  }
  if (/mobi|iphone|ipod|android|blackberry|iemobile|opera mini/.test(ua)) {
    return 'mobile';
  }
  return 'desktop';
}
