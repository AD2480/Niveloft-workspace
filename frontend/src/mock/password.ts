/**
 * Password hashing for the mock API only (salted SHA-256 via Web Crypto).
 * The real backend uses BCrypt through Spring Security's PasswordEncoder.
 */
function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  return toHex(await crypto.subtle.digest('SHA-256', data));
}

export async function hashPassword(password: string, salt?: string): Promise<string> {
  const s = salt ?? toHex(crypto.getRandomValues(new Uint8Array(8)).buffer as ArrayBuffer);
  return `sha256$${s}$${await sha256(`${s}:${password}`)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, salt, hash] = stored.split('$');
  if (!salt || !hash) return false;
  return (await sha256(`${salt}:${password}`)) === hash;
}
