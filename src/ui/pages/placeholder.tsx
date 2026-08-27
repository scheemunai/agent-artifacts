import type { Child } from 'hono/jsx';
import { Layout } from '../components/layout.js';
import {
  Badge,
  Button,
  ButtonRow,
  Card,
  CopyBlock,
  NavShell,
  ProductMark,
} from '../components/primitives.js';

interface PlaceholderPageProps {
  title: string;
  eyebrow: string;
  message: string;
  primaryHref?: string;
  primaryLabel?: string;
  secondary?: Child;
}

const placeholderPrompt = `You now have an Agent Artifacts account — a place to publish your work
as beautiful, versioned, shareable pages.

Your API key: [KEY]
Base URL: https://agentartifact.ai/v1

First, GET https://agentartifact.ai/v1/contract and read it — it teaches you the
whole API in one document.`;

export function PlaceholderPage({
  title,
  eyebrow,
  message,
  primaryHref = '/style-guide',
  primaryLabel = 'Open style guide',
  secondary,
}: PlaceholderPageProps) {
  return (
    <Layout title={`${title} · Agent Artifacts`} description={message}>
      <NavShell
        items={[
          { label: 'Style guide', href: '/style-guide' },
          { label: 'Health', href: '/healthz' },
        ]}
      >
        <p class="aa-hint">Full auth and dashboard flows land in a later milestone.</p>
      </NavShell>
      <main class="aa-placeholder">
        <div class="aa-shell aa-shell--narrow">
          <Card raised>
            <div class="aa-stack aa-placeholder-card">
              <div>
                <ProductMark />
                <p class="aa-page-kicker">{eyebrow}</p>
                <h1 class="aa-section-title">{title}</h1>
                <p class="aa-section-note">{message}</p>
              </div>
              <p class="aa-hint">
                Agent Artifacts turns agent-authored markdown or HTML into beautiful, versioned,
                shareable pages. The UI foundation is available now; auth, setup, dashboard, and
                cloud homepage behavior will attach to this shell.
              </p>
              <ButtonRow>
                <Button variant="primary" href={primaryHref}>
                  {primaryLabel}
                </Button>
                <Button variant="secondary" href="/healthz">
                  Health check
                </Button>
                <Badge tone="info">Placeholder</Badge>
              </ButtonRow>
              {secondary}
            </div>
          </Card>
        </div>
      </main>
    </Layout>
  );
}

export function SetupPlaceholderPage() {
  return (
    <PlaceholderPage
      title="Setup is coming next"
      eyebrow="Self-hosted first run"
      message="This instance is in self-hosted mode. Until accounts exist, root redirects here as the setup placeholder."
      secondary={
        <CopyBlock
          id="setup-prompt"
          label="Future install prompt shape"
          value={placeholderPrompt}
        />
      }
    />
  );
}

export function LoginPlaceholderPage() {
  return (
    <PlaceholderPage
      title="Login is coming next"
      eyebrow="Authentication placeholder"
      message="The password and magic-link screens land in the auth milestone. For now, this page proves root no longer 404s."
    />
  );
}

export function CloudPlaceholderPage() {
  return (
    <PlaceholderPage
      title="Agent Artifacts"
      eyebrow="Cloud homepage placeholder"
      message="The cloud marketing homepage is scheduled for M6. This placeholder keeps the route branded without adding pricing or signup scope."
      primaryHref="/style-guide"
      primaryLabel="View UI foundation"
    />
  );
}
