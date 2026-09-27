import { config } from 'dotenv';
import { StubLlm } from './llm.js';

config();

async function main() {
  const port = Number(process.env.COPILOT_PORT ?? 3002);
  console.log(`Facilito Copilot service on ${port}`);
  const llm = new StubLlm();
  console.log(await llm.complete('ping'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
