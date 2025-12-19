import fs from "fs/promises";
import path from "path";

const LIB_PATH = path.join(process.cwd(), "data", "library.json");

function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

function merge(target = {}, patch = {}) {
    const out = { ...target };
    Object.entries(patch || {}).forEach(([k, v]) => {
        if (v == null) return;
        if (typeof v === "object" && !Array.isArray(v)) {
            out[k] = merge(out[k] || {}, v);
        } else {
            out[k] = v;
        }
    });
    return out;
}

function migrateTemplate(t = {}) {
    const bestiary = clone(t.bestiary || t.sheet || {});
    const overrides = merge({}, t.overrides || {});

    const abilityKeys = ["str", "dex", "con", "int", "wis", "cha"];
    const abilityOverrides = merge({}, overrides.abilities || {});
    abilityKeys.forEach((key) => {
        if (t[key] != null) {
            abilityOverrides[key] = t[key];
        }
    });
    if (Object.keys(abilityOverrides).length) {
        overrides.abilities = abilityOverrides;
    }

    const hpOverrides = merge({}, overrides.hp || {});
    if (t.maxHp != null) hpOverrides.baseMaxHp = t.maxHp;
    if (t.tempHp != null) hpOverrides.tempHp = t.tempHp;
    if (t.currentHp != null) hpOverrides.currentHp = t.currentHp;
    if (Object.keys(hpOverrides).length) {
        overrides.hp = hpOverrides;
    }

    if (t.skills) {
        overrides.skills = merge(overrides.skills || {}, t.skills);
    }
    if (t.saves) {
        overrides.saves = merge(overrides.saves || {}, t.saves);
    }
    if (t.passives) {
        overrides.passives = merge(overrides.passives || {}, t.passives);
    }

    return {
        id: t.id,
        name: t.name,
        img: t.img,
        bestiary,
        overrides,
        templateSource: t.templateSource,
        baseTemplateId: t.baseTemplateId,
        originalName: t.originalName,
        notes: t.notes
    };
}

async function run() {
    const raw = await fs.readFile(LIB_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed?.library) ? parsed.library : [];
    const migrated = list.map(migrateTemplate);
    await fs.writeFile(
        LIB_PATH,
        JSON.stringify({ library: migrated }, null, 2),
        "utf-8"
    );
    console.log(`Migrated ${migrated.length} templates to overrides-only model.`);
}

run().catch((err) => {
    console.error("Migration failed", err);
    process.exit(1);
});
