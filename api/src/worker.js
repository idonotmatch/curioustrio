if (process.env.NODE_ENV !== 'test') require('dotenv').config();
require('dns').setDefaultResultOrder('ipv4first');

const db = require('./db');
const { runStartupChecks } = require('./startup/runStartupChecks');
const { initObservability } = require('./services/observability');
const {
  startBackgroundJobWorker,
  stopBackgroundJobWorker,
} = require('./services/backgroundJobWorker');

initObservability();

async function main() {
  await runStartupChecks();
  await startBackgroundJobWorker();
  console.log('[background jobs] dedicated worker started');
  const keepAlive = setInterval(() => {}, 60_000);

  let stopping = false;
  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    clearInterval(keepAlive);
    console.log(`[background jobs] ${signal} received; draining worker`);
    await stopBackgroundJobWorker({ timeoutMs: 25_000 });
    await db.pool.end();
    process.exit(0);
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

main().catch(async (error) => {
  console.error('[background jobs] worker startup failed', error?.message || error);
  await db.pool.end().catch(() => {});
  process.exit(1);
});
