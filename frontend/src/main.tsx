import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';
import { useTheme } from '@/lib/theme';
import { App } from './App';
import './index.css';

function Root() {
  return (
    <>
      <App />
      <Toaster theme={useTheme()} />
    </>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Root /></StrictMode>);
