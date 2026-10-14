import { createPublicKey, sign, verify, type KeyLike } from 'node:crypto';
import { z } from 'zod';

export const licensePayloadSchema = z
  .object({
    issued_to: z.string().min(1).max(200),
    seat_band: z.number().int().min(1).max(100000),
    tier: z.enum(['starter', 'pilot', 'production']),
    maintenance_expires_at: z.string().datetime({ offset: true }),
    issued_at: z.string().datetime({ offset: true }),
  })
  .strict();
export type LicensePayload = z.infer<typeof licensePayloadSchema>;
const envelopeSchema = z
  .object({ payload: licensePayloadSchema, signature: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/) })
  .strict();
export function canonicalPayload(payload: LicensePayload): string {
  const p = licensePayloadSchema.parse(payload);
  return JSON.stringify({
    issued_to: p.issued_to,
    seat_band: p.seat_band,
    tier: p.tier,
    maintenance_expires_at: p.maintenance_expires_at,
    issued_at: p.issued_at,
  });
}
export function issueLicense(payload: LicensePayload, privateKey: KeyLike): string {
  const parsed = licensePayloadSchema.parse(payload);
  return JSON.stringify(
    {
      payload: parsed,
      signature: sign(null, Buffer.from(canonicalPayload(parsed)), privateKey).toString('base64'),
    },
    null,
    2,
  );
}
export function verifyLicense(raw: string, publicKey: KeyLike, now = new Date()) {
  const envelope = envelopeSchema.parse(JSON.parse(raw));
  const key =
    typeof publicKey === 'string' || Buffer.isBuffer(publicKey) ? createPublicKey(publicKey) : publicKey;
  if ('asymmetricKeyType' in key && key.asymmetricKeyType !== 'ed25519')
    throw new Error('License key must be Ed25519');
  if (
    !verify(
      null,
      Buffer.from(canonicalPayload(envelope.payload)),
      key,
      Buffer.from(envelope.signature, 'base64'),
    )
  )
    throw new Error('Invalid license signature');
  if (new Date(envelope.payload.issued_at).getTime() > now.getTime() + 300000)
    throw new Error('License issue date is in the future');
  return { ...envelope.payload, updatesAvailable: new Date(envelope.payload.maintenance_expires_at) >= now };
}
export function evaluationStatus(orgCreatedAt: Date, activeSeats: number, now = new Date()) {
  const expiresAt = new Date(orgCreatedAt.getTime() + 14 * 86400000);
  return {
    mode: 'evaluation' as const,
    seatBand: 25,
    activeSeats,
    expiresAt: expiresAt.toISOString(),
    expired: now > expiresAt,
    updatesAvailable: true,
  };
}
export function canAddSeat(activeSeats: number, seatBand: number): boolean {
  return activeSeats < seatBand;
}

/** Verify an offline bundle manifest before an operator imports its images. */
export function verifyUpdateManifest(manifest: string, signature: string, publicKey: KeyLike) {
  if (!verify(null, Buffer.from(manifest), publicKey, Buffer.from(signature, 'base64')))
    throw new Error('Invalid update signature');
  return z
    .object({
      version: z.string().min(1),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      migration: z.string().min(1),
    })
    .strict()
    .parse(JSON.parse(manifest));
}
