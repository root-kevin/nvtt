// src/lib/vtt/tokens/size.js

// D&D 5e standard creature sizes
export const CREATURE_SIZES = [
    { label: "Tiny",        feet: 2.5 },
    { label: "Small",       feet: 5 },
    { label: "Medium",      feet: 5 },
    { label: "Large",       feet: 10 },
    { label: "Huge",        feet: 15 },
    { label: "Gargantuan",  feet: 20 }
];

// -------------------------------
// Canonical Label From Feet
// (used only as a fallback when we DON'T know the label)
// -------------------------------
export function inferLabelFromFeet(feet) {
    if (!feet) return "Medium";

    if (feet <= 2.5) return "Tiny";
    // 5 ft defaults to MEDIUM when we don't know more
    if (feet <= 5)   return "Medium";
    if (feet <= 10)  return "Large";
    if (feet <= 15)  return "Huge";
    if (feet <= 20)  return "Gargantuan";
    return "Gargantuan";
}

// -------------------------------
// Convert Feet → Pixels
// -------------------------------
export function feetToPixels(feet, gridSizePx) {
    return gridSizePx * (feet / 5);
}

// -------------------------------
// Convert Label → { feet, px, label }
// LABEL IS CANONICAL HERE
// -------------------------------
export function resolveTokenSize(label, customFeet, gridSizePx) {
    let feet;

    if (label === "Gargantuan") {
        feet = Math.max(20, Math.round((customFeet || 20) / 5) * 5);
    } else {
        const match = CREATURE_SIZES.find(s => s.label === label);
        feet = match?.feet ?? 5;
    }

    const px = feetToPixels(feet, gridSizePx);

    return {
        sizePx: px,
        sizeFeet: feet,
        sizeLabel: label      // ⬅️ DO NOT RE-INFER FROM FEET
    };
}
