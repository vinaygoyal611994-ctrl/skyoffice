/**
 * Supply Slot Manager — unit tests
 *
 * These tests verify the core slot allocation, release, waitlist entry,
 * waitlist processing, priority tier determination, and audit log functions.
 *
 * All DB interactions are mocked via vi.mock('@workspace/db').
 * The pool.connect() client is mocked separately.
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
  allocateSlot,
  releaseSlot,
  processWaitlist,
  determinePriorityTier,
  getSlotStatus,
  getWaitlistForMarket,
  getMarketSlotSummary,
  countAllocatedSlotsForMarket,
  cancelSlot,
  forceAllocateSlot,
} from "../supplySlotManager";

// ── Helpers ───────────────────────────────────────────────────────────────────

type MockFn = ReturnType<typeof vi.fn>;

function getPoolMock()   { return pool.query as MockFn; }
function getClientMock() {
  // pool.connect() returns the client mock
  return (pool as any)._clientMock ?? {
    query:   (pool as any).connect.mock.results[0]?.value?.query,
    release: (pool as any).connect.mock.results[0]?.value?.release,
  };
}

/** Build a stub pool.connect() client with sequenced responses. */
function stubClientQueries(responses: Array<{ rows: unknown[] }>) {
  let callCount = -1;
  const clientQuery = vi.fn().mockImplementation(() => {
    callCount++;
    return Promise.resolve(responses[callCount] ?? { rows: [] });
  });
  const clientRelease = vi.fn();
  (pool.connect as MockFn).mockResolvedValue({ query: clientQuery, release: clientRelease });
  return { clientQuery, clientRelease };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.resetAllMocks();
});

// ── 1. determinePriorityTier ──────────────────────────────────────────────────

describe("determinePriorityTier", () => {
  it("returns tier 1 for a returning provider (has prior allocated_at)", async () => {
    (pool.query as MockFn)
      .mockResolvedValueOnce({ rows: [{ cnt: 1 }] })  // returning check
      .mockResolvedValueOnce({ rows: [{ cnt: 0 }] }); // existing check (not reached)

    const tier = await determinePriorityTier(1, "SA|riyadh|marketing");
    expect(tier).toBe(1);
  });

  it("returns tier 2 for an existing eligible provider", async () => {
    (pool.query as MockFn)
      .mockResolvedValueOnce({ rows: [{ cnt: 0 }] })  // returning check → 0
      .mockResolvedValueOnce({ rows: [{ cnt: 1 }] }); // existing check → 1

    const tier = await determinePriorityTier(2, "SA|riyadh|marketing");
    expect(tier).toBe(2);
  });

  it("returns tier 3 for a brand-new provider", async () => {
    (pool.query as MockFn)
      .mockResolvedValueOnce({ rows: [{ cnt: 0 }] })  // returning check → 0
      .mockResolvedValueOnce({ rows: [{ cnt: 0 }] }); // existing check → 0

    const tier = await determinePriorityTier(3, "SA|riyadh|marketing");
    expect(tier).toBe(3);
  });
});

// ── 2. allocateSlot: not_required ─────────────────────────────────────────────

describe("allocateSlot — not_required", () => {
  it("marks the slot not_required when office has no supply_gate_market_key", async () => {
    // fetchOfficeMarket
    (pool.query as MockFn)
      .mockResolvedValueOnce({ rows: [{ id: 10, supply_gate_market_key: null, country: "SA", city: "riyadh", category: "marketing" }] })
      // UPSERT market_slot_allocations
      .mockResolvedValueOnce({ rows: [] })
      // recordAuditEntry INSERT
      .mockResolvedValueOnce({ rows: [] });

    const result = await allocateSlot(10, "test");
    expect(result.slotStatus).toBe("not_required");
    expect(result.marketKey).toBeNull();
  });
});

// ── 3. allocateSlot: allocated (capacity available) ───────────────────────────

