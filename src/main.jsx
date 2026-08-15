import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import TagEditorWindow from './TagEditorWindow.jsx'

// The Tag Editor opens as its own BrowserWindow (electron/main.js) loading
// this same bundle with ?editor=1 — same pattern as the ?test=1 smoke-test gate.
const isTagEditorWindow = new URLSearchParams(window.location.search).has('editor');

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isTagEditorWindow ? <TagEditorWindow /> : <App />}
  </StrictMode>,
)
