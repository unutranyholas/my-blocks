import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Recorder from './machines/recorder/recorder'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <div><Recorder /></div>
  </StrictMode>,
)
