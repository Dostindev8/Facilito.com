import { config } from 'dotenv';
import { StubPsfe, processComprobante } from './engine.js';

config();

async function main() {
  const port = Number(process.env.ECF_PORT ?? 3003);
  console.log(`Facilito e-CF service listening conceptually on ${port} (worker mode)`);
  // Worker loop would pull from Redis; for MVP demonstrate one stub cycle.
  const demo = await processComprobante(new StubPsfe(), { ventaId: 'demo', total: '0.00' });
  console.log('demo cycle', demo.status);
  setInterval(() => {
    /* poll queue */
  }, 30_000);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
