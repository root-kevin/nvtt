Fog v2 overview
---------------
- Fog lives entirely in a per-map canvas (black at ~78% opacity).
- GM paints/erases with a soft circular brush on the client canvas.
- After each stroke, GM sends a WebSocket message `{ type: "fog-update", mapId, png }`.
- Player receives `fog-update` for the active map and draws the PNG onto their fog canvas.
- "Cover All" fills black, "Reveal All" clears the canvas.
- No localStorage is used; the state is only in memory and over WS.
