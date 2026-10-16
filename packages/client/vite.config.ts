import { defineConfig } from 'vite';

export default defineConfig({
  // Исходники графики лежат в корневой assets/ — отдаём их как статику, не копируя.
  publicDir: '../../assets',
  server: { host: true, port: 5173 },
});
