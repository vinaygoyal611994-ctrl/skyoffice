export const SERVICE_REQUEST_ATTACHMENT_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "application/pdf",
] as const;

export type ServiceRequestAttachmentContentType =
  (typeof SERVICE_REQUEST_ATTACHMENT_CONTENT_TYPES)[number];

export const SERVICE_REQUEST_ATTACHMENT_MAX_FILES = 5;
export const SERVICE_REQUEST_ATTACHMENT_MAX_FILE_SIZE = 10 * 1024 * 1024;
export const SERVICE_REQUEST_ATTACHMENT_MAX_TOTAL_SIZE = 25 * 1024 * 1024;
export const SERVICE_REQUEST_ATTACHMENT_RESERVATION_TTL_MS = 5 * 60 * 1000;

export function isServiceRequestAttachmentContentType(
  value: string,
): value is ServiceRequestAttachmentContentType {
  return (SERVICE_REQUEST_ATTACHMENT_CONTENT_TYPES as readonly string[]).includes(value);
}

export function hasValidServiceRequestAttachmentSignature(
  contentType: string,
  bytes: Buffer,
): boolean {
  if (contentType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (contentType === "image/png") {
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    return bytes.subarray(0, signature.length).equals(signature);
  }
  if (contentType === "application/pdf") {
    return bytes.subarray(0, 5).equals(Buffer.from("%PDF-"));
  }
  return false;
}

export function safeAttachmentFileName(fileName: string): string {
  const baseName = fileName.split(/[\\/]/).pop() ?? "attachment";
  const cleaned = baseName.replace(/[^\w.\- ()[\]]/g, "_").trim();
  return (cleaned || "attachment").slice(0, 255);
}