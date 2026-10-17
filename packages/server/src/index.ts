import { createServer } from './createServer';

const port = Number(process.env['PORT'] ?? 2567);
await createServer().listen(port, '0.0.0.0');
console.log(`Dungeon Togethere: сервер слушает ws://0.0.0.0:${port}`);
