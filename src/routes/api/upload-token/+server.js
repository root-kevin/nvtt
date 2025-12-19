// src/routes/api/upload-token/+server.js
import { json } from '@sveltejs/kit';
import fs from 'fs/promises';
import path from 'path';

// Always resolve correctly in both dev + prod
const ROOT = process.cwd();
const STATIC_DIR = path.join(ROOT, 'static');
const UPLOAD_DIR = path.join(STATIC_DIR, 'tokens', 'uploads');

export async function POST({ request }) {
    try {
        const formData = await request.formData();
        const file = formData.get('file');

        if (!file || typeof file === 'string') {
            return json({ error: 'No file uploaded' }, { status: 400 });
        }

        // Convert file -> buffer
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Create folders if missing
        await fs.mkdir(UPLOAD_DIR, { recursive: true });

        // Sanitized filename
        const safeName = file.name.replace(/[^a-z0-9.\-_]/gi, '_');

        // Prevent caching + collisions
        const timestamp = Date.now();
        const random = Math.floor(Math.random() * 1_000_000);
        const filename = `${timestamp}_${random}_${safeName}`;

        const filePath = path.join(UPLOAD_DIR, filename);

        await fs.writeFile(filePath, buffer);

        // Public static path served by Vite/SvelteKit
        const src = `/tokens/uploads/${filename}`;

        return json({ src }, { status: 200 });

    } catch (err) {
        console.error("UPLOAD ERROR:", err);
        return json(
            { error: 'Upload failed', details: err.message },
            { status: 500 }
        );
    }
}