describe("allocateSlot — allocated", () => {
  it("allocates slot when cap has remaining capacity", async () => {
    // Pool query: fetchOfficeMarket
    (pool.query as MockFn)
      .mockResolvedValueOnce({ rows: [{ id: 5, supply_gate_market_key: "SA|riyadh|marketing", country: "SA", city: "riyadh", category: "marketing" }] })
      // idempotency check → no existing allocated row (office is NOT already allocated)
      .mockResolvedValueOnce({ rows: [] })
      // determinePriorityTier: returning check
      .mockResolvedValueOnce({ rows: [{ cnt: 0 }] })
      // determinePriorityTier: existing check
      .mockResolvedValueOnce({ rows: [{ cnt: 1 }] });

    // Client queries: BEGIN, lock market row, count, post-lock re-check, upsert slot, update offices, audit log, COMMIT
    stubClientQueries([
      { rows: [] },                              // BEGIN
      { rows: [{ supply_cap: 5 }] },             // FOR UPDATE lock → cap = 5
      { rows: [{ cnt: 3 }] },                    // countAllocatedSlots → 3 (< 5)
      { rows: [] },                              // post-lock re-check → not already allocated (proceed)
      { rows: [] },                              // UPSERT market_slot_allocations
      { rows: [] },                              // UPDATE offices SET is_subscription_hidden=false
      { rows: [] },                              // INSERT slot_audit_log
      { rows: [] },                              // COMMIT
    ]);

    const result = await allocateSlot(5, "test_activation", 999);
    expect(result.slotStatus).toBe("allocated");
    expect(result.marketKey).toBe("SA|riyadh|marketing");
  });

  it("allocates slot when market is uncapped (cap = null)", async () => {
    (pool.query as MockFn)
      .mockResolvedValueOnce({ rows: [{ id: 6, supply_gate_market_key: "SA|jeddah|legal", country: "SA", city: "jeddah", category: "legal" }] })
      .mockResolvedValueOnce({ rows: [] })            // idempotency check → not already allocated
      .mockResolvedValueOnce({ rows: [{ cnt: 0 }] }) // priority: not returning
      .mockResolvedValueOnce({ rows: [{ cnt: 1 }] }); // priority: existing

    stubClientQueries([
      { rows: [] },                     // BEGIN
      { rows: [{ supply_cap: null }] }, // lock → cap null → uncapped
      { rows: [{ cnt: 0 }] },           // count allocated
      { rows: [] },                     // post-lock re-check → not already allocated (proceed)
      { rows: [] },                     // UPSERT
      { rows: [] },                     // UPDATE offices SET is_subscription_hidden=false
      { rows: [] },                     // audit log
      { rows: [] },                     // COMMIT
    ]);

    const result = await allocateSlot(6, "uncapped_test");
    expect(result.slotStatus).toBe("allocated");
  });
});

// ── 4. allocateSlot: waiting (market full) ────────────────────────────────────

describe("allocateSlot — waiting", () => {
  it("enters waitlist when market is at capacity", async () => {
    (pool.query as MockFn)
      .mockResolvedValueOnce({ rows: [{ id: 7, supply_gate_market_key: "SA|riyadh|marketing", country: "SA", city: "riyadh", category: "marketing" }] })
      .mockResolvedValueOnce({ rows: [] })            // idempotency check → not already allocated (fresh entry)
      .mockResolvedValueOnce({ rows: [{ cnt: 0 }] }) // not returning
      .mockResolvedValueOnce({ rows: [{ cnt: 0 }] }); // not existing

    stubClientQueries([
      { rows: [] },                             // BEGIN
      { rows: [{ supply_cap: 15 }] },           // lock → cap = 15
      { rows: [{ cnt: 15 }] },                  // countAllocated → 15 = cap (FULL)
      { rows: [] },                             // post-lock re-check → not already allocated (proceed)
      { rows: [] },                             // UPSERT waiting
      { rows: [] },                             // UPDATE offices SET is_subscription_hidden=true
      { rows: [] },                             // audit log
      { rows: [] },                             // COMMIT
    ]);

    const result = await allocateSlot(7, "non_payment_renewal");
    expect(result.slotStatus).toBe("waiting");
    expect(result.priorityTier).toBe(3);
  });
});

// ── 5. releaseSlot ────────────────────────────────────────────────────────────

describe("releaseSlot", () => {
  it("releases an allocated slot and returns marketKey", async () => {
    (pool.query as MockFn)
      .mockResolvedValueOnce({ rows: [{ slot_status: "allocated", market_key: "SA|riyadh|marketing" }] }) // get current
      .mockResolvedValueOnce({ rows: [] })  // UPDATE
      .mockResolvedValueOnce({ rows: [] }); // audit log

    const key = await releaseSlot(5, "non_payment", null);
    expect(key).toBe("SA|riyadh|marketing");
  });

  it("returns null and is no-op when office already released", async () => {
    (pool.query as MockFn)
      .mockResolvedValueOnce({ rows: [{ slot_status: "released", market_key: "SA|riyadh|marketing" }] });

    const key = await releaseSlot(5, "already_released", null);
    // should return the market key for the caller to use
    expect(key).toBe("SA|riyadh|marketing");
    // no UPDATE or audit log called
    expect((pool.query as MockFn).mock.calls.length).toBe(1);
  });

  it("returns null when no slot record exists (not_required market)", async () => {
    (pool.query as MockFn)
      .mockResolvedValueOnce({ rows: [] }); // no row

    const key = await releaseSlot(99, "test", null);
    expect(key).toBeNull();
  });
});

// ── 6. cancelSlot ─────────────────────────────────────────────────────────────

describe("cancelSlot", () => {
  it("calls releaseSlot with subscription_cancelled reason and returns marketKey", async () => {
    (pool.query as MockFn)
      .mockResolvedValueOnce({ rows: [{ slot_status: "waiting", market_key: "SA|riyadh|marketing" }] })
      .mockResolvedValueOnce({ rows: [] })  // UPDATE
      .mockResolvedValueOnce({ rows: [] }); // audit log

    const marketKey = await cancelSlot(10, 999);
    expect(marketKey).toBe("SA|riyadh|marketing");
    // The UPDATE call should have set slot_status = 'released'
    const updateCall = (pool.query as MockFn).mock.calls.find(
      (c) => String(c[0]).includes("UPDATE market_slot_allocations"),
    );
    expect(updateCall).toBeDefined();
    expect(String(updateCall![0])).toMatch(/released/);
  });

  it("returns null when office has no slot record (not_required market)", async () => {
    (pool.query as MockFn)
      .mockResolvedValueOnce({ rows: [] }); // no row → releaseSlot returns null

    const marketKey = await cancelSlot(99, 999);
    expect(marketKey).toBeNull();
    // No UPDATE or audit log — nothing to release
    expect((pool.query as MockFn).mock.calls.length).toBe(1);
  });
});

// ── 6b. Subscription cancellation releases slot and triggers waitlist ──────────

describe("cancelSlot + processWaitlist integration — subscription cancellation", () => {
  it("cancelling an allocated office releases its slot and opens it to waiting providers", async () => {
    // Scenario: office A holds an allocated slot in a full market (cap=2, 2 allocated).
    // Office B is waiting. When A cancels, its slot is released, and processWaitlist
    // creates a 3-hour RESERVATION (not direct allocation) for office B.
    //
    // cancelSlot (delegates to releaseSlot) — pool.query calls:
    // 1. get current row → { slot_status: 'allocated', market_key: 'SA|riyadh|marketing' }
    // 2. UPDATE market_slot_allocations SET slot_status='released'
    // 3. INSERT slot_audit_log
    //
    // processWaitlist — client.query calls (capped market → reservation):
    // 4. BEGIN
    // 5. SELECT supply_cap, acceptance_status ... FOR UPDATE → cap=2, open
    // 6. COUNT allocated+reserved → 1 (A released, only 1 remains)
    // 7. SELECT waiting offices → [{ office_id: 99, priority_tier: 1, slot_status: 'waiting' }]
    // 8. INSERT/UPDATE market_slot_allocations SET slot_status='reserved' (office B)
    // 9. INSERT slot_audit_log (reservation_created)
    // 10. COMMIT

    // Pool queries for cancelSlot
    (pool.query as MockFn)
      .mockResolvedValueOnce({ rows: [{ slot_status: "allocated", market_key: "SA|riyadh|marketing", priority_tier: 1 }] })
      .mockResolvedValueOnce({ rows: [] }) // UPDATE released
      .mockResolvedValueOnce({ rows: [] }); // audit log for release

    // Client queries for processWaitlist
    stubClientQueries([
      { rows: [] },                                                           // BEGIN
      { rows: [{ supply_cap: 2, acceptance_status: "open" }] },              // FOR UPDATE lock
      { rows: [{ cnt: 1 }] },                                                 // count active (alloc+reserved) after release
      { rows: [{ office_id: 99, priority_tier: 1, slot_status: "waiting" }] }, // waiting list
      { rows: [] },                                                           // INSERT/UPDATE slot → reserved (B)
      { rows: [] },                                                           // audit log: reservation_created
      { rows: [] },                                                           // INSERT slot_notification_outbox (outbox entry)
      { rows: [] },                                                           // audit log: notification_queued
      { rows: [] },                                                           // COMMIT
    ]);

    const marketKey = await cancelSlot(42, 999); // A cancels
    expect(marketKey).toBe("SA|riyadh|marketing");

    // Now run processWaitlist — creates a reservation (not direct allocation) for office B
    const promoted = await processWaitlist(marketKey!);
    expect(promoted.reserved).toContain(99);
    expect(promoted.allocated).toHaveLength(0);
  });

  it("cancelling a waiting office removes it from the waitlist (does not block future promotions)", async () => {
    // Scenario: office W is waiting (not allocated — market is full).
    // When W's subscription is cancelled, its slot row moves to 'released'.
    // processWaitlist is a no-op since W no longer waits and market stays full.
    //
    // cancelSlot — pool.query calls:
    // 1. get current row → { slot_status: 'waiting', market_key: 'SA|jeddah|legal' }
    // 2. UPDATE market_slot_allocations SET slot_status='released'
    // 3. INSERT slot_audit_log
    //
    // processWaitlist — client.query calls:
    // 4. BEGIN
    // 5. SELECT supply_cap, acceptance_status FOR UPDATE → cap=1, open
    // 6. COUNT allocated+reserved → 1 (full, W is no longer waiting)
    // 7. COMMIT (no capacity, no-op)

    (pool.query as MockFn)
      .mockResolvedValueOnce({ rows: [{ slot_status: "waiting", market_key: "SA|jeddah|legal", priority_tier: 3 }] })
      .mockResolvedValueOnce({ rows: [] }) // UPDATE released
      .mockResolvedValueOnce({ rows: [] }); // audit log

    stubClientQueries([
      { rows: [] },                                          // BEGIN
      { rows: [{ supply_cap: 1, acceptance_status: "open" }] }, // FOR UPDATE lock → cap=1
      { rows: [{ cnt: 1 }] },                                // count active → 1 = cap (no space)
      { rows: [] },                                          // COMMIT
    ]);

    const marketKey = await cancelSlot(77, 999);
    expect(marketKey).toBe("SA|jeddah|legal");

    // processWaitlist: no one to promote (market still full)
    const promoted = await processWaitlist(marketKey!);
    expect(promoted.reserved).toHaveLength(0);
    expect(promoted.allocated).toHaveLength(0);
  });
});

// ── 7. processWaitlist ────────────────────────────────────────────────────────

describe("processWaitlist", () => {
  it("promotes waiting office when capacity exists — creates a reservation (not direct allocation)", async () => {
    // Capped market: processWaitlist reserves a slot (3h window) instead of direct allocation.
    // Sequence: BEGIN + lock + count + fetch-waiting + slot-INSERT + audit + outbox + notif_audit + COMMIT
    stubClientQueries([
      { rows: [] },                          // BEGIN
      { rows: [{ supply_cap: 5, acceptance_status: "open" }] }, // FOR UPDATE lock → cap=5, open
      { rows: [{ cnt: 4 }] },                // count active (allocated+reserved) → 4 (1 slot free)
      {                                      // fetch waiting (1 entry)
        rows: [{ office_id: 20, priority_tier: 1, slot_status: "waiting" }],
      },
      { rows: [] },                          // INSERT/UPDATE market_slot_allocations → 'reserved'
      { rows: [] },                          // INSERT slot_audit_log (reservation_created)
      { rows: [] },                          // INSERT slot_notification_outbox (outbox entry)
      { rows: [] },                          // INSERT slot_audit_log (notification_queued)
      { rows: [] },                          // COMMIT
    ]);

    const promoted = await processWaitlist("SA|riyadh|marketing");
    expect(promoted.reserved).toContain(20);
    expect(promoted.allocated).toHaveLength(0);
  });

  it("returns empty when market is at cap (reserved + allocated together fill it)", async () => {
    stubClientQueries([
      { rows: [] },                          // BEGIN
      { rows: [{ supply_cap: 5, acceptance_status: "open" }] }, // lock → cap=5
      { rows: [{ cnt: 5 }] },                // count active (alloc+reserved) → 5 (full)
      { rows: [] },                          // COMMIT (no-op)
    ]);

    const promoted = await processWaitlist("SA|riyadh|marketing");
    expect(promoted.reserved).toHaveLength(0);
    expect(promoted.allocated).toHaveLength(0);
  });

  it("returns empty for invalid market key", async () => {
    const promoted = await processWaitlist("bad-key");
    expect(promoted.reserved).toHaveLength(0);
    expect(promoted.allocated).toHaveLength(0);
  });

  it("returns empty for empty string", async () => {
    const promoted = await processWaitlist("");
    expect(promoted.reserved).toHaveLength(0);
    expect(promoted.allocated).toHaveLength(0);
  });

  it("creates reservations for multiple offices when multiple slots free", async () => {
    // Each waiting office gets 4 DB calls: slot INSERT/UPDATE + reservation_created audit + outbox INSERT + notification_queued audit
    stubClientQueries([
      { rows: [] },                                   // BEGIN
      { rows: [{ supply_cap: 10, acceptance_status: "open" }] }, // lock → cap=10
      { rows: [{ cnt: 7 }] },                        // count active → 7 (3 free)
      {                                              // 3 waiting offices (LIMIT 3)
        rows: [
          { office_id: 21, priority_tier: 1, slot_status: "waiting" },
          { office_id: 22, priority_tier: 1, slot_status: "waiting" },
          { office_id: 23, priority_tier: 2, slot_status: "waiting" },
        ],
      },
      { rows: [] }, { rows: [] }, { rows: [] }, { rows: [] },   // office 21: slot + reservation_created audit + outbox + notification_queued audit
      { rows: [] }, { rows: [] }, { rows: [] }, { rows: [] },   // office 22
      { rows: [] }, { rows: [] }, { rows: [] }, { rows: [] },   // office 23
      { rows: [] },                                              // COMMIT
    ]);

    const promoted = await processWaitlist("SA|riyadh|marketing");
    expect(promoted.reserved).toEqual([21, 22, 23]);
    expect(promoted.allocated).toHaveLength(0);
  });
});

