import { mountGame } from './main';

// Standalone entry (single-file build target). Styles + everything else are
// injected by the game itself, so this works from file:// or any static host.
window.addEventListener('DOMContentLoaded', () => {
  const holder = document.createElement('div');
  document.body.appendChild(holder);
  mountGame(holder);
  document.getElementById('ns-boot')?.remove();
});
