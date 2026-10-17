import { fileURLToPath } from 'node:url';
import { createServer } from './createServer';
import { ProfileStore } from './ProfileStore';

const port = Number(process.env['PORT'] ?? 2567);
const file =
  process.env['DT_PROFILES_FILE'] ??
  fileURLToPath(new URL('../data/profiles.json', import.meta.url));
await createServer(new ProfileStore(file)).listen(port, '0.0.0.0');
console.log(`Dungeon Togethere: сервер слушает ws://0.0.0.0:${port}, профили — ${file}`);