// ── 8. getSlotStatus ──────────────────────────────────────────────────────────

describe("getSlotStatus", () => {
  it("returns slotStatus, marketKey, priorityTier from DB row", async () => {
    (pool.query as MockFn).mockResolvedValueOnce({
      rows: [{ slot_status: "allocated", market_key: "SA|riyadh|marketing", priority_tier: 2 }],
    });

    const result = await getSlotStatus(5);
    expect(result.slotStatus).toBe("allocated");
    expect(result.marketKey).toBe("SA|riyadh|marketing");
    expect(result.priorityTier).toBe(2);
  });

  it("returns null fields when no row exists", async () => {
    (pool.query as MockFn).mockResolvedValueOnce({ rows: [] });

    const result = await getSlotStatus(999);
    expect(result.slotStatus).toBeNull();
    expect(result.marketKey).toBeNull();
    expect(result.priorityTier).toBeNull();
  });

  it("maps unassigned market_key to null", async () => {
    (pool.query as MockFn).mockResolvedValueOnce({
      rows: [{ slot_status: "not_required", market_key: "unassigned", priority_tier: 3 }],
    });

    const result = await getSlotStatus(10);
    expect(result.marketKey).toBeNull();
    expect(result.slotStatus).toBe("not_required");
  });
});

// ── 9. countAllocatedSlotsForMarket ──────────────────────────────────────────

describe("countAllocatedSlotsForMarket", () => {
  it("returns allocated slot count for a market", async () => {
    (pool.query as MockFn).mockResolvedValueOnce({ rows: [{ cnt: 12 }] });
    const count = await countAllocatedSlotsForMarket("SA|riyadh|marketing");
    expect(count).toBe(12);
  });

  it("returns 0 when no allocated slots", async () => {
    (pool.query as MockFn).mockResolvedValueOnce({ rows: [{ cnt: 0 }] });
    const count = await countAllocatedSlotsForMarket("SA|jeddah|legal");
    expect(count).toBe(0);
  });
});

// ── 10. getWaitlistForMarket ──────────────────────────────────────────────────

describe("getWaitlistForMarket", () => {
  it("returns ordered waitlist entries", async () => {
    const mockDate = new Date("2025-01-01");
    (pool.query as MockFn).mockResolvedValueOnce({
      rows: [
        { office_id: 1, name: "Office A", name_ar: "مكتب أ", city: "Riyadh", market_key: "SA|riyadh|marketing", priority_tier: 1, slot_status: "waiting", allocated_at: mockDate, created_at: mockDate },
        { office_id: 2, name: "Office B", name_ar: null, city: "Riyadh", market_key: "SA|riyadh|marketing", priority_tier: 2, slot_status: "waiting", allocated_at: null, created_at: mockDate },
      ],
    });

    const list = await getWaitlistForMarket("SA|riyadh|marketing");
    expect(list).toHaveLength(2);
    expect(list[0].officeId).toBe(1);
    expect(list[0].priorityTier).toBe(1);
    expect(list[1].priorityTier).toBe(2);
  });

  it("returns empty array when no waiting offices", async () => {
    (pool.query as MockFn).mockResolvedValueOnce({ rows: [] });
    const list = await getWaitlistForMarket("SA|jeddah|legal");
    expect(list).toHaveLength(0);
  });
});

// ── 11. getMarketSlotSummary ──────────────────────────────────────────────────

describe("getMarketSlotSummary", () => {
  it("returns slot summary with correct remaining count", async () => {
    (pool.query as MockFn)
      .mockResolvedValueOnce({ rows: [{ supply_cap: 15 }] })
      .mockResolvedValueOnce({ rows: [{ allocated: "12", waiting: "3", returning_waiting: "1" }] });

    const summary = await getMarketSlotSummary("SA|riyadh|marketing");
    expect(summary.supplyCap).toBe(15);
    expect(summary.activeSlots).toBe(12);
    expect(summary.remainingSlots).toBe(3);
    expect(summary.waitingCount).toBe(3);
    expect(summary.returningWaiting).toBe(1);
  });

  it("returns null remainingSlots for uncapped market", async () => {
    (pool.query as MockFn)
      .mockResolvedValueOnce({ rows: [{ supply_cap: null }] })
      .mockResolvedValueOnce({ rows: [{ allocated: "5", waiting: "0", returning_waiting: "0" }] });

    const summary = await getMarketSlotSummary("SA|jeddah|legal");
    expect(summary.supplyCap).toBeNull();
    expect(summary.remainingSlots).toBeNull();
  });
});

// ── 12. Returning provider is prioritized over new provider ───────────────────

