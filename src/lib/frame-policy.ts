import type { AppConfig } from '../config.js';

export const FRAME_CONTENT_TYPE = 'text/html; charset=utf-8';
export const APP_PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=(), payment=()';

const DASHBOARD_PREVIEW_CONTENT_TYPE = 'text/html; charset=utf-8';

export type FramePolicyVariant = 'public-artifact' | 'dashboard-preview';

export interface FrameHeadersInput {
  config: AppConfig;
  variant: FramePolicyVariant;
  passwordProtected?: boolean;
}

export function frameCsp(config: AppConfig, variant: FramePolicyVariant): string {
  return variant === 'public-artifact'
    ? publicArtifactFrameCsp(config)
    : dashboardPreviewFrameCsp();
}

export function frameHeaders(input: FrameHeadersInput): Record<string, string> {
  if (input.variant === 'dashboard-preview') {
    return dashboardPreviewFrameHeaders(input.config);
  }

  return publicArtifactFrameHeaders(input);
}

export function publicArtifactFrameHeaders(
  input: Pick<FrameHeadersInput, 'config' | 'passwordProtected'>
): Record<string, string> {
  return {
    'Content-Type': FRAME_CONTENT_TYPE,
    'Content-Security-Policy': frameCsp(input.config, 'public-artifact'),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Permissions-Policy': APP_PERMISSIONS_POLICY,
    'Cache-Control': input.passwordProtected ? 'no-store' : 'public, max-age=3600',
  };
}

export function dashboardPreviewFrameHeaders(config: AppConfig): Record<string, string> {
  void config;
  return {
    'Content-Type': DASHBOARD_PREVIEW_CONTENT_TYPE,
    'Content-Security-Policy': frameCsp(config, 'dashboard-preview'),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': APP_PERMISSIONS_POLICY,
  };
}

function publicArtifactFrameCsp(config: AppConfig): string {
  const appOrigin = new URL(config.baseUrl).origin;
  return [
    'sandbox allow-scripts',
    "default-src 'none'",
    "script-src https: 'unsafe-inline' 'unsafe-eval'",
    "style-src https: 'unsafe-inline'",
    'img-src https: data: blob:',
    'font-src https: data:',
    'connect-src https:',
    'media-src https: data:',
    "form-action 'none'",
    `frame-ancestors ${appOrigin}`,
  ].join('; ');
}

function dashboardPreviewFrameCsp(): string {
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    'img-src data: https:',
    "font-src 'none'",
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    'sandbox allow-scripts',
  ].join('; ');
}
