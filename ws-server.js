// ws-server.js
import { WebSocketServer } from "ws";
import { loadMaps, normalizeMap } from "./src/lib/server/mapsStorage.js";
import { migrateTokensFromMapsIfNeeded, writeTokens } from "./src/lib/server/tokensStorage.js";

const PORT = 5174; // Do not conflict with Vite (5173)

const wss = new WebSocketServer({ port: PORT });

console.log(`WS SERVER: listening on ws://localhost:${PORT}`);

wss.on("connection", (socket) => {
    console.log("WS SERVER: client connected");

    socket.on("message", async (msg) => {
        const text = msg.toString();
        console.log("WS SERVER received:", text);
        let parsed;
        try {
            parsed = JSON.parse(text);
        } catch {
            parsed = null;
        }

        if (parsed && parsed.type === "fogUpdate" && parsed.mapId && parsed.png) {
            const maps = await loadMaps();
            const idx = maps.findIndex((m) => m.id === parsed.mapId);
            if (idx !== -1) {
                maps[idx] = normalizeMap({ ...maps[idx], fogPng: parsed.png });
                await saveMaps(maps);
                console.log("WS SERVER fogUpdate", parsed.mapId, "png length", parsed.png.length);
            } else {
                console.warn("WS SERVER fogUpdate: map not found", parsed.mapId);
            }
        }

        if (parsed && parsed.type === "tokensUpdate" && parsed.mapId && Array.isArray(parsed.tokens)) {
            await migrateTokensFromMapsIfNeeded();
            const maps = await loadMaps();
            const exists = maps.some(m => m?.id === parsed.mapId);
            if (exists) {
                await writeTokens(parsed.mapId, parsed.tokens);
                console.log("WS SERVER tokensUpdate", parsed.mapId, "count", parsed.tokens.length);
            } else {
                console.warn("WS SERVER tokensUpdate: map not found", parsed.mapId);
            }
        }

        // Broadcast to ALL connected clients
        for (const client of wss.clients) {
            if (client.readyState === 1) {
                client.send(text);
            }
        }
    });

    socket.on("close", () => {
        console.log("WS SERVER: client disconnected");
    });
});