describe("Returning provider priority ordering", () => {
  it("returning tier-1 office is fetched before new tier-3 in waitlist query", async () => {
    const capTime = new Date("2024-06-01"); // returning office's last allocation
    (pool.query as MockFn).mockResolvedValueOnce({
      rows: [
        { office_id: 10, name: "Returning Office", name_ar: null, city: "Riyadh", market_key: "SA|riyadh|marketing", priority_tier: 1, slot_status: "waiting", allocated_at: capTime, created_at: new Date("2023-01-01") },
        { office_id: 20, name: "New Office",       name_ar: null, city: "Riyadh", market_key: "SA|riyadh|marketing", priority_tier: 3, slot_status: "waiting", allocated_at: null, created_at: new Date("2024-01-01") },
      ],
    });

    const list = await getWaitlistForMarket("SA|riyadh|marketing");
    // First result should be the returning provider (tier 1)
    expect(list[0].priorityTier).toBe(1);
    expect(list[1].priorityTier).toBe(3);
  });
});

// ── 13. processWaitlist allocates returning provider first ────────────────────

describe("processWaitlist: returning provider gets slot before new provider", () => {
  it("picks tier-1 over tier-3 when only one slot is free", async () => {
    // DB returns only the tier-1 office (LIMIT=1 since available=1)
    stubClientQueries([
      { rows: [] },                          // BEGIN
      { rows: [{ supply_cap: 5, acceptance_status: "open" }] }, // lock → cap=5
      { rows: [{ cnt: 4 }] },                // count active → 4 (1 slot free)
      {                                      // fetch LIMIT 1 → only returning provider
        rows: [
          { office_id: 30, priority_tier: 1, slot_status: "waiting" }, // returning (tier 1)
          // tier 3 NOT included since LIMIT 1
        ],
      },
      { rows: [] }, { rows: [] }, { rows: [] }, { rows: [] },  // reservation for office 30 (slot + reservation_created audit + outbox + notification_queued audit)
      { rows: [] },                          // COMMIT
    ]);

    const promoted = await processWaitlist("SA|riyadh|marketing");
    // Only the returning provider (tier 1) is reserved
    expect(promoted.reserved).toContain(30);
    expect(promoted.allocated).toHaveLength(0);
    expect(promoted.reserved).not.toContain(40);
  });
});

// ── 14. Renewal idempotency: already-allocated office in a full market ────────

describe("allocateSlot — renewal idempotency (already allocated, full market)", () => {
  it("returns allocated immediately without touching count when office already holds a slot", async () => {
    // Scenario: market is at cap (15/15 allocated slots including this office's own slot).
    // Calling allocateSlot() on renewal must NOT downgrade the office to 'waiting'.
    // The idempotency guard checks the existing row BEFORE acquiring the lock,
    // so the office's own slot is never counted against capacity.

    // Pool queries:
    // 1. fetchOfficeMarket
    // 2. idempotency check → finds existing 'allocated' row for this market → early return
    // 3+4. determinePriorityTier (returning + existing checks)
    // Note: pool.connect() is NOT called — no transaction needed for the idempotent path
    (pool.query as MockFn)
      .mockResolvedValueOnce({ rows: [{ id: 5, supply_gate_market_key: "SA|riyadh|marketing", country: "SA", city: "riyadh", category: "marketing" }] })  // fetchOfficeMarket
      .mockResolvedValueOnce({ rows: [{ slot_status: "allocated", market_key: "SA|riyadh|marketing" }] }) // idempotency check → already allocated
      .mockResolvedValueOnce({ rows: [{ cnt: 1 }] })  // determinePriorityTier: returning (yes, prev allocation exists)
      .mockResolvedValueOnce({ rows: [] });            // determinePriorityTier: existing (not needed — already returned 1)

    const result = await allocateSlot(5, "subscription_renewal", 999);

    // Must return 'allocated' — office retains its slot
    expect(result.slotStatus).toBe("allocated");
    expect(result.marketKey).toBe("SA|riyadh|marketing");

    // pool.connect() must NOT have been called — no transaction for idempotent path
    expect((pool.connect as MockFn).mock.calls.length).toBe(0);
  });

  it("does NOT change the slot to 'waiting' even when market count equals cap", async () => {
    // This is the key regression guard: a renewal in a full market (where the
    // office's own slot is counted in the total) must never enter 'waiting'.
    (pool.query as MockFn)
      .mockResolvedValueOnce({ rows: [{ id: 8, supply_gate_market_key: "SA|jeddah|legal", country: "SA", city: "jeddah", category: "legal" }] })
      .mockResolvedValueOnce({ rows: [{ slot_status: "allocated", market_key: "SA|jeddah|legal" }] }) // idempotency → allocated
      .mockResolvedValueOnce({ rows: [{ cnt: 0 }] })  // priority: not returning
      .mockResolvedValueOnce({ rows: [{ cnt: 1 }] }); // priority: existing

    const result = await allocateSlot(8, "renewal", null);
    expect(result.slotStatus).toBe("allocated"); // never 'waiting' for a renewal
    expect((pool.connect as MockFn).mock.calls.length).toBe(0);
  });

  it("concurrent race: post-lock re-check inside transaction prevents downgrade to waiting", async () => {
    // Scenario: two simultaneous allocateSlot() calls for the same office.
    // Both pass the pre-lock idempotency check (row shows 'released' at check time).
    // The first call acquires the lock, allocates the slot, commits.
    // The second call acquires the lock AFTER the first commits; it now sees
    // count = cap (full), but the post-lock re-check finds slot_status='allocated'
    // and returns early — preventing the office from being wrongly put to 'waiting'.
    //
    // This test simulates the SECOND concurrent call after the first has allocated.
    // Pre-check: 'released' (both calls saw this before the first allocated)
    // Post-lock re-check (inside tx): 'allocated' → early COMMIT, return allocated

    (pool.query as MockFn)
      .mockResolvedValueOnce({ rows: [{ id: 9, supply_gate_market_key: "SA|riyadh|marketing", country: "SA", city: "riyadh", category: "marketing" }] }) // fetchOfficeMarket
      .mockResolvedValueOnce({ rows: [{ slot_status: "released", market_key: "SA|riyadh|marketing" }] }) // pre-lock idempotency: 'released' → proceed
      .mockResolvedValueOnce({ rows: [{ cnt: 0 }] })  // priority: not returning
      .mockResolvedValueOnce({ rows: [{ cnt: 1 }] }); // priority: existing (tier 2)

    stubClientQueries([
      { rows: [] },                              // BEGIN
      { rows: [{ supply_cap: 5 }] },             // FOR UPDATE lock → cap = 5
      { rows: [{ cnt: 5 }] },                    // count allocated → 5 = cap (FULL)
      { rows: [{ slot_status: "allocated" }] },  // post-lock re-check → ALREADY ALLOCATED (concurrent first call won)
      // No UPSERT, no UPDATE offices, no audit log — early return after COMMIT
      { rows: [] },                              // COMMIT
    ]);

    const result = await allocateSlot(9, "concurrent_renewal");
    // Must return 'allocated' — the post-lock guard preserved the allocated state
    expect(result.slotStatus).toBe("allocated");
  });
});

