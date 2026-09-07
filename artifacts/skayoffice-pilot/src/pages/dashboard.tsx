/**
 * This file is a thin re-export shim. The Dashboard component was refactored
 * into a modular directory at src/pages/dashboard/ (one file per section) to
 * support the new sidebar/bottom-nav shell and 12-section layout.
 *
 * App.tsx imports `{ Dashboard }` from '@/pages/dashboard' and Vite resolves
 * this file first (file beats directory), so we forward the export here.
 */
export { Dashboard } from './dashboard/index';
