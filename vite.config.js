import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist', // Output for production serving
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true
      },
      '/sensor': 'http://localhost:3000'
    }
  }
});
