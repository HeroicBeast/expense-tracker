import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Offline service worker — caches the app shell so the PWA opens instantly
// on Android with zero connectivity. Registered relative to the page so it
// works from GitHub Pages project sub-paths. Production only, so the dev
// server never serves a stale cache.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* SW is a progressive enhancement; the app works without it */
    });
  });
}
