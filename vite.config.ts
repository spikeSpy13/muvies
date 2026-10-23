import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createDriveMiddleware } from './server/drive.mjs';

export default defineConfig({ plugins: [react(), {
  name: 'muvies-local-drive',
  configureServer(server) { server.middlewares.use(createDriveMiddleware()); },
  configurePreviewServer(server) { server.middlewares.use(createDriveMiddleware()); },
}] });
