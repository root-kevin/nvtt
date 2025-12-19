// Utilities for extracting Armor Class from varying bestiary formats.
export function extractAc(raw) {
    if (raw == null) return { ac: null, from: null };

    const entries = Array.isArray(raw) ? raw : [raw];

    for (const entry of entries) {
        if (typeof entry === "number") return { ac: entry, from: null };
        if (entry == null) continue;
        if (typeof entry === "object") {
            if (typeof entry.ac === "number") {
                const from = Array.isArray(entry.from)
                    ? entry.from.filter(Boolean).join(", ")
                    : typeof entry.from === "string"
                        ? entry.from
                        : null;
                return { ac: entry.ac, from: from || null };
            }
        }
    }

    return { ac: null, from: null };
}
