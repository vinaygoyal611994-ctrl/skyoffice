import { z } from "zod";

// ── Status enum ──────────────────────────────────────────────────────────────

export const ServiceRequestStatusSchema = z.enum([
  "submitted",
  "offer_sent",
  "agreed",
  "awaiting_customer_confirmation",
  "completed",
  "rejected",
  "not_completed",
]);
export type ServiceRequestStatusType = z.infer<typeof ServiceRequestStatusSchema>;

// ── Shared item shape returned by list/action endpoints ──────────────────────

export const ServiceRequestItemSchema = z.object({
  id: z.number(),
  customerId: z.number(),
  officeId: z.number(),
  serviceName: z.string(),
  description: z.string(),
  price: z.string().nullable(),
  executionDuration: z.string().nullable(),
  status: ServiceRequestStatusSchema,
  officeCompletedAt: z.string().nullable(),
  customerConfirmedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  // Enriched – only present on the appropriate role's endpoint
  customerName: z.string().optional(),
  officeName: z.string().optional(),
  officeNameAr: z.string().nullable().optional(),
  officeSlug: z.string().optional(),
  hasReview: z.boolean().optional(),
});
export type ServiceRequestItem = z.infer<typeof ServiceRequestItemSchema>;

// ── Request bodies ────────────────────────────────────────────────────────────

export const SubmitServiceRequestBody = z.object({
  officeId: z.number().int().positive(),
  serviceName: z.string().min(1).max(200),
  description: z.string().min(1).max(1000),
});
export type SubmitServiceRequestBodyType = z.infer<typeof SubmitServiceRequestBody>;

export const SendOfferBody = z.object({
  price: z.string().min(1).max(200),
  executionDuration: z.string().min(1).max(200),
});
export type SendOfferBodyType = z.infer<typeof SendOfferBody>;

export const ServiceRequestAttachmentContentTypeSchema = z.enum([
  "image/jpeg",
  "image/png",
  "application/pdf",
]);
export type ServiceRequestAttachmentContentType = z.infer<
  typeof ServiceRequestAttachmentContentTypeSchema
>;

export const RequestServiceRequestAttachmentUploadUrlBody = z.object({
  name: z.string().min(1).max(255),
  size: z.number().int().positive(),
  contentType: ServiceRequestAttachmentContentTypeSchema,
});
export type RequestServiceRequestAttachmentUploadUrlBodyType = z.infer<
  typeof RequestServiceRequestAttachmentUploadUrlBody
>;

export const RegisterServiceRequestAttachmentBody = z.object({
  objectPath: z.string().regex(/^\/objects\/[A-Za-z0-9._/-]+$/).max(500),
});
export type RegisterServiceRequestAttachmentBodyType = z.infer<
  typeof RegisterServiceRequestAttachmentBody
>;

// responseSpeed removed: response speed is now system-calculated from
// first_response_at - created_at timestamps; not customer-reported.
export const SubmitServiceReviewBody = z.object({
  wasCompleted: z.enum(["yes", "no"]),
  wouldRecommend: z.enum(["yes", "no"]),
});
export type SubmitServiceReviewBodyType = z.infer<typeof SubmitServiceReviewBody>;

// ── Param schemas ─────────────────────────────────────────────────────────────

export const ServiceRequestIdParams = z.object({
  id: z.coerce.number().int().positive(),
});

export const ServiceRequestAttachmentIdParams = z.object({
  id: z.coerce.number().int().positive(),
  attachmentId: z.coerce.number().int().positive(),
});

export const ServiceMetricsSlugParams = z.object({
  slug: z.string().min(1).max(200),
});

// ── Response shapes ───────────────────────────────────────────────────────────

export const ListServiceRequestsResponse = z.array(ServiceRequestItemSchema);

export const ServiceRequestReviewItemSchema = z.object({
  id: z.number(),
  requestId: z.number(),
  customerId: z.number(),
  wasCompleted: z.enum(["yes", "no"]),
  wouldRecommend: z.enum(["yes", "no"]),
  // Nullable since migration 0022 (legacy field — system calculates response
  // speed automatically from first_response_at timestamps now).
  responseSpeed: z.number().nullable().optional(),
  createdAt: z.string(),
});
export type ServiceRequestReviewItem = z.infer<typeof ServiceRequestReviewItemSchema>;

export const ServiceMetricsResponseSchema = z.object({
  // Total completed transactions (with or without reviews).
  completedCount: z.number(),
  // Count of customers who submitted a review.
  reviewCount: z.number(),
  // Percentage of reviewers who would recommend (0–100). Based on review
  // submissions only — denominator is reviewCount, not completedCount.
  recommendPct: z.number(),
  // Average minutes from request creation to office's first offer response.
  // NULL when no office has yet responded to any request (no first_response_at).
  avgFirstResponseMinutes: z.number().nullable(),
});
export type ServiceMetricsResponse = z.infer<typeof ServiceMetricsResponseSchema>;
