// src/routes/api/state/+server.js
import { json } from '@sveltejs/kit';
import fs from 'fs/promises';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'vtt-state.json');

const DEFAULT_STATE = {
    tokens: [],
    tokenLibrary: [],
    sharedHp: {},
    fog: {}
};

async function ensureState() {
    await fs.mkdir(DATA_DIR, { recursive: true });
    try {
        const raw = await fs.readFile(DATA_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        return normalize(parsed);
    } catch {
        await fs.writeFile(DATA_FILE, JSON.stringify(DEFAULT_STATE, null, 2), 'utf8');
        return { ...DEFAULT_STATE };
    }
}

function normalize(state) {
    const tokens = Array.isArray(state?.tokens) ? state.tokens : [];
    const tokenLibrary = Array.isArray(state?.tokenLibrary) ? state.tokenLibrary : [];
    const sharedHp = state?.sharedHp && typeof state.sharedHp === 'object' ? state.sharedHp : {};
    const fog = state?.fog && typeof state.fog === 'object' ? state.fog : {};
    return { tokens, tokenLibrary, sharedHp, fog };
}

async function saveState(state) {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify(normalize(state), null, 2), 'utf8');
}

export async function GET() {
    const state = await ensureState();
    return json(state);
}

export async function POST({ request }) {
    const incoming = await request.json();
    const current = await ensureState();

    const next = normalize({
        tokens: Array.isArray(incoming?.tokens) ? incoming.tokens : current.tokens,
        tokenLibrary: Array.isArray(incoming?.tokenLibrary) ? incoming.tokenLibrary : current.tokenLibrary,
        sharedHp: incoming?.sharedHp && typeof incoming.sharedHp === 'object'
            ? incoming.sharedHp
            : current.sharedHp,
        fog: incoming?.fog && typeof incoming.fog === 'object'
            ? { ...current.fog, ...incoming.fog }
            : current.fog
    });

    await saveState(next);
    return json(next);
}
