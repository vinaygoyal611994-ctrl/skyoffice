import { createRoot } from 'react-dom/client';
import { setAuthTokenGetter } from '@workspace/api-client-react';

import App from './App';
import { getSessionToken } from '@/lib/sessionToken';
import { initializeFrontendSentry } from '@/lib/sentry';

import './index.css';

initializeFrontendSentry();

// See src/lib/sessionToken.ts — the published site can't rely on a
// cookie-delivered session, so every request carries the session id
// ourselves via this bearer token getter.
setAuthTokenGetter(getSessionToken);

createRoot(document.getElementById('root')!).render(<App />);
