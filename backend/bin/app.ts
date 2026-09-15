#!/usr/bin/env node
/**
 * CDK entry point.
 *
 * Overridable with -c, e.g.
 *   npx cdk deploy -c bedrockModelId=global.anthropic.claude-sonnet-5
 */
import 'source-map-support/register';
import { App } from 'aws-cdk-lib';
import { Mr20Stack } from '../lib/mr20-stack';
import { LyznWebStack } from '../lib/web-stack';
import { PreviewStack } from '../lib/preview-stack';

const app = new App();

const region = app.node.tryGetContext('region') ?? process.env.CDK_DEFAULT_REGION ?? 'ap-south-1';

/**
 * Which credentials an environment runs on.
 *
 * Staging exists so a preview cannot reach a production user, take a real
 * payment, or spend production quota.
 *
 * Clerk and Razorpay are genuinely separated. Clerk's test instance is a
 * different issuer with different signing keys, so a production session token
 * is rejected by staging outright rather than merely discouraged; Razorpay's
 * test keys cannot move money.
 *
 * Deepgram, Sarvam and GitLoom have no test tenant yet, so staging shares
 * production's keys for those and does spend their quota. Add test secrets and
 * point them here when that matters — nothing else has to change.
 */
const ENVIRONMENTS = {
  production: {
    clerkIssuer: 'https://clerk.lyzn.ai',
    clerkSecretName: 'mr20/clerk/prod',
    razorpaySecretName: 'mr20/razorpay/prod',
    // The ₹1,500/month Automation plan, created in Razorpay by hand. A
    // subscription is created against it per customer at checkout.
    razorpayPlanAutomation: 'plan_TYs5jZSQbltSvf',
  },
  staging: {
    clerkIssuer: 'https://wired-gorilla-4.clerk.accounts.dev',
    clerkSecretName: 'mr20/clerk/test',
    razorpaySecretName: 'mr20/razorpay/test',
    razorpayPlanAutomation: 'plan_TYs5ifYhLAHltX',
  },
} as const;

new Mr20Stack(app, 'Mr20PendantStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region },
  // Haiku 4.5: fast and cheap enough to run on every recording, and the same
  // model answers the in-app chat.
  bedrockModelId:
    app.node.tryGetContext('bedrockModelId') ?? 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
  // Derived from the app's Clerk publishable key: the part after pk_live_
  // base64-decodes to this host. Overridable for a different instance.
  clerkIssuer: app.node.tryGetContext('clerkIssuer') ?? ENVIRONMENTS.production.clerkIssuer,
  clerkSecretName: ENVIRONMENTS.production.clerkSecretName,
  razorpaySecretName: ENVIRONMENTS.production.razorpaySecretName,
  razorpayPlanAutomation: ENVIRONMENTS.production.razorpayPlanAutomation,
  // The API's own domain, fronted by CloudFront. Certificates for both this
  // and the site are issued by hand and referenced by ARN: lyzn.ai's DNS is at
  // Cloudflare, so nothing here can create the validation records.
  // Live voice chat is parked; -c voice=true brings the service back.
  voice: String(app.node.tryGetContext('voice') ?? '').toLowerCase() === 'true',
  apiDomainName: app.node.tryGetContext('apiDomainName') ?? 'api.lyzn.ai',
  apiCertificateArn:
    app.node.tryGetContext('apiCertificateArn') ??
    'arn:aws:acm:us-east-1:788655295054:certificate/0901433f-9d7b-4761-8dd0-4af8bdedfd45',
  description: 'MR20 AI pendant: ingest, transcription, diarization and enrichment',
});

// The marketing site. Separate stack: it has its own lifecycle, and a site
// deploy should never be able to disturb the pipeline that holds the data.
new LyznWebStack(app, 'LyznWebStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region },
  // Both names. www was a CNAME to Vercel until 2026-09-10, and Vercel's zone
  // publishes CAA records naming four issuers with Amazon not among them — so
  // every certificate covering www was refused with CAA_ERROR while that CNAME
  // stood. It is repointed at this distribution now, and the certificate below
  // is the one issued afterwards; the apex-only certificate it replaces is
  // still in the account. www is answered with a 301 to the apex rather than
  // the site itself — see RedirectWww in lib/web-stack.ts.
  domainNames: app.node.tryGetContext('webDomainNames')?.split(',') ?? [
    'lyzn.ai',
    'www.lyzn.ai',
  ],
  certificateArn:
    app.node.tryGetContext('webCertificateArn') ??
    'arn:aws:acm:us-east-1:788655295054:certificate/d27bf2a8-ee32-47ab-85d5-392656fbc84f',
  description: 'lyzn.ai: the marketing site, S3 behind CloudFront',
});

// A pull request's own backend, and only when one asks for it by number:
//   cdk deploy -c previewPr=42 -c deepgramSecretArn=... -c sarvamSecretArn=... -c claudeOAuthSecretArn=...
// Without previewPr the stack is never synthesised, so an ordinary deploy of
// everything cannot raise or disturb one.
const previewPr = app.node.tryGetContext('previewPr');
if (previewPr) {
  new PreviewStack(app, `Mr20PendantPreview-pr-${previewPr}`, {
    env: { account: process.env.CDK_DEFAULT_ACCOUNT, region },
    pullRequest: String(previewPr),
    bedrockModelId:
      app.node.tryGetContext('bedrockModelId') ?? 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
    // A preview is staging by definition, and the flag is what selects the
    // test credentials rather than anything the workflow has to remember.
    staging: true,
    clerkIssuer: app.node.tryGetContext('clerkIssuer') ?? ENVIRONMENTS.staging.clerkIssuer,
    clerkSecretName: ENVIRONMENTS.staging.clerkSecretName,
    razorpaySecretName: ENVIRONMENTS.staging.razorpaySecretName,
    razorpayPlanAutomation: ENVIRONMENTS.staging.razorpayPlanAutomation,
    deepgramSecretArn: app.node.tryGetContext('deepgramSecretArn'),
    sarvamSecretArn: app.node.tryGetContext('sarvamSecretArn'),
    claudeOAuthSecretArn: app.node.tryGetContext('claudeOAuthSecretArn'),
    description: `Ephemeral backend for pull request #${previewPr}`,
  });
}
