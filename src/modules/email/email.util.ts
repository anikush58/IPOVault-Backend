/**
 * Masks an email address for safe observability and logging (e.g., 'jo***e@domain.com').
 * Never prints full local part to prevent PII exposure.
 */
export function maskEmailForDisplay(email: string): string {
  if (!email || !email.includes('@')) return 'your account';
  const [local, domain] = email.split('@');
  if (local.length <= 2) {
    return `${local.charAt(0)}***@${domain}`;
  }
  return `${local.slice(0, 2)}***${local.charAt(local.length - 1)}@${domain}`;
}

/**
 * Escapes HTML characters to prevent XSS in email bodies and web previews.
 */
export function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
