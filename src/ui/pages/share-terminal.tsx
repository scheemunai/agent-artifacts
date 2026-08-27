import { ShareTerminalMain } from '../components/share-terminal-main.js';
import { abuseHref, ViewerDocument, ViewerFooter } from './viewer.js';

export type ShareTerminalStatus = 404 | 410 | 429;

export {
  CLIENT_TERMINAL_COPY,
  type ClientTerminalStatus,
  ShareTerminalMain,
} from '../components/share-terminal-main.js';

interface ShareTerminalPageProps {
  title: string;
  message: string;
  status: ShareTerminalStatus;
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
      <ShareTerminalMain
        title={pageTitle}
        message={message}
        shareUrl={shareUrl}
        headingId={`terminal-title-${status}`}
      />
      <ViewerFooter
        showProductFooter={showProductFooter}
        abuseHref={abuseHref(abuseEmail, shareUrl)}
      />
    </ViewerDocument>
  );
}
