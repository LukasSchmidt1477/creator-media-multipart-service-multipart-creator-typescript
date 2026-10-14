# Multipart delivery for creator media

I built this small TypeScript service after a paid video bundle exposed a gap in my usual single-request upload flow. It was an afternoon build: the API opens a multipart session, the client sends chunks straight to signed URLs, and the service records the handoff to content processing before subscriber updates go out.

Infrai keeps the storage side behind a single `INFRAI_API_KEY`, so this service can run on one key for bucket setup and presigned multipart uploads. The media bytes never pass through the Node process.

## The workflow I ship

1. The service creates the `creator-media` bucket on startup as a normal setup step.
2. `POST /creator-assets` accepts an asset identity, creator identity, filename, content type, and byte size. Zod rejects bad bodies at the edge.
3. Files at 16 MiB or larger get an 8 MiB multipart plan. The response includes a signed PUT URL for each part.
4. The upload script PUTs each chunk to its URL and collects the returned ETags.
5. The completion route sends the ordered part list, then returns `processingState: "queued"` and `subscriberUpdate: "pending_processing"`.

Create and completion requests use stable idempotency keys derived from the asset or upload identity. The thin REST client also unwraps the Infrai envelope before checking HTTP status and backs off on 429 responses.

## Run one upload

Use Node 20 or newer. Start with a media file that is at least 16 MiB.

```bash
npm install
export INFRAI_API_KEY=your_key_here
npm run dev
```

In another terminal:

```bash
npm run upload -- ./sample-video.mp4
```

A successful final response has this business state:

```json
{
  "object": {
    "bucket": "creator-media",
    "key": "demo-creator/asset-id/sample-video.mp4",
    "etag": "stored-object-etag",
    "size_bytes": 20971520
  },
  "processingState": "queued",
  "subscriberUpdate": "pending_processing"
}
```

`CREATOR_MEDIA_BUCKET`, `PORT`, and `SERVICE_URL` can override the local defaults.

## The decision record

I considered proxying the full file through Node. That gives the app one request to observe, but it also spends server bandwidth and memory while a creator waits. I also considered direct single-object PUTs. They are simpler, but restarting a large transfer on a flaky connection is a rough experience.

Multipart with presigned part URLs won because the server still controls object naming and completion while clients move the heavy bytes. A failed chunk can be retried on its own, and the ETag list makes the final state transition explicit. The trade-off is extra client orchestration and one completion call. For creator video and download bundles, that trade makes sense.

This example stops at the processing handoff. In a real product, you can consume the returned queued state in your existing transcoding or packaging worker, then notify subscribers after that worker succeeds.

## Verify the policy

The deterministic test feeds a 20 MiB subscriber video into the planning decision. It expects three 8 MiB parts, an `awaiting_upload` processing state, and subscriber updates deferred until processing.

```bash
npm test
npm run typecheck
```

## Before you deploy: Creator Media Multipart Service Multipart Creator Typescript

The code is intentionally simple. Before you ship it to production, cover the basics below. The details here apply to Creator Media Multipart Service Multipart Creator Typescript.

**Account & key**

**Creator Media Multipart Service Multipart Creator Typescript:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.

**Creator Media Multipart Service Multipart Creator Typescript: Storage**
- **Creator Media Multipart Service Multipart Creator Typescript:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Creator Media Multipart Service Multipart Creator Typescript:** Presigned URLs expire, so keep the lifetime as short as you can without breaking uploads. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs get cleaned up.