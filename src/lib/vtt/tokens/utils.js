// src/lib/vtt/tokens/utils.js

// Temporary placeholder image
export const DEFAULT_TOKEN_IMG = "/goblin.png";

export function createToken(x, y) {
    return {
        id: crypto.randomUUID(),
        x,
        y,
        img: DEFAULT_TOKEN_IMG,
        name: "Goblin",
        size: 1  // grid units
    };
}

// gridSizePx passed from map
export function tokenPixelSize(token, gridSize) {
    return Math.round(gridSize * (token.size ?? 1));
}
