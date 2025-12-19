import { pan, zoomAt } from "../core/viewportStore.js";

export function setupPanZoom(el) {
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    el.addEventListener("mousedown", (e) => {
        dragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
    });

    window.addEventListener("mouseup", () => {
        dragging = false;
    });

    window.addEventListener("mousemove", (e) => {
        if (!dragging) return;

        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;

        pan(dx, dy);

        lastX = e.clientX;
        lastY = e.clientY;
    });

    el.addEventListener("wheel", (e) => {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 1.1 : 0.9;
        zoomAt({ x: e.clientX, y: e.clientY }, delta);
    });
}
