// 1. Sélectionner le bouton et le conteneur dans le DOM
const btnOpenFolder = document.getElementById("btn-open-folder");
const fileTreeContainer = document.getElementById("file-tree");

// 2. Ajouter l'écouteur d'événement au clic
btnOpenFolder.addEventListener("click", async () => {
  try {
    // Ouvre la fenêtre native du système pour sélectionner un dossier
    const dirHandle = await window.showDirectoryPicker();

    // Vider l'explorateur précédent s'il y en avait un
    fileTreeContainer.innerHTML = "";

    // Générer et afficher l'arbre HTML
    const treeHTML = await construireArbreHTML(dirHandle);
    fileTreeContainer.appendChild(treeHTML);
  } catch (error) {
    // L'utilisateur a fermé la fenêtre sans choisir de dossier
    console.log("Sélection de dossier annulée ou non supportée.");
  }
});

// 3. Fonction récursive pour créer la liste <ul> / <li> des fichiers et dossiers
async function construireArbreHTML(dirHandle) {
  const ul = document.createElement("ul");
  ul.className = "tree-list";

  for await (const entry of dirHandle.values()) {
    const li = document.createElement("li");

    if (entry.kind === "file") {
      // Si c'est un fichier
      li.textContent = `📄 ${entry.name}`;
      li.className = "tree-file";

      // Clic sur un fichier -> Lire son contenu
      li.addEventListener("click", async (e) => {
        e.stopPropagation();
        const file = await entry.getFile();
        const content = await file.text();

        console.log(`Contenu de ${entry.name} :`, content);
        // Toujours prêt à être envoyé dans CodeMirror / Yjs !
      });

      ul.appendChild(li);
    } else if (entry.kind === "directory") {
      // Si c'est un sous-dossier, on utilise <details> pour rendre le dossier pliable !
      const details = document.createElement("details");
      const summary = document.createElement("summary");

      summary.textContent = `📁 ${entry.name}`;
      summary.className = "tree-folder-title";

      // Appel récursif pour lire le contenu du sous-dossier
      const subTree = await construireArbreHTML(entry);

      details.appendChild(summary);
      details.appendChild(subTree);
      li.appendChild(details);

      ul.appendChild(li);
    }
  }

  return ul;
}
