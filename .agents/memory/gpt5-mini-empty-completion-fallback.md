---
name: gpt-5-mini empty/over-conservative completions
description: Two related gpt-5-mini (reasoning model) pitfalls seen building a knowledge-restricted AI assistant — low max_completion_tokens silently produces empty text, and strict "only use approved knowledge" prompts can make it discard a whole answer over one uncovered sub-question.
---

Two failure modes hit together when building an OpenAI-based assistant restricted to admin-provided knowledge (via the AI Integrations proxy, gpt-5-mini):

1. **Silent empty completions at low token budgets.** `max_completion_tokens: 500` reliably returned an empty `message.content` (reasoning tokens consumed the whole budget, no visible output, no error/exception). The ai-integrations-openai skill's own guidance (`max_completion_tokens: 8192`, never lower) exists for exactly this reason — treat it as a hard floor, not a suggestion, for any gpt-5/gpt-5-mini reasoning-model call.

2. **Over-conservative full-refusal on multi-part questions.** Even at 8192 tokens, a strict "if the approved knowledge does not answer the customer's question, respond with exactly this fallback message" instruction made the model discard an entire answer (including parts it clearly could answer) just because one sub-question (e.g. "what languages do you support") wasn't explicitly covered.

**Why:** Both are invisible in normal testing — no exception is thrown, and a single-clause test question won't expose #2. They only surface when testing realistic multi-part user questions with real generated text, not just checking for HTTP success.

**How to apply:** For knowledge-restricted assistants, (a) always use `max_completion_tokens: 8192`, and (b) phrase the "stay in scope" instruction as "answer whatever the approved knowledge DOES cover, even partially; only for the uncovered part, append the fallback message" instead of an all-or-nothing gate. Verify with a manual multi-clause question end-to-end (not just a curl smoke test) before considering an AI-reply feature done.
