---
name: SkayOffice admin login dedicated route
description: How admin accounts authenticate in SkayOffice Pilot — relevant for any testing, QA, or auth-flow work on this app.
---

Admins have their own dedicated login page at `/admin/login` (`src/pages/login-admin.tsx`, `LoginAdmin` component).

- `ProtectedRoute role="admin"` redirects unauthenticated users to `/admin/login` (not `/login/customer`).
- Successful login on `/admin/login` redirects to `/admin`.
- If a non-admin role logs in on `/admin/login`, an error is shown and the session token is NOT captured.
- The `LoginCustomer` form no longer has an admin backdoor — admins must use `/admin/login`.
- The admin dashboard `handleLogout` (in `src/pages/admin/index.tsx`) now calls `clearSessionToken()` + `queryClient.removeQueries()` + `setLocation('/', { replace: true })`, matching the Shell.tsx pattern — important for the bfcache guard to work.
- `AccountSettings.tsx` password-change redirect goes to `/admin/login` (was `/login/customer`).
- The public hamburger menu "دخول الإدارة" link points to `/admin/login`.

**Why:** admin role now has full role separation matching offices and customers.

**How to apply:** when testing/QA'ing admin flows, navigate to `/admin/login` (or `/admin` which auto-redirects there). Use `admin@skayoffice.demo` / `SEED_ADMIN_PASSWORD`.
