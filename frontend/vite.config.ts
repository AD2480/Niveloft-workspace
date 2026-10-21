/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv, type ProxyOptions } from 'vite';
import { excludeTestApi, seoPlugin } from './tools/seo';

const API_TARGET = process.env.PROJECTFLOW_API_TARGET ?? 'http://localhost:8080';

/**
 * When Spring Boot isn't running, Vite's proxy would answer with an empty 500 and the app could
 * only say "the server ran into a problem". Answer with the API's own error shape instead, so the
 * UI can say exactly what's wrong and how to fix it.
 */
const explainUnreachableBackend: ProxyOptions['configure'] = (proxy) => {
  proxy.on('error', (err, req, res) => {
    const code = (err as NodeJS.ErrnoException).code ?? 'ERROR';
    const message =
      code === 'ECONNREFUSED'
        ? `Can’t reach the ProjectFlow backend at ${API_TARGET}. Start it in another terminal (cd backend && ./mvnw spring-boot:run) and wait for “Started ProjectFlowApplication”.`
        : `Can’t reach the ProjectFlow backend at ${API_TARGET} (${code}). Check the backend terminal for errors.`;
    // `res` is a socket for WebSocket upgrades; only HTTP responses can carry a body.
    if (!('writeHead' in res) || res.headersSent) return;
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        success: false,
        status: 503,
        code: 'BACKEND_UNAVAILABLE',
        error: 'Service Unavailable',
        message,
        fieldErrors: null,
        path: req.url ?? null,
        timestamp: new Date().toISOString(),
      }),
    );
  });
};

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // All variables (not only VITE_…), so the build can read Vercel's own ones too.
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), '') };
  return {
    plugins: [react(), tailwindcss(), excludeTestApi(env), seoPlugin(env, mode)],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      // 5174 is the agreed frontend port; the backend's CORS list expects it.
      port: 5174,
      strictPort: true,
      open: false,
      // In development the app calls same-origin /api and Vite forwards it to Spring Boot,
      // so the browser never needs CORS and the JWT stays on one origin.
      proxy: {
        '/api': {
          target: API_TARGET,
          changeOrigin: false,
          configure: explainUnreachableBackend,
        },
        // Lets the sign-in pages check whether the backend is up (GET /actuator/health).
        '/actuator/health': {
          target: API_TARGET,
          changeOrigin: false,
          configure: explainUnreachableBackend,
        },
      },
    },
    preview: {
      port: 4174,
    },
    build: {
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom', 'react-router'],
            redux: ['@reduxjs/toolkit', 'react-redux'],
            dnd: ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
          },
        },
      },
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts', 'tools/**/*.test.ts'],
    },
  };
});
