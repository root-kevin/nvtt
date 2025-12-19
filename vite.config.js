import { sveltekit } from '@sveltejs/kit/vite';
import { WebSocketServer } from 'ws';

function websocketPlugin() {
    let wss;

    return {
        name: 'vtt-websocket-plugin',

        configureServer(server) {
            // Create a single WebSocket server for Vite dev mode
            if (!wss) {
                wss = new WebSocketServer({ noServer: true });
                console.log('[WS] WebSocket server initialized (via Vite)');
            }

            // Intercept only upgrade requests to /ws
            server.httpServer.on('upgrade', (req, socket, head) => {
                if (req.url === '/ws') {
                    wss.handleUpgrade(req, socket, head, (ws) => {
                        wss.emit('connection', ws, req);
                    });

                    return;
                }
            });

            // When a client connects
            wss.on('connection', (ws) => {
                console.log('[WS] Client connected');

                ws.on('message', (data) => {
                    const message =
                        typeof data === 'string' ? data : data.toString('utf8');

                    // Broadcast to all clients
                    wss.clients.forEach((client) => {
                        if (client.readyState === 1) {
                            client.send(message);
                        }
                    });
                });

                ws.on('close', () => {
                    console.log('[WS] Client disconnected');
                });
            });
        }
    };
}

export default {
    plugins: [websocketPlugin(), sveltekit()]
};
