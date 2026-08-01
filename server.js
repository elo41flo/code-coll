import http from "http";
import { WebSocketServer } from "ws";
import { setupWSConnection } from "y-websocket/bin/utils";

// 1. Création d'un serveur HTTP basique
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Le serveur WebSocket Yjs est actif !");
});

// 2. Attachement du serveur WebSocket
const wss = new WebSocketServer({ server });

wss.on("connection", (conn, req) => {
  // y-websocket gère les rooms automatiquement via l'URL
  setupWSConnection(conn, req);
});

// 3. Lancement du serveur sur le port 1234
const PORT = 1234;
server.listen(PORT, () => {
  console.log(`🚀 Serveur Yjs prêt et à l'écoute sur ws://localhost:${PORT}`);
});
