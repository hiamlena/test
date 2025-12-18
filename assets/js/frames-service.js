// assets/js/frames-service.js
// Работа с весовыми рамками и HGV-слоями.
// Сервис анализа: грузит GeoJSON один раз и умеет быстро выдавать рамки рядом с маршрутом.
// ВАЖНО: НИКАКОГО /api — всё статикой из /map/data/frames_ready.geojson

const HAS_WINDOW = typeof window !== 'undefined';
const HAS_DOC = typeof document !== 'undefined';

const _geojsonCache = new Map();

async function fetchGeoJSON(url) {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) {
      console.warn('[TT][frames-service] Не удалось загрузить GeoJSON:', url, res.status);
      return null;
    }

    const data = await res.json();
    if (!data || data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
      console.warn('[TT][frames-service] Некорректный GeoJSON:', url);
      return null;
    }

    return data;
  } catch (e) {
    console.warn('[TT][frames-service] Ошибка сети при загрузке GeoJSON:', url, e);
    return null;
  }
}

/**
 * Однократная загрузка GeoJSON по URL (с кэшированием промиса).
 */
async function loadGeoJSONOnce(url) {
  if (!url) return null;

  const cacheKey = `GEOJSON:${url}`;
  if (_geojsonCache.has(cacheKey)) return _geojsonCache.get(cacheKey);

  const promise = (async () => {
    const data = await fetchGeoJSON(url);
    return data;
  })();

  _geojsonCache.set(cacheKey, promise);
  return promise;
}

/**
 * Нормализация пары координат.
 * Тут ОЖИДАЕМ [lon, lat] (потому что в твоём GeoJSON именно так).
 */
function normalizeCoordPair(pair) {
  if (!pair || !Array.isArray(pair) || pair.length < 2) return null;
  const lon = Number(pair[0]);
  const lat = Number(pair[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return [lon, lat];
}

/**
 * BBOX вокруг маршрута с паддингом (в км).
 */
function bboxFromRoutePointsWithPadding(routePoints, paddingKm = 5) {
  if (!Array.isArray(routePoints) || !routePoints.length) return null;

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;

  routePoints.forEach((pt) => {
    const pair = normalizeCoordPair(pt);
    if (!pair) return;
    const [lon, lat] = pair;
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
  });

  if (!Number.isFinite(minLat) || !Number.isFinite(minLon) || !Number.isFinite(maxLat) || !Number.isFinite(maxLon)) {
    return null;
  }

  const latCenter = (minLat + maxLat) / 2;
  const kmPerDegLat = 111;
  const kmPerDegLon = 111 * Math.cos((latCenter * Math.PI) / 180);

  const dLat = paddingKm / kmPerDegLat;
  const dLon = paddingKm / (kmPerDegLon || 1e-6);

  return {
    minLon: minLon - dLon,
    maxLon: maxLon + dLon,
    minLat: minLat - dLat,
    maxLat: maxLat + dLat
  };
}

function isPointInBBoxObject(coords, bboxObj) {
  if (!bboxObj) return true;
  const pair = normalizeCoordPair(coords);
  if (!pair) return false;
  const [lon, lat] = pair;
  const { minLon, maxLon, minLat, maxLat } = bboxObj;
  return lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat;
}

/**
 * Инициализация сервиса рамок.
 * options.framesUrl можно передать, но по умолчанию — статический GeoJSON.
 */
export async function initFramesService(map, options = {}) {
  const state = {
    map: map || null,
    framesData: { type: 'FeatureCollection', features: [] },
    framesUrl: null
  };

  if (!HAS_DOC || !HAS_WINDOW) {
    console.warn('[TT][frames-service] Нет window/DOM, сервис рамок будет пустым');
    return {
      state,
      updateFramesForRoute: () => ({
        state,
        bbox: null,
        frames: [],
        criticalFrames: []
      })
    };
  }

  // ✅ главный фикс: дефолт теперь статический файл
  const FRAMES_URL_DEFAULT = '/map/data/frames_ready.geojson';
  const framesUrl = options?.framesUrl || FRAMES_URL_DEFAULT;
  state.framesUrl = framesUrl;

  try {
    const framesData = await loadGeoJSONOnce(framesUrl);
    state.framesData = framesData || { type: 'FeatureCollection', features: [] };
    console.log('[TT][frames-service] Рамок загружено:', state.framesData.features.length, 'из', framesUrl);
  } catch (e) {
    console.warn('[TT][frames-service] Ошибка при загрузке рамок:', e);
    state.framesData = { type: 'FeatureCollection', features: [] };
  }

  function updateFramesForRoute(routePoints, truckParams = {}) {
    const framesData = state.framesData;

    if (!framesData || !Array.isArray(framesData.features) || !routePoints || !routePoints.length) {
      return { state, bbox: null, frames: [], criticalFrames: [] };
    }

    const bboxObj = bboxFromRoutePointsWithPadding(routePoints, 5);
    if (!bboxObj) {
      return { state, bbox: null, frames: [], criticalFrames: [] };
    }

    const framesInCorridor = framesData.features.filter((f) => {
      if (!f || !f.geometry || f.geometry.type !== 'Point') return false;
      return isPointInBBoxObject(f.geometry.coordinates, bboxObj);
    });

    // Пока считаем "критичными" все, что попали в коридор (как у тебя было)
    const criticalFrames = framesInCorridor.slice();

    const bbox = [
      [bboxObj.minLon, bboxObj.minLat],
      [bboxObj.maxLon, bboxObj.maxLat]
    ];

    return { state, bbox, frames: framesInCorridor, criticalFrames };
  }

  console.log('[TT][frames-service] Сервис рамок инициализирован, framesUrl:', framesUrl);
  return { state, updateFramesForRoute };
}
