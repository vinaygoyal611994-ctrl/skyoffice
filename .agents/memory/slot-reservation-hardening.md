---
name: Slot Reservation Hardening
description: Slot reservation system — processWaitlist return shape, forceAllocateSlot audit SQL pattern, orval termsAccepted gap.
---

## processWaitlist return shape

`processWaitlist()` now returns `{ reserved: number[], allocated: number[] }` (not `number[]`).
- **Capped markets** → creates 3-hour reservations (`reserved[]`), `allocated[]` is empty.
- **Uncapped markets** → direct allocations (`allocated[]`), `reserved[]` is empty.
- Tests must use `promoted.reserved.toContain(id)` / `promoted.allocated.toHaveLength(0)`.

**Why:** Capped markets require a payment confirmation step before going fully active. Direct allocation at processWaitlist time would bypass that flow.

## forceAllocateSlot audit SQL pattern

`forceAllocateSlot` hardcodes `'admin_override'` directly in the INSERT SQL text (not as a `$N` param). Test assertions must check the **query text**, not the params array:
```typescript
expect(String(auditCall![0])).toContain("'admin_override'");  // correct
expect(auditParams[2]).toBe("admin_override");                // wrong — index 2 is slotStatusBefore
```

**How to apply:** Any new test for `forceAllocateSlot` audit should check the SQL string, not params[2].

## countActiveSlots includes reserved + allocated

`countActiveSlots` (used inside processWaitlist transaction) counts both `slot_status IN ('allocated', 'reserved')` — not just allocated. Test stubs for the count query must reflect that reserved slots consume capacity.

## CustomerRegisterInput termsAccepted gap

`openapi.yaml` `CustomerRegisterInput` was missing `termsAccepted: boolean` in its `required` list and properties, even though `OfficeRegisterInput` had it. This caused orval to omit the field from `RegisterCustomerBody`, breaking consent tests.

**How to apply:** After adding any `required` field to one registration schema, grep for the corresponding schema for the other actor type and add it there too.
