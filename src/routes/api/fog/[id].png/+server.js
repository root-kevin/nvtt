import fs from "fs";
import path from "path";

const FOG_DIR = path.join(process.cwd(), "static", "fog");

function getFogPath(id) {
  return path.join(FOG_DIR, `${id}.png`);
}

// GET /api/fog/[id].png
export async function GET({ params }) {
  const id = params.id;
  const filePath = getFogPath(id);

  if (!fs.existsSync(filePath)) {
    return new Response("Not found", { status: 404 });
  }

  const data = await fs.promises.readFile(filePath);

  return new Response(data, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-cache"
    }
  });
}

// PUT /api/fog/[id].png
export async function PUT({ params, request }) {
  const id = params.id;
  const filePath = getFogPath(id);

  await fs.promises.mkdir(FOG_DIR, { recursive: true });

  const arrayBuffer = await request.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  await fs.promises.writeFile(filePath, buffer);

  return new Response(null, { status: 204 });
}
