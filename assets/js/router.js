// assets/js/router.js
// Маршрутизация Trans-Time на основе Яндекс.Карт 2.1 (multiRouter.MultiRoute).
// Выбор альтернатив, обновление рамок.

import { $, toast } from './core.js';

const hasWindow = typeof window !== 'undefined';
const hasDom = typeof document !== 'undefined';

let multiRoute = null;
let _countTimer = null;

/* ------------------------------------------------------
   ✅ Detour state (кнопка "Попробовать объезд")
------------------------------------------------------ */
const detourState = {
  busy: false,
  originalViaPoints: null,
  lastFrameId: null
};

const ROUTE_ORDER_KEY = '__ttCoordOrder';

/* ------------------------------------------------------
   Получение карты
------------------------------------------------------ */
function getMap() {
  if (!hasWindow) return null;
  return window.map || (window.__TT_MAP && window.__TT_MAP.map) || null;
}

/* ------------------------------------------------------
   Frames-service
------------------------------------------------------ */
function getFramesService() {
  if (!hasWindow) return null;
  return window.__TT_FRAMES_SERVICE || null;
}

/* ------------------------------------------------------
   Режим "Легковой"
------------------------------------------------------ */
function isCarMode() {
  if (!hasDom) return false;
  const carRadio = document.querySelector('input[name=veh][value="car"]');
  return !!(carRadio && carRadio.checked);
}

/* ------------------------------------------------------
   Параметры ТС
------------------------------------------------------ */
function updateTruckParamsFromUI() {
  if (!hasDom || !hasWindow) return;

  const weightInput = $('#truckWeight');
  const heightInput = $('#truckHeight');
  const widthInput  = $('#truckWidth');
  const lengthInput = $('#truckLength');

  const params = {
    weight: Number(weightInput?.value) || 0,
    height: Number(heightInput?.value) || 0,
    width:  Number(widthInput?.value)  || 0,
    length: Number(lengthInput?.value) || 0
  };

  window.__TT_TRUCK_PARAMS = params;
  return params;
}

/* ------------------------------------------------------
   UI: "Frames on route: N"
------------------------------------------------------ */
function updateFramesOnRouteUI(count) {
  if (!hasDom) return;

  const host =
    document.querySelector('#routeList')?.parentElement ||
    document.querySelector('#routeList') ||
    document.body;

  if (!host) return;

  let el = document.getElementById('tt-frames-on-route');
  if (!el) {
    el = document.createElement('div');
    el.id = 'tt-frames-on-route';
    el.style.cssText = [
      'margin-top:10px',
      'padding:10px 12px',
      'border:1px solid rgba(0,0,0,.08)',
      'border-radius:10px',
      'background:#fff',
      'font-size:13px',
      'line-height:1.3',
      'color:#111'
    ].join(';');
    host.appendChild(el);
  }

  const n = Number(count);
  if (!Number.isFinite(n)) {
    el.textContent = 'Рамок на маршруте: —';
    return;
  }
  el.textContent = `Рамок на маршруте: ${n}`;
}

/* ------------------------------------------------------
   Reference points (from/via/to)
------------------------------------------------------ */
function getReferencePointsFromState() {
  if (!hasDom) return null;

  const fromInput = $('#from');
  const toInput   = $('#to');

  const from = fromInput?.value.trim() || '';
  const to   = toInput?.value.trim()   || '';

  if (!from || !to) return null;

  if (hasWindow) {
    window.routes = window.routes || {};
    window.routes.viaPoints  = window.routes.viaPoints  || [];
    window.routes.viaMarkers = window.routes.viaMarkers || [];
    window.routes.legacyWaypoints = [
      { request: from },
      { request: to }
    ];
  }

  const viaPoints = (hasWindow && window.routes && Array.isArray(window.routes.viaPoints))
    ? window.routes.viaPoints
    : [];

  return [from, ...viaPoints, to];
}

