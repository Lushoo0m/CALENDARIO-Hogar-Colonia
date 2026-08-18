// sw.js — service worker mínimo, solo para que el navegador permita
// "Agregar a la pantalla de inicio" como una app instalable. A propósito
// NO cachea nada (todo pasa directo a la red) para no repetir el problema
// de versiones viejas de ui.js/core.js quedando pegadas en el celular.
self.addEventListener('install', () => {
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
