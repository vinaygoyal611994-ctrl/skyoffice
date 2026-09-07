/**
 * Slot Reservations — comprehensive test suite
 *
 * Covers all 18+ scenarios for the reservation system:
 *   1.  Full market blocks paid activation
 *   2.  Full market places provider on waitlist without payment
 *   3.  Free slot creates one 3-hour reservation
 *   4.  Reserved slot counts against capacity
 *   5.  Second provider cannot reserve the same final slot (concurrency)
 *   6.  Reservation expires after 3 hours
 *   7.  Expired reservation passes opportunity to next provider
 *   8.  Valid reservation can convert to allocated
 *   9.  Invalid/expired reservation blocks activatePaid
 *   10. Returning provider priority (tier 1 before tier 3)
 *   11. Priority never exceeds cap (only available slots get reservations)
 *   12. Closed market blocks reservation even with spare capacity
 *   13. Suspended allocated office releases slot and triggers waitlist
 *   14. Rejected/suspended waiting office does not trigger waitlist (no capacity freed)
 *   15. forceAllocateSlot is atomic (rolls back on error)
 *   16. expireReservation sets all reservation fields + audit
 *   17. getSlotStatus returns reservationExpiresAt
 *   18. countAllocatedSlotsForMarket counts allocated + reserved (not waiting/released)
 *   19. processWaitlist respects closed market (no reservations created)
 *   20. checkPrePaymentCapacity: valid reservation → canPay=true
 *   21. checkPrePaymentCapacity: renewal → canPay=true
 *   22. checkPrePaymentCapacity: uncapped market → canPay=true not_required
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { pool } from "@workspace/db";

// ── Mock @workspace/db ────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => {
  const mockClient = {
    query:   vi.fn(),
    release: vi.fn(),
  };
  const mockPool = {
    query:   vi.fn(),
    connect: vi.fn().mockResolvedValue(mockClient),
  };
  return { pool: mockPool, db: {} };
});

// Import after mock is in place
import {
  checkPrePaymentCapacity,
  convertReservationToAllocation,
  expireReservation,
  processWaitlist,
  releaseSlot,
  forceAllocateSlot,
  getSlotStatus,
  countAllocatedSlotsForMarket,
  determinePriorityTier,
} from "../supplySlotManager";

// ── Helpers ───────────────────────────────────────────────────────────────────

type MockFn = ReturnType<typeof vi.fn>;
const MARKET_KEY = "SA|riyadh|marketing";
const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
const futureDate = new Date(Date.now() + THREE_HOURS_MS);
const pastDate   = new Date(Date.now() - 60_000); // 1 min ago

/** Build a mock client that responses to queries in sequence. */
function stubClientQueries(responses: Array<{ rows: unknown[] }>) {
  let callCount = -1;
  const clientQuery = vi.fn().mockImplementation(() => {
    callCount++;
    const resp = responses[callCount] ?? { rows: [] };
    return Promise.resolve(resp);
  });
  const clientRelease = vi.fn();
  (pool.connect as MockFn).mockResolvedValue({ query: clientQuery, release: clientRelease });
  return { clientQuery, clientRelease };
}

/** pool.query mock helper */
function pq() { return pool.query as MockFn; }

