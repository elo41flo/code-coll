import http from "http";
import { WebSocketServer } from "ws";
import pkg from "y-websocket/bin/utils";

// Extraction sécurisée de la fonction depuis le package CommonJS
const { setupWSConnection } = pkg;

// 1. Création du serveur HTTP
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("🚀 Le serveur WebSocket Yjs est actif !");
});

// 2. Attachement de WebSocketServer au serveur HTTP
const wss = new WebSocketServer({ server });

wss.on("connection", (conn, req) => {
  // Gestion d'erreur individuelle sur la socket pour éviter les crashs silencieux
  conn.on("error", (err) => console.error("Erreur WebSocket :", err));

  // y-websocket extrait automatiquement le nom de la room depuis l'URL de connexion
  setupWSConnection(conn, req);
});

// 3. Écoute sur le port d'environnement (Plesk/Passenger) ou 1234 en local
const PORT = process.env.PORT || 1234;

server.listen(PORT, () => {
  console.log(`🚀 Serveur Yjs prêt et à l'écoute sur le port ${PORT}`);
});
