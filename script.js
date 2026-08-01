// ==========================================
// 1. IMPORTS
// ==========================================

import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";
import { keymap } from "@codemirror/view";

import * as Y from "yjs";
import { yCollab } from "y-codemirror.next";

import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

// ==========================================
// 2. INITIALISATION & VARIABLES GLOBALES
// ==========================================

// Map globale pour stocker la session de chaque fichier ouvert
// Clé: Nom du fichier -> Valeur: { handle, originalContent, state, isDirty }
const openFiles = new Map();

let currentFileName = null;
const editorContainer = document.getElementById("editor");

// Instanciation initiale de l'éditeur CodeMirror
const view = new EditorView({
  state: EditorState.create({
    doc: "// Ouvre un dossier puis sélectionne un fichier pour commencer.",
    extensions: [basicSetup, javascript(), oneDark],
  }),
  parent: editorContainer,
});

// ==========================================
// 3. BOUTON D'INVITATION (COPIE DU LIEN)
// ==========================================

const btnShare = document.getElementById("btn-share");

if (btnShare) {
  btnShare.addEventListener("click", () => {
    const inviteUrl = window.location.href;

    navigator.clipboard
      .writeText(inviteUrl)
      .then(() => {
        const originalText = btnShare.textContent;
        btnShare.textContent = "Lien copie !";

        setTimeout(() => {
          btnShare.textContent = originalText;
        }, 2000);
      })
      .catch((err) => {
        console.error("Erreur copie lien :", err);
      });
  });
}

// ==========================================
// 4. EXPLORATEUR DE FICHIERS & GESTION DES SESSIONS
// ==========================================

const btnOpenFolder = document.getElementById("btn-open-folder");
const fileTreeContainer = document.getElementById("file-tree");

if (btnOpenFolder) {
  btnOpenFolder.addEventListener("click", async () => {
    try {
      const dirHandle = await window.showDirectoryPicker();
      fileTreeContainer.innerHTML = "";

      const treeHTML = await construireArbreHTML(dirHandle);
      fileTreeContainer.appendChild(treeHTML);
    } catch (error) {
      console.log("Selection de dossier annulee.");
    }
  });
}

// Construction récursive de l'arbre de fichiers
async function construireArbreHTML(dirHandle) {
  const ul = document.createElement("ul");
  ul.className = "tree-list";

  for await (const entry of dirHandle.values()) {
    const li = document.createElement("li");

    if (entry.kind === "file") {
      li.className = "tree-file";
      // data-attribute pour retrouver le DOM par le nom de fichier
      li.dataset.filename = entry.name;

      li.innerHTML = `
        <span class="file-name">${entry.name}</span>
        <span class="dirty-badge"></span>
      `;

      // Conserver l'état visuel de la pastille lors du re-rendu de l'arbre
      if (openFiles.has(entry.name) && openFiles.get(entry.name).isDirty) {
        li.classList.add("is-dirty");
      }

      li.addEventListener("click", async (e) => {
        e.stopPropagation();

        document.querySelectorAll(".tree-file").forEach((el) => {
          el.classList.remove("active-file");
        });
        li.classList.add("active-file");

        await basculerVersFichier(entry, entry.name);
      });

      ul.appendChild(li);
    } else if (entry.kind === "directory") {
      const details = document.createElement("details");
      const summary = document.createElement("summary");

      summary.textContent = entry.name;
      summary.className = "tree-folder-title";

      const subTree = await construireArbreHTML(entry);

      details.appendChild(summary);
      details.appendChild(subTree);
      li.appendChild(details);

      ul.appendChild(li);
    }
  }

  return ul;
}

// Recherche l'élément HTML actif dans le DOM
function getElementFichierDOM(fileName) {
  return document.querySelector(
    `.tree-file[data-filename="${CSS.escape(fileName)}"]`,
  );
}

// Ajoute ou retire la pastille dorée
function mettreAJourPastille(fileName, isDirty) {
  const domElement = getElementFichierDOM(fileName);
  if (domElement) {
    if (isDirty) {
      domElement.classList.add("is-dirty");
    } else {
      domElement.classList.remove("is-dirty");
    }
  }
}

