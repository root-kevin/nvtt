// src/routes/api/upload-map/+server.js
import { json } from '@sveltejs/kit';
import fs from 'fs/promises';
import path from 'path';

const STATIC_DIR = path.join(process.cwd(), 'static');
const UPLOAD_DIR = path.join(STATIC_DIR, 'maps', 'uploads');

export async function POST({ request }) {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file || typeof file === 'string') {
        return json({ error: 'No file uploaded' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    await fs.mkdir(UPLOAD_DIR, { recursive: true });

    const safeName = file.name.replace(/[^a-z0-9.\-_]/gi, '_');
    const filename = `${Date.now()}_${safeName}`;
    const filePath = path.join(UPLOAD_DIR, filename);

    await fs.writeFile(filePath, buffer);

    const src = `/maps/uploads/${filename}`;
    return json({ src });
}
