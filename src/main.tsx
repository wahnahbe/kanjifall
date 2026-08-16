import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './ui/tokens.css'
// Word face — needs Japanese; 1.9 MB slice, served locally from our own dist.
import '@fontsource/shippori-mincho-b1/japanese-600.css'
import '@fontsource/shippori-mincho-b1/latin-600.css'
// Display face — brush, headings only.
import '@fontsource/yuji-syuku/japanese-400.css'
import '@fontsource/yuji-syuku/latin-400.css'
// UI + mono — latin only.
import '@fontsource/chakra-petch/latin-500.css'
import '@fontsource/chakra-petch/latin-700.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-600.css'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