// Basculer vers un fichier sans détruire l'état en mémoire
async function basculerVersFichier(fileHandle, fileName) {
  // 1. Sauvegarder l'état actuel de CodeMirror pour le fichier qu'on quitte
  if (currentFileName && openFiles.has(currentFileName)) {
    openFiles.get(currentFileName).state = view.state;
  }

  currentFileName = fileName;

  // 2. Première ouverture du fichier : créer son état propre
  if (!openFiles.has(fileName)) {
    const file = await fileHandle.getFile();
    const diskContent = await file.text();

    // Création d'un Y.Doc et Y.Text isolés spécifiquement pour ce fichier
    const ydocFile = new Y.Doc();
    const ytextFile = ydocFile.getText("codemirror");

    ydocFile.transact(() => {
      ytextFile.insert(0, diskContent);
    });

    // Écouteur de modifications pour la pastille dorée
    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const fileData = openFiles.get(fileName);
        if (fileData) {
          const currentText = update.state.doc.toString();
          // Comparaison directe avec le texte original lu sur le disque
          fileData.isDirty = currentText !== fileData.originalContent;
          mettreAJourPastille(fileName, fileData.isDirty);
        }
      }
    });

    // Création de l'EditorState CodeMirror dédié
    const fileState = EditorState.create({
      doc: ytextFile.toString(),
      extensions: [
        basicSetup,
        javascript(),
        oneDark,
        yCollab(ytextFile, null),
        updateListener,
        keymap.of([
          {
            key: "Mod-s",
            run: () => {
              enregistrerFichierSilencieux();
              return true;
            },
          },
        ]),
      ],
    });

    openFiles.set(fileName, {
      handle: fileHandle,
      originalContent: diskContent,
      state: fileState,
      isDirty: false,
    });
  }

  // 3. Charger l'état CodeMirror du fichier sélectionné
  const session = openFiles.get(fileName);
  view.setState(session.state);

  // 4. Forcer la mise à jour de la pastille visuelle
  mettreAJourPastille(fileName, session.isDirty);
}

// Enregistrement sur le disque dur au raccourci Ctrl+S
async function enregistrerFichierSilencieux() {
  if (!currentFileName || !openFiles.has(currentFileName)) return;

  const session = openFiles.get(currentFileName);

  try {
    const contentToSave = view.state.doc.toString();

    // Écriture physique dans le fichier local
    const writable = await session.handle.createWritable();
    await writable.write(contentToSave);
    await writable.close();

    // Mise à jour de la référence : le contenu d'origine devient le texte sauvegardé
    session.originalContent = contentToSave;
    session.isDirty = false;

    // Retirer la pastille dorée
    mettreAJourPastille(currentFileName, false);

    console.log(`Fichier ${currentFileName} enregistre avec succes.`);
  } catch (error) {
    console.error("Erreur lors de l'enregistrement :", error);
  }
}

// Interception globale de Ctrl+S / Cmd+S
window.addEventListener(
  "keydown",
  (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
      e.preventDefault();
      e.stopPropagation();
      enregistrerFichierSilencieux();
    }
  },
  true,
);

// ==========================================
// 5. TERMINAL XTERM.JS
// ==========================================

const term = new Terminal({
  cursorBlink: true,
  allowProposedApi: true,
  theme: {
    background: "#11111b",
    foreground: "#cdd6f4",
    cursor: "#89b4fa",
    black: "#45475a",
    red: "#f38ba8",
    green: "#a6e3a1",
    yellow: "#f9e2af",
    blue: "#89b4fa",
    magenta: "#f5c2e7",
    cyan: "#94e2d5",
    white: "#bac2de",
  },
  fontFamily: "'Fira Code', 'Cascadia Code', Consolas, monospace",
  fontSize: 13,
});

const fitAddon = new FitAddon();
term.loadAddon(fitAddon);

const terminalContainer = document.getElementById("terminal-container");
let socket = null;

if (terminalContainer) {
  term.open(terminalContainer);

  setTimeout(() => {
    fitAddon.fit();
  }, 100);

  // Connexion au serveur WebSocket du terminal (node-pty sur le port 3001)
  socket = new WebSocket("ws://localhost:3001");

  socket.onopen = () => {
    fitAddon.fit();
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          type: "resize",
          cols: term.cols,
          rows: term.rows,
        }),
      );
    }
  };

  socket.onmessage = (event) => {
    term.write(event.data);
  };

  term.onData((data) => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(data);
    }
  });

  socket.onclose = () => {
    term.writeln("\r\n[Connexion au terminal interrompue]");
  };
}

window.addEventListener("resize", () => {
  try {
    fitAddon.fit();
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          type: "resize",
          cols: term.cols,
          rows: term.rows,
        }),
      );
    }
  } catch (e) {}
});
