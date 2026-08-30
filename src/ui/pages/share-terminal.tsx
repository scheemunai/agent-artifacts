import { ShareTerminalMain, type ShareTerminalStatus } from '../components/share-terminal-main.js';
import { ViewerDocument, ViewerFooter } from './viewer.js';

export {
  CLIENT_TERMINAL_COPY,
  type ClientTerminalStatus,
  ShareTerminalMain,
  type ShareTerminalStatus,
} from '../components/share-terminal-main.js';

interface ShareTerminalPageProps {
  title: string;
  message: string;
  status: ShareTerminalStatus;
  shareUrl: string;
  showProductFooter?: boolean;
}

export function ShareTerminalPage({
  title,
  message,
  status,
  shareUrl,
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
        status={status}
        headingId={`terminal-title-${status}`}
      />
      <ViewerFooter showProductFooter={showProductFooter} />
    </ViewerDocument>
  );
}
