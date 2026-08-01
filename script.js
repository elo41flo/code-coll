// ==========================================
// 1. IMPORTS
// ==========================================

import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";
import { keymap } from "@codemirror/view";

// Imports Yjs et WebSocket Provider
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { yCollab } from "y-codemirror.next";

import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

// ==========================================
// 2. GESTION DE LA SALLE (ROOM) & WEBSOCKET
// ==========================================

// Extraction ou génération de l'ID de la salle dans l'URL
function getRoomId() {
  const urlParams = new URLSearchParams(window.location.search);
  let roomId = urlParams.get("room");

  if (!roomId) {
    // Génération d'un identifiant unique si la room n'existe pas
    roomId = "room-" + Math.random().toString(36).substring(2, 9);
    const newUrl = `${window.location.pathname}?room=${roomId}`;
    window.history.replaceState(null, "", newUrl);
  }
  return roomId;
}

const currentRoom = getRoomId();

// Choix automatique du serveur WebSocket (serveur public sécurisé wss:// en prod/Vercel)
const wsServerUrl =
  window.location.hostname === "localhost"
    ? "ws://localhost:1234"
    : "wss://demos.yjs.dev";

// Document Yjs racine et provider WebSocket global
const ydoc = new Y.Doc();
const provider = new WebsocketProvider(wsServerUrl, currentRoom, ydoc);

// Map globale pour stocker les sessions de chaque fichier ouvert
// Clé: Nom du fichier -> Valeur: { handle, originalContent, state, isDirty }
const openFiles = new Map();

let currentFileName = null;
const editorContainer = document.getElementById("editor");

// Instanciation initiale de l'éditeur CodeMirror avec message par défaut
const view = new EditorView({
  state: EditorState.create({
    doc: "// Ouvre un dossier puis sélectionne un fichier pour commencer.",
    extensions: [basicSetup, javascript(), oneDark],
  }),
  parent: editorContainer,
});

// ==========================================
// 3. BOUTON PARTAGER (COPIE DU LIEN)
// ==========================================

const btnShare = document.getElementById("btn-share");

if (btnShare) {
  btnShare.addEventListener("click", async () => {
    const inviteUrl = window.location.href;

    try {
      // 1. Tentative via l'API Clipboard native
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(inviteUrl);
      } else {
        // 2. Méthode de secours pour environnements restreints
        const textArea = document.createElement("textarea");
        textArea.value = inviteUrl;

        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        textArea.style.top = "-999999px";
        document.body.appendChild(textArea);

        textArea.focus();
        textArea.select();

        const successful = document.execCommand("copy");
        document.body.removeChild(textArea);

        if (!successful) {
          throw new Error("Échec de la copie via execCommand");
        }
      }

      // Feedback visuel du bouton
      const originalText = btnShare.textContent;
      btnShare.textContent = "Lien copie !";

      setTimeout(() => {
        btnShare.textContent = originalText;
      }, 2000);
    } catch (err) {
      console.error("Erreur lors de la copie du lien :", err);
      btnShare.textContent = "Erreur de copie";
      setTimeout(() => {
        btnShare.textContent = "🔗 Inviter";
      }, 2000);
    }
  });
}

// ==========================================
// 4. EXPLORATEUR DE FICHIERS & SESSIONS
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
      console.log("Sélection de dossier annulée.");
    }
  });
}

// Construction récursive de l'arborescence HTML
async function construireArbreHTML(dirHandle) {
  const ul = document.createElement("ul");
  ul.className = "tree-list";

  for await (const entry of dirHandle.values()) {
    const li = document.createElement("li");

    if (entry.kind === "file") {
      li.className = "tree-file";
      // data-attribute pour le ciblage DOM
      li.dataset.filename = entry.name;

      li.innerHTML = `
        <span class="file-name">${entry.name}</span>
        <span class="dirty-badge"></span>
      `;

      // Conserver l'état de la pastille si le fichier a été modifié
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

// Retrouve l'élément HTML actif dans le DOM
function getElementFichierDOM(fileName) {
  return document.querySelector(
    `.tree-file[data-filename="${CSS.escape(fileName)}"]`,
  );
}

// Gestion de la pastille dorée (.is-dirty)
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

// Chargement et bascule de fichier avec synchronisation Yjs
async function basculerVersFichier(fileHandle, fileName) {
  // 1. Sauvegarder l'état CodeMirror du fichier qu'on quitte
  if (currentFileName && openFiles.has(currentFileName)) {
    openFiles.get(currentFileName).state = view.state;
  }

  currentFileName = fileName;

  // 2. Première ouverture du fichier pendant cette session
  if (!openFiles.has(fileName)) {
    const file = await fileHandle.getFile();
    const diskContent = await file.text();

    // Clé Y.Text propre à ce fichier dans la room courante
    const fileYText = ydoc.getText(`file:${fileName}`);

    // Si la structure Yjs est vide pour ce fichier, on y insère le contenu initial du disque
    if (fileYText.toString() === "" && diskContent !== "") {
      ydoc.transact(() => {
        fileYText.insert(0, diskContent);
      });
    }

    // Écouteur pour la détection de modifications non sauvegardées
    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const fileData = openFiles.get(fileName);
        if (fileData) {
          const currentText = update.state.doc.toString();
          // Comparaison directe entre l'état en mémoire et le contenu d'origine du disque
          fileData.isDirty = currentText !== fileData.originalContent;
          mettreAJourPastille(fileName, fileData.isDirty);
        }
      }
    });

    // Création de l'EditorState CodeMirror connecté à Yjs via yCollab
    const fileState = EditorState.create({
      doc: fileYText.toString(),
      extensions: [
        basicSetup,
        javascript(),
        oneDark,
        yCollab(fileYText, provider.awareness),
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

  // 3. Charger l'état CodeMirror spécifique à ce fichier
  const session = openFiles.get(fileName);
  view.setState(session.state);

  // 4. Mettre à jour la pastille visuelle dans l'explorateur
  mettreAJourPastille(fileName, session.isDirty);
}

// Enregistrement sur le disque dur via Ctrl+S / Cmd+S
async function enregistrerFichierSilencieux() {
  if (!currentFileName || !openFiles.has(currentFileName)) return;

  const session = openFiles.get(currentFileName);

  try {
    const contentToSave = view.state.doc.toString();

    // Écriture physique sur le fichier local
    const writable = await session.handle.createWritable();
    await writable.write(contentToSave);
    await writable.close();

    // Réinitialisation de l'état : l'origine devient le texte qu'on vient de sauvegarder
    session.originalContent = contentToSave;
    session.isDirty = false;

    // Retirer la pastille dorée
    mettreAJourPastille(currentFileName, false);

    console.log(`Fichier ${currentFileName} enregistré avec succès.`);
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
