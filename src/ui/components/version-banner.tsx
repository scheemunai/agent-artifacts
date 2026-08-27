/**
 * The pinned-version banner for the public viewer.
 *
 * It exists to say one thing: "you are not looking at the current document, here is the way back".
 * On the latest version there is nothing to go back to — so it must not exist at all. It used to,
 * announcing "Viewing v2 of v2" beside a "View latest" link pointing at the page the reader was
 * already on: a control that cannot do anything, which is what Part C's C14 forbids.
 *
 * The cause was two implementations of one decision. The server gated the initial `hidden` on "a
 * version was pinned in the URL"; `viewer-*.js` re-showed the banner on any picker change without
 * comparing to the latest version. `isPinnedVersion` is that decision, once, and the client script
 * calls the same predicate by the same name.
 */
export interface VersionBannerProps {
  /** The version actually on screen, or null when the reader is on the canonical URL. */
  shownVersion: number | null | undefined;
  latestVersion: number;
  canonicalUrl: string;
}

export function isPinnedVersion(
  shownVersion: number | null | undefined,
  latestVersion: number
): boolean {
  return (
    typeof shownVersion === 'number' &&
    Number.isFinite(shownVersion) &&
    shownVersion > 0 &&
    shownVersion !== latestVersion
  );
}

export function VersionBanner({ shownVersion, latestVersion, canonicalUrl }: VersionBannerProps) {
  const pinned = isPinnedVersion(shownVersion, latestVersion);

  return (
    <div
      class="aa-viewer-version-banner"
      data-aa-version-banner="true"
      data-aa-pinned={pinned ? 'true' : 'false'}
      hidden={pinned ? undefined : true}
    >
      <span data-aa-version-banner-text="true">
        {pinned ? `Viewing v${shownVersion} of v${latestVersion}` : ''}
      </span>
      {/* Hidden in its own right as well as with the banner: no state may leave a link visible
          that points at the page the reader is already on. */}
      <a href={canonicalUrl} data-aa-view-latest="true" hidden={pinned ? undefined : true}>
        View latest
      </a>
    </div>
  );
}
