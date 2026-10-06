import { createHash, randomBytes } from 'node:crypto';

/** Token aleatorio para invitaciones; en la base solo se guarda su hash SHA-256. */
export function newOpaqueToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
