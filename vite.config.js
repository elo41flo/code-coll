// vite.config.js
import { defineConfig } from "vite";

export default defineConfig({
  // Injection globale pour éviter l'erreur "process is not defined" dans le navigateur
  define: {
    "process.env": {},
  },
  server: {
    // Empêche Vite de recharger la page quand tu modifies un fichier
    hmr: false,
    watch: {
      // Optionnel : ignore les fichiers du projet pour éviter le reload
      ignored: ["**/*"],
    },
  },
});
