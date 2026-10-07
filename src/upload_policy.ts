export const PART_BYTES = 8 * 1024 * 1024;
export const MULTIPART_THRESHOLD_BYTES = 16 * 1024 * 1024;

export type UploadPlan = {
  strategy: "multipart";
  partSize: number;
  partCount: number;
  processingState: "awaiting_upload";
  subscriberUpdate: "after_processing";
};

export function planCreatorUpload(sizeBytes: number): UploadPlan {
  if (sizeBytes < MULTIPART_THRESHOLD_BYTES) {
    throw new RangeError(`Creator assets must be at least ${MULTIPART_THRESHOLD_BYTES} bytes`);
  }
  return {
    strategy: "multipart",
    partSize: PART_BYTES,
    partCount: Math.ceil(sizeBytes / PART_BYTES),
    processingState: "awaiting_upload",
    subscriberUpdate: "after_processing",
  };
}
