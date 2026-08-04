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

// ==========================================
// 2. CONFIGURATION DE L'URL BACKEND (.ENV)
// ==========================================

const rawBackendUrl =
  import.meta.env.VITE_BACKEND_URL ||
  `${window.location.protocol}//${window.location.host}`;

const BACKEND_URL = rawBackendUrl.replace(/\/+$/, "");

const wsProtocol = BACKEND_URL.startsWith("https") ? "wss:" : "ws:";
const backendHost = BACKEND_URL.replace(/^https?:\/\//, "");

const wsYjsUrl = `${wsProtocol}//${backendHost}/yjs`;
const wsTerminalUrl = `${wsProtocol}//${backendHost}/terminal`;

// ==========================================
// 3. CONFIGURATION DE L'IDENTITÉ UTILISATEUR
// ==========================================

const USER_COLORS = [
  { color: "#f38ba8", light: "#f38ba833" },
  { color: "#a6e3a1", light: "#a6e3a133" },
  { color: "#89b4fa", light: "#89b4fa33" },
  { color: "#f9e2af", light: "#f9e2af33" },
  { color: "#cba6f7", light: "#cba6f733" },
  { color: "#fab387", light: "#fab38733" },
  { color: "#94e2d5", light: "#94e2d533" },
];

function getLocalUserInfo() {
  const savedName = localStorage.getItem("editor_username");

  let osName = "Dev";
  const ua = navigator.userAgent;
  if (ua.includes("Win")) osName = "Windows User";
  else if (ua.includes("Mac")) osName = "Mac User";
  else if (ua.includes("Linux")) osName = "Linux User";

  const randomId = Math.floor(Math.random() * 900 + 100);
  const userName = savedName || `${osName} #${randomId}`;

  const randomColor =
    USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)];

  return {
    name: userName,
    color: randomColor.color,
    colorLight: randomColor.light,
  };
}

const localUser = getLocalUserInfo();

// ==========================================
// 4. SALLE (ROOM) & SERVEUR WEBSOCKET YJS
// ==========================================

function getRoomId() {
  const urlParams = new URLSearchParams(window.location.search);
  let roomId = urlParams.get("room");

  if (!roomId) {
    roomId = "room-" + Math.random().toString(36).substring(2, 9);
    const newUrl = `${window.location.pathname}?room=${roomId}`;
    window.history.replaceState(null, "", newUrl);
  }
  return roomId;
}

const currentRoom = getRoomId();

const ydoc = new Y.Doc();
const provider = new WebsocketProvider(wsYjsUrl, currentRoom, ydoc);

provider.awareness.setLocalStateField("user", {
  name: localUser.name,
  color: localUser.color,
  colorLight: localUser.colorLight,
});

const openFiles = new Map();
let currentFilePath = null;
const editorContainer = document.getElementById("editor");

const view = new EditorView({
  state: EditorState.create({
    doc: "// Sélectionnez un fichier dans l'explorateur pour démarrer.",
    extensions: [basicSetup, javascript(), oneDark],
  }),
  parent: editorContainer,
});

// ==========================================
// 5. BOUTON PARTAGER (COPIE DU LIEN D'INVITATION)
// ==========================================

const btnShare = document.getElementById("btn-share");

if (btnShare) {
  btnShare.addEventListener("click", async () => {
    // Le lien intègre à la fois la room et le fichier actif
    const inviteUrl = window.location.href;

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(inviteUrl);
      } else {
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

        if (!successful) throw new Error("Échec de la copie");
      }

      const originalText = btnShare.textContent;
      btnShare.textContent = "Lien copié !";
      setTimeout(() => (btnShare.textContent = originalText), 2000);
    } catch (err) {
      console.error("Erreur copie lien :", err);
      btnShare.textContent = "Erreur de copie";
      setTimeout(() => (btnShare.textContent = "🔗 Inviter"), 2000);
    }
  });
}

// ==========================================
// 6. EXPLORATION DE FICHIERS SERVEUR & SYNCHRONISATION
// ==========================================

const btnOpenFolder = document.getElementById("btn-open-folder");
const fileTreeContainer = document.getElementById("file-tree");
const sidebar = document.getElementById("sidebar");

// Charger l'arborescence depuis le serveur backend
async function chargerArborescenceServeur() {
  try {
    const response = await fetch(`${BACKEND_URL}/api/files`);
    if (!response.ok) throw new Error(`Erreur HTTP: ${response.status}`);

    const treeData = await response.json();

    if (fileTreeContainer) {
      fileTreeContainer.innerHTML = "";
      if (Array.isArray(treeData) && treeData.length > 0) {
        const treeHTML = construireArbreHTMLBackend(treeData);
        fileTreeContainer.appendChild(treeHTML);

        // --- SYNCHRONISATION : Vérifier si un fichier est spécifié dans l'URL ---
        const urlParams = new URLSearchParams(window.location.search);
        const fileFromUrl = urlParams.get("file");

        if (fileFromUrl) {
          // L'invité ouvre automatiquement le fichier présent dans le lien
          await basculerVersFichierServeur(fileFromUrl);
        } else {
          // Ouverture par défaut du premier fichier si aucun n'est dans le lien
          const firstFile = trouverPremierFichier(treeData);
          if (firstFile) await basculerVersFichierServeur(firstFile.path);
        }
      } else {
        fileTreeContainer.innerHTML =
          "<div class='tree-empty'>Aucun fichier sur le serveur.</div>";
      }
    }
  } catch (err) {
    console.error("Impossible de charger l'explorateur :", err);
    if (fileTreeContainer) {
      fileTreeContainer.innerHTML =
        "<div class='tree-error'>Échec de connexion au serveur.</div>";
    }
  }
}

// Fonction utilitaire pour trouver le premier fichier
function trouverPremierFichier(nodes) {
  for (const node of nodes) {
    if (node.type === "file") return node;
    if (node.type === "directory" && node.children) {
      const sub = trouverPremierFichier(node.children);
      if (sub) return sub;
    }
  }
  return null;
}

// Clic sur le bouton : ouvrir/fermer la sidebar + charger les fichiers
if (btnOpenFolder) {
  btnOpenFolder.textContent = "📁 Projet serveur";
  btnOpenFolder.addEventListener("click", () => {
    if (sidebar) {
      sidebar.classList.toggle("open");
      sidebar.classList.toggle("active");
    }
    chargerArborescenceServeur();
  });
}

// Chargement automatique dès l'arrivée sur le site
chargerArborescenceServeur();

// Rendu HTML récursif sécurisé de l'arborescence
function construireArbreHTMLBackend(nodes) {
  const ul = document.createElement("ul");
  ul.className = "tree-list";

  if (!Array.isArray(nodes)) return ul;

  nodes.forEach((node) => {
    const li = document.createElement("li");

    if (node.type === "file") {
      li.className = "tree-file";
      li.dataset.filepath = node.path;

      li.innerHTML = `
        <span class="file-name">📄 ${node.name}</span>
        <span class="dirty-badge"></span>
      `;

      if (openFiles.has(node.path) && openFiles.get(node.path).isDirty) {
        li.classList.add("is-dirty");
      }

      if (currentFilePath === node.path) {
        li.classList.add("active-file");
      }

      li.addEventListener("click", async (e) => {
        e.stopPropagation();

        document.querySelectorAll(".tree-file").forEach((el) => {
          el.classList.remove("active-file");
        });
        li.classList.add("active-file");

        await basculerVersFichierServeur(node.path);
      });

      ul.appendChild(li);
    } else if (node.type === "directory") {
      const details = document.createElement("details");
      details.open = true;
      const summary = document.createElement("summary");

      summary.textContent = `📁 ${node.name}`;
      summary.className = "tree-folder-title";

      const childrenNodes = Array.isArray(node.children) ? node.children : [];
      const subTree = construireArbreHTMLBackend(childrenNodes);

      details.appendChild(summary);
      details.appendChild(subTree);
      li.appendChild(details);

      ul.appendChild(li);
    }
  });

  return ul;
}

