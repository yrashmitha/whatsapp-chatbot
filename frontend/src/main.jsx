import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// The app never scrolls the page itself: every list scrolls inside its own
// box. iOS still shifts the whole page up to make room for the keyboard, or
// for a scroll it starts itself, and on a home screen web app it often leaves
// it there, with the header stuck under the status bar. Put it back whenever
// the keyboard closes or the visible area changes.
try {
  const resetPage = () => {
    const se = document.scrollingElement || document.documentElement;
    if (window.scrollY || se.scrollTop || document.body.scrollTop) {
      window.scrollTo(0, 0);
      se.scrollTop = 0;
      document.body.scrollTop = 0;
    }
  };
  document.addEventListener('focusout', () => setTimeout(resetPage, 60));
  window.visualViewport?.addEventListener('resize', () => setTimeout(resetPage, 60));
  window.addEventListener('pageshow', resetPage);

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') resetPage(); });
} catch (_) { /* never let this stop the app */ }

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
