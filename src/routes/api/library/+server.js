// src/routes/api/library/+server.js
import { json, error } from "@sveltejs/kit";
import fs from "fs/promises";
import path from "path";

const LIB_PATH = path.join(process.cwd(), "data", "library.json");

/* ------------------------------
   Helpers
------------------------------ */
function cleanTemplate(t = {}) {
    return {
        id: t.id,
        name: t.name,
        img: t.img,
        bestiary: t.bestiary || t.sheet || null,
        overrides: t.overrides || {},
        templateSource: t.templateSource,
        baseTemplateId: t.baseTemplateId,
        originalName: t.originalName,
        notes: t.notes,
        customized: !!t.customized
    };
}

async function loadLibrary() {
    try {
        const raw = await fs.readFile(LIB_PATH, "utf-8");
        const parsed = JSON.parse(raw);
        const list = Array.isArray(parsed?.library) ? parsed.library : [];
        return list.map(cleanTemplate);
    } catch (err) {
        if (err.code === "ENOENT") {
            await saveLibrary([]); // create empty file
            return [];
        }
        console.warn("Failed to load library.json", err);
        return [];
    }
}

async function saveLibrary(list) {
    await fs.mkdir(path.dirname(LIB_PATH), { recursive: true });
    await fs.writeFile(
        LIB_PATH,
        JSON.stringify({ library: list.map(cleanTemplate) }, null, 2),
        "utf-8"
    );
}

/* ------------------------------
   ENDPOINTS
------------------------------ */

export async function GET() {
    const lib = await loadLibrary();
    return json(lib);
}

export async function POST({ request }) {
    const patch = cleanTemplate(await request.json());
    if (!patch.id) throw error(400, "Template requires id");

    const lib = await loadLibrary();
    const idx = lib.findIndex(t => t.id === patch.id);

    if (idx === -1) {
        // New entry → just store
        lib.push(patch);
    } else {
        lib[idx] = cleanTemplate({ ...lib[idx], ...patch });
    }

    await saveLibrary(lib);
    return json({ ok: true, template: lib[idx] });
}


export async function PUT({ request }) {
    const patch = cleanTemplate(await request.json());
    if (!patch.id) throw error(400, "Template requires id");

    const lib = await loadLibrary();
    const idx = lib.findIndex(t => t.id === patch.id);

    if (idx === -1) {
        throw error(404, "Template not found");
    }

    lib[idx] = cleanTemplate({ ...lib[idx], ...patch });

    await saveLibrary(lib);
    return json({ ok: true, template: lib[idx] });
}


export async function DELETE({ request }) {
    const { id } = await request.json();
    if (!id) throw error(400, "Missing id");

    const lib = await loadLibrary();
    const next = lib.filter(t => t.id !== id);
    await saveLibrary(next);

    return json({ ok: true });
}
