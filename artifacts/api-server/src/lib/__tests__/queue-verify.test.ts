import { vi, describe, it, expect, beforeEach } from "vitest";
const mockFn = vi.fn();
describe("verify clearAllMocks queue behavior", () => {
  // resetAllMocks clears queued mockReturnValueOnce values too. clearAllMocks
  // only clears call history, allowing a stale response from one test to leak
  // into the next one.
  beforeEach(() => vi.resetAllMocks());
  it("test1: use 1 of 2 queued returns", () => {
    mockFn.mockReturnValueOnce("a");
    mockFn.mockReturnValueOnce("b");
    expect(mockFn()).toBe("a");
    // don't call again - b stays in queue
  });
  it("test2: check if b leaked from test1", () => {
    // If b leaked, first call returns "b"
    // If cleared, first call returns undefined
    const first = mockFn();
    console.log("[queue-verify] first call in test2 returns:", first);
    expect(first).toBeUndefined(); // should be undefined if queue was cleared
  });
});
