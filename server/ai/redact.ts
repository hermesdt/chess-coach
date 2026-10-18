/** Replaces every occurrence of the secret so it never reaches a message or log. */
export function redact(text: string, secret: string | null): string {
  return secret ? text.split(secret).join('[redacted]') : text;
}
