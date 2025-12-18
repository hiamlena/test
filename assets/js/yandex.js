// assets/js/yandex.js
// Простая инициализация карты и маршрута через ymaps для отдельных страниц.
// НЕ используется на модульной главной, где есть map.js/router.js.

import { __TT_CONFIG } from './config.js';

let map = null;
let multiRoute = null;

const hasWindow = typeof window !== 'undefined';
const hasDom = typeof document !== 'undefined';

// Обновляем/создаём глобал с картой и конфигом
function ensureGlobals() {
  if (!hasWindow) return;
  window.__TT_MAP = window.__TT_MAP || {};
  window.__TT_MAP.config = __TT_CONFIG;
  if (map) {
    window.__TT_MAP.map = map;
  }
}

function initMap() {
  if (typeof ymaps === 'undefined') {
    console.error('[TT] yandex.js: ymaps не определён, initMap не будет выполнен');
    return;
  }
  if (!hasDom) {
    console.error('[TT] yandex.js: document недоступен, карта не может быть инициализирована');
    return;
  }

  const container = document.getElementById('map');
  if (!container) {
    console.error('[TT] yandex.js: не найден контейнер #map');
    return;
  }

  map = new ymaps.Map(container, {
    center: [37.62, 55.75], // Москва, [долгота, широта]
    zoom: 10,
    controls: []
  });

  ensureGlobals();
  setupRouting();
}

function setupRouting() {
  if (!hasDom) return;

  const fromInput = document.getElementById('from');
  const toInput = document.getElementById('to');
  const buildBtn = document.getElementById('buildBtn');

  if (!fromInput || !toInput || !buildBtn) {
    console.warn('[TT] yandex.js: элементы формы маршрута не найдены (from/to/buildBtn)');
    return;
  }

  buildBtn.addEventListener('click', async () => {
    const from = fromInput.value.trim();
    const to = toInput.value.trim();

    if (!from || !to) {
      return;
    }

    try {
      // Стандартное геокодирование, без json:true
      const [fromRes, toRes] = await Promise.all([
        ymaps.geocode(from, { results: 1 }),
        ymaps.geocode(to, { results: 1 })
      ]);

      const fromObj = fromRes && fromRes.geoObjects && fromRes.geoObjects.get(0);
      const toObj = toRes && toRes.geoObjects && toRes.geoObjects.get(0);

      const fromCoords = fromObj && fromObj.geometry && fromObj.geometry.getCoordinates();
      const toCoords = toObj && toObj.geometry && toObj.geometry.getCoordinates();

      if (!fromCoords || !toCoords) {
        console.error('[TT] yandex.js: не найдены координаты для одной из точек');
        return;
      }

      // ymaps.geometry.getCoordinates() уже возвращает [долгота, широта],
      // поэтому никакой ручной перестановки не делаем. // исправлено
      const points = [fromCoords, toCoords];

      if (multiRoute) {
        try {
          map.geoObjects.remove(multiRoute);
        } catch (e) {
          console.warn('[TT] yandex.js: не удалось удалить старый маршрут', e);
        }
      }

      multiRoute = new ymaps.multiRouter.MultiRoute(
        {
          referencePoints: points,
          params: {
            results: 2,
            routingMode: 'auto'
          }
        },
        {
          boundsAutoApply: true
        }
      );

      map.geoObjects.add(multiRoute);
    } catch (e) {
      console.error('[TT] yandex.js: ошибка геокодирования', e);
    }
  });
}

// Запускаем initMap, только если ymaps доступен
if (typeof ymaps !== 'undefined' && ymaps.ready) {
  ymaps.ready(initMap);
} else {
  console.error('[TT] yandex.js: ymaps недоступен при загрузке модуля, initMap не запланирован');
}

// Инициализируем глобал конфигом даже до карты
ensureGlobals();

// Явный пустой экспорт, чтобы файл был ES-модулем
export {};