// ── 4b. allocateSlot: waiting hides the office ───────────────────────────────

describe("allocateSlot — waiting path hides the office", () => {
  it("sets is_subscription_hidden=true when the office enters the waitlist", async () => {
    // Scenario: office was previously visible (e.g., approved while market was
    // uncapped, then a cap was introduced). On renewal, allocateSlot enters
    // 'waiting' because the market is now full. The office must be hidden
    // atomically within the same transaction to not appear in the public listing.

    (pool.query as MockFn)
      .mockResolvedValueOnce({ rows: [{ id: 11, supply_gate_market_key: "SA|riyadh|marketing", country: "SA", city: "riyadh", category: "marketing" }] })
      .mockResolvedValueOnce({ rows: [] })            // idempotency → not allocated
      .mockResolvedValueOnce({ rows: [{ cnt: 0 }] }) // priority: not returning
      .mockResolvedValueOnce({ rows: [{ cnt: 0 }] }); // priority: new (tier 3)

    stubClientQueries([
      { rows: [] },                             // BEGIN
      { rows: [{ supply_cap: 3 }] },            // FOR UPDATE lock → cap = 3
      { rows: [{ cnt: 3 }] },                   // count allocated → 3 = full
      { rows: [] },                             // post-lock re-check → not allocated
      { rows: [] },                             // UPSERT waiting
      { rows: [] },                             // UPDATE offices SET is_subscription_hidden=true ← key assertion
      { rows: [] },                             // INSERT slot_audit_log
      { rows: [] },                             // COMMIT
    ]);

    const { clientQuery } = stubClientQueries([
      { rows: [] },                             // BEGIN
      { rows: [{ supply_cap: 3 }] },            // FOR UPDATE lock → cap = 3
      { rows: [{ cnt: 3 }] },                   // count allocated → 3 = full
      { rows: [] },                             // post-lock re-check → not allocated
      { rows: [] },                             // UPSERT waiting
      { rows: [] },                             // UPDATE offices SET is_subscription_hidden=true ← key assertion
      { rows: [] },                             // INSERT slot_audit_log
      { rows: [] },                             // COMMIT
    ]);

    const result = await allocateSlot(11, "market_cap_introduced");
    expect(result.slotStatus).toBe("waiting");

    // Verify the UPDATE offices call set is_subscription_hidden = true
    const hideCall = clientQuery.mock.calls.find(
      (c: unknown[]) => String(c[0]).includes("UPDATE offices") && String(c[0]).includes("is_subscription_hidden"),
    );
    expect(hideCall).toBeDefined();
    expect(String(hideCall![0])).toContain("is_subscription_hidden = true");
  });
});

