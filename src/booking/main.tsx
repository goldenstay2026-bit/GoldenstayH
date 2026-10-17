import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { AuthProvider } from '../lib/auth';
import { BookingPage } from './BookingPage';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <BookingPage />
    </AuthProvider>
  </StrictMode>,
);
