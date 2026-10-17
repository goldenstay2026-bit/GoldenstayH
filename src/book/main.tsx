import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { AuthProvider } from '../lib/auth';
import { Checkout } from './Checkout';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <Checkout />
    </AuthProvider>
  </StrictMode>,
);
