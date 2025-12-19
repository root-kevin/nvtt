export function point(x, y) {
  return { x, y };
}

export function segment(a, b, meta = {}) {
  return { a, b, meta };
}
