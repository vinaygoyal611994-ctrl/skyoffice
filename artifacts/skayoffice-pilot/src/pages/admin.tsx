// Re-exports the new modular Admin dashboard.
// App.tsx imports `{ Admin } from '@/pages/admin'` which resolves to this file
// first (admin.tsx takes priority over admin/index.tsx in Vite resolution),
// so this thin re-export wires the new shell without touching App.tsx.
export { Admin } from './admin/index';
