---
name: SkayOffice form validation i18n pattern
description: How to write Zod/react-hook-form validation schemas so error messages always appear in the active UI language (Arabic/English).
---

All registration and login forms use a **schema factory** pattern so error messages are always in the current language:

```ts
// 1. Define a factory outside the component
function makeSchema(t: (k: string) => string) {
  return z.object({
    name: z.string().min(2, t('validation.min_2')),
    email: z.string().email(t('validation.email_invalid')),
    // ...
  });
}

// 2. Inside the component — resolver reads the factory on every validation call
const { t, language } = useI18n();
const form = useForm({
  resolver: (...args) => zodResolver(makeSchema(t))(...args),
  defaultValues: { ... },
});

// 3. Clear stale errors immediately when language changes
useEffect(() => { form.clearErrors(); }, [language]);
```

**Why:** Zod schemas defined at module level (outside the component) are created once before `t()` is available — so all messages come out in English (Zod's default) or as raw keys. The factory pattern + resolver closure always uses the latest `t` at validation time.

**Key validation i18n keys** (in `src/lib/i18n.ts`):
- `validation.required`, `validation.email_invalid`
- `validation.min_2`, `validation.min_5`, `validation.min_6`, `validation.min_8`
- `validation.provider_type_required`
- `auth.terms_error` (reused — already existed)

**How to apply:** any new form with Zod validation must use this factory pattern. Never define a schema at module/file scope if it needs translated error messages.
