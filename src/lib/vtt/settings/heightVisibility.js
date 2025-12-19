import { writable } from "svelte/store";

export const heightSettings = writable({
    enabled: true,              // Master toggle
    tokenEyeMultiplier: 0.9,    // Eye height = token height * 0.9 (head level)
    tokenHeightFeet: {          // Defaults by size
        Tiny: 2.5,
        Small: 5,
        Medium: 6,
        Large: 10,
        Huge: 15,
        Gargantuan: 20
    },
    coverThresholds: {          // % of LOS blocked
        half: 25,
        threeQuarters: 50,
        full: 75
    }
});