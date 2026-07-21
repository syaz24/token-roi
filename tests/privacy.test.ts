import { describe, expect, it } from 'vitest';
import { REDACTION_RULE_NAMES, redact, truncatePreview } from '@/lib/privacy';

const CASES: Array<{ name: string; input: string; marker: string }> = [
  {
    name: 'anthropic-key',
    input: 'key sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAA here',
    marker: '[REDACTED:anthropic-key]',
  },
  {
    name: 'openai-key',
    input: 'key sk-proj-ABCDEFGHIJKLMNOPQRSTUVWX1234 here',
    marker: '[REDACTED:openai-key]',
  },
  {
    name: 'github-token',
    input: 'token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123 here',
    marker: '[REDACTED:github-token]',
  },
  { name: 'aws-key', input: 'id AKIAIOSFODNN7EXAMPLE here', marker: '[REDACTED:aws-key]' },
  {
    name: 'slack-token',
    input: 'tok xoxb-123456789012-abcdefghijkl here',
    marker: '[REDACTED:slack-token]',
  },
  {
    name: 'google-key',
    input: 'key AIzaSyA1234567890abcdefghijklmnopqrstuvw here',
    marker: '[REDACTED:google-key]',
  },
  {
    name: 'bearer',
    input: 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345',
    marker: 'Bearer [REDACTED]',
  },
  {
    name: 'jwt',
    input:
      'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk here',
    marker: '[REDACTED:jwt]',
  },
  {
    name: 'pem',
    input:
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA1234\n-----END RSA PRIVATE KEY-----',
    marker: '[REDACTED:private-key]',
  },
  { name: 'email', input: 'mail me at syazwan@example.com ok', marker: '[REDACTED:email]' },
  { name: 'env-assign', input: 'DB_PASSWORD=hunter2correcthorse', marker: 'DB_PASSWORD=[REDACTED]' },
];

describe('redact()', () => {
  it('exposes every rule it applies', () => {
    expect(REDACTION_RULE_NAMES).toEqual(CASES.map((c) => c.name));
  });

  for (const c of CASES) {
    it(`redacts ${c.name}`, () => {
      const out = redact(c.input);
      expect(out).toContain(c.marker);
      // the secret material itself must be gone
      const secret = c.input.split(/\s+/).find((w) => w.length > 18) ?? '';
      if (c.name !== 'pem' && c.name !== 'env-assign') expect(out).not.toContain(secret);
    });
  }

  it('redacts several different secrets in one string', () => {
    const out = redact(
      'ping dev@example.com with AKIAIOSFODNN7EXAMPLE and ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123',
    );
    expect(out).toContain('[REDACTED:email]');
    expect(out).toContain('[REDACTED:aws-key]');
    expect(out).toContain('[REDACTED:github-token]');
  });

  it('redacts every occurrence, not only the first', () => {
    const out = redact('a@b.com and c@d.com');
    expect(out).toBe('[REDACTED:email] and [REDACTED:email]');
  });

  it('leaves harmless text untouched', () => {
    const plain = 'Refactor the allocation engine and add tests.';
    expect(redact(plain)).toBe(plain);
  });

  it('keeps the env var name while removing its value', () => {
    const out = redact('export API_KEY=sk-abcdefghijklmnopqrstuvwxyz');
    expect(out).toContain('API_KEY=[REDACTED]');
    expect(out).not.toContain('sk-abcdefghijklmnopqrstuvwxyz');
  });
});

describe('truncatePreview()', () => {
  it('collapses whitespace', () => {
    expect(truncatePreview('  a\n\n b\t c  ', 100)).toBe('a b c');
  });

  it('returns short text unchanged and without an ellipsis', () => {
    expect(truncatePreview('short', 160)).toBe('short');
  });

  it('respects the limit and marks the truncation', () => {
    const out = truncatePreview('x'.repeat(500), 160);
    expect(out.endsWith('…')).toBe(true);
    expect(out.slice(0, -1)).toHaveLength(160);
  });

  it('does not truncate text exactly at the limit', () => {
    const exact = 'y'.repeat(160);
    expect(truncatePreview(exact, 160)).toBe(exact);
  });

  it('applies the preview (160) and full (4000) limits used by the adapters', () => {
    const long = 'z'.repeat(10_000);
    expect(truncatePreview(long, 160)).toHaveLength(161);
    expect(truncatePreview(long, 4000)).toHaveLength(4001);
  });
});
