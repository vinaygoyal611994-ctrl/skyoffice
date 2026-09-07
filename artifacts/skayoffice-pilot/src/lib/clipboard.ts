/**
 * Robust clipboard copy helper.
 *
 * Tries the modern `navigator.clipboard.writeText` API first. Some mobile
 * browsers (in-app webviews, some Android Chrome contexts, non-HTTPS/
 * embedded-preview contexts, or when clipboard permission is denied) reject
 * or simply lack that API, so this falls back to the legacy
 * `document.execCommand('copy')` technique via a temporary off-screen
 * textarea — the same trick used by most production copy-link buttons.
 *
 * Returns whether the copy actually succeeded, so callers must not tell the
 * user "copied" unless this resolves `true`.
 */
export async function copyTextRobust(text: string): Promise<boolean> {
  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === 'function'
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Clipboard API unavailable/denied/failed — fall through to legacy copy.
    }
  }

  if (typeof document === 'undefined') return false;

  let textarea: HTMLTextAreaElement | null = null;
  try {
    textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.readOnly = true;
    // Keep it in-flow but visually and interactively off-screen so it never
    // flashes on screen or steals layout, while still being selectable
    // (some browsers refuse to select content in display:none elements).
    textarea.style.position = 'fixed';
    textarea.style.top = '0';
    textarea.style.left = '-9999px';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);

    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);

    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    if (textarea) {
      textarea.remove();
    }
  }
}