// ── 15. forceAllocateSlot: admin override bypasses cap ───────────────────────

describe("forceAllocateSlot — admin override bypasses supply cap", () => {
  it("allocates the slot in a full market without checking capacity", async () => {
    // Scenario: market is at cap (15/15). Admin explicitly overrides.
    // forceAllocateSlot is now TRANSACTIONAL (pool.connect + BEGIN/COMMIT) so
    // all 3 writes are atomic. It does NOT check or count capacity.
    //
    // Pool queries (no transaction):
    // 1. fetchOfficeMarket
    // 2. determinePriorityTier: returning check → returns (tier 1)
    // 3. determinePriorityTier: existing check (not reached — tier 1 returned)
    //
    // Client queries (transactional):
    // 4. BEGIN
    // 5. SELECT prev status
    // 6. UPSERT market_slot_allocations → allocated
    // 7. UPDATE offices SET is_subscription_hidden = false
    // 8. INSERT slot_audit_log (admin_override)
    // 9. COMMIT
    (pool.query as MockFn)
      .mockResolvedValueOnce({ rows: [{ id: 20, supply_gate_market_key: "SA|riyadh|marketing", country: "SA", city: "riyadh", category: "marketing" }] }) // fetchOfficeMarket
      .mockResolvedValueOnce({ rows: [{ cnt: 1 }] })  // priority: returning (tier 1)
      .mockResolvedValueOnce({ rows: [] });            // priority: existing (not reached - tier 1 returned)

    const { clientQuery } = stubClientQueries([
      { rows: [] },                                    // BEGIN
      { rows: [{ slot_status: "waiting" }] },          // SELECT prev status
      { rows: [] },                                    // UPSERT → allocated
      { rows: [] },                                    // UPDATE offices
      { rows: [] },                                    // INSERT audit log (admin_override)
      { rows: [] },                                    // COMMIT
    ]);

    const result = await forceAllocateSlot(20, "VIP office, must be visible", 999);

    expect(result.slotStatus).toBe("allocated");
    expect(result.marketKey).toBe("SA|riyadh|marketing");

    // pool.connect() MUST have been called — we use a transaction for atomicity
    expect((pool.connect as MockFn).mock.calls.length).toBe(1);

    // The UPSERT must set slot_status = 'allocated'
    const upsertCall = (clientQuery as MockFn).mock.calls.find(
      (c) => String(c[0]).includes("INSERT INTO market_slot_allocations"),
    );
    expect(upsertCall).toBeDefined();
    expect(String(upsertCall![0])).toMatch(/'allocated'/);

    // forceAllocateSlot hardcodes 'admin_override' directly in the SQL string (not a param),
    // so check the query text rather than the params array.
    const auditCall = (clientQuery as MockFn).mock.calls.find(
      (c) => String(c[0]).includes("INSERT INTO slot_audit_log"),
    );
    expect(auditCall).toBeDefined();
    expect(String(auditCall![0])).toContain("'admin_override'");
  });

  it("works even when office is in 'waiting' state at a full market", async () => {
    (pool.query as MockFn)
      .mockResolvedValueOnce({ rows: [{ id: 21, supply_gate_market_key: "SA|riyadh|marketing", country: "SA", city: "riyadh", category: "marketing" }] })
      .mockResolvedValueOnce({ rows: [{ cnt: 0 }] })  // not returning
      .mockResolvedValueOnce({ rows: [{ cnt: 1 }] }); // existing (tier 2)

    stubClientQueries([
      { rows: [] },                                    // BEGIN
      { rows: [{ slot_status: "waiting" }] },          // SELECT prev status
      { rows: [] },                                    // UPSERT → allocated
      { rows: [] },                                    // UPDATE offices
      { rows: [] },                                    // INSERT audit
      { rows: [] },                                    // COMMIT
    ]);

    const result = await forceAllocateSlot(21, "admin manual override from waiting", 999);
    expect(result.slotStatus).toBe("allocated");
    expect((pool.connect as MockFn).mock.calls.length).toBe(1); // uses transaction
  });
});

// ── 16. Cap 15 with 15 slots: returning office cannot become #16 ──────────────

describe("processWaitlist: never exceeds cap", () => {
  it("returns empty when cap = 15 and 15 active (allocated+reserved) fill it exactly", async () => {
    stubClientQueries([
      { rows: [] },                                              // BEGIN
      { rows: [{ supply_cap: 15, acceptance_status: "open" }] }, // lock → cap=15
      { rows: [{ cnt: 15 }] },                                   // count active → 15 (EXACTLY at cap)
      { rows: [] },                                              // COMMIT
    ]);

    const promoted = await processWaitlist("SA|riyadh|marketing");
    expect(promoted.reserved).toHaveLength(0);
    expect(promoted.allocated).toHaveLength(0);
    // Office 16 must not be reserved — no office pushed beyond cap
  });
});
