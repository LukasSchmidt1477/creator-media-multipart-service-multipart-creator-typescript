import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { z } from "zod";
import { infrai, InfraiError } from "./infrai_storage.js";
import { planCreatorUpload } from "./upload_policy.js";

const BUCKET = process.env.CREATOR_MEDIA_BUCKET ?? "creator-media";
const PORT = Number(process.env.PORT ?? 3000);

const startSchema = z.object({
  assetId: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/),
  creatorId: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/),
  filename: z.string().min(1).max(180).regex(/^[a-zA-Z0-9._-]+$/),
  contentType: z.string().min(1).max(100),
  sizeBytes: z.number().int().positive(),
});

const completeSchema = z.object({
  parts: z.array(z.object({ partNumber: z.number().int().positive(), etag: z.string().min(1) })).min(1),
});

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method === "POST" && request.url === "/creator-assets") {
    const input = startSchema.parse(await readJson(request));
    const plan = planCreatorUpload(input.sizeBytes);
    const key = `${input.creatorId}/${input.assetId}/${input.filename}`;
    const created = await infrai.storage.multipart.create(
      BUCKET,
      key,
      input.contentType,
      `asset:${input.assetId}:create`,
    );
    const parts = await Promise.all(
      Array.from({ length: plan.partCount }, async (_, index) => {
        const partNumber = index + 1;
        const signed = await infrai.storage.multipart.presign_part(created.upload_id, partNumber);
        return { partNumber, uploadUrl: signed.url, method: signed.method };
      }),
    );
    json(response, 201, { assetId: input.assetId, uploadId: created.upload_id, key, ...plan, parts });
    return;
  }

  const match = request.url?.match(/^\/creator-assets\/([^/]+)\/complete$/);
  if (request.method === "POST" && match) {
    const uploadId = decodeURIComponent(match[1]);
    const input = completeSchema.parse(await readJson(request));
    const stored = await infrai.storage.multipart.complete(
      uploadId,
      input.parts.map((part) => ({ part_number: part.partNumber, etag: part.etag })),
      `upload:${uploadId}:complete`,
    );
    json(response, 200, {
      object: stored,
      processingState: "queued",
      subscriberUpdate: "pending_processing",
    });
    return;
  }

  json(response, 404, { error: "Route not found" });
}

const server = createServer(async (request, response) => {
  try {
    await handle(request, response);
  } catch (error) {
    if (error instanceof z.ZodError) {
      json(response, 400, { error: "Invalid request", issues: error.issues });
    } else if (error instanceof InfraiError) {
      json(response, error.status >= 400 && error.status < 500 ? error.status : 502, {
        error: error.code,
        message: error.message,
      });
    } else {
      json(response, 500, { error: "Request failed" });
    }
  }
});

async function start(): Promise<void> {
  await infrai.storage.bucket.create(BUCKET);
  server.listen(PORT, () => {
    console.log(`Creator media service listening on http://localhost:${PORT}`);
  });
}

start().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Startup failed");
  process.exitCode = 1;
});
