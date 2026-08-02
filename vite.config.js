import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  define: {
    "process.env": {},
    global: "window",
  },
  build: {
    rollupOptions: {
      // Forcer Vite à ne compiler QUE l'index.html frontend
      input: {
        main: path.resolve(__dirname, "index.html"),
      },
      // Ignorer les modules Node si un package les appelle indirectement
      external: ["node-pty", "os", "path", "fs", "child_process"],
    },
  },
});
