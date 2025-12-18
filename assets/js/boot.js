// assets/js/boot.js
// Точка входа для страницы карты Trans-Time.

import { toast } from './core.js';
import { init as initMap } from './map.js';
import { initUI } from './ui.js';
import { renderSavedRoutes } from './storage.js';

// ВАЖНО: подключаем слои/сервисы как side-effect модули
// Чтобы window.__TT_LAYERS и window.__TT_FRAMES_SERVICE гарантированно существовали.
import './layers.js';
import './frames-service.js';

// ✅ КРИТИЧНО: маршрутизация и список альтернатив живут в router.js
import './router.js';

// Глобальное состояние via-точек (если кто-то ещё полагается на window.routes)
if (typeof window !== 'undefined') {
  window.routes = window.routes || {};
  window.routes.viaPoints = window.routes.viaPoints || [];
  window.routes.viaMarkers = window.routes.viaMarkers || [];
}

let booted = false;

async function boot() {
  if (booted) return;
  booted = true;

  try {
    // 1. Инициализируем карту и геолокацию
    await initMap();

    // 2. Запускаем UI (панель, кнопки, детали)
    initUI();

    // 3. Рендер избранных маршрутов
    if (typeof renderSavedRoutes === 'function') {
      renderSavedRoutes();
    }
  } catch (e) {
    console.error('[TT] boot failed:', e);
    try {
      toast('Не удалось инициализировать карту. Попробуйте обновить страницу.', 5000);
    } catch (_) {}
  }
}

boot();
