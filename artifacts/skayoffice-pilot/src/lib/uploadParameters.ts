import { getSessionToken } from '@/lib/sessionToken';

export function buildStoragePutParameters(uploadURL: string, contentType: string) {
  const headers: Record<string, string> = { 'Content-Type': contentType };
  const isLocalUpload = uploadURL.startsWith('/');

  // Autoscale strips this app's session cookie, so the authenticated relay
  // needs the same bearer token used by normal API requests. Never attach it
  // to an external signed-storage URL.
  if (isLocalUpload) {
    const token = getSessionToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  // Uppy parses the final upload response with new URL(), which requires an
  // absolute URL even though fetch itself accepts same-origin relative paths.
  const url = isLocalUpload
    ? new URL(uploadURL, window.location.origin).toString()
    : uploadURL;

  return { method: 'PUT' as const, url, headers };
}