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
// 2. CONFIGURATION DE L'IDENTITÉ UTILISATEUR
// ==========================================

const USER_COLORS = [
  { color: "#f38ba8", light: "#f38ba833" }, // Rose / Rouge
  { color: "#a6e3a1", light: "#a6e3a133" }, // Vert
  { color: "#89b4fa", light: "#89b4fa33" }, // Bleu
  { color: "#f9e2af", light: "#f9e2af33" }, // Jaune
  { color: "#cba6f7", light: "#cba6f733" }, // Violet
  { color: "#fab387", light: "#fab38733" }, // Orange
  { color: "#94e2d5", light: "#94e2d533" }, // Cyan
];

function getLocalUserInfo() {
  const savedName = localStorage.getItem("editor_username");

  let osName = "Dev";
  const ua = navigator.userAgent;
  if (ua.includes("Win")) osName = "Windows User";
  else if (ua.includes("Mac")) osName = "Mac User";
  else if (ua.includes("Linux")) osName = "Linux User";
  else if (ua.includes("Android")) osName = "Android User";
  else if (ua.includes("iPhone") || ua.includes("iPad")) osName = "iOS User";

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
// 3. GESTION DE LA SALLE (ROOM) & WEBSOCKET
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

const wsServerUrl =
  window.location.hostname === "localhost"
    ? "ws://localhost:1234"
    : "wss://demos.yjs.dev";

const ydoc = new Y.Doc();
const provider = new WebsocketProvider(wsServerUrl, currentRoom, ydoc);

provider.awareness.setLocalStateField("user", {
  name: localUser.name,
  color: localUser.color,
  colorLight: localUser.colorLight,
});

const openFiles = new Map();

let currentFileName = null;
const editorContainer = document.getElementById("editor");

const view = new EditorView({
  state: EditorState.create({
    doc: "// Ouvre un dossier puis sélectionne un fichier pour commencer.",
    extensions: [basicSetup, javascript(), oneDark],
  }),
  parent: editorContainer,
});

// ==========================================
// 4. BOUTON PARTAGER (COPIE DU LIEN)
// ==========================================

const btnShare = document.getElementById("btn-share");

if (btnShare) {
  btnShare.addEventListener("click", async () => {
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

        if (!successful) {
          throw new Error("Échec de la copie via execCommand");
        }
      }

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
// 5. EXPLORATEUR DE FICHIERS & SESSIONS
// ==========================================

const btnOpenFolder = document.getElementById("btn-open-folder");
const fileTreeContainer = document.getElementById("file-tree");

if (btnOpenFolder) {
  btnOpenFolder.addEventListener("click", async () => {
    try {
      // Vérification du support natif de l'API File System Access
      if (!window.showDirectoryPicker) {
        alert(
          "Ton navigateur ne prend pas en compte l'ouverture de dossiers locaux (utilise Chrome, Edge ou Brave).",
        );
        return;
      }

      const dirHandle = await window.showDirectoryPicker();

      if (fileTreeContainer) {
        fileTreeContainer.innerHTML = "";
        const treeHTML = await construireArbreHTML(dirHandle);
        fileTreeContainer.appendChild(treeHTML);
      }
    } catch (error) {
      if (error.name !== "AbortError") {
        console.error("Erreur d'ouverture de dossier :", error);
      }
    }
  });
}

async function construireArbreHTML(dirHandle) {
  const ul = document.createElement("ul");
  ul.className = "tree-list";

  for await (const entry of dirHandle.values()) {
    const li = document.createElement("li");

    if (entry.kind === "file") {
      li.className = "tree-file";
      li.dataset.filename = entry.name;

      li.innerHTML = `
        <span class="file-name">${entry.name}</span>
        <span class="dirty-badge"></span>
      `;

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

function getElementFichierDOM(fileName) {
  return document.querySelector(
    `.tree-file[data-filename="${CSS.escape(fileName)}"]`,
  );
}

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

async function basculerVersFichier(fileHandle, fileName) {
  if (currentFileName && openFiles.has(currentFileName)) {
    openFiles.get(currentFileName).state = view.state;
  }

  currentFileName = fileName;

  if (!openFiles.has(fileName)) {
    const file = await fileHandle.getFile();
    const diskContent = await file.text();

    const fileYText = ydoc.getText(`file:${fileName}`);

    if (fileYText.toString() === "" && diskContent !== "") {
      ydoc.transact(() => {
        fileYText.insert(0, diskContent);
      });
    }

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const fileData = openFiles.get(fileName);
        if (fileData) {
          const currentText = update.state.doc.toString();
          fileData.isDirty = currentText !== fileData.originalContent;
          mettreAJourPastille(fileName, fileData.isDirty);
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

  const session = openFiles.get(fileName);
  view.setState(session.state);

  mettreAJourPastille(fileName, session.isDirty);
}

async function enregistrerFichierSilencieux() {
  if (!currentFileName || !openFiles.has(currentFileName)) return;

  const session = openFiles.get(currentFileName);

  try {
    const contentToSave = view.state.doc.toString();

    const writable = await session.handle.createWritable();
    await writable.write(contentToSave);
    await writable.close();

    session.originalContent = contentToSave;
    session.isDirty = false;

    mettreAJourPastille(currentFileName, false);

    console.log(`Fichier ${currentFileName} enregistré avec succès.`);
  } catch (error) {
    console.error("Erreur lors de l'enregistrement :", error);
  }
}

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
// 6. TERMINAL XTERM.JS
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
