export function deriveHpState(entity = {}) {
    const baseMax = Number.isFinite(entity.maxHp)
        ? entity.maxHp
        : Number.isFinite(entity.baseMaxHp)
            ? entity.baseMaxHp
            : Number.isFinite(entity.hp)
                ? entity.hp
                : 1;

    const max = Math.max(1, baseMax ?? 1);
    const currentRaw = Number.isFinite(entity.currentHp) ? entity.currentHp : max;
    const current = Math.max(0, Math.min(currentRaw, max || currentRaw));
    const temp = Math.max(0, Number.isFinite(entity.tempHp) ? entity.tempHp : 0);

    // Maintain legacy keys (current, max, temp, eff) for existing callers.
    return {
        currentHp: current,
        maxHp: max,
        tempHp: temp,
        current,
        max,
        temp,
        eff: max + temp
    };
}

/**
 * patch may contain: damage, heal, setMax, setCurrent, setTemp
 */
export function applyHpPatch(entity = {}, patch = {}) {
    const base = deriveHpState(entity);

    let maxHp = base.maxHp;
    let currentHp = base.currentHp;
    let tempHp = base.tempHp;

    let maxHpIncreased = false;

    if (patch.setMax != null) {
        const nextMax = Math.max(0, +patch.setMax || 0);
        if (nextMax > maxHp) maxHpIncreased = true;
        maxHp = nextMax;
        if (currentHp > maxHp) currentHp = maxHp;
    }

    if (patch.setTemp != null) {
        tempHp = Math.max(0, +patch.setTemp || 0);
    }

    if (patch.setCurrent != null) {
        currentHp = Math.max(0, Math.min(maxHp, +patch.setCurrent || 0));
    } else {
        if (patch.damage != null) {
            let dmg = Math.max(0, +patch.damage || 0);
            if (tempHp > 0) {
                const absorb = Math.min(tempHp, dmg);
                tempHp -= absorb;
                dmg -= absorb;
            }
            if (dmg > 0) {
                currentHp = Math.max(0, currentHp - dmg);
            }
        }

        if (patch.heal != null) {
            const heal = Math.max(0, +patch.heal || 0);
            currentHp = Math.min(maxHp, currentHp + heal);
        }
    }

    // If we increased max and were at full (incl temp), bump current up to new full + temp
    if (maxHpIncreased) {
        const effBefore = (Number.isFinite(entity.currentHp) ? entity.currentHp : base.currentHp) + (Number.isFinite(entity.tempHp) ? entity.tempHp : base.tempHp);
        const effMaxBefore = base.maxHp + base.tempHp;
        if (effBefore >= effMaxBefore) {
            currentHp = maxHp;
        }
    }

    currentHp = Math.max(0, Math.min(currentHp, maxHp));

    return {
        currentHp,
        maxHp,
        tempHp
    };
}

// Compute initial HP for a template/token given overrides and bestiary data.
export function computeTemplateHp(template = {}) {
    const hpOvr = template.overrides?.hp || {};
    const bestiaryHp = template.bestiary?.hp || template.sheet?.hp || {};
    const consistent = !!template.consistentHp;

    const num = (v) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    };

    const baseMax =
        num(hpOvr.baseMaxHp) ??
        num(bestiaryHp.average) ??
        num(bestiaryHp.hp) ??
        num(bestiaryHp.maxHp) ??
        num(template.hp) ??
        num(template.maxHp) ??
        1;

    const maxHp = Math.max(1, baseMax);
    const currentHp = Math.max(
        0,
        Math.min(
            consistent
                ? (hpOvr.currentHp ?? maxHp)
                : (hpOvr.currentHp ?? maxHp),
            maxHp
        )
    );
    const tempHp = Math.max(0, hpOvr.tempHp ?? 0);

    return { maxHp, currentHp, tempHp };
}
