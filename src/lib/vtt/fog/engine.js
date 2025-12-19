// Fog-of-war engine: maintains an in-memory canvas per map and supports
// painting/erasing with a soft circular brush, cover all, reveal all, and export/import as PNG.

const canvases = new Map(); // mapId -> { canvas, ctx }

function makeCanvas(width = 1, height = 1) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    return { canvas, ctx };
}

export function getCanvas(mapId, width, height) {
    const existing = canvases.get(mapId);
    if (existing) return existing;
    const entry = makeCanvas(width, height);
    canvases.set(mapId, entry);
    return entry;
}

export function clearCanvas(mapId) {
    canvases.delete(mapId);
}

export function coverAll(mapId, width, height, opacity = 1) {
    const { canvas, ctx } = getCanvas(mapId, width, height);
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = `rgba(0,0,0,${opacity})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    return canvas;
}

export function revealAll(mapId, width, height) {
    const { canvas, ctx } = getCanvas(mapId, width, height);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return canvas;
}

export function paint(mapId, width, height, options) {
    let { x, y, radius, opacity = 0.75, mode = "add" } = options;

    // 🚨 HARD GUARD — prevent NaN nukes
    if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        !Number.isFinite(radius) ||
        radius <= 0
    ) {
        return getCanvas(mapId, width, height);
    }

    const { canvas, ctx } = getCanvas(mapId, width, height);

    ctx.save();
    ctx.globalCompositeOperation =
        mode === "erase" ? "destination-out" : "source-over";

    const inner = Math.max(1, radius * 0.4);
    const outer = Math.max(inner + 1, radius);

    const g = ctx.createRadialGradient(
        x,
        y,
        inner,
        x,
        y,
        outer
    );

    if (mode === "erase") {
        g.addColorStop(0, "rgba(0,0,0,1)");
        g.addColorStop(1, "rgba(0,0,0,0)");
    } else {
        g.addColorStop(0, `rgba(0,0,0,${opacity})`);
        g.addColorStop(1, "rgba(0,0,0,0)");
    }

    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, outer, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    return { canvas, ctx };
}


export function exportPng(mapId) {
    const entry = canvases.get(mapId);
    if (!entry) return null;
    return entry.canvas.toDataURL("image/png");
}

export async function importPng(mapId, dataUrl, width, height) {
    const { canvas, ctx } = getCanvas(mapId, width, height);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!dataUrl) return canvas;
    try {
        const loadImage = (src) =>
            new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = reject;
                img.src = src;
            });
        let img;
        try {
            img = await loadImage(dataUrl);
        } catch {
            // retry once in case of transient decode issues
            img = await loadImage(dataUrl);
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    } catch (err) {
        console.warn("Failed to import fog image", err);
    }
    return canvas;
}
