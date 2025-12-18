// assets/js/frames-service.js
// Работа с весовыми рамками и HGV-слоями.
// Сервис анализа: грузит GeoJSON один раз и умеет быстро выдавать рамки рядом с маршрутом.
// ВАЖНО: НИКАКОГО /api — всё статикой из /map/data/frames_ready.geojson

const HAS_WINDOW = typeof window !== 'undefined';
const HAS_DOC = typeof document !== 'undefined';

const _geojsonCache = new Map();

const DEFAULT_CORRIDOR_METERS = 50;

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

function normalizeCoordPair(pair) {
  if (!pair || !Array.isArray(pair) || pair.length < 2) return null;
  const lon = Number(pair[0]);
  const lat = Number(pair[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return [lon, lat];
}

function normalizeRoutePoints(routePoints) {
  if (!Array.isArray(routePoints) || routePoints.length < 2) return [];
  const out = [];
  for (const p of routePoints) {
    const norm = normalizeCoordPair(p);
    if (norm) out.push(norm);
  }
  return out.length >= 2 ? out : [];
}

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

function toXYMeters(lon, lat, refLatRad) {
  const R = 6371000;
  const x = (lon * Math.PI / 180) * R * Math.cos(refLatRad);
  const y = (lat * Math.PI / 180) * R;
  return [x, y];
}

function distPointToSegmentMeters(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;

  const ab2 = abx * abx + aby * aby;
  if (ab2 <= 1e-9) {
    const dx = px - ax;
    const dy = py - ay;
    return Math.sqrt(dx * dx + dy * dy);
  }

  let t = (apx * abx + apy * aby) / ab2;
  if (t < 0) t = 0;
  if (t > 1) t = 1;

  const cx = ax + t * abx;
  const cy = ay + t * aby;

  const dx = px - cx;
  const dy = py - cy;
  return Math.sqrt(dx * dx + dy * dy);
}

function distancePointToPolylineMeters(pointLonLat, routeLonLat) {
  if (!Array.isArray(routeLonLat) || routeLonLat.length < 2) return Infinity;
  const lon = Number(pointLonLat?.[0]);
  const lat = Number(pointLonLat?.[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return Infinity;

  const refLat = Number(routeLonLat[Math.floor(routeLonLat.length / 2)]?.[1]) || lat;
  const refLatRad = (refLat * Math.PI) / 180;

  const [px, py] = toXYMeters(lon, lat, refLatRad);

  let best = Infinity;
  for (let i = 0; i < routeLonLat.length - 1; i++) {
    const a = routeLonLat[i];
    const b = routeLonLat[i + 1];

    const alon = Number(a?.[0]), alat = Number(a?.[1]);
    const blon = Number(b?.[0]), blat = Number(b?.[1]);
    if (![alon, alat, blon, blat].every(Number.isFinite)) continue;

    const [ax, ay] = toXYMeters(alon, alat, refLatRad);
    const [bx, by] = toXYMeters(blon, blat, refLatRad);

    const d = distPointToSegmentMeters(px, py, ax, ay, bx, by);
    if (d < best) best = d;
    if (best <= 1) break;
  }
  return best;
}

function collectFramePointLonLat(feature) {
  const g = feature?.geometry;
  if (!g || g.type !== 'Point' || !Array.isArray(g.coordinates)) return null;
  return normalizeCoordPair(g.coordinates);
}

function computeMaxRisk(frames) {
  if (!Array.isArray(frames) || !frames.length) return null;
  let m = -Infinity;
  for (const f of frames) {
    const v = Number(f?.properties?.risk ?? f?.risk);
    if (Number.isFinite(v)) m = Math.max(m, v);
  }
  return m === -Infinity ? null : m;
}

export async function initFramesService(map, options = {}) {
  const state = {
    map: map || null,
    framesData: { type: 'FeatureCollection', features: [] },
    framesUrl: null,
    framesLoaded: false,
    lastRouteFrames: [],
    lastRouteStats: { count: null, maxRisk: null }
  };

  if (!HAS_DOC || !HAS_WINDOW) {
    console.warn('[TT][frames-service] Нет window/DOM, сервис рамок будет пустым');
    return {
      state,
      updateFramesForRoute: () => ({ state, bbox: null, frames: [], criticalFrames: [], stats: state.lastRouteStats }),
      getFramesOnRoute: () => state.lastRouteFrames,
      getRouteStats: () => state.lastRouteStats
    };
  }

  const FRAMES_URL_DEFAULT = '/map/data/frames_ready.geojson';
  const framesUrl = options?.framesUrl || FRAMES_URL_DEFAULT;
  state.framesUrl = framesUrl;

  try {
    const framesData = await loadGeoJSONOnce(framesUrl);
    state.framesData = framesData || { type: 'FeatureCollection', features: [] };
    state.framesLoaded = !!framesData;
    console.log('[TT][frames-service] Рамок загружено:', state.framesData.features.length, 'из', framesUrl);
  } catch (e) {
    console.warn('[TT][frames-service] Ошибка при загрузке рамок:', e);
    state.framesData = { type: 'FeatureCollection', features: [] };
  }

  function updateFramesForRoute(routePoints, truckParams = {}) {
    const normalizedRoute = normalizeRoutePoints(routePoints);

    if (!state.framesLoaded || !normalizedRoute.length) {
      state.lastRouteFrames = [];
      state.lastRouteStats = { count: null, maxRisk: null };
      return { state, bbox: null, frames: [], criticalFrames: [], stats: state.lastRouteStats, truckParams };
    }

    const bboxObj = bboxFromRoutePointsWithPadding(normalizedRoute, 5);

    const framesInCorridor = state.framesData.features.filter((f) => {
      if (!f || !f.geometry || f.geometry.type !== 'Point') return false;
      const pt = collectFramePointLonLat(f);
      if (!pt) return false;
      const d = distancePointToPolylineMeters(pt, normalizedRoute);
      return d <= DEFAULT_CORRIDOR_METERS;
    });

    const criticalFrames = framesInCorridor.slice();

    const bbox = bboxObj
      ? [
          [bboxObj.minLon, bboxObj.minLat],
          [bboxObj.maxLon, bboxObj.maxLat]
        ]
      : null;

    const stats = { count: framesInCorridor.length, maxRisk: computeMaxRisk(framesInCorridor) };

    state.lastRouteFrames = framesInCorridor;
    state.lastRouteStats = stats;

    return { state, bbox, frames: framesInCorridor, criticalFrames, stats, truckParams };
  }

  function getFramesOnRoute() {
    return state.lastRouteFrames;
  }

  function getRouteStats() {
    return state.lastRouteStats;
  }

  console.log('[TT][frames-service] Сервис рамок инициализирован, framesUrl:', framesUrl);
  return { state, updateFramesForRoute, getFramesOnRoute, getRouteStats };
}
