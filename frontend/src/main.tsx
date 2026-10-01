import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { migrateSeatingStorage } from './seating/storage';
import './App.css';
import { initTestVersionSync, runOneTimeTestForceRefresh } from './utils/testVersionSync';
import { cacheFullUiFontAfterReveal, loadUiFontBeforeReveal } from './utils/uiFont';

const AUTUMN_TERM_FORCE_REFRESH_ID = '2026-autumn-celebration-v1';


async function startApp(): Promise<void> {
  // The preload begins in index.html. Start decoding immediately, but keep the
  // lightweight boot card visible until the UI font is stable.
  const uiFontPromise = loadUiFontBeforeReveal();
  if (await runOneTimeTestForceRefresh(AUTUMN_TERM_FORCE_REFRESH_ID)) {
    return;
  }
  await uiFontPromise;
  migrateSeatingStorage();
  initTestVersionSync();

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
  cacheFullUiFontAfterReveal();
}

void startApp();
