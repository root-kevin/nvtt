import { WebSocketServer } from 'ws';

let wss;

export const handle = async ({ event, resolve }) => {
    if (!wss) {
        const server = event.platform?.server;

        if (server) {
            wss = new WebSocketServer({ server });
            console.log("[WS] WebSocket server initialized");

            wss.on('connection', (ws) => {
                console.log("[WS] Client connected");

                ws.on('message', (msg) => {
                    for (const client of wss.clients) {
                        if (client.readyState === 1) {
                            client.send(msg);
                        }
                    }
                });

                ws.on('close', () => {
                    console.log("[WS] Client disconnected");
                });
            });
        }
    }

    return resolve(event);
};
