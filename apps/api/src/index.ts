import { buildApp } from './server.js';
import { migrate } from './db/migrate.js';
import { pool } from './db/client.js';
import { licenseState } from './context.js';
import { purgeRetention } from './admin.js';
await migrate();
const app = await buildApp();
const license = await licenseState();
if (license.mode === 'invalid')
  app.log.error({ license }, 'Stored license verification failed; sign-in remains available.');
await app.listen({ port: Number(process.env.PORT || 4000), host: process.env.HOST || '127.0.0.1' });
const retention = setInterval(
  () =>
    purgeRetention()
      .then((result) => app.log.info({ retention: result }, 'Retention completed'))
      .catch((error) => app.log.error({ err: error }, 'Retention failed')),
  86400000,
);
retention.unref();
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(retention);
  await app.close();
  await pool.end();
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
