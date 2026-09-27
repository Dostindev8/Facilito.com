import { ensureSchema } from './schema.js';
import { getDriver } from './client.js';

ensureSchema((msg) => console.log(msg))
  .then(async (applied) => {
    console.log(applied.length ? `Applied ${applied.length} migration(s)` : 'Schema up to date');
    await (await getDriver()).close();
  })
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
