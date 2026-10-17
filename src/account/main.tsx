import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { AuthProvider } from '../lib/auth';
import { Account } from './Account';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <Account />
    </AuthProvider>
  </StrictMode>,
);
