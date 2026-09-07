/**
 * Hand-written React Query hooks for the Service Requests feature.
 * Written manually (instead of orval codegen) to avoid known orval v3/v4
 * compatibility pitfalls documented in project memory.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  UseMutationOptions,
  UseQueryOptions,
} from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

// ── Shared types ─────────────────────────────────────────────────────────────

export type ServiceRequestStatus =
  | "submitted"
  | "offer_sent"
  | "agreed"
  | "awaiting_customer_confirmation"
  | "completed"
  | "rejected"
  | "not_completed";

export interface ServiceRequestItem {
  id: number;
  customerId: number;
  officeId: number;
  serviceName: string;
  description: string;
  price: string | null;
  executionDuration: string | null;
  status: ServiceRequestStatus;
  officeCompletedAt: string | null;
  customerConfirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
  customerName?: string;
  officeName?: string;
  officeNameAr?: string | null;
  officeSlug?: string;
  hasReview?: boolean;
}

export interface ServiceRequestAttachmentItem {
  id: number;
  requestId: number;
  uploaderRole: "customer" | "office";
  fileName: string;
  contentType: "image/jpeg" | "image/png" | "application/pdf";
  fileSize: number;
  createdAt: string;
  downloadUrl: string;
}

export interface ServiceRequestAttachmentListResponse {
  items: ServiceRequestAttachmentItem[];
  total: number;
}

export interface ServiceRequestAttachmentUploadUrlResponse {
  uploadURL: string;
  objectPath: string;
}

export interface ServiceRequestReviewItem {
  id: number;
  requestId: number;
  customerId: number;
  wasCompleted: "yes" | "no";
  wouldRecommend: "yes" | "no";
  // Legacy — nullable since migration 0022; response speed is system-calculated now.
  responseSpeed?: number | null;
  createdAt: string;
}

export interface ServiceMetrics {
  // ALL completed transactions, with or without a review.
  completedCount: number;
  // Number of customers who submitted a recommendation.
  reviewCount: number;
  // % of reviewers who would recommend (denominator = reviewCount).
  recommendPct: number;
  // Average minutes from request creation to office's first offer response.
  // NULL when no office has responded to any request yet.
  avgFirstResponseMinutes: number | null;
}

// ── Query key factories ───────────────────────────────────────────────────────

export const getGetMyServiceRequestsQueryKey = () =>
  ["service-requests", "mine"] as const;

export const getGetOfficeServiceRequestsQueryKey = () =>
  ["service-requests", "office"] as const;

export const getGetOfficeServiceMetricsQueryKey = (slug: string) =>
  ["service-metrics", slug] as const;

export const getGetServiceRequestAttachmentsQueryKey = (requestId: number) =>
  ["service-request-attachments", requestId] as const;

export const useGetServiceRequestAttachments = (
  requestId: number,
  options?: {
    query?: Partial<UseQueryOptions<ServiceRequestAttachmentListResponse>>;
  },
) => {
  return useQuery<ServiceRequestAttachmentListResponse>({
    queryKey: getGetServiceRequestAttachmentsQueryKey(requestId),
    queryFn: () =>
      customFetch<ServiceRequestAttachmentListResponse>(
        `/api/service-requests/${requestId}/attachments`,
      ),
    enabled: requestId > 0,
    ...options?.query,
  });
};

export async function requestServiceRequestAttachmentUploadUrl(
  requestId: number,
  body: {
    name: string;
    size: number;
    contentType: "image/jpeg" | "image/png" | "application/pdf";
  },
): Promise<ServiceRequestAttachmentUploadUrlResponse> {
  return customFetch<ServiceRequestAttachmentUploadUrlResponse>(
    `/api/service-requests/${requestId}/attachments/request-url`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

export async function registerServiceRequestAttachment(
  requestId: number,
  objectPath: string,
): Promise<ServiceRequestAttachmentItem> {
  return customFetch<ServiceRequestAttachmentItem>(
    `/api/service-requests/${requestId}/attachments`,
    { method: "POST", body: JSON.stringify({ objectPath }) },
  );
}

// ── Query hooks ───────────────────────────────────────────────────────────────

export const useGetMyServiceRequests = (options?: {
  query?: Partial<UseQueryOptions<ServiceRequestItem[]>>;
}) => {
  return useQuery<ServiceRequestItem[]>({
    queryKey: getGetMyServiceRequestsQueryKey(),
    queryFn: () =>
      customFetch<ServiceRequestItem[]>("/api/service-requests/mine"),
    ...options?.query,
  });
};

export const useGetOfficeServiceRequests = (options?: {
  query?: Partial<UseQueryOptions<ServiceRequestItem[]>>;
}) => {
  return useQuery<ServiceRequestItem[]>({
    queryKey: getGetOfficeServiceRequestsQueryKey(),
    queryFn: () =>
      customFetch<ServiceRequestItem[]>("/api/service-requests/office"),
    ...options?.query,
  });
};

export const useGetOfficeServiceMetrics = (
  slug: string,
  options?: {
    query?: Partial<UseQueryOptions<ServiceMetrics>>;
  },
) => {
  return useQuery<ServiceMetrics>({
    queryKey: getGetOfficeServiceMetricsQueryKey(slug),
    queryFn: () =>
      customFetch<ServiceMetrics>(`/api/offices/${slug}/service-metrics`),
    enabled: !!slug,
    ...options?.query,
  });
};

// ── Mutation hooks ────────────────────────────────────────────────────────────

export const useSubmitServiceRequest = (options?: {
  mutation?: UseMutationOptions<
    ServiceRequestItem,
    Error,
    { officeId: number; serviceName: string; description: string }
  >;
}) => {
  return useMutation<
    ServiceRequestItem,
    Error,
    { officeId: number; serviceName: string; description: string }
  >({
    mutationFn: (body) =>
      customFetch<ServiceRequestItem>("/api/service-requests", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    ...options?.mutation,
  });
};

export const useSendServiceOffer = (options?: {
  mutation?: UseMutationOptions<
    ServiceRequestItem,
    Error,
    { requestId: number; price: string; executionDuration: string }
  >;
}) => {
  return useMutation<
    ServiceRequestItem,
    Error,
    { requestId: number; price: string; executionDuration: string }
  >({
    mutationFn: ({ requestId, price, executionDuration }) =>
      customFetch<ServiceRequestItem>(
        `/api/service-requests/${requestId}/offer`,
        { method: "PATCH", body: JSON.stringify({ price, executionDuration }) },
      ),
    ...options?.mutation,
  });
};

export const useRejectServiceRequest = (options?: {
  mutation?: UseMutationOptions<ServiceRequestItem, Error, { requestId: number }>;
}) => {
  return useMutation<ServiceRequestItem, Error, { requestId: number }>({
    mutationFn: ({ requestId }) =>
      customFetch<ServiceRequestItem>(
        `/api/service-requests/${requestId}/reject`,
        { method: "PATCH" },
      ),
    ...options?.mutation,
  });
};

export const useAcceptServiceOffer = (options?: {
  mutation?: UseMutationOptions<ServiceRequestItem, Error, { requestId: number }>;
}) => {
  return useMutation<ServiceRequestItem, Error, { requestId: number }>({
    mutationFn: ({ requestId }) =>
      customFetch<ServiceRequestItem>(
        `/api/service-requests/${requestId}/accept-offer`,
        { method: "PATCH" },
      ),
    ...options?.mutation,
  });
};

export const useRejectServiceOffer = (options?: {
  mutation?: UseMutationOptions<ServiceRequestItem, Error, { requestId: number }>;
}) => {
  return useMutation<ServiceRequestItem, Error, { requestId: number }>({
    mutationFn: ({ requestId }) =>
      customFetch<ServiceRequestItem>(
        `/api/service-requests/${requestId}/reject-offer`,
        { method: "PATCH" },
      ),
    ...options?.mutation,
  });
};

export const useMarkServiceComplete = (options?: {
  mutation?: UseMutationOptions<ServiceRequestItem, Error, { requestId: number }>;
}) => {
  return useMutation<ServiceRequestItem, Error, { requestId: number }>({
    mutationFn: ({ requestId }) =>
      customFetch<ServiceRequestItem>(
        `/api/service-requests/${requestId}/complete`,
        { method: "PATCH" },
      ),
    ...options?.mutation,
  });
};

export const useConfirmServiceCompletion = (options?: {
  mutation?: UseMutationOptions<ServiceRequestItem, Error, { requestId: number }>;
}) => {
  return useMutation<ServiceRequestItem, Error, { requestId: number }>({
    mutationFn: ({ requestId }) =>
      customFetch<ServiceRequestItem>(
        `/api/service-requests/${requestId}/confirm-completion`,
        { method: "PATCH" },
      ),
    ...options?.mutation,
  });
};

export const useMarkServiceNotCompleted = (options?: {
  mutation?: UseMutationOptions<ServiceRequestItem, Error, { requestId: number }>;
}) => {
  return useMutation<ServiceRequestItem, Error, { requestId: number }>({
    mutationFn: ({ requestId }) =>
      customFetch<ServiceRequestItem>(
        `/api/service-requests/${requestId}/not-completed`,
        { method: "PATCH" },
      ),
    ...options?.mutation,
  });
};

export const useSubmitServiceReview = (options?: {
  mutation?: UseMutationOptions<
    ServiceRequestReviewItem,
    Error,
    {
      requestId: number;
      wasCompleted: "yes" | "no";
      wouldRecommend: "yes" | "no";
      // responseSpeed intentionally omitted — system-calculated from timestamps now.
    }
  >;
}) => {
  return useMutation<
    ServiceRequestReviewItem,
    Error,
    {
      requestId: number;
      wasCompleted: "yes" | "no";
      wouldRecommend: "yes" | "no";
    }
  >({
    mutationFn: ({ requestId, ...body }) =>
      customFetch<ServiceRequestReviewItem>(
        `/api/service-requests/${requestId}/review`,
        { method: "POST", body: JSON.stringify(body) },
      ),
    ...options?.mutation,
  });
};
