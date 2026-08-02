import { defineConfig } from "vite";

export default defineConfig({
  define: {
    // Injection globale pour éviter tout ReferenceError dans le navigateur
    "process.env": {},
    process: { env: {} },
  },
  build: {
    rollupOptions: {
      // Indique au bundler d'ignorer totalement node-pty s'il est résolu indirectement
      external: ["node-pty"],
    },
  },
  server: {
    hmr: false,
    watch: {
      ignored: ["**/*"],
    },
  },
});
