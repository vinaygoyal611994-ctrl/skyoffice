---
name: Zod intersection schemas lack .passthrough()
description: The generated api-zod schemas use .and() making them ZodIntersection, which does NOT have .passthrough(). Calling it crashes at runtime.
---

## Rule
Never call `.passthrough()` on the generated response schemas in `lib/api-zod/src/generated/api.ts`. They use `.and(zod.object({...}))` which produces a `ZodIntersection`, not a `ZodObject`. `ZodIntersection` has no `.passthrough()` method — calling it throws `TypeError: XxxResponse.passthrough is not a function` at runtime.

**Why:** The orval-generated schemas chain multiple `.and()` intersections to compose the response shape. This breaks the ZodObject prototype chain. The error is silent at compile time (TypeScript doesn't catch it) but fatal at runtime.

**How to apply:**
- When a response serializer returns extra fields not in the generated schema, do NOT use `.parse()` or `.passthrough()` on the response. Just `res.json(await serializeXxx(...))` directly.
- Response Zod parsing provides no security benefit (it's only type enforcement). The serializer already guarantees the correct shape.
- Input Zod parsing (`req.body`, `req.params`, `req.query`) is still valid and safe — those schemas tend to be plain ZodObject instances.
- Pattern to use: `res.json(await serializeOfficeProfile(office))` NOT `res.json(SomeResponse.parse(await serializeOfficeProfile(office)))`.
