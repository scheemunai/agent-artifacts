import { LAUNCH_VIDEO } from '../marketing-video-media.js';
import { Button } from './primitives.js';

/**
 * A first-party, deliberately activated film. The initial action is a working file link; the
 * page-specific script replaces it with a native button of the same size. Without that script
 * there is no dead play button and the browser still makes no movie request until navigation.
 *
 * No media src (including the caption track) is emitted before activation. The responsive picture
 * owns the still; putting a poster on the video as well would risk downloading it twice.
 * The still is an LCP candidate at the supported opening viewports, so it must not be lazy.
 */
export function MarketingVideo({ id = 'launch-demo' }: { id?: string }) {
  return (
    <figure
      class="aa-marketing-video"
      data-aa-marketing-video="true"
      data-aa-video-phone={LAUNCH_VIDEO.phone}
      data-aa-video-desktop={LAUNCH_VIDEO.desktop}
      aria-labelledby={`${id}-label`}
    >
      <div class="aa-marketing-video__frame">
        <picture data-aa-video-poster="true">
          <source
            media="(max-width: 528px)"
            srcset={`${LAUNCH_VIDEO.posterPhone} 480w, ${LAUNCH_VIDEO.posterDesktop} 960w`}
            sizes="(max-width: 480px) calc(100vw - 32px), calc(100vw - 48px)"
          />
          <img
            src={LAUNCH_VIDEO.posterDesktop}
            srcset={`${LAUNCH_VIDEO.posterDesktop} 960w`}
            sizes="(max-width: 827px) calc(100vw - 48px), 780px"
            width={960}
            height={720}
            loading="eager"
            decoding="async"
            alt="From a reply. To a real page."
          />
        </picture>
        <video
          id={`${id}-player`}
          controls
          playsinline
          preload="none"
          width={960}
          height={720}
          tabindex={0}
          aria-label="Agent Artifacts: 46-second product demo"
          aria-describedby={`${id}-status`}
          hidden
        >
          <track
            kind="captions"
            srclang="en"
            label="Visual transcript (English)"
            data-aa-video-captions={LAUNCH_VIDEO.captions}
          />
        </video>
      </div>
      <figcaption>
        <div class="aa-marketing-video__actions">
          <Button
            href={LAUNCH_VIDEO.phone}
            id={`${id}-label`}
            dataAttrs={{ 'data-aa-video-play': 'true' }}
          >
            Watch the 46-second demo
          </Button>
          <a href={LAUNCH_VIDEO.phone} data-aa-video-file="true">
            Open video file
          </a>
        </div>
        <p class="aa-marketing-video__status" id={`${id}-status`} aria-live="polite">
          46 seconds. Simulated product workflow.
        </p>
        <details class="aa-marketing-video__transcript">
          <summary>Read the demo transcript</summary>
          <div class="aa-marketing-video__transcript-body">
            <p>This film illustrates a workflow with fictional example content.</p>
            <ol>
              <li>
                <strong>0–8s — Create and open.</strong> In an agent conversation, a person asks for
                a weekly growth report. The agent creates an artifact that is initially private. It
                opens as a formatted report with a chart and a recommended next step.
              </li>
              <li>
                <strong>8–17s — Share and protect.</strong> In the owner's dashboard, a share link
                is created, copied and sent in a team conversation. Password protection is added. A
                recipient enters the password to open the report.
              </li>
              <li>
                <strong>17–28s — Update and retain.</strong> A teammate asks for fresh numbers. The
                person returns to the same agent conversation and requests an update. The revised
                report opens at the same link. The owner's version menu retains the earlier report.
              </li>
              <li>
                <strong>28–35s — Reuse and choose a format.</strong> The demo shows reusable
                templates, saving a customized report as a template, and switching between Markdown
                and full HTML presentation.
              </li>
              <li>
                <strong>35–46s — Connect and publish.</strong> Several agents connect to one
                artifact link. The closing message is “Publish your agent’s work.”
              </li>
            </ol>
            <p>
              This describes the visual sequence, not spoken dialogue. The optional visual
              transcript in the video controls follows the same sequence.
            </p>
          </div>
        </details>
      </figcaption>
    </figure>
  );
}
