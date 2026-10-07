import { open, stat } from "node:fs/promises";
import { basename } from "node:path";
import { randomUUID } from "node:crypto";

const path = process.argv[2];
if (!path) throw new Error("Run: npm run upload -- <media-file>");

const serviceUrl = process.env.SERVICE_URL ?? "http://localhost:3000";
const file = await stat(path);
const assetId = randomUUID();
const started = await fetch(`${serviceUrl}/creator-assets`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    assetId,
    creatorId: "demo-creator",
    filename: basename(path),
    contentType: "application/octet-stream",
    sizeBytes: file.size,
  }),
});
if (!started.ok) throw new Error(await started.text());
const session = (await started.json()) as {
  uploadId: string;
  partSize: number;
  parts: Array<{ partNumber: number; uploadUrl: string; method: "PUT" }>;
};

const handle = await open(path, "r");
const completed: Array<{ partNumber: number; etag: string }> = [];
try {
  for (const part of session.parts) {
    const buffer = Buffer.alloc(Math.min(session.partSize, file.size - (part.partNumber - 1) * session.partSize));
    await handle.read(buffer, 0, buffer.length, (part.partNumber - 1) * session.partSize);
    const uploaded = await fetch(part.uploadUrl, { method: part.method, body: buffer });
    if (!uploaded.ok) throw new Error(`Part ${part.partNumber} upload failed`);
    const etag = uploaded.headers.get("etag");
    if (!etag) throw new Error(`Part ${part.partNumber} response did not include an ETag`);
    completed.push({ partNumber: part.partNumber, etag });
  }
} finally {
  await handle.close();
}

const finished = await fetch(`${serviceUrl}/creator-assets/${encodeURIComponent(session.uploadId)}/complete`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ parts: completed }),
});
if (!finished.ok) throw new Error(await finished.text());
console.log(JSON.stringify(await finished.json(), null, 2));