function getElementFichierDOM(filePath) {
  return document.querySelector(
    `.tree-file[data-filepath="${CSS.escape(filePath)}"]`,
  );
}

function mettreAJourPastille(filePath, isDirty) {
  const domElement = getElementFichierDOM(filePath);
  if (domElement) {
    if (isDirty) {
      domElement.classList.add("is-dirty");
    } else {
      domElement.classList.remove("is-dirty");
    }
  }
}

// Chargement et bascule de fichier synchronisé dans l'URL
async function basculerVersFichierServeur(filePath) {
  if (currentFilePath && openFiles.has(currentFilePath)) {
    openFiles.get(currentFilePath).state = view.state;
  }

  currentFilePath = filePath;

  // --- MISE À JOUR DE L'URL : On enregistre le fichier dans la barre d'adresse ---
  const urlParams = new URLSearchParams(window.location.search);
  urlParams.set("file", filePath);
  const newUrl = `${window.location.pathname}?${urlParams.toString()}`;
  window.history.replaceState(null, "", newUrl);

  // Mettre à jour l'élément actif dans le DOM
  document.querySelectorAll(".tree-file").forEach((el) => {
    if (el.dataset.filepath === filePath) {
      el.classList.add("active-file");
    } else {
      el.classList.remove("active-file");
    }
  });

  if (!openFiles.has(filePath)) {
    try {
      const res = await fetch(
        `${BACKEND_URL}/api/file-content?path=${encodeURIComponent(filePath)}`,
      );
      if (!res.ok) throw new Error("Erreur lors de la lecture du fichier.");

      const data = await res.json();
      const diskContent = data.content || "";

      const fileYText = ydoc.getText(`file:${filePath}`);

      if (fileYText.toString() === "" && diskContent !== "") {
        ydoc.transact(() => {
          fileYText.insert(0, diskContent);
        });
      }

      const updateListener = EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const fileData = openFiles.get(filePath);
          if (fileData) {
            const currentText = update.state.doc.toString();
            fileData.isDirty = currentText !== fileData.originalContent;
            mettreAJourPastille(filePath, fileData.isDirty);
          }
        }
      });

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
                enregistrerFichierServeur();
                return true;
              },
            },
          ]),
        ],
      });

      openFiles.set(filePath, {
        path: filePath,
        originalContent: diskContent,
        state: fileState,
        isDirty: false,
      });
    } catch (err) {
      console.error("Erreur de basculement vers le fichier :", err);
      return;
    }
  }

  const session = openFiles.get(filePath);
  if (session) {
    view.setState(session.state);
    mettreAJourPastille(filePath, session.isDirty);
  }
}

// Enregistrement sur le serveur backend
async function enregistrerFichierServeur() {
  if (!currentFilePath || !openFiles.has(currentFilePath)) return;

  const session = openFiles.get(currentFilePath);

  try {
    const contentToSave = view.state.doc.toString();

    const response = await fetch(`${BACKEND_URL}/api/save-file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: session.path,
        content: contentToSave,
      }),
    });

    if (!response.ok) throw new Error("Échec de la sauvegarde backend.");

    session.originalContent = contentToSave;
    session.isDirty = false;

    mettreAJourPastille(currentFilePath, false);
    console.log(`Fichier ${currentFilePath} sauvegardé avec succès.`);
  } catch (error) {
    console.error("Erreur enregistrement serveur :", error);
  }
}

window.addEventListener(
  "keydown",
  (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
      e.preventDefault();
      e.stopPropagation();
      enregistrerFichierServeur();
    }
  },
  true,
);

// ==========================================
// 7. TERMINAL XTERM.JS
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
    try {
      fitAddon.fit();
    } catch (e) {}
  }, 100);

  socket = new WebSocket(wsTerminalUrl);

  socket.onopen = () => {
    try {
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
    } catch (e) {}
  };

  socket.onmessage = (event) => term.write(event.data);

  term.onData((data) => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(data);
    }
  });

  socket.onclose = () => {
    term.writeln("\r\n[Connexion au terminal serveur interrompue]");
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
