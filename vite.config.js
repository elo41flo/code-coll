import { defineConfig } from "vite";

export default defineConfig({
  define: {
    "process.env": {},
    global: "window",
  },
  build: {
    // Empêche Vite de bundler les scripts backend et les modules natifs
    rollupOptions: {
      external: ["node-pty", "os", "path", "fs", "child_process"],
    },
  },
});
