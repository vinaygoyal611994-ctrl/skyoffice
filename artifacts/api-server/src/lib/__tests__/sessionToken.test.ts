/**
 * sessionToken — storage hardening tests (Blocker 3).
 *
 * Verifies that the sessionToken module (artifacts/skayoffice-pilot/src/lib/sessionToken.ts)
 * uses sessionStorage-only persistence after the localStorage mirror was removed.
 *
 * Key properties verified:
 *  A) setSessionToken writes ONLY to sessionStorage; localStorage is never written
 *  B) getSessionToken reads ONLY from sessionStorage; localStorage is never read
 *  C) clearSessionToken (and setSessionToken(null)) removes the key from sessionStorage
 *     and does NOT touch localStorage
 *  D) captureSessionToken stores only string tokens; non-string or absent values are ignored
 *  E) authFetch attaches `Authorization: Bearer <token>` when a token is set
 *  F) authFetch does NOT attach an Authorization header when no token is stored
 *  G) authFetch does not override an already-present Authorization header
 *  H) getSessionToken returns null when sessionStorage is empty (no cross-storage fallback)
 *  I) setSessionToken/getSessionToken are no-ops when storage is unavailable (private mode)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const productionModuleUrl = pathToFileURL(resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../skayoffice-pilot/src/lib/sessionToken.ts",
)).href;

const {
  authFetch,
  captureSessionToken,
  clearSessionToken,
  getSessionToken,
  setSessionToken,
} = await import(productionModuleUrl);

// The test imports the actual pilot implementation. The browser globals it
// uses are supplied by the test so this security-sensitive code is not
// reimplemented in the test itself.

const STORAGE_KEY = "skayoffice.sessionToken";

// ---------------------------------------------------------------------------
// Storage mock factory
// ---------------------------------------------------------------------------

function makeStorageMock() {
  const store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      for (const k of Object.keys(store)) delete store[k];
    }),
    get _store() { return store; },
  };
}

let mockSessionStorage: ReturnType<typeof makeStorageMock>;
let mockLocalStorage: ReturnType<typeof makeStorageMock>;

beforeEach(() => {
  mockSessionStorage = makeStorageMock();
  mockLocalStorage = makeStorageMock();
  vi.stubGlobal("window", {
    sessionStorage: mockSessionStorage,
    localStorage: mockLocalStorage,
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("ok")));
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function lastRequestHeaders(): Headers {
  const call = vi.mocked(globalThis.fetch).mock.calls.at(-1);
  return new Headers(call?.[1]?.headers);
}

// ===========================================================================
// A) setSessionToken writes ONLY to sessionStorage
// ===========================================================================

describe("setSessionToken — storage isolation", () => {
  it("writes to sessionStorage when a token is provided", () => {
    setSessionToken("test-token-abc");

    expect(mockSessionStorage.setItem).toHaveBeenCalledOnce();
    expect(mockSessionStorage.setItem).toHaveBeenCalledWith(STORAGE_KEY, "test-token-abc");
  });

  it("NEVER writes to localStorage (long-lived persistence eliminated)", () => {
    setSessionToken("test-token-abc");

    // localStorage must never be touched
    expect(mockLocalStorage.setItem).not.toHaveBeenCalled();
    expect(mockLocalStorage.removeItem).not.toHaveBeenCalled();
  });

  it("removes key from sessionStorage when token is null", () => {
    setSessionToken(null);

    expect(mockSessionStorage.removeItem).toHaveBeenCalledWith(STORAGE_KEY);
    expect(mockSessionStorage.setItem).not.toHaveBeenCalled();
  });

  it("removes key from sessionStorage when token is undefined", () => {
    setSessionToken(undefined);

    expect(mockSessionStorage.removeItem).toHaveBeenCalledWith(STORAGE_KEY);
  });

  it("NEVER removes from localStorage on clear (no cross-storage cleanup needed)", () => {
    setSessionToken(null);

    expect(mockLocalStorage.removeItem).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// B) getSessionToken reads ONLY from sessionStorage
// ===========================================================================

describe("getSessionToken — storage isolation", () => {
  it("returns the token from sessionStorage", () => {
    mockSessionStorage._store[STORAGE_KEY] = "session-only-token";

    const token = getSessionToken();

    expect(token).toBe("session-only-token");
    expect(mockSessionStorage.getItem).toHaveBeenCalledWith(STORAGE_KEY);
  });

  it("NEVER reads from localStorage (no cross-tab bridge)", () => {
    // localStorage has a token but sessionStorage is empty
    mockLocalStorage._store[STORAGE_KEY] = "local-token";

    const token = getSessionToken();

    // Should return null — sessionStorage is authoritative, no localStorage fallback
    expect(token).toBeNull();
    expect(mockLocalStorage.getItem).not.toHaveBeenCalled();
  });

  it("returns null when sessionStorage is empty", () => {
    const token = getSessionToken();

    expect(token).toBeNull();
  });
});

// ===========================================================================
// C) clearSessionToken
// ===========================================================================

describe("clearSessionToken", () => {
  it("removes the key from sessionStorage", () => {
    mockSessionStorage._store[STORAGE_KEY] = "token-to-clear";

    clearSessionToken();

    expect(mockSessionStorage.removeItem).toHaveBeenCalledWith(STORAGE_KEY);
  });

  it("does not write to localStorage", () => {
    clearSessionToken();

    expect(mockLocalStorage.setItem).not.toHaveBeenCalled();
    expect(mockLocalStorage.removeItem).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// D) captureSessionToken
// ===========================================================================

describe("captureSessionToken", () => {
  it("stores a string sessionToken from a response body", () => {
    captureSessionToken({ sessionToken: "captured-token-xyz" });

    expect(mockSessionStorage.setItem).toHaveBeenCalledWith(STORAGE_KEY, "captured-token-xyz");
    expect(mockLocalStorage.setItem).not.toHaveBeenCalled();
  });

  it("ignores non-string sessionToken values", () => {
    captureSessionToken({ sessionToken: 12345 });

    expect(mockSessionStorage.setItem).not.toHaveBeenCalled();
  });

  it("ignores missing sessionToken field", () => {
    captureSessionToken({ user: "alice" });

    expect(mockSessionStorage.setItem).not.toHaveBeenCalled();
  });

  it("ignores null input", () => {
    captureSessionToken(null);

    expect(mockSessionStorage.setItem).not.toHaveBeenCalled();
  });

  it("ignores primitive inputs", () => {
    captureSessionToken("not-an-object");

    expect(mockSessionStorage.setItem).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// E) authFetch attaches Authorization: Bearer when token present
// ===========================================================================

describe("authFetch — Authorization header injection", () => {
  it("attaches Authorization: Bearer <token> when a token is stored", async () => {
    mockSessionStorage._store[STORAGE_KEY] = "bearer-token-123";

    await authFetch("/api/me");
    const headers = lastRequestHeaders();

    expect(headers.get("authorization")).toBe("Bearer bearer-token-123");
  });

  it("reads token from sessionStorage, not localStorage", async () => {
    mockLocalStorage._store[STORAGE_KEY] = "local-only-token";
    // sessionStorage is empty

    await authFetch("/api/me");
    const headers = lastRequestHeaders();

    // No token from sessionStorage → no Authorization header
    expect(headers.get("authorization")).toBeNull();
    expect(mockLocalStorage.getItem).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// F) authFetch — no header when no token
// ===========================================================================

describe("authFetch — no token present", () => {
  it("does not set Authorization header when sessionStorage is empty", async () => {
    await authFetch("/api/me");
    const headers = lastRequestHeaders();

    expect(headers.get("authorization")).toBeNull();
  });
});

// ===========================================================================
// G) authFetch — does not override existing Authorization header
// ===========================================================================

describe("authFetch — existing Authorization header preserved", () => {
  it("preserves an already-present Authorization header", async () => {
    mockSessionStorage._store[STORAGE_KEY] = "session-token";

    await authFetch(
      "/api/me",
      { headers: { Authorization: "Bearer explicit-token" } },
    );
    const headers = lastRequestHeaders();

    expect(headers.get("authorization")).toBe("Bearer explicit-token");
  });
});

// ===========================================================================
// H) No cross-storage fallback — new tab sees empty session
// ===========================================================================

describe("sessionToken — no cross-tab localStorage fallback", () => {
  it("returns null when sessionStorage is empty even if localStorage has a value", () => {
    // Pre-existing localStorage entry (from old implementation or manual injection)
    mockLocalStorage._store[STORAGE_KEY] = "stale-local-token";

    const token = getSessionToken();

    // sessionStorage is empty → null returned (new tab requires fresh login)
    expect(token).toBeNull();
  });

  it("does not bridge localStorage to sessionStorage on read", () => {
    mockLocalStorage._store[STORAGE_KEY] = "stale-local-token";

    getSessionToken();

    // sessionStorage must NOT have been written (no bridging)
    expect(mockSessionStorage.setItem).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// I) Storage unavailability (private mode simulation)
// ===========================================================================

describe("sessionToken — storage unavailable (private mode)", () => {
  it("getSessionToken returns null when sessionStorage.getItem throws", () => {
    const throwingStorage = {
      getItem: vi.fn(() => { throw new DOMException("Access denied"); }),
    };
    vi.stubGlobal("window", {
      sessionStorage: throwingStorage,
      localStorage: mockLocalStorage,
    });

    const token = getSessionToken();

    expect(token).toBeNull();
  });

  it("setSessionToken is a no-op when sessionStorage.setItem throws", () => {
    const throwingStorage = {
      setItem: vi.fn(() => { throw new DOMException("Access denied"); }),
      removeItem: vi.fn(() => { throw new DOMException("Access denied"); }),
    };
    vi.stubGlobal("window", {
      sessionStorage: throwingStorage,
      localStorage: mockLocalStorage,
    });

    // Must not throw
    expect(() => setSessionToken("tok")).not.toThrow();
  });

  it("setSessionToken(null) is a no-op when sessionStorage.removeItem throws", () => {
    const throwingStorage = {
      setItem: vi.fn(),
      removeItem: vi.fn(() => { throw new DOMException("Access denied"); }),
    };
    vi.stubGlobal("window", {
      sessionStorage: throwingStorage,
      localStorage: mockLocalStorage,
    });

    expect(() => setSessionToken(null)).not.toThrow();
  });
});
