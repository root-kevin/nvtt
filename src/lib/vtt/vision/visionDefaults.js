export function defaultVision(overrides = {}) {
  return {
    isPlayer: false,
    hasVision: true,
    hasDarkvision: false,
    darkvisionDistance: 60,
    ...overrides
  };
}
