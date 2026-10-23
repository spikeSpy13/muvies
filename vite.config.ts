import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createDriveMiddleware } from './server/drive.mjs';
import { createLibraryMiddleware } from './server/library.mjs';
import { createSubtitlesMiddleware } from './server/subtitles.mjs';
import { createImagesMiddleware } from './server/images.mjs';

export default defineConfig({ plugins: [react(), {
  name: 'muvies-local-drive',
  configureServer(server) {
    server.middlewares.use(createLibraryMiddleware({ directory: process.env.MUVIES_LIBRARY_DIR }));
    server.middlewares.use(createSubtitlesMiddleware({ directory: process.env.MUVIES_LIBRARY_DIR }));
    server.middlewares.use(createImagesMiddleware({ directory: process.env.MUVIES_LIBRARY_DIR }));
    server.middlewares.use(createDriveMiddleware());
  },
  configurePreviewServer(server) {
    server.middlewares.use(createLibraryMiddleware({ directory: process.env.MUVIES_LIBRARY_DIR }));
    server.middlewares.use(createSubtitlesMiddleware({ directory: process.env.MUVIES_LIBRARY_DIR }));
    server.middlewares.use(createImagesMiddleware({ directory: process.env.MUVIES_LIBRARY_DIR }));
    server.middlewares.use(createDriveMiddleware());
  },
}] });
