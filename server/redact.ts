// Best-effort defense in depth. Raw events and command output are never stored.
export function redact(input: string): string {
  return input
    .replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g,
      '[REDACTED PRIVATE KEY]',
    )
    .replace(
      /\b(?:sk-[\w-]{12,}|gh[pousr]_[\w]{12,}|github_pat_[\w]{12,}|AKIA[A-Z0-9]{16})\b/g,
      '[REDACTED]',
    )
    .replace(/\b(Bearer\s+)[\w.\-+/=]+/gi, '$1[REDACTED]')
    .replace(
      /((?:[\w-]*(?:password|passwd|secret|token|api[_-]?key)[\w-]*)["']?\s*[:=]\s*)["']?[^\s,"';}]+["']?/gi,
      '$1[REDACTED]',
    )
    .replace(/(https?:\/\/)[^/\s:@]+:[^/\s@]+@/g, '$1[REDACTED]@');
}