/* ------------------------------------------------------
   ПОСТРОИТЬ МАРШРУТ
------------------------------------------------------ */
export async function buildRouteWithState(options = {}) {
  const map = getMap();
  if (!map || typeof ymaps === 'undefined') {
    console.error('[TT][router] Карта недоступна');
    toast?.('Карта недоступна');
    return;
  }

  const fromInput = $('#from');
  const toInput   = $('#to');
  const buildBtn  = $('#buildBtn');

  const refPoints = getReferencePointsFromState();
  if (!refPoints) {
    fromInput && !fromInput.value.trim() && (fromInput.style.borderColor = '#ef4444');
    toInput   && !toInput.value.trim()   && (toInput.style.borderColor   = '#ef4444');
    toast?.('Заполните поля "Откуда" и "Куда"');
    return;
  }
  fromInput && (fromInput.style.borderColor = '');
  toInput   && (toInput.style.borderColor   = '');

  updateTruckParamsFromUI();

  let oldText = '';
  try {
    if (buildBtn) {
      oldText = buildBtn.textContent || '';
      buildBtn.disabled = true;
      buildBtn.textContent = 'Строим...';
    }

    console.log('[TT][router] Построение маршрута:', refPoints);

    if (multiRoute) {
      try { map.geoObjects.remove(multiRoute); } catch {}
      multiRoute = null;
    }

    const vehRadio = document.querySelector('input[name=veh]:checked');
    const vehMode = vehRadio ? vehRadio.value : 'truck40';

    const truckParams = window.__TT_TRUCK_PARAMS || {};
    const isTruck = vehMode !== 'car';

    const params = {
      results: options.results || 3,
      avoidTrafficJams: options.avoidTrafficJams !== false,
      routingMode: isTruck ? 'truck' : 'auto'
    };

    if (isTruck) {
      if (truckParams.weight) params.truckWeight = truckParams.weight;
      if (truckParams.height) params.truckHeight = truckParams.height;
      if (truckParams.width)  params.truckWidth  = truckParams.width;
      if (truckParams.length) params.truckLength = truckParams.length;
    }

    multiRoute = new ymaps.multiRouter.MultiRoute(
      { referencePoints: refPoints, params },
      {
        boundsAutoApply: true,
        zoomMargin: 40,
        routeStrokeColor: '#4b5563',
        routeStrokeOpacity: 0.6,
        routeStrokeWidth: 4,
        routeActiveStrokeColor: '#4da3ff',
        routeActiveStrokeOpacity: 0.9,
        routeActiveStrokeWidth: 6
      }
    );

    if (hasWindow) {
      window.multiRoute = multiRoute;
      window.routes = window.routes || {};
      window.routes.vehMode = vehMode;
    }

    try {
      const model = multiRoute.model;
      if (model && model.events && typeof model.events.add === 'function') {
        model.events.add('requestsuccess', () => {
          refreshFramesForActiveRoute();
          renderRouteList();
          window.dispatchEvent(new CustomEvent('tt_router_route_updated'));
        });

        model.events.add('requestfail', (e) => {
          window.dispatchEvent(new CustomEvent('tt_router_route_failed', { detail: e }));
        });
      }
    } catch (e) {
      console.warn('[TT][router] Не удалось подписаться на model.events:', e);
    }

    multiRoute.events.add('update', () => {
      refreshFramesForActiveRoute();
      renderRouteList();
      window.dispatchEvent(new CustomEvent('tt_router_route_updated'));
    });

    multiRoute.events.add('activeroutechange', () => {
      refreshFramesForActiveRoute();
      renderRouteList();
      window.dispatchEvent(new CustomEvent('tt_router_active_route_changed'));
    });

    multiRoute.events.add('pathschange', () => {
      refreshFramesForActiveRoute();
    });

    map.geoObjects.add(multiRoute);

    if (hasWindow) {
      setTimeout(() => {
        try {
          refreshFramesForActiveRoute();
          renderRouteList();
        } catch {}
      }, 600);
    }

    window.dispatchEvent(new CustomEvent('tt_router_built'));

  } catch (e) {
    console.error('[TT][router] Ошибка построения маршрута:', e);
    toast?.('Не удалось построить маршрут');
    window.dispatchEvent(new CustomEvent('tt_router_route_failed', { detail: e }));
  } finally {
    if (buildBtn) {
      buildBtn.disabled = false;
      buildBtn.textContent = oldText || 'Построить маршрут';
    }
  }
}

