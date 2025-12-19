// src/lib/vtt/tokens/defaultVision.js
// Reusable default vision settings for all tokens

export function defaultVision(overrides = {}) {
  return {
    isPlayer: false,          // Can this token be selected as the player's view?
    hasVision: true,          // Does this creature have sight at all?
    hasDarkvision: false,     // Can see in darkness?
    darkvisionDistance: 200,   // In feet (standard D&D default)
    ...overrides
  };
}