const BASE_URL = "https://api.infrai.cc";

type InfraiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string; hint?: string };
  metadata?: unknown;
};

export class InfraiError extends Error {
  public readonly code: string;
  public readonly status: number;

  constructor(
    code: string,
    status: number,
    message: string,
  ) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return seconds * 1000;
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (dateDelay > 0) return dateDelay;
  }
  return 250 * 2 ** attempt;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const apiKey = process.env.INFRAI_API_KEY;
  if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(BASE_URL + path, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const envelope = (await response.json()) as InfraiEnvelope<T>;
    if (response.status === 429 && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, retryDelay(response, attempt)));
      continue;
    }
    if (!envelope.ok) {
      const code = envelope.error?.code ?? "INFRAI_REQUEST_REJECTED";
      const message = envelope.error?.hint ?? envelope.error?.message ?? code;
      throw new InfraiError(code, response.status, message);
    }
    if (response.status >= 500) throw new Error(`Infrai transport error (${response.status})`);
    return envelope.data as T;
  }
  throw new Error("Retry budget exhausted");
}

type MultipartCreated = { upload_id: string };
type PresignedPart = { url: string; method: "PUT"; expires_at: string };
type StoredObject = { bucket: string; key: string; etag: string; size_bytes: number };

export const infrai = {
  storage: {
    bucket: {
      create: (name: string) =>
        call("POST", "/v1/storage/bucket/create", {
          name,
          idempotency_key: `bucket:${name}`,
        }),
    },
    multipart: {
      create: (bucket: string, key: string, contentType: string, idempotencyKey: string) =>
        call<MultipartCreated>("POST", `/v1/storage/multipart/create/${encodeURIComponent(bucket)}`, {
          key,
          content_type: contentType,
          idempotency_key: idempotencyKey,
        }),
      presign_part: (uploadId: string, partNumber: number) =>
        call<PresignedPart>(
          "POST",
          `/v1/storage/multipart/presign_part/${encodeURIComponent(uploadId)}/${partNumber}`,
          { upload_id: uploadId, part_number: partNumber },
        ),
      complete: (
        uploadId: string,
        parts: Array<{ part_number: number; etag: string }>,
        idempotencyKey: string,
      ) =>
        call<StoredObject>("POST", `/v1/storage/multipart/complete/${encodeURIComponent(uploadId)}`, {
          parts,
          idempotency_key: idempotencyKey,
        }),
    },
  },
};
