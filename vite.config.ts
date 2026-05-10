import { defineConfig, type UserConfig } from "vite";
import solid from "vite-plugin-solid";

declare const process: { env: { TAURI_DEV_HOST?: string } };

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig((): UserConfig => ({
  plugins: [solid()],
  
  build: {
    target: "esnext",
    minify: "esbuild",
    cssMinify: "lightningcss" as const,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules')) {
            if (id.includes('solid-js')) return 'solid';
            if (id.includes('@tauri-apps')) return 'tauri';
            return 'vendor';
          }
        }
      }
    }
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
