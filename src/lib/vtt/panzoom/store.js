// src/lib/vtt/panzoom/store.js
import { writable, get } from "svelte/store";
import { tick } from "svelte";

export const pan = writable({ x: 0, y: 0 });
export const zoom = writable(1);
export const panMode = writable("none");

export function setPanTool(active) {
    panMode.set(active ? "tool" : "none");
}

const ZOOM_SPEED = 0.005;
const ZOOM_MIN = 0.05;
const ZOOM_MAX = 6.0;

export async function setupPanZoom(container) {
    await tick();

    // 🔑 INTERNAL STATE MIRRORS STORES (never resets)
    let p = { ...get(pan) };
    let z = get(zoom);

    const unsubPan = pan.subscribe(v => {
        if (v) p = { ...v };
    });
    const unsubZoom = zoom.subscribe(v => {
        if (Number.isFinite(v)) z = v;
    });

    let isPanning = false;
    let startX = 0;
    let startY = 0;

    let spaceHeld = false;
    let toolPan = false;

    const unsubMode = panMode.subscribe(mode => {
        toolPan = mode === "tool";
        if (!spaceHeld && !toolPan) container.style.cursor = "default";
    });

    function onKeyDown(e) {
        if (e.code === "Space") {
            spaceHeld = true;
            panMode.set("space");
            container.style.cursor = "grab";
        }
    }

    function onKeyUp(e) {
        if (e.code === "Space") {
            spaceHeld = false;
            panMode.set(toolPan ? "tool" : "none");
            container.style.cursor = toolPan ? "grab" : "default";
            isPanning = false;
        }
    }

    function onMouseDown(e) {
        if (!spaceHeld && !toolPan) return;
        isPanning = true;
        container.style.cursor = "grabbing";
        startX = e.clientX - p.x;
        startY = e.clientY - p.y;
    }

    function onMouseUp() {
        isPanning = false;
        container.style.cursor = spaceHeld || toolPan ? "grab" : "default";
    }

    function onMouseMove(e) {
        if (!isPanning) return;
        p.x = e.clientX - startX;
        p.y = e.clientY - startY;
        pan.set({ ...p });
    }

    function onWheel(e) {
        e.preventDefault();

        const rect = container.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;

        const dz = -Math.sign(e.deltaY) * ZOOM_SPEED;
        const nextZ = clamp(z + dz, ZOOM_MIN, ZOOM_MAX);
        const scale = nextZ / z;

        p.x = cx - (cx - p.x) * scale;
        p.y = cy - (cy - p.y) * scale;

        z = nextZ;

        pan.set({ ...p });
        zoom.set(z);
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("mousemove", onMouseMove);
    container.addEventListener("mousedown", onMouseDown);
    container.addEventListener("wheel", onWheel, { passive: false });

    // 🧹 CLEANUP
    return () => {
        unsubPan();
        unsubZoom();
        unsubMode();
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("keyup", onKeyUp);
        window.removeEventListener("mouseup", onMouseUp);
        window.removeEventListener("mousemove", onMouseMove);
        container.removeEventListener("mousedown", onMouseDown);
        container.removeEventListener("wheel", onWheel);
    };
}

function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
}
