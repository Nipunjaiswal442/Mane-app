import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { issueLicense, verifyLicense, evaluationStatus, canAddSeat } from '../src/index.js';
const keys = generateKeyPairSync('ed25519');
const payload = {
  issued_to: 'Example',
  seat_band: 100,
  tier: 'starter' as const,
  issued_at: '2026-01-01T00:00:00Z',
  maintenance_expires_at: '2027-01-01T00:00:00Z',
};
test('Ed25519 license verifies and detects modified payload', () => {
  const raw = issueLicense(payload, keys.privateKey);
  assert.equal(verifyLicense(raw, keys.publicKey, new Date('2026-09-01')).seat_band, 100);
  assert.throws(() => verifyLicense(raw.replace('100', '101'), keys.publicKey));
});
test('expired maintenance preserves entitlement while disabling updates', () => {
  const raw = issueLicense(payload, keys.privateKey);
  const result = verifyLicense(raw, keys.publicKey, new Date('2028-01-01'));
  assert.equal(result.updatesAvailable, false);
  assert.equal(result.seat_band, 100);
});
test('wrong issuer and malformed payload rejected', () => {
  const raw = issueLicense(payload, keys.privateKey);
  assert.throws(() => verifyLicense(raw, generateKeyPairSync('ed25519').publicKey));
  assert.throws(() => issueLicense({ ...payload, seat_band: -1 }, keys.privateKey));
});
test('seat and evaluation boundaries', () => {
  assert.equal(canAddSeat(99, 100), true);
  assert.equal(canAddSeat(100, 100), false);
  assert.equal(evaluationStatus(new Date('2026-01-01'), 1, new Date('2026-01-16')).expired, true);
});
