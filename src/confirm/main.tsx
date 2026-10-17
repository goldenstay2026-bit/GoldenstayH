import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { ConfirmPage } from './ConfirmPage';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfirmPage />
  </StrictMode>,
);
