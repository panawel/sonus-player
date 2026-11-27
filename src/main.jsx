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

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isTagEditorWindow ? <TagEditorWindow /> : isStripWindow ? <StripApp /> : <App />}
  </StrictMode>,
)