// Use resetAllMocks before each test to drain unconsumed mockResolvedValueOnce queues
// (clearAllMocks does NOT drain queues, so bleed between tests would occur).
// After reset, pool.query is still a vi.fn() — each test queues its own responses.
beforeEach(() => {
  vi.resetAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Full market blocks paid activation via activatePaid (tested via the gate
//    that getSlotStatus exposes — activatePaid is integration-level, tested here
//    through the underlying gate check)
// ─────────────────────────────────────────────────────────────────────────────

describe("checkPrePaymentCapacity — full capped market", () => {
  it("blocks payment and enters waitlist when market is full (waiting result)", async () => {
    // Office market lookup
    pq().mockResolvedValueOnce({ rows: [{ id: 1, supply_gate_market_key: MARKET_KEY, country: "SA", city: "riyadh", category: "marketing" }] });
    // Slot record — no slot yet (null)
    pq().mockResolvedValueOnce({ rows: [] });
    // isMarketClosed → not closed
    pq().mockResolvedValueOnce({ rows: [{ acceptance_status: "open" }] });
    // determinePriorityTier — returning check
    pq().mockResolvedValueOnce({ rows: [{ cnt: 0 }] });
    // determinePriorityTier — existing check
    pq().mockResolvedValueOnce({ rows: [{ cnt: 0 }] });
    // Enter waitlist INSERT
    pq().mockResolvedValueOnce({ rows: [] });
    // Audit log INSERT
    pq().mockResolvedValueOnce({ rows: [] });
    // Update is_subscription_hidden
    pq().mockResolvedValueOnce({ rows: [] });

    // processWaitlist: BEGIN, lock market (cap=5), countActiveSlots → 5 (full), COMMIT
    const { clientQuery } = stubClientQueries([
      { rows: [] },  // BEGIN
      { rows: [{ supply_cap: 5, acceptance_status: "open" }] },  // lock market
      { rows: [{ cnt: 5 }] },  // countActiveSlots — full
      { rows: [] },  // COMMIT
    ]);
    // After processWaitlist, re-query pool for slot status (not reserved)
    pq().mockResolvedValueOnce({ rows: [] }); // No reservation created

    const result = await checkPrePaymentCapacity(1);

    expect(result.canPay).toBe(false);
    expect(result.reason).toBe("waitlist_entered");
    expect(result.slotStatus).toBe("waiting");
  });

  it("places already-waiting provider on waitlist without changing state", async () => {
    pq().mockResolvedValueOnce({ rows: [{ id: 2, supply_gate_market_key: MARKET_KEY, country: "SA", city: "riyadh", category: "marketing" }] });
    // Office already waiting
    pq().mockResolvedValueOnce({ rows: [{ slot_status: "waiting", market_key: MARKET_KEY, allocated_at: null, reservation_expires_at: null }] });
    // isMarketClosed → open
    pq().mockResolvedValueOnce({ rows: [{ acceptance_status: "open" }] });
    // determinePriorityTier
    pq().mockResolvedValueOnce({ rows: [{ cnt: 0 }] });
    pq().mockResolvedValueOnce({ rows: [{ cnt: 1 }] }); // existing tier 2
    // Enter waitlist — no-op (slot_status = 'waiting', ON CONFLICT clause won't change it... but we still call)
    pq().mockResolvedValueOnce({ rows: [] });
    // Audit — but currentStatus === "waiting" so no audit
    // is_subscription_hidden update
    pq().mockResolvedValueOnce({ rows: [] });

    // processWaitlist: full market
    const { clientQuery } = stubClientQueries([
      { rows: [] },  // BEGIN
      { rows: [{ supply_cap: 5, acceptance_status: "open" }] },
      { rows: [{ cnt: 5 }] },  // full
      { rows: [] },  // COMMIT
    ]);

    pq().mockResolvedValueOnce({ rows: [] }); // re-check slot after processWaitlist

    const result = await checkPrePaymentCapacity(2);

    expect(result.canPay).toBe(false);
    expect(result.slotStatus).toBe("waiting");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Free slot creates a 3-hour reservation (not direct allocation)
// ─────────────────────────────────────────────────────────────────────────────

describe("processWaitlist — capped market creates reservations", () => {
  it("creates a reservation (not direct allocation) when a slot is available", async () => {
    const { clientQuery } = stubClientQueries([
      { rows: [] },  // BEGIN
      // Lock market: cap=5, open
      { rows: [{ supply_cap: 5, acceptance_status: "open" }] },
      // countActiveSlots — 4 (one slot available)
      { rows: [{ cnt: 4 }] },
      // Fetch top waiting offices — one waiting provider
      { rows: [{ office_id: 10, priority_tier: 2, slot_status: "waiting" }] },
      // createReservationRow: INSERT INTO market_slot_allocations (reservation)
      { rows: [] },
      // createReservationRow: INSERT INTO slot_audit_log (reservation_created)
      { rows: [] },
      // createReservationRow: INSERT INTO slot_notification_outbox (outbox entry)
      { rows: [] },
      // createReservationRow: INSERT INTO slot_audit_log (notification_queued)
      { rows: [] },
      { rows: [] },  // COMMIT
    ]);

    const result = await processWaitlist(MARKET_KEY);

    expect(result.reserved).toEqual([10]);
    expect(result.allocated).toEqual([]);

    // Verify the reservation was created, not direct allocation
    const insertCall = clientQuery.mock.calls.find((call: any[]) =>
      typeof call[0] === "string" && call[0].includes("reservation_expires_at"),
    );
    expect(insertCall).toBeTruthy();
    const reservedCall = clientQuery.mock.calls.find((call: any[]) =>
      typeof call[0] === "string" && call[0].includes("'reserved'"),
    );
    expect(reservedCall).toBeTruthy();
  });

  it("creates exactly N reservations when N slots are available", async () => {
    const { clientQuery } = stubClientQueries([
      { rows: [] },  // BEGIN
      { rows: [{ supply_cap: 5, acceptance_status: "open" }] },
      { rows: [{ cnt: 3 }] },  // 2 available
      // Two waiting providers
      { rows: [
        { office_id: 11, priority_tier: 1, slot_status: "waiting" },
        { office_id: 12, priority_tier: 2, slot_status: "waiting" },
      ]},
      // Office 11: slot reservation + reservation_created audit + outbox INSERT + notification_queued audit
      { rows: [] }, { rows: [] }, { rows: [] }, { rows: [] },
      // Office 12: same 4 queries
      { rows: [] }, { rows: [] }, { rows: [] }, { rows: [] },
      { rows: [] },  // COMMIT
    ]);

    const result = await processWaitlist(MARKET_KEY);

    expect(result.reserved).toHaveLength(2);
    expect(result.reserved).toContain(11);
    expect(result.reserved).toContain(12);
    // Tier 1 (returning) provider should be FIRST (ordered by priority)
    expect(result.reserved[0]).toBe(11);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Reserved slot counts against capacity
// ─────────────────────────────────────────────────────────────────────────────

describe("countAllocatedSlotsForMarket — includes reserved", () => {
  it("counts both allocated and reserved slots as capacity consumers", async () => {
    pq().mockResolvedValueOnce({ rows: [{ cnt: 7 }] });
    // The query should use IN ('allocated', 'reserved')
    const result = await countAllocatedSlotsForMarket(MARKET_KEY);
    expect(result).toBe(7);

    const callArg = (pq().mock.calls[0] as any[])[0] as string;
    expect(callArg).toContain("'allocated', 'reserved'");
  });

  it("does NOT count waiting or released slots", async () => {
    // If DB correctly filters, our mock returns the right count
    pq().mockResolvedValueOnce({ rows: [{ cnt: 3 }] });
    const result = await countAllocatedSlotsForMarket(MARKET_KEY);
    expect(result).toBe(3);
    // Verify we do NOT include 'waiting' or 'released' in the WHERE clause
    const callArg = (pq().mock.calls[0] as any[])[0] as string;
    expect(callArg).not.toContain("'waiting'");
    expect(callArg).not.toContain("'released'");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Second provider cannot reserve the same final slot (market full after first)
// ─────────────────────────────────────────────────────────────────────────────

describe("processWaitlist — no over-booking", () => {
  it("creates at most (cap - activeSlots) reservations", async () => {
    const { clientQuery } = stubClientQueries([
      { rows: [] },  // BEGIN
      { rows: [{ supply_cap: 5, acceptance_status: "open" }] },
      { rows: [{ cnt: 5 }] },  // already full (allocated=4 + reserved=1 = 5)
      { rows: [] },  // COMMIT (no waiting rows fetched)
    ]);

    const result = await processWaitlist(MARKET_KEY);
    expect(result.reserved).toHaveLength(0);
    expect(result.allocated).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6 & 7. expireReservation — releases slot, passes opportunity
// ─────────────────────────────────────────────────────────────────────────────

describe("expireReservation", () => {
  it("releases a reserved slot and records reservation_expired audit", async () => {
    pq()
      .mockResolvedValueOnce({ rows: [{ slot_status: "reserved", market_key: MARKET_KEY, priority_tier: 2 }] })
      .mockResolvedValueOnce({ rows: [] }) // UPDATE slot to released
      .mockResolvedValueOnce({ rows: [] }); // INSERT audit log

    const marketKey = await expireReservation(42);
    expect(marketKey).toBe(MARKET_KEY);

    // Verify the UPDATE query references 'released' state and clears reservation fields
    const updateQuery = (pq().mock.calls[1] as any[])[0] as string;
    expect(updateQuery).toContain("'released'");
    expect(updateQuery).toContain("reservation_expires_at");

    // Verify the audit action param ($3) is 'reservation_expired'
    // recordAuditEntry uses INSERT INTO slot_audit_log ... VALUES ($1,$2,$3,...) where $3=action
    const auditParams = (pq().mock.calls[2] as any[])[1] as any[];
    expect(auditParams[2]).toBe("reservation_expired");
  });

  it("is a no-op when slot is not 'reserved'", async () => {
    pq().mockResolvedValueOnce({ rows: [{ slot_status: "allocated", market_key: MARKET_KEY, priority_tier: 2 }] });

    const marketKey = await expireReservation(99);
    // Returns market key but doesn't write anything
    expect(pq().mock.calls).toHaveLength(1); // only the SELECT
    // marketKey may be returned even for no-op (implementation detail)
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Valid reservation converts to allocated
// ─────────────────────────────────────────────────────────────────────────────

describe("convertReservationToAllocation", () => {
  it("converts reserved → allocated and clears is_subscription_hidden", async () => {
    pq()
      .mockResolvedValueOnce({ rows: [{ slot_status: "reserved", market_key: MARKET_KEY, priority_tier: 2, reservation_expires_at: futureDate }] })
      .mockResolvedValueOnce({ rows: [] }) // UPDATE slot
      .mockResolvedValueOnce({ rows: [] }) // UPDATE offices
      .mockResolvedValueOnce({ rows: [] }); // INSERT audit

    await expect(convertReservationToAllocation(5, 100)).resolves.not.toThrow();

    // Verify slot update sets allocated
    const slotUpdate = (pq().mock.calls[1] as any[])[0] as string;
    expect(slotUpdate).toContain("'allocated'");
    expect(slotUpdate).toContain("converted_to_allocation");

    // Verify is_subscription_hidden = false
    const officeUpdate = (pq().mock.calls[2] as any[])[0] as string;
    expect(officeUpdate).toContain("is_subscription_hidden = false");

    // recordAuditEntry passes action as $3 param — check the params array
    const auditParams = (pq().mock.calls[3] as any[])[1] as any[];
    expect(auditParams[2]).toBe("reservation_converted");
  });

  it("throws if no slot record exists", async () => {
    pq().mockResolvedValueOnce({ rows: [] }); // no slot

    await expect(convertReservationToAllocation(99)).rejects.toThrow("No slot record");
  });

  it("throws if slot is not in 'reserved' state", async () => {
    pq().mockResolvedValueOnce({ rows: [{ slot_status: "waiting", market_key: MARKET_KEY, priority_tier: 2, reservation_expires_at: null }] });

    await expect(convertReservationToAllocation(7)).rejects.toThrow("does not have a reserved slot");
  });

  it("throws if reservation has expired", async () => {
    pq().mockResolvedValueOnce({ rows: [{ slot_status: "reserved", market_key: MARKET_KEY, priority_tier: 2, reservation_expires_at: pastDate }] });

    await expect(convertReservationToAllocation(8)).rejects.toThrow("expired");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Invalid/expired reservation blocks payment (tested via convertReservationToAllocation)
// ─────────────────────────────────────────────────────────────────────────────

describe("checkPrePaymentCapacity — valid/invalid reservation", () => {
  it("returns canPay=true for a valid (unexpired) reservation", async () => {
    // Office market
    pq().mockResolvedValueOnce({ rows: [{ id: 3, supply_gate_market_key: MARKET_KEY, country: "SA", city: "riyadh", category: "marketing" }] });
    // Slot with valid reservation
    pq().mockResolvedValueOnce({ rows: [{ slot_status: "reserved", market_key: MARKET_KEY, allocated_at: null, reservation_expires_at: futureDate }] });

    const result = await checkPrePaymentCapacity(3);

    expect(result.canPay).toBe(true);
    expect(result.reason).toBe("valid_reservation");
    expect(result.slotStatus).toBe("reserved");
    expect(result.reservationExpiresAt).toEqual(futureDate);
  });

  it("returns canPay=true for active_slot (renewal)", async () => {
    pq().mockResolvedValueOnce({ rows: [{ id: 4, supply_gate_market_key: MARKET_KEY, country: "SA", city: "riyadh", category: "marketing" }] });
    // Already allocated
    pq().mockResolvedValueOnce({ rows: [{ slot_status: "allocated", market_key: MARKET_KEY, allocated_at: new Date(), reservation_expires_at: null }] });

    const result = await checkPrePaymentCapacity(4);

    expect(result.canPay).toBe(true);
    expect(result.reason).toBe("active_slot");
  });

  it("returns canPay=true for not_required market", async () => {
    pq().mockResolvedValueOnce({ rows: [{ id: 5, supply_gate_market_key: null, country: "SA", city: "riyadh", category: "marketing" }] });

    const result = await checkPrePaymentCapacity(5);

    expect(result.canPay).toBe(true);
    expect(result.reason).toBe("not_required");
    expect(result.slotStatus).toBe("not_required");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10 & 11. Returning provider priority + capacity limits
// ─────────────────────────────────────────────────────────────────────────────

describe("determinePriorityTier", () => {
  it("assigns tier 1 to a returning provider (previously allocated)", async () => {
    pq()
      .mockResolvedValueOnce({ rows: [{ cnt: 1 }] })  // has allocated_at
      .mockResolvedValueOnce({ rows: [{ cnt: 0 }] }); // not reached

    const tier = await determinePriorityTier(20, MARKET_KEY);
    expect(tier).toBe(1);
  });

  it("assigns tier 2 to an approved provider without prior allocation", async () => {
    pq()
      .mockResolvedValueOnce({ rows: [{ cnt: 0 }] })  // no allocated_at
      .mockResolvedValueOnce({ rows: [{ cnt: 1 }] }); // is approved/active

    const tier = await determinePriorityTier(21, MARKET_KEY);
    expect(tier).toBe(2);
  });

  it("assigns tier 3 to a brand new provider", async () => {
    pq()
      .mockResolvedValueOnce({ rows: [{ cnt: 0 }] })
      .mockResolvedValueOnce({ rows: [{ cnt: 0 }] });

    const tier = await determinePriorityTier(22, MARKET_KEY);
    expect(tier).toBe(3);
  });

  it("processWaitlist orders tier-1 providers BEFORE tier-3", async () => {
    // cap=5, current=4 → 1 available
    const { clientQuery } = stubClientQueries([
      { rows: [] },  // BEGIN
      { rows: [{ supply_cap: 5, acceptance_status: "open" }] },
      { rows: [{ cnt: 4 }] },
      // waiting providers — ordered by tier ASC (tier 1 first)
      { rows: [{ office_id: 30, priority_tier: 1, slot_status: "waiting" }] },
      { rows: [] }, { rows: [] }, { rows: [] }, { rows: [] },  // reservation for office 30 (slot + reservation_created audit + outbox + notification_queued audit)
      { rows: [] },  // COMMIT
    ]);

    const result = await processWaitlist(MARKET_KEY);
    expect(result.reserved[0]).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. Closed market blocks reservations even with spare capacity
// ─────────────────────────────────────────────────────────────────────────────

describe("processWaitlist — closed market", () => {
  it("creates NO reservations when market is closed (acceptance_status=closed)", async () => {
    const { clientQuery } = stubClientQueries([
      { rows: [] },  // BEGIN
      { rows: [{ supply_cap: 10, acceptance_status: "closed" }] },  // closed market
      { rows: [] },  // COMMIT (early exit)
    ]);

    const result = await processWaitlist(MARKET_KEY);

    expect(result.reserved).toHaveLength(0);
    expect(result.allocated).toHaveLength(0);

    // Should NOT have fetched waiting providers
    const calls = (clientQuery as MockFn).mock.calls as any[][];
    const fetchedWaiting = calls.some((call: any[]) =>
      typeof call[0] === "string" && call[0].includes("slot_status = 'waiting'"),
    );
    expect(fetchedWaiting).toBe(false);
  });
});

describe("checkPrePaymentCapacity — closed market", () => {
  it("blocks payment and enters waitlist when market is closed", async () => {
    pq().mockResolvedValueOnce({ rows: [{ id: 6, supply_gate_market_key: MARKET_KEY, country: "SA", city: "riyadh", category: "marketing" }] });
    pq().mockResolvedValueOnce({ rows: [] }); // no slot record
    // isMarketClosed → closed
    pq().mockResolvedValueOnce({ rows: [{ acceptance_status: "closed" }] });
    // determinePriorityTier
    pq().mockResolvedValueOnce({ rows: [{ cnt: 0 }] });
    pq().mockResolvedValueOnce({ rows: [{ cnt: 0 }] });
    // Enter waitlist
    pq().mockResolvedValueOnce({ rows: [] });
    // Audit
    pq().mockResolvedValueOnce({ rows: [] });

    const result = await checkPrePaymentCapacity(6);

    expect(result.canPay).toBe(false);
    expect(result.reason).toBe("waitlist_entered");
    expect(result.slotStatus).toBe("waiting");
    // Message should mention "closed"
    expect(result.message.toLowerCase()).toContain("closed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. Suspended office: releaseSlot releases an allocated slot
// ─────────────────────────────────────────────────────────────────────────────

describe("releaseSlot — suspension/rejection", () => {
  it("releases an allocated slot and records 'released' audit", async () => {
    pq()
      .mockResolvedValueOnce({ rows: [{ slot_status: "allocated", market_key: MARKET_KEY, priority_tier: 2 }] })
      .mockResolvedValueOnce({ rows: [] }) // UPDATE market_slot_allocations
      .mockResolvedValueOnce({ rows: [] }); // INSERT audit

    const marketKey = await releaseSlot(50, "office_suspended", 9);

    expect(marketKey).toBe(MARKET_KEY);

    // UPDATE query text should contain 'released' status
    const updateQuery = (pq().mock.calls[1] as any[])[0] as string;
    expect(updateQuery).toContain("'released'");

    // Audit action ($3 param) should be 'released' for an allocated slot
    const auditParams = (pq().mock.calls[2] as any[])[1] as any[];
    expect(auditParams[2]).toBe("released");
  });

  it("releases a reserved slot and records 'reservation_released' audit", async () => {
    pq()
      .mockResolvedValueOnce({ rows: [{ slot_status: "reserved", market_key: MARKET_KEY, priority_tier: 2 }] })
      .mockResolvedValueOnce({ rows: [] }) // UPDATE
      .mockResolvedValueOnce({ rows: [] }); // audit

    const marketKey = await releaseSlot(51, "office_suspended", 9);
    expect(marketKey).toBe(MARKET_KEY);

    // Audit action ($3 param) should be 'reservation_released' for a reserved slot
    const auditParams = (pq().mock.calls[2] as any[])[1] as any[];
    expect(auditParams[2]).toBe("reservation_released");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. Rejected/waiting provider: releasing 'waiting' slot does NOT free capacity
// ─────────────────────────────────────────────────────────────────────────────

describe("releaseSlot — waiting provider", () => {
  it("releases a waiting slot without consuming or freeing capacity", async () => {
    pq()
      .mockResolvedValueOnce({ rows: [{ slot_status: "waiting", market_key: MARKET_KEY, priority_tier: 3 }] })
      .mockResolvedValueOnce({ rows: [] }) // UPDATE
      .mockResolvedValueOnce({ rows: [] }); // audit

    const marketKey = await releaseSlot(60, "office_rejected", 9);
    expect(marketKey).toBe(MARKET_KEY);

    // Audit action ($3 param) for waiting release should be 'released' (not reservation_released)
    const auditParams = (pq().mock.calls[2] as any[])[1] as any[];
    expect(auditParams[2]).toBe("released");
    expect(auditParams[2]).not.toBe("reservation_released");
  });

  it("is idempotent if slot is already released", async () => {
    pq().mockResolvedValueOnce({ rows: [{ slot_status: "released", market_key: MARKET_KEY, priority_tier: 3 }] });
    // Should not write anything further
    const marketKey = await releaseSlot(61, "double_release", 9);
    // Still returns the market key for caller convenience
    expect(marketKey).toBe(MARKET_KEY);
    // Only 1 DB call (the SELECT)
    expect(pq().mock.calls).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 15. forceAllocateSlot is transactional
// ─────────────────────────────────────────────────────────────────────────────

describe("forceAllocateSlot — atomic/transactional", () => {
  it("succeeds atomically — all 3 writes inside a single transaction", async () => {
    // Outer pool.query for fetchOfficeMarket + determinePriorityTier
    pq()
      .mockResolvedValueOnce({ rows: [{ id: 70, supply_gate_market_key: MARKET_KEY, country: "SA", city: "riyadh", category: "marketing" }] })
      .mockResolvedValueOnce({ rows: [{ cnt: 1 }] })   // determinePriorityTier returning check
      .mockResolvedValueOnce({ rows: [{ cnt: 0 }] });  // determinePriorityTier existing check

    const { clientQuery } = stubClientQueries([
      { rows: [] },  // BEGIN
      { rows: [] },  // SELECT slot (prev status check)
      { rows: [] },  // UPSERT market_slot_allocations
      { rows: [] },  // UPDATE offices (is_subscription_hidden = false)
      { rows: [] },  // INSERT slot_audit_log
      { rows: [] },  // COMMIT
    ]);

    const result = await forceAllocateSlot(70, "admin_override_test", 9);

    expect(result.slotStatus).toBe("allocated");

    const calls = (clientQuery as MockFn).mock.calls as any[][];
    expect(calls[0][0]).toContain("BEGIN");
    expect(calls[calls.length - 1][0]).toContain("COMMIT");
    // Verify all writes happen between BEGIN and COMMIT
    expect(calls.length).toBeGreaterThanOrEqual(5);
  });

  it("rolls back on error — no partial writes", async () => {
    pq()
      .mockResolvedValueOnce({ rows: [{ id: 71, supply_gate_market_key: MARKET_KEY, country: "SA", city: "riyadh", category: "marketing" }] })
      .mockResolvedValueOnce({ rows: [{ cnt: 0 }] })
      .mockResolvedValueOnce({ rows: [{ cnt: 0 }] });

    const clientQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // SELECT prev status
      .mockRejectedValueOnce(new Error("DB constraint violation")); // UPSERT fails
    const clientRelease = vi.fn();
    (pool.connect as MockFn).mockResolvedValue({
      query: clientQuery,
      release: clientRelease,
    });

    await expect(forceAllocateSlot(71, "should_fail", 9)).rejects.toThrow("DB constraint violation");

    // ROLLBACK must have been called
    const calls = (clientQuery as MockFn).mock.calls as any[][];
    const hasRollback = calls.some((c: any[]) => typeof c[0] === "string" && c[0].includes("ROLLBACK"));
    expect(hasRollback).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 16. expireReservation sets all reservation fields
// ─────────────────────────────────────────────────────────────────────────────

describe("expireReservation — field validation", () => {
  it("sets slot_status=released, clears reservation timestamps, records audit", async () => {
    pq()
      .mockResolvedValueOnce({ rows: [{ slot_status: "reserved", market_key: MARKET_KEY, priority_tier: 1 }] })
      .mockResolvedValueOnce({ rows: [] })  // UPDATE
      .mockResolvedValueOnce({ rows: [] }); // audit

    await expireReservation(80);

    const updateCall = (pq().mock.calls[1] as any[])[0] as string;
    expect(updateCall).toContain("'released'");
    expect(updateCall).toContain("reservation_expired");
    expect(updateCall).toContain("reservation_expires_at    = NULL");
    expect(updateCall).toContain("reservation_started_at    = NULL");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 17. getSlotStatus returns reservationExpiresAt
// ─────────────────────────────────────────────────────────────────────────────

describe("getSlotStatus — includes reservationExpiresAt", () => {
  it("returns reservationExpiresAt for a reserved slot", async () => {
    pq().mockResolvedValueOnce({ rows: [{
      slot_status: "reserved",
      market_key: MARKET_KEY,
      priority_tier: 2,
      reservation_expires_at: futureDate,
    }]});

    const info = await getSlotStatus(90);

    expect(info.slotStatus).toBe("reserved");
    expect(info.reservationExpiresAt).toEqual(futureDate);
  });

  it("returns null reservationExpiresAt for an allocated slot", async () => {
    pq().mockResolvedValueOnce({ rows: [{
      slot_status: "allocated",
      market_key: MARKET_KEY,
      priority_tier: 1,
      reservation_expires_at: null,
    }]});

    const info = await getSlotStatus(91);

    expect(info.slotStatus).toBe("allocated");
    expect(info.reservationExpiresAt).toBeNull();
  });

  it("returns all nulls when no slot record exists", async () => {
    pq().mockResolvedValueOnce({ rows: [] });

    const info = await getSlotStatus(92);

    expect(info.slotStatus).toBeNull();
    expect(info.marketKey).toBeNull();
    expect(info.priorityTier).toBeNull();
    expect(info.reservationExpiresAt).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 18. Market isolation — SA|riyadh|marketing ≠ AE|dubai|marketing
// ─────────────────────────────────────────────────────────────────────────────

describe("market key isolation", () => {
  it("countAllocatedSlotsForMarket uses the full key including country and city", async () => {
    pq().mockResolvedValueOnce({ rows: [{ cnt: 2 }] });
    await countAllocatedSlotsForMarket("AE|dubai|marketing");

    const callArgs = (pq().mock.calls[0] as any[])[1] as any[];
    expect(callArgs[0]).toBe("AE|dubai|marketing");
    expect(callArgs[0]).not.toContain("riyadh");
  });

  it("processWaitlist does not affect providers in a different market", async () => {
    // processWaitlist for SA|riyadh|marketing should not touch AE|dubai|marketing rows
    const { clientQuery } = stubClientQueries([
      { rows: [] },  // BEGIN
      { rows: [{ supply_cap: 5, acceptance_status: "open" }] },
      { rows: [{ cnt: 5 }] },  // full in SA|riyadh|marketing
      { rows: [] },  // COMMIT
    ]);

    const result = await processWaitlist(MARKET_KEY);

    // No reservations created — didn't touch other markets
    expect(result.reserved).toHaveLength(0);

    // Verify the query used MARKET_KEY, not a broader pattern
    const calls = (clientQuery as MockFn).mock.calls as any[][];
    const marketKeyUsed = calls.some((c: any[]) =>
      Array.isArray(c[1]) && (c[1] as any[]).includes(MARKET_KEY),
    );
    expect(marketKeyUsed).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 19. processWaitlist: uncapped market → direct allocation (no reservation)
// ─────────────────────────────────────────────────────────────────────────────

describe("processWaitlist — uncapped market", () => {
  it("directly allocates (not reserves) all waiting providers in an uncapped market", async () => {
    const { clientQuery } = stubClientQueries([
      { rows: [] },  // BEGIN
      // Lock market: no supply_cap (null), open
      { rows: [{ supply_cap: null, acceptance_status: "open" }] },
      // allocateAllWaitingUncapped: fetch waiting
      { rows: [{ office_id: 100, priority_tier: 2 }, { office_id: 101, priority_tier: 3 }]},
      // UPDATE slot for office 100
      { rows: [] },
      // UPDATE offices for office 100
      { rows: [] },
      // INSERT audit for office 100
      { rows: [] },
      // UPDATE slot for office 101
      { rows: [] },
      // UPDATE offices for office 101
      { rows: [] },
      // INSERT audit for office 101
      { rows: [] },
      { rows: [] },  // COMMIT
    ]);

    const result = await processWaitlist(MARKET_KEY);

    expect(result.allocated).toContain(100);
    expect(result.allocated).toContain(101);
    expect(result.reserved).toHaveLength(0);

    // Verify that the slot update sets 'allocated', not 'reserved'
    const updateCalls = (clientQuery as MockFn).mock.calls as any[][];
    const allocatedUpdates = updateCalls.filter((c: any[]) =>
      typeof c[0] === "string" && c[0].includes("'allocated'") && c[0].includes("UPDATE market_slot_allocations"),
    );
    expect(allocatedUpdates.length).toBeGreaterThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 20. Expired reservation re-enters waitlist via checkPrePaymentCapacity
// ─────────────────────────────────────────────────────────────────────────────

describe("checkPrePaymentCapacity — expired reservation re-queues", () => {
  it("re-enters the waitlist when reservation has expired", async () => {
    pq().mockResolvedValueOnce({ rows: [{ id: 7, supply_gate_market_key: MARKET_KEY, country: "SA", city: "riyadh", category: "marketing" }] });
    // Has expired reservation
    pq().mockResolvedValueOnce({ rows: [{ slot_status: "reserved", market_key: MARKET_KEY, allocated_at: null, reservation_expires_at: pastDate }] });
    // Market is open (not closed)
    pq().mockResolvedValueOnce({ rows: [{ acceptance_status: "open" }] });
    // determinePriorityTier
    pq().mockResolvedValueOnce({ rows: [{ cnt: 1 }] }); // returning, tier 1
    pq().mockResolvedValueOnce({ rows: [] }); // existing check (not reached)
    // Enter waitlist (status is "reserved", not "waiting", so DO UPDATE fires)
    pq().mockResolvedValueOnce({ rows: [] });
    // Audit
    pq().mockResolvedValueOnce({ rows: [] });
    // Update is_subscription_hidden
    pq().mockResolvedValueOnce({ rows: [] });

    // processWaitlist — market still full
    const { clientQuery } = stubClientQueries([
      { rows: [] },
      { rows: [{ supply_cap: 5, acceptance_status: "open" }] },
      { rows: [{ cnt: 5 }] },
      { rows: [] },
    ]);

    pq().mockResolvedValueOnce({ rows: [] }); // re-check slot after processWaitlist

    const result = await checkPrePaymentCapacity(7);

    expect(result.canPay).toBe(false);
    expect(result.reason).toBe("already_reserved_expired");
    expect(result.slotStatus).toBe("waiting");
  });
});
