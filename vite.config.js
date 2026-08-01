// vite.config.js
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    // Empêche Vite de recharger la page quand tu modifies un fichier
    hmr: false,
    watch: {
      // Optionnel : ignore les fichiers du projet pour éviter le reload
      ignored: ["**/*"],
    },
  },
});
