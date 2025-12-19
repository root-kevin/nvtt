let ws;
let fogUpdateHandler = null;

export function connectWS(onMessage) {
    if (typeof window === "undefined") return;
    if (ws) return;

    ws = new WebSocket(`ws://${location.hostname}:5174`);

    ws.onopen = () => console.log("WS connected!");
    ws.onerror = (err) => console.error("WS error:", err);

    ws.onmessage = (event) => {
        let data;
        try {
            data = JSON.parse(event.data);
        } catch (e) {
            console.error("WS parse error:", e);
            return;
        }

        // Fog update handling
        if (data.type === "fogUpdated" && fogUpdateHandler) {
            fogUpdateHandler(data.mapId);
        }

        onMessage?.(data);
    };
}

export function sendWS(data) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(data));
}

export function setFogUpdateHandler(fn) {
    fogUpdateHandler = fn;
}
