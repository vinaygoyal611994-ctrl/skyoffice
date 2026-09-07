import type { Language } from './i18n';

type ApiErrorLike = {
  status?: number;
  statusCode?: number;
  data?: unknown;
  message?: string;
  error?: string;
};

const AUTH_TEXT = /unauthori[sz]ed|forbidden|not authenticated|authentication required|session expired/i;
const NETWORK_TEXT = /failed to fetch|networkerror|network request failed|load failed/i;
const RAW_TECHNICAL_TEXT = /^\s*(?:\{|\[|<!doctype|<html)|\b(?:http|api error|status code|internal server error|syntaxerror|typeerror)\b/i;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

function errorStatus(error: unknown): number | undefined {
  const root = record(error) as ApiErrorLike | undefined;
  const data = record(root?.data);
  const candidate = root?.status ?? root?.statusCode ?? data?.status ?? data?.statusCode;
  return typeof candidate === 'number' ? candidate : undefined;
}

function errorText(error: unknown): string {
  if (typeof error === 'string') return error;
  const root = record(error) as ApiErrorLike | undefined;
  const data = record(root?.data);
  const candidates = [
    data?.messageAr,
    data?.messageEn,
    data?.message,
    data?.error,
    root?.error,
    root?.message,
  ];
  return candidates.find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim() ?? '';
}

/**
 * Converts API/network failures into safe, localized user-facing copy.
 * Backend payloads are intentionally never rendered verbatim.
 */
export function safeApiError(
  error: unknown,
  language: Language,
  fallback?: { ar: string; en: string },
): string {
  const status = errorStatus(error);
  const text = errorText(error);

  if (status === 401 || AUTH_TEXT.test(text)) {
    return language === 'ar'
      ? 'انتهت جلستك. يرجى تسجيل الدخول مرة أخرى.'
      : 'Your session has expired. Please sign in again.';
  }
  if (status === 403) {
    return language === 'ar'
      ? 'ليست لديك صلاحية لتنفيذ هذا الإجراء.'
      : 'You do not have permission to perform this action.';
  }
  if (status === 429) {
    return language === 'ar'
      ? 'تم إجراء محاولات كثيرة. يرجى الانتظار والمحاولة لاحقاً.'
      : 'Too many attempts. Please wait and try again.';
  }
  if (NETWORK_TEXT.test(text)) {
    return language === 'ar'
      ? 'تعذر الاتصال بالخادم. تحقق من اتصالك وحاول مرة أخرى.'
      : 'Unable to reach the server. Check your connection and try again.';
  }
  if ((status && status >= 500) || RAW_TECHNICAL_TEXT.test(text)) {
    return language === 'ar'
      ? 'تعذر إكمال الطلب الآن. يرجى المحاولة مرة أخرى.'
      : 'We could not complete the request. Please try again.';
  }

  const generic = fallback ?? {
    ar: 'تعذر إكمال الطلب. يرجى المحاولة مرة أخرى.',
    en: 'Unable to complete the request. Please try again.',
  };
  return language === 'ar' ? generic.ar : generic.en;
}