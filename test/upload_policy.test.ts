import assert from "node:assert/strict";
import test from "node:test";
import { MULTIPART_THRESHOLD_BYTES, PART_BYTES, planCreatorUpload } from "../src/upload_policy.js";

test("a 20 MiB subscriber video is split into three resumable parts", () => {
  const plan = planCreatorUpload(20 * 1024 * 1024);
  assert.deepEqual(plan, {
    strategy: "multipart",
    partSize: PART_BYTES,
    partCount: 3,
    processingState: "awaiting_upload",
    subscriberUpdate: "after_processing",
  });
});

test("small assets stay outside this large-media route", () => {
  assert.throws(() => planCreatorUpload(MULTIPART_THRESHOLD_BYTES - 1), RangeError);
});
