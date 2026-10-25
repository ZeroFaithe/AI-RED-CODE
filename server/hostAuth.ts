import { createHash, timingSafeEqual } from 'node:crypto';
/** Server-side facilitator check. HOST_PASSCODE lives only in server environment variables. Empty/missing = nobody can be host. */
export function verifyHostPasscode(input: string, expected: string | undefined): boolean {
  if (!expected) return false;
  const h = (x: string) => createHash('sha256').update(x).digest();
  return timingSafeEqual(h(input ?? ''), h(expected));
}
