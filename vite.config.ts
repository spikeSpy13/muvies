import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createDriveMiddleware } from './server/drive.mjs';
import { createLibraryMiddleware } from './server/library.mjs';

export default defineConfig({ plugins: [react(), {
  name: 'muvies-local-drive',
  configureServer(server) {
    server.middlewares.use(createLibraryMiddleware({ directory: process.env.MUVIES_LIBRARY_DIR }));
    server.middlewares.use(createDriveMiddleware());
  },
  configurePreviewServer(server) {
    server.middlewares.use(createLibraryMiddleware({ directory: process.env.MUVIES_LIBRARY_DIR }));
    server.middlewares.use(createDriveMiddleware());
  },
}] });
