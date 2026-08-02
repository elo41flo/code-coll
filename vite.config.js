import { defineConfig } from "vite";

export default defineConfig({
  define: {
    // Injection globale pour éviter le crash "process is not defined" dans le navigateur
    "process.env": {},
    process: { env: {} },
  },
  server: {
    hmr: false,
    watch: {
      ignored: ["**/*"],
    },
  },
});
