// terminal-server.js (Serveur Backend Node.js)
import { WebSocketServer } from "ws";
import pty from "node-pty";
import os from "os";

// Choix du shell (PowerShell pour Windows, bash pour Linux/Mac)
const shell = os.platform() === "win32" ? "powershell.exe" : "bash";

// Création du serveur WebSocket sur le port 3001
const wss = new WebSocketServer({ port: 3001 });

console.log("🚀 Serveur Terminal démarré sur ws://localhost:3001");

wss.on("connection", (ws) => {
  console.log("⚡ Client connecté au terminal !");

  // Lancement du VRAI terminal système via node-pty
  const ptyProcess = pty.spawn(shell, [], {
    name: "xterm-color",
    cols: 80,
    rows: 24,
    cwd: process.cwd(),
    env: process.env,
  });

  // Envoi des sorties du terminal au navigateur
  ptyProcess.onData((data) => {
    try {
      ws.send(data);
    } catch (err) {}
  });

  // Saisie du navigateur transmise au terminal
  ws.on("message", (message) => {
    ptyProcess.write(message.toString());
  });

  ws.on("close", () => {
    console.log("❌ Client déconnecté");
    ptyProcess.kill();
  });
});
