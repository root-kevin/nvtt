function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
}

function toNumber(val) {
    if (typeof val === "number") return val;
    const parsed = parseInt(val, 10);
    return Number.isFinite(parsed) ? parsed : null;
}

function parseMaxHp(raw) {
    if (!raw) return 1;
    if (typeof raw.maxHp === "number") return raw.maxHp;
    if (typeof raw.hp === "number") return raw.hp;
    if (typeof raw.hp?.max === "number") return raw.hp.max;
    if (typeof raw.hp?.average === "number") return raw.hp.average;
    if (typeof raw.hp?.hp === "number") return raw.hp.hp;
    return 1;
}

export function computeHP(raw) {
    const maxHp = parseMaxHp(raw);
    const tempHp = toNumber(raw?.tempHp) || 0;
    const current = raw?.currentHp ?? raw?.hp?.current ?? raw?.hp ?? maxHp;
    const currentHp = clamp(toNumber(current) ?? maxHp, 0, maxHp + tempHp);

    return {
        maxHp,
        currentHp,
        tempHp
    };
}
