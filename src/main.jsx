import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import TagEditorWindow from './TagEditorWindow.jsx'
import StripApp from './StripApp.jsx'

// The Tag Editor opens as its own BrowserWindow (electron/main.js) loading
// this same bundle with ?editor=1 — same pattern as the ?test=1 smoke-test gate.
const params = new URLSearchParams(window.location.search);
const isTagEditorWindow = params.has('editor');
// Strip mode's slim player beside the Dock is its own window too (?strip=1, StripApp.jsx).
const isStripWindow = params.has('strip');

// Keyboard navigation (every window): the glass focus ring (index.css) shows only after the Tab key
// moved focus, never because a button got focus some other way (from code, or left over) and a key
// like Space or an arrow was then pressed — that is when Chromium used to draw the system's
// accent-coloured ring. Tab turns it on; any mouse, trackpad or touch press turns it off.
document.addEventListener('keydown', (e) => { if (e.key === 'Tab') document.documentElement.dataset.kbdNav = '1'; }, true);
document.addEventListener('pointerdown', () => { delete document.documentElement.dataset.kbdNav; }, true);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isTagEditorWindow ? <TagEditorWindow /> : isStripWindow ? <StripApp /> : <App />}
  </StrictMode>,
)
