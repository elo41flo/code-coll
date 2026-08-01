// --- IMPORTS ---
import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";

import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { yCollab } from "y-codemirror.next";

// ==========================================
// 1. GESTION DE LA SALLE (ROOM) VIA L'URL
// ==========================================

// Fonction pour récupérer l'ID de room dans l'URL ou en générer un nouveau
function getRoomId() {
  const urlParams = new URLSearchParams(window.location.search);
  let roomId = urlParams.get("room");

  if (!roomId) {
    // Génération d'une chaîne aléatoire si aucune room n'est spécifiée
    roomId = "room-" + Math.random().toString(36).substring(2, 9);
    const newUrl = `${window.location.pathname}?room=${roomId}`;
    // Mise à jour de l'URL sans rechargement de la page
    window.history.replaceState(null, "", newUrl);
  }
  return roomId;
}

const currentRoom = getRoomId();

// ==========================================
// 2. CONFIGURATION DE YJS & CODEMIRROR
// ==========================================

// Création du document Yjs et connexion au serveur WebSocket
const ydoc = new Y.Doc();
const provider = new WebsocketProvider(
  "ws://localhost:1234",
  currentRoom,
  ydoc,
);
const ytext = ydoc.getText("codemirror");

// Ciblage du conteneur HTML
const editorContainer = document.getElementById("editor");

// Configuration de l'état CodeMirror avec les extensions requis
const state = EditorState.create({
  doc: ytext.toString(),
  extensions: [
    basicSetup, // Numérotation, surbrillance, indentations
    javascript(), // Syntaxe JavaScript
    oneDark, // Thème sombre
    yCollab(ytext, provider.awareness), // Synchronisation Yjs
  ],
});

// Instanciation de la vue de l'éditeur
const view = new EditorView({
  state,
  parent: editorContainer,
});

// ==========================================
// 3. BOUTON D'INVITATION (COPIE DU LIEN)
// ==========================================

const btnShare = document.getElementById("btn-share");

if (btnShare) {
  btnShare.addEventListener("click", () => {
    // Récupération de l'URL courante incluant le paramètre ?room=
    const inviteUrl = window.location.href;

    // Copie de l'URL dans le presse-papier
    navigator.clipboard
      .writeText(inviteUrl)
      .then(() => {
        const originalText = btnShare.textContent;
        btnShare.textContent = "Lien copié !";

        setTimeout(() => {
          btnShare.textContent = originalText;
        }, 2000);
      })
      .catch((err) => {
        console.error("Erreur lors de la copie du lien :", err);
      });
  });
}

// ==========================================
// 4. EXPLORATEUR DE FICHIERS (FILE SYSTEM API)
// ==========================================

const btnOpenFolder = document.getElementById("btn-open-folder");
const fileTreeContainer = document.getElementById("file-tree");

if (btnOpenFolder) {
  btnOpenFolder.addEventListener("click", async () => {
    try {
      // Ouverture du sélecteur de dossier natif
      const dirHandle = await window.showDirectoryPicker();

      // Reinitialisation de l'affichage
      fileTreeContainer.innerHTML = "";

      // Construction et injection de l'arborescence
      const treeHTML = await construireArbreHTML(dirHandle);
      fileTreeContainer.appendChild(treeHTML);
    } catch (error) {
      console.log("Sélection de dossier annulée ou non supportée.");
    }
  });
}

// Fonction récursive pour construire la structure HTML du projet
async function construireArbreHTML(dirHandle) {
  const ul = document.createElement("ul");
  ul.className = "tree-list";

  for await (const entry of dirHandle.values()) {
    const li = document.createElement("li");

    if (entry.kind === "file") {
      // Cas : Fichier
      li.textContent = `📄 ${entry.name}`;
      li.className = "tree-file";

      // Clic sur un fichier -> Injection de son contenu dans l'éditeur partagé
      li.addEventListener("click", async (e) => {
        e.stopPropagation();

        const file = await entry.getFile();
        const content = await file.text();

        // 1. Mise à jour du document partagé Yjs
        ytext.delete(0, ytext.length);
        ytext.insert(0, content);

        // 2. Dispatch dans la vue de l'éditeur local
        view.dispatch({
          changes: {
            from: 0,
            to: view.state.doc.length,
            insert: content,
          },
        });
      });

      ul.appendChild(li);
    } else if (entry.kind === "directory") {
      // Cas : Dossier (arborescence dépliable)
      const details = document.createElement("details");
      const summary = document.createElement("summary");

      summary.textContent = `📁 ${entry.name}`;
      summary.className = "tree-folder-title";

      // Parcours récursif du sous-dossier
      const subTree = await construireArbreHTML(entry);

      details.appendChild(summary);
      details.appendChild(subTree);
      li.appendChild(details);

      ul.appendChild(li);
    }
  }

  return ul;
}
