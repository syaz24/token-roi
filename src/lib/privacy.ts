/** Redaction rules applied before any prompt text is persisted. */
const RULES: Array<{ name: string; re: RegExp; to: string }> = [
  { name: 'anthropic-key', re: /sk-ant-[A-Za-z0-9\-_]{20,}/g, to: '[REDACTED:anthropic-key]' },
  { name: 'openai-key', re: /sk-(?:proj-)?[A-Za-z0-9]{20,}/g, to: '[REDACTED:openai-key]' },
  { name: 'github-token', re: /gh[pousr]_[A-Za-z0-9]{20,}/g, to: '[REDACTED:github-token]' },
  { name: 'aws-key', re: /AKIA[0-9A-Z]{16}/g, to: '[REDACTED:aws-key]' },
  { name: 'slack-token', re: /xox[baprs]-[A-Za-z0-9-]{10,}/g, to: '[REDACTED:slack-token]' },
  { name: 'google-key', re: /AIza[0-9A-Za-z\-_]{35}/g, to: '[REDACTED:google-key]' },
  { name: 'bearer', re: /\bBearer\s+[A-Za-z0-9\-._~+/]{20,}=*/g, to: 'Bearer [REDACTED]' },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, to: '[REDACTED:jwt]' },
  { name: 'pem', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, to: '[REDACTED:private-key]' },
  { name: 'email', re: /\b[\w.+-]+@[\w-]+\.[\w.]{2,}\b/g, to: '[REDACTED:email]' },
  { name: 'env-assign', re: /\b([A-Z0-9_]*(?:SECRET|PASSWORD|TOKEN|APIKEY|API_KEY)[A-Z0-9_]*)\s*=\s*\S+/g, to: '$1=[REDACTED]' },
];

export function redact(text: string): string {
  let out = text;
  for (const r of RULES) out = out.replace(r.re, r.to);
  return out;
}

export function truncatePreview(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max)}…`;
}

export const REDACTION_RULE_NAMES = RULES.map((r) => r.name);
