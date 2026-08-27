import { Button, ButtonRow, ProductMark } from '../components/primitives.js';
import { abuseHref, ViewerDocument, ViewerFooter } from './viewer.js';

interface ShareTerminalPageProps {
  title: string;
  message: string;
  status: 404 | 410 | 429;
  shareUrl: string;
  abuseEmail: string;
  showProductFooter?: boolean;
}

export function ShareTerminalPage({
  title,
  message,
  status,
  shareUrl,
  abuseEmail,
  showProductFooter = true,
}: ShareTerminalPageProps) {
  const pageTitle = status === 404 ? 'Not found' : title;
  return (
    <ViewerDocument
      title={`${pageTitle} · Agent Artifacts`}
      description={message}
      canonicalUrl={shareUrl}
    >
      <main class="aa-viewer-terminal" data-aa-terminal="true">
        <section class="aa-viewer-terminal-card" aria-labelledby="terminal-title">
          <ProductMark />
          <h1 id="terminal-title">{pageTitle}</h1>
          <p>{message}</p>
          <ButtonRow align="center" class="aa-viewer-terminal-actions">
            <Button variant="secondary" href={shareUrl}>
              Try again
            </Button>
            <Button variant="ghost" href="/">
              Go home
            </Button>
          </ButtonRow>
        </section>
      </main>
      <ViewerFooter
        showProductFooter={showProductFooter}
        abuseHref={abuseHref(abuseEmail, shareUrl)}
      />
    </ViewerDocument>
  );
}