/* ------------------------------------------------------
   UI → выбор альтернативного маршрута
------------------------------------------------------ */
if (hasWindow) {
  window.addEventListener('tt_ui_select_route', (ev) => {
    if (!multiRoute) return;
    const index = ev.detail?.index;
    try {
      const routes = multiRoute.getRoutes();
      if (!routes || !routes.getLength()) return;
      const route = routes.get(index);
      if (route) {
        multiRoute.setActiveRoute(route);
        renderRouteList();
      }
    } catch (e) {
      console.warn('Не удалось выбрать маршрут:', e);
    }
  });
}

/* ------------------------------------------------------
   Рендер альтернатив
------------------------------------------------------ */
function renderRouteList() {
  if (!hasDom) return;
  const container = $('#routeList');
  if (!container) return;

  container.innerHTML = '';

  if (!multiRoute) {
    container.textContent = 'Маршрут не построен';
    updateFramesOnRouteUI(null);
    return;
  }

  const routes = multiRoute.getRoutes?.();
  if (!routes || typeof routes.getLength !== 'function') {
    container.textContent = 'Маршруты недоступны';
    updateFramesOnRouteUI(null);
    return;
  }

  const len = routes.getLength();
  if (!len) {
    container.textContent = 'Маршруты не найдены';
    updateFramesOnRouteUI(null);
    return;
  }

  const activeRoute = multiRoute.getActiveRoute?.();

  for (let i = 0; i < len; i++) {
    const route = routes.get(i);
    const props = route.properties;
    const distance = props.get('distance');
    const duration = props.get('durationInTraffic') || props.get('duration');
    const blocked  = props.get('blocked');

    const item = document.createElement('div');
    item.className = 'tt-route-item';
    if (activeRoute === route) item.classList.add('active');

    const title = document.createElement('div');
    title.className = 'tt-route-title';
    title.textContent = `Маршрут ${i + 1}` + (blocked ? ' (недоступен)' : '');

    const meta = document.createElement('div');
    meta.className = 'tt-route-meta';
    const parts = [];
    distance?.text && parts.push(distance.text);
    duration?.text && parts.push(duration.text);
    meta.textContent = parts.join(' • ');

    item.appendChild(title);
    item.appendChild(meta);

    item.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('tt_ui_select_route', { detail: { index: i } }));
    });

    container.appendChild(item);
  }
}

/* ------------------------------------------------------
   Координаты / bbox
------------------------------------------------------ */

const LAT_MIN = 40;
const LAT_MAX = 82;

