import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import './brand.css'
import './auth.css'
import './dashboard.css'
import './modules.css'
import './forms.css'
import './reports.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
