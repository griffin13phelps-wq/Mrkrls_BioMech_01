import './ui/styles.css';
import { mountApp } from './ui/app';

mountApp(document.getElementById('app')!);

// Service worker: caches the app and the MediaPipe library/model for offline use.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch((e) => {
      console.warn('Service worker registration failed', e);
    });
  });
}