function normalizeCoordPairRoute(pair) {
  if (!Array.isArray(pair) || pair.length < 2) return null;

  const a = Number(pair[0]);
  const b = Number(pair[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;

  return [a, b];
}

function scoreRouteOrder(points) {
  let latLonScore = 0;
  let lonLatScore = 0;

  for (const [a, b] of points) {
    const aAbs = Math.abs(a);
    const bAbs = Math.abs(b);

    if (aAbs <= 90 && bAbs > 90) { latLonScore += 3; continue; }
    if (bAbs <= 90 && aAbs > 90) { lonLatScore += 3; continue; }

    const aLooksLat = a >= LAT_MIN && a <= LAT_MAX;
    const bLooksLat = b >= LAT_MIN && b <= LAT_MAX;
    const aLooksLongFar = aAbs >= 100;
    const bLooksLongFar = bAbs >= 100;

    if (aLooksLat && bLooksLongFar) latLonScore += 2;
    if (bLooksLat && aLooksLongFar) lonLatScore += 2;

    if (aLooksLat && !bLooksLat) latLonScore += 1;
    if (bLooksLat && !aLooksLat) lonLatScore += 1;
  }

  return { latLonScore, lonLatScore };
}

function pickCoordOrderFromMeta() {
  try {
    const meta = ymaps?.meta;
    const direct = meta && meta.coordinatesOrder;
    if (direct === 'longlat' || direct === 'lonlat') return 'lonlat';
    if (direct === 'latlong') return 'latlon';

    const metaGetter = typeof meta?.get === 'function' ? meta.get('coordorder') : null;
    if (metaGetter === 'longlat' || metaGetter === 'lonlat') return 'lonlat';
    if (metaGetter === 'latlong') return 'latlon';
  } catch {}
  return null;
}

function decideRouteOrder(rawPoints) {
  const metaOrder = pickCoordOrderFromMeta();
  if (metaOrder) return metaOrder;

  const { latLonScore, lonLatScore } = scoreRouteOrder(rawPoints);
  return latLonScore > lonLatScore ? 'latlon' : 'lonlat';
}

function normalizeRouteWithOrder(rawPoints, order) {
  if (!Array.isArray(rawPoints) || rawPoints.length < 2) return [];

  const cleaned = [];
  rawPoints.forEach((p) => {
    const norm = normalizeCoordPairRoute(p);
    if (norm) cleaned.push(norm);
  });

  if (cleaned.length < 2) return [];

  const useOrder = order || decideRouteOrder(cleaned);
  const swapped = useOrder === 'latlon';

  return swapped ? cleaned.map(([a, b]) => [b, a]) : cleaned.map(([a, b]) => [a, b]);
}

function ensureRouteOrderCached(route, rawPoints) {
  if (!route || !Array.isArray(rawPoints) || rawPoints.length < 2) return null;
  if (route[ROUTE_ORDER_KEY]) return route[ROUTE_ORDER_KEY];
  const order = decideRouteOrder(rawPoints);
  route[ROUTE_ORDER_KEY] = order;
  return order;
}

function getNormalizedRoutePoints(route) {
  const rawPts = collectRouteGeometryPoints(route);
  if (!rawPts || rawPts.length < 2) return { points: [], order: null };
  const order = ensureRouteOrderCached(route, rawPts) || decideRouteOrder(rawPts);
  const points = normalizeRouteWithOrder(rawPts, order);
  return { points, order };
}

function bboxFromTwoPoints(p1, p2) {
  if (!p1 || !p2) return null;
  const lon1 = Number(p1[0]);
  const lat1 = Number(p1[1]);
  const lon2 = Number(p2[0]);
  const lat2 = Number(p2[1]);
  if (![lon1, lat1, lon2, lat2].every(Number.isFinite)) return null;

  return [
    [Math.min(lon1, lon2), Math.min(lat1, lat2)],
    [Math.max(lon1, lon2), Math.max(lat1, lat2)]
  ];
}

function bboxFromPointsLonLat(pointsLonLat, margin = 0.02) {
  if (!Array.isArray(pointsLonLat) || pointsLonLat.length < 2) return null;

  let minLat = Infinity, maxLat = -Infinity;
  let minLon = Infinity, maxLon = -Infinity;

  pointsLonLat.forEach((pt) => {
    const lon = Number(pt?.[0]);
    const lat = Number(pt?.[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
  });

  if (![minLat, maxLat, minLon, maxLon].every(Number.isFinite)) return null;

  return [
    [minLon - margin, minLat - margin],
    [maxLon + margin, maxLat + margin]
  ];
}

/* ------------------------------------------------------
   ✅ СБОР ГЕОМЕТРИИ СИНЕЙ ЛИНИИ
------------------------------------------------------ */

function flattenCoordsDeep(coords, out) {
  if (!coords) return;
  if (Array.isArray(coords) && coords.length === 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
    out.push(coords);
    return;
  }
  if (Array.isArray(coords)) coords.forEach((c) => flattenCoordsDeep(c, out));
}

function collectRouteGeometryPoints(route) {
  const pts = [];
  if (!route) return pts;

  try {
    const g = route.geometry;
    if (g && typeof g.getCoordinates === 'function') {
      const coords = g.getCoordinates();
      const flat = [];
      flattenCoordsDeep(coords, flat);
      flat.forEach((p) => pts.push(p));
      if (pts.length) return pts;
    }
  } catch {}

  try {
    const paths = route.getPaths?.();
    if (!paths) return pts;

    if (typeof paths.each === 'function') {
      paths.each((path) => {
        try {
          const segs = path.getSegments?.();
          if (!segs) return;

          if (typeof segs.each === 'function') {
            segs.each((segment) => {
              try {
                const c = segment.getCoordinates?.();
                if (Array.isArray(c)) c.forEach((p) => pts.push(p));
              } catch {}
              try {
                const sg = segment.geometry;
                const c2 = sg?.getCoordinates?.();
                if (c2) {
                  const flat2 = [];
                  flattenCoordsDeep(c2, flat2);
                  flat2.forEach((p) => pts.push(p));
                }
              } catch {}
            });
          }
        } catch {}
      });
    }
  } catch {}

  return pts;
}

/* ------------------------------------------------------
   Применение BBOX к слою рамок (быстро показать)
------------------------------------------------------ */
export function applyFramesBBox(bbox) {
  const api = window.__TT_LAYERS;
  if (!api) return;
  api.setFramesVisible?.(!!bbox);
  api.setFramesBBox?.(bbox);
}

/* ------------------------------------------------------
   ✅ ВКЛЮЧИТЬ ПОКАЗ РАМОК ПО МАРШРУТУ (а не только счётчик)
------------------------------------------------------ */
function applyFramesOnRoute(routeLonLat, meters) {
  const api = window.__TT_LAYERS;
  if (!api?.setFramesRoute) return;
  api.setFramesRoute(routeLonLat, meters);
}

/* ------------------------------------------------------
   ✅ ТОЧНЫЙ подсчёт + показ рамок "по синей линии"
------------------------------------------------------ */
function scheduleExactCountOnBlueLine(activeRoute) {
  if (!hasWindow) return;
  const api = window.__TT_LAYERS;
  if (!api?.countFramesOnRoute) return;
  if (!activeRoute) return;

  const METERS = 50;

  if (_countTimer) clearTimeout(_countTimer);
  updateFramesOnRouteUI(null);

  _countTimer = setTimeout(() => {
    let tries = 0;

    const tick = async () => {
      tries++;

      const rawPts = collectRouteGeometryPoints(activeRoute);
      if (!rawPts || rawPts.length < 2) {
        if (tries <= 80) return setTimeout(tick, 250);
        updateFramesOnRouteUI(null);
        return;
      }

      const order = ensureRouteOrderCached(activeRoute, rawPts) || decideRouteOrder(rawPts);
      const routeLonLat = normalizeRouteWithOrder(rawPts, order);
      if (routeLonLat.length < 2) {
        updateFramesOnRouteUI(null);
        return;
      }

      const framesReady = api.waitForFramesReady?.();
      if (framesReady && typeof framesReady.then === 'function') {
        try { await framesReady; } catch {}
      }

      const bboxByGeom = bboxFromPointsLonLat(routeLonLat);
      if (bboxByGeom) applyFramesBBox(bboxByGeom);

      applyFramesOnRoute(routeLonLat, METERS);

      const r = api.countFramesOnRoute(routeLonLat, METERS);

      const count = Number.isFinite(r.count) ? r.count : null;
      updateFramesOnRouteUI(count);

      if (Number.isFinite(count)) toast?.(`Рамок на маршруте: ${count}`, 5000);

      const framesSvc = getFramesService();
      if (framesSvc) {
        try {
          const truckParams = window.__TT_TRUCK_PARAMS || {};
          framesSvc.updateFramesForRoute(routeLonLat, truckParams);
        } catch (e) {
          console.warn('[TT][router] Ошибка frames-service:', e);
        }
      }

      console.log('[TT][router] Frames ON ROUTE:', count, '| meters=', METERS, '| ids=', r.ids);
    };

    tick();
  }, 200);
}

/* ------------------------------------------------------
   Обновление рамок
------------------------------------------------------ */
export function refreshFramesForActiveRoute() {
  if (_countTimer) {
    clearTimeout(_countTimer);
    _countTimer = null;
  }

  const api = window.__TT_LAYERS;

  if (isCarMode()) {
    api?.setFramesVisible?.(false);
    updateFramesOnRouteUI(null);
    return;
  }

  const framesToggle = $('#toggle-frames');
  if (framesToggle && framesToggle.checked === false) {
    api?.setFramesVisible?.(false);
    updateFramesOnRouteUI(null);
    return;
  }

  const activeRoute = multiRoute?.getActiveRoute?.();
  if (!activeRoute) {
    api?.setFramesVisible?.(false);
    updateFramesOnRouteUI(null);
    return;
  }

  const { points: normalizedRoutePoints } = getNormalizedRoutePoints(activeRoute);
  if (!normalizedRoutePoints.length) {
    api?.setFramesVisible?.(false);
    updateFramesOnRouteUI(null);
    return;
  }

  const bboxByGeom = bboxFromPointsLonLat(normalizedRoutePoints);
  applyFramesBBox(bboxByGeom);
  scheduleExactCountOnBlueLine(activeRoute);

  const framesSvc = getFramesService();
  if (framesSvc) {
    try {
      const truckParams = window.__TT_TRUCK_PARAMS || {};
      framesSvc.updateFramesForRoute(normalizedRoutePoints, truckParams);
    } catch (e) {
      console.warn('[TT][router] Ошибка frames-service:', e);
    }
  }
}

/* ======================================================
   ✅ DETOUR API (экспорт для кнопки в карточке рамки)
====================================================== */

export async function tryDetourForFrame(frame) {
  if (!hasWindow) return;
  if (detourState.busy) return;

  if (!frame?.coords || !Array.isArray(frame.coords) || frame.coords.length < 2) return;

  detourState.busy = true;
  detourState.lastFrameId = frame.id;

  window.routes = window.routes || {};
  window.routes.viaPoints = window.routes.viaPoints || [];

  if (!detourState.originalViaPoints) {
    detourState.originalViaPoints = [...window.routes.viaPoints];
  }

  const before = snapshotRouteStatsMaybe(frame);

  try {
    const ok1 = await runDetourAttempt(frame, 350);
    if (ok1) return;

    await runDetourAttempt(frame, 850);

  } finally {
    const after = snapshotRouteStatsMaybe(frame);

    const beforeCount = before?.framesCount;
    const beforeMax = before?.maxRisk;
    const afterCount = after?.framesCount;
    const afterMax = after?.maxRisk;

    const bMaxTxt = Number.isFinite(beforeMax) ? String(beforeMax) : '—';
    const aMaxTxt = Number.isFinite(afterMax) ? String(afterMax) : '—';

    toast?.(`Было: ${Number.isFinite(beforeCount) ? beforeCount : '—'} рамок / макс. риск ${bMaxTxt}\nСтало: ${Number.isFinite(afterCount) ? afterCount : '—'} рамок / макс. риск ${aMaxTxt}`, 6000);

    const frameStill = after?.frameStillOnRoute;
    if (frameStill === true) {
      toast?.('Объезд в этом месте ограничен — альтернативных дорог мало', 5000);
    }

    detourState.busy = false;
  }
}

export async function restoreOriginalRouteAfterDetour() {
  if (!hasWindow) return;
  if (detourState.busy) return;
  if (!detourState.originalViaPoints) return;

  window.routes = window.routes || {};
  window.routes.viaPoints = [...detourState.originalViaPoints];

  detourState.originalViaPoints = null;
  detourState.lastFrameId = null;

  await buildRouteWithState();
}

async function runDetourAttempt(frame, radiusMeters) {
  const via = computeViaPoint(frame, radiusMeters);
  if (!via) return false;

  window.routes.viaPoints = [
    ...(detourState.originalViaPoints || []),
    { request: via }
  ];

  await buildRouteWithState();
  await waitForRouteUpdate(9000);

  const after = snapshotRouteStatsMaybe(frame);
  if (after?.frameStillOnRoute === false) return true;

  return false;
}

function waitForRouteUpdate(timeoutMs = 8000) {
  if (!hasWindow) return Promise.resolve();

  return new Promise((resolve) => {
    let done = false;

    const onOk = () => {
      if (done) return;
      done = true;
      cleanup();
      resolve();
    };

    const onFail = () => {
      if (done) return;
      done = true;
      cleanup();
      resolve();
    };

    const timer = setTimeout(onOk, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      window.removeEventListener('tt_router_route_updated', onOk);
      window.removeEventListener('tt_router_active_route_changed', onOk);
      window.removeEventListener('tt_router_route_failed', onFail);
    }

    window.addEventListener('tt_router_route_updated', onOk, { once: true });
    window.addEventListener('tt_router_active_route_changed', onOk, { once: true });
    window.addEventListener('tt_router_route_failed', onFail, { once: true });
  });
}

function snapshotRouteStatsMaybe(frame) {
  const activeRoute = multiRoute?.getActiveRoute?.();
  if (!activeRoute) return { framesCount: null, maxRisk: null, frameStillOnRoute: null };

  const { points: routeLonLat } = getNormalizedRoutePoints(activeRoute);
  if (routeLonLat.length < 2) return { framesCount: null, maxRisk: null, frameStillOnRoute: null };

  const api = window.__TT_LAYERS;
  const r = api?.countFramesOnRoute?.(routeLonLat, 50) || { count: null, ids: [] };

  const ids = Array.isArray(r.ids) ? r.ids : [];
  const framesCount = Number.isFinite(r.count) ? r.count : null;

  const framesSvc = getFramesService();
  let maxRisk = null;

  try {
    if (framesSvc && typeof framesSvc.getRouteStats === 'function') {
      const st = framesSvc.getRouteStats();
      if (st && Number.isFinite(st.maxRisk)) maxRisk = st.maxRisk;
    } else if (framesSvc && typeof framesSvc.getFramesOnRoute === 'function') {
      const arr = framesSvc.getFramesOnRoute();
      if (Array.isArray(arr) && arr.length) {
        let m = -Infinity;
        for (const f of arr) {
          const v = Number(f?.risk);
          if (Number.isFinite(v)) m = Math.max(m, v);
        }
        if (m !== -Infinity) maxRisk = m;
      }
    }
  } catch {}

  const frameStillOnRoute =
    frame?.id != null
      ? ids.includes(frame.id)
      : null;

  return { framesCount, maxRisk, frameStillOnRoute, ids };
}

/* ------------------------------------------------------
   ✅ computeViaPoint
------------------------------------------------------ */
function computeViaPoint(frame, meters) {
  const lon = Number(frame?.coords?.[0]);
  const lat = Number(frame?.coords?.[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;

  const dLat = meters / 111000;

  const latRad = lat * Math.PI / 180;
  const cosLat = Math.cos(latRad) || 1;
  const dLon = (meters / (111000 * cosLat));

  const dir = stableDirFromId(frame?.id);

  const dx = dir.dx * dLon;
  const dy = dir.dy * dLat;

  return [lat + dy, lon + dx];
}

function stableDirFromId(id) {
  const s = String(id ?? '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const k = h % 4;

  if (k === 0) return { dx: 1, dy: 0 };
  if (k === 1) return { dx: -1, dy: 0 };
  if (k === 2) return { dx: 0, dy: 1 };
  return { dx: 0, dy: -1 };
}

/* ------------------------------------------------------
   ✅ EXPORT TO NAVIGATOR
------------------------------------------------------ */
export function exportActiveRouteToNavigator() {
  if (!hasWindow) return;

  const activeRoute = multiRoute?.getActiveRoute?.();
  if (!activeRoute) {
    toast?.('Сначала постройте маршрут');
    return;
  }

  const wayPoints = activeRoute.getWayPoints?.();
  const points = [];

  try {
    if (wayPoints && typeof wayPoints.each === 'function') {
      wayPoints.each((wp) => {
        try {
          const c = wp?.properties?.get?.('coordinates');
          if (Array.isArray(c) && c.length >= 2) points.push(c);
        } catch {}
      });
    }
  } catch {}

  if (points.length < 2) {
    const { points: normPts } = getNormalizedRoutePoints(activeRoute);
    if (normPts.length >= 2) {
      points.push(normPts[0]);
      points.push(normPts[normPts.length - 1]);
    }
  }

  if (points.length < 2) {
    toast?.('Нет координат для экспорта');
    return;
  }

  const order = activeRoute[ROUTE_ORDER_KEY] || decideRouteOrder(points);
  const normPoints = normalizeRouteWithOrder(points, order);

  const start = normPoints[0];
  const finish = normPoints[normPoints.length - 1];

  const via = Array.isArray(window.routes?.viaPoints) ? window.routes.viaPoints : [];
  const viaCoordsRaw = via
    .map((v) => {
      if (Array.isArray(v?.request)) return v.request;
      if (Array.isArray(v)) return v;
      return null;
    })
    .filter(Boolean);

  const viaNorm = viaCoordsRaw.length ? normalizeRouteWithOrder(viaCoordsRaw, order) : [];

  const params = new URLSearchParams();
  params.set('from', `${start[1]},${start[0]}`);
  params.set('to', `${finish[1]},${finish[0]}`);
  if (viaNorm.length) {
    params.set('via', viaNorm.map((p) => `${p[1]},${p[0]}`).join('|'));
  }
  params.set('app_promo', 'map');

  const url = `https://yandex.ru/navi/?${params.toString()}`;
  window.open(url, '_blank');
}
