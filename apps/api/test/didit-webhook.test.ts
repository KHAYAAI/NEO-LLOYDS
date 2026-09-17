import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyDiditWebhookSignature, type DiditWebhookPayload } from '../src/compliance/didit.js';

/**
 * The exact shape of a real Didit webhook delivery, captured live through
 * Didit's own MCP connector: a webhook destination was pointed at
 * https://httpbin.org/post, a sandbox session created against the
 * "Neo-Lloyds Signatory KYC" workflow, and `didit_session_webhooks`
 * returned this request body verbatim (field order, key names, and all).
 * `X-Signature` was `78e77f3a8e73c2a5f7ae4261bfb2ca651b97154e5222c76165dcc3188c74f301`
 * for this exact byte string against the real (never-retrieved-in-
 * plaintext) destination secret -- confirming the signature is 64 lowercase
 * hex characters (a 32-byte digest) computed over the raw body. The tests
 * below verify `verifyDiditWebhookSignature`'s HMAC-SHA256 logic against a
 * synthetic secret, since the real destination's secret is never exposed
 * in plaintext by Didit's API/MCP tools (`secret_set: true` only).
 */
const REAL_WEBHOOK_BODY =
  '{"application_id":"bf5b935e-afa6-4357-a80d-8b5ab736ab91","created_at":1789628455,"environment":"sandbox","event_id":"989d3e1a-aece-465f-a7af-cd23269b19c9","sandbox_scenario":"approve","session_id":"1f5d62e1-d3df-4a7d-8591-7ed5d60078a4","status":"Not Started","timestamp":1789628455,"vendor_data":"org-webhook-shape-test-2","webhook_type":"status.updated","workflow_id":"477652f9-44b7-4242-b9c4-76bb536d7be9","workflow_version":1}';

describe('verifyDiditWebhookSignature', () => {
  const secret = 'test-webhook-secret';

  it('accepts a signature computed the way this function computes it (HMAC-SHA256 hex of the raw body)', () => {
    const body = Buffer.from(REAL_WEBHOOK_BODY, 'utf8');
    const signature = createHmac('sha256', secret).update(body).digest('hex');

    expect(signature).toHaveLength(64);
    expect(verifyDiditWebhookSignature(body, signature, secret)).toBe(true);
  });

  it('rejects a signature computed with the wrong secret', () => {
    const body = Buffer.from(REAL_WEBHOOK_BODY, 'utf8');
    const wrongSignature = createHmac('sha256', 'not-the-real-secret').update(body).digest('hex');

    expect(verifyDiditWebhookSignature(body, wrongSignature, secret)).toBe(false);
  });

  it('rejects when the body was tampered with after signing', () => {
    const body = Buffer.from(REAL_WEBHOOK_BODY, 'utf8');
    const signature = createHmac('sha256', secret).update(body).digest('hex');

    const tampered = Buffer.from(REAL_WEBHOOK_BODY.replace('"status":"Not Started"', '"status":"Approved"'), 'utf8');
    expect(verifyDiditWebhookSignature(tampered, signature, secret)).toBe(false);
  });

  it('rejects a missing signature header rather than treating it as vacuously valid', () => {
    const body = Buffer.from(REAL_WEBHOOK_BODY, 'utf8');
    expect(verifyDiditWebhookSignature(body, undefined, secret)).toBe(false);
  });

  it('rejects a malformed (non-hex) signature header without throwing', () => {
    const body = Buffer.from(REAL_WEBHOOK_BODY, 'utf8');
    expect(verifyDiditWebhookSignature(body, 'not-hex-at-all!!', secret)).toBe(false);
  });

  it('parses the real captured payload shape', () => {
    const payload = JSON.parse(REAL_WEBHOOK_BODY) as DiditWebhookPayload;
    expect(payload).toMatchObject({
      environment: 'sandbox',
      status: 'Not Started',
      webhook_type: 'status.updated',
      vendor_data: 'org-webhook-shape-test-2',
      workflow_id: '477652f9-44b7-4242-b9c4-76bb536d7be9',
    });
  });
});
