# Offline signed update format

The v0 verifier authenticates update bytes. Update application is deliberately a stub: it does not extract archives, load images, run SQL, stop services, or alter the installed version.

An update directory contains `manifest.json`, `manifest.sig` and `payload.tar`. The UTF-8 manifest is signed exactly as stored; reformatting it invalidates the signature. `manifest.sig` is a raw 64-byte Ed25519 signature of the bytes `mane-update-v1\n` followed by the complete manifest bytes. The domain prefix prevents cross-protocol signatures from being reused.

```json
{
  "format": "mane-update-v1",
  "version": "0.1.0",
  "archive": "payload.tar",
  "sha256": "<64 lowercase hexadecimal characters>",
  "images": ["mane/node@sha256:<64 lowercase hexadecimal characters>"],
  "migration": "migrations/001.sql"
}
```

`payload.tar` contains offline `docker save` image archives under `images/` and the declared SQL migration under `migrations/`. Release packaging must document image digests and migration compatibility. The verifier checks the pinned public key type, signature, constrained manifest shape and streaming SHA-256 of the payload. Symlinks are refused. No supplied executable content is run during verification.

```sh
node scripts/verify-update.mjs /media/update/manifest.json /media/update/manifest.sig /etc/mane/trusted-update-public.pem
```

The trust key is provisioned independently by the appliance administrator; never trust a key included in the same untrusted bundle. Signing private keys stay outside the repository and appliance. `scripts/tests/update.test.mjs` generates disposable keys to prove authentic verification, wrong-key rejection and tamper rejection.

Future application must enforce installed-version/rollback policy, check license maintenance eligibility without blocking login, verify file paths and archive types before extraction, back up data, load images by digest, apply migrations transactionally where possible, health-check services and recover on failure. Authenticity alone does not make a migration compatible. Those steps are not claimed as implemented in this v0 verification stub.
