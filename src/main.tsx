import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { media, player } from './lib/engine'
import { library } from './lib/library'
import { settings } from './lib/settings'
import { mixerLevel, mixerRunning } from './lib/mixer'

// Diagnostics hook for automated tests (opt-in via localStorage.setItem('mono.debug','1')).
if (localStorage.getItem('mono.debug')) (window as unknown as Record<string, unknown>).__mono = { media, player, library, settings, mixerLevel, mixerRunning }


ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
