export function logVision(label, payload) {
  if (!window.__VTT_DEBUG_VISION__) return;
  console.groupCollapsed(`👁️ Vision :: ${label}`);
  console.log(payload);
  console.groupEnd();
}
