// file: /map/assets/js/layers.js
// Слой весовых рамок Trans-Time (GeoJSON -> ObjectManager)
// + отдельный слой "Официальные посты" (официальные/подтверждённые точки)
//
// ВАЖНО ПО ТВОЕЙ ПРАВКЕ:
// ✅ РАМКИ (frames) — ТОЛЬКО ПО МАРШРУТУ (route-only).
// ❌ Никакого bbox режима и никаких bbox-prefilter’ов.
//
// FIX (почему "не отдаёт рамки"):
// ✅ Маршрут от Yandex часто приходит как [lat, lon]. Мы считаем как [lon, lat].
// Поэтому нормализуем route в setFramesRoute()/countFramesOnRoute() к [[lon,lat],...]

const HAS_WINDOW = typeof window !== 'undefined';

if (HAS_WINDOW) {
  window.__TT_LAYERS = window.__TT_LAYERS || {};
}

/* ------------------------------------------------------
   FRAMES (Nerudas) state
------------------------------------------------------ */
let framesManager = null;
let framesVisible = false;

let framesRouteLonLat = null;
let framesRouteMeters = 50;

let framesData = null;
let framesLoadingPromise = null;
let framesAddedToManager = false;

let framesReadyResolver = null;
const framesReadyPromise = new Promise((resolve) => { framesReadyResolver = resolve; });

const FRAMES_GEOJSON_URL = '/map/data/frames_ready.geojson';

/* ------------------------------------------------------
   OFFICIAL POSTS state
------------------------------------------------------ */
let officialManager = null;
let officialVisible = false;

let officialData = null;
let officialLoadingPromise = null;
let officialAddedToManager = false;

const OFFICIAL_GEOJSON_URL = '/map/data/official_weight_posts.geojson';

/* ------------------------------------------------------
   Map / ymaps helpers
------------------------------------------------------ */
function getMap() {
  if (!HAS_WINDOW) return null;
  return (window.__TT_MAP && window.__TT_MAP.map) || window.map || null;
}

function hasYmaps() {
  return typeof ymaps !== 'undefined' && ymaps && typeof ymaps.ObjectManager === 'function';
}

/* ------------------------------------------------------
   Coord helpers
------------------------------------------------------ */
function normalizeCoordPair(pair) {
  if (!Array.isArray(pair) || pair.length < 2) return null;

  const a = Number(pair[0]);
  const b = Number(pair[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;

  return [a, b];
}

function normalizeRouteToLonLat(route) {
  if (!Array.isArray(route) || route.length < 2) return null;

  const out = [];
  for (const p of route) {
    if (!Array.isArray(p) || p.length < 2) continue;

    const a = Number(p[0]);
    const b = Number(p[1]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;

    out.push([a, b]);
  }

  return out.length >= 2 ? out : null;
}

/* ------------------------------------------------------
   UI helpers (общие)
------------------------------------------------------ */
function escHtml(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function pickFirst(obj, keys) {
  for (const k of keys) {
    const val = obj?.[k];
    if (val !== undefined && val !== null && String(val).trim() !== '') return val;
  }
  return null;
}

function clipText(s, maxLen = 80) {
  const t = String(s ?? '').trim();
  if (!t) return '';
  if (t.length <= maxLen) return t;
  return t.slice(0, maxLen - 1) + '…';
}

/* ------------------------------------------------------
   FRAMES UI formatting
------------------------------------------------------ */
function extractCommentFromNerudas(p) {
  const raw =
    String(p?.nerudas_full_text ?? '').trim() ||
    String(p?.nerudas_raw_text ?? '').trim();

  if (!raw) return null;

  const lines = raw
    .split(/\r?\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (!lines.length) return null;

  const STOP_PATTERNS = [
    /^сообщить об ошибке$/i,
    /^объект$/i,
    /^#\d+$/i,
    /^регион$/i,
    /^\d+$/i,
    /^просмотрели$/i,
    /^обновлено$/i,
    /^добавил/i,
    /^где находится$/i,
    /^координаты/i,
    /^открыть в/i
  ];

  const meaningful = [];
  for (const line of lines) {
    const lower = line.toLowerCase();

    if (STOP_PATTERNS.some((re) => re.test(lower))) continue;
    if (/^-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+$/.test(line)) continue;

    meaningful.push(line);
  }

  if (!meaningful.length) return null;

  meaningful.sort((a, b) => b.length - a.length);
  const best = meaningful[0]?.trim();
  if (!best) return null;

  return best.replace(/\s+/g, ' ');
}

function formatProps(objProps) {
  const p = objProps || {};

  const title =
    pickFirst(p, ['title', 'name', 'Name', 'point_name', 'frame_name', 'station', 'location']) ||
    'Весовой контроль';

  const address = pickFirst(p, ['address', 'addr', 'full_address', 'Address', 'place']);
  const road = pickFirst(p, ['road', 'highway', 'route', ' трасса', 'Road']);
  const km = pickFirst(p, ['km', 'kilometer', 'distance_km', 'Km']);

  const comment =
    pickFirst(p, ['comment', 'note', 'description', 'desc', 'Комментарий']) ||
    extractCommentFromNerudas(p);

  return { title, address, road, km, comment };
}

function buildHintText(obj) {
  const props = formatProps(obj?.properties);
  const lines = [];

  lines.push(props.title);

  const d = obj?.properties?.__ttDistanceMeters;
  if (Number.isFinite(d)) {
    lines.push(`От маршрута: ${Math.round(d)} м`);
  }

  if (props.comment) {
    lines.push(`Комментарий: ${clipText(props.comment, 90)}`);
  }

  return lines.join('\n');
}

function buildBalloonContent(obj) {
  const props = formatProps(obj?.properties);
  const rows = [];

  const addRow = (label, value) => {
    if (value === null || value === undefined || String(value).trim() === '') return;
    rows.push(
      `<tr><td style="padding:2px 8px 2px 0;color:#666;white-space:nowrap;">${escHtml(
        label
      )}</td><td style="padding:2px 0;">${escHtml(value)}</td></tr>`
    );
  };

  const d = obj?.properties?.__ttDistanceMeters;
  if (Number.isFinite(d)) addRow('От маршрута', `${Math.round(d)} м`);

  addRow('Адрес', props.address);
  addRow('Дорога', props.road);
  addRow('Километр', props.km);
  addRow('Комментарий', props.comment);

  const table = rows.length
    ? `<table style="border-collapse:collapse;font-size:13px;line-height:1.35;">${rows.join('')}</table>`
    : `<div style="color:#666;">Нет данных по этой точке.</div>`;

  return `
    <div style="min-width:240px;max-width:420px;">
      <div style="font-weight:700;margin-bottom:6px;">${escHtml(props.title)}</div>
      ${table}
    </div>
  `.trim();
}

function applyDynamicProps(obj, distanceMeters = null) {
  if (!obj) return;
  obj.properties = obj.properties || {};

  if (Number.isFinite(distanceMeters)) obj.properties.__ttDistanceMeters = distanceMeters;
  else delete obj.properties.__ttDistanceMeters;

  const props = formatProps(obj.properties);

  if (props.comment && !obj.properties.comment) obj.properties.comment = props.comment;

  obj.properties.hintContent = buildHintText(obj);
  obj.properties.balloonContent = buildBalloonContent(obj);

  const caption = props.comment ? clipText(props.comment, 40) : '';
  obj.properties.iconCaption = caption;
}

/* ------------------------------------------------------
   OFFICIAL UI formatting
------------------------------------------------------ */
function formatOfficialProps(p0) {
  const p = p0 || {};

  const title = pickFirst(p, ['title', 'name']) || 'Официальный пост';
  const type = pickFirst(p, ['type']) || 'UNKNOWN';
  const region = pickFirst(p, ['region_name', 'region']) || '';
  const road = pickFirst(p, ['road']) || '';
  const km = pickFirst(p, ['km']) || '';
  const status = pickFirst(p, ['status']) || '';
  const notes = pickFirst(p, ['notes', 'comment', 'description']) || '';

  const confidence = pickFirst(p, ['confidence']) || 'unknown';
  const coordsSource = pickFirst(p, ['coords_source']) || 'unknown';

  const sourceUrl = pickFirst(p, ['source_url']) || '';
  const sourceTitle = pickFirst(p, ['source_title']) || '';

  return { title, type, region, road, km, status, notes, confidence, coordsSource, sourceUrl, sourceTitle };
}

function buildOfficialHint(obj) {
  const p = formatOfficialProps(obj?.properties);
  const lines = [];
  lines.push(`ОФИЦИАЛЬНО: ${p.type}`);
  if (p.road || p.km) lines.push(`${[p.road, p.km].filter(Boolean).join(' • ')}`);
  if (p.status) lines.push(`Статус: ${clipText(p.status, 60)}`);
  return lines.join('\n');
}

function buildOfficialBalloon(obj) {
  const p = formatOfficialProps(obj?.properties);

  const rows = [];
  const addRow = (label, value) => {
    if (!value || String(value).trim() === '') return;
    rows.push(
      `<tr><td style="padding:2px 10px 2px 0;color:#666;white-space:nowrap;">${escHtml(label)}</td>` +
      `<td style="padding:2px 0;">${escHtml(value)}</td></tr>`
    );
  };

  addRow('Тип', p.type);
  addRow('Регион', p.region);
  addRow('Дорога', p.road);
  addRow('Км', p.km);
  addRow('Статус', p.status);
  addRow('Примечания', p.notes);
  addRow('Достоверность', p.confidence);
  addRow('Коорд. источник', p.coordsSource);

  let sourceBlock = '';
  if (p.sourceUrl) {
    const text = p.sourceTitle ? escHtml(p.sourceTitle) : 'Официальный источник';
    const url = escHtml(p.sourceUrl);
    sourceBlock = `<div style="margin-top:10px;">
      <a href="${url}" target="_blank" rel="noopener noreferrer" style="color:#4da3ff;text-decoration:none;font-weight:600;">
        ${text}
      </a>
    </div>`;
  }

  const table = rows.length
    ? `<table style="border-collapse:collapse;font-size:13px;line-height:1.35;">${rows.join('')}</table>`
    : `<div style="color:#666;">Нет данных.</div>`;

  return `
    <div style="min-width:260px;max-width:460px;">
      <div style="font-weight:800;margin-bottom:6px;">${escHtml(p.title)}</div>
      <div style="display:inline-block;margin-bottom:10px;padding:3px 8px;border-radius:999px;background:rgba(77,163,255,0.14);border:1px solid rgba(77,163,255,0.35);font-size:12px;">
        официальные посты
      </div>
      ${table}
      ${sourceBlock}
    </div>
  `.trim();
}

function applyOfficialProps(obj) {
  if (!obj) return;
  obj.properties = obj.properties || {};

  obj.properties.hintContent = buildOfficialHint(obj);
  obj.properties.balloonContent = buildOfficialBalloon(obj);

  const p = formatOfficialProps(obj.properties);
  obj.properties.iconCaption = p.type ? String(p.type).slice(0, 10) : '';
}

/* ------------------------------------------------------
   GeoJSON loader (общий)
------------------------------------------------------ */
async function fetchGeoJSON(url) {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) {
      console.warn('[TT][layers] Не удалось загрузить', url, res.status);
      return null;
    }
    const data = await res.json();
    if (!data || data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
      console.warn('[TT][layers] Некорректный формат GeoJSON от', url);
      return null;
    }
    return data;
  } catch (e) {
    console.warn('[TT][layers] Ошибка сети при загрузке', url, e);
    return null;
  }
}

/* ------------------------------------------------------
   Load frames
------------------------------------------------------ */
async function loadFramesGeoJSON() {
  if (framesLoadingPromise) return framesLoadingPromise;

  framesLoadingPromise = (async () => {
    const data = await fetchGeoJSON(FRAMES_GEOJSON_URL);
    if (!data) {
      console.warn('[TT][layers] Рамки не загружены по', FRAMES_GEOJSON_URL);
      return null;
    }
    framesData = data;
    console.log('[TT][layers] Рамки загружены:', data.features.length, 'из', FRAMES_GEOJSON_URL);
    return data;
  })();

  return framesLoadingPromise;
}

/* ------------------------------------------------------
   Load official
------------------------------------------------------ */
async function loadOfficialGeoJSON() {
  if (officialLoadingPromise) return officialLoadingPromise;

  officialLoadingPromise = (async () => {
    const data = await fetchGeoJSON(OFFICIAL_GEOJSON_URL);
    if (!data) {
      console.warn('[TT][layers] Официальные посты не загружены по', OFFICIAL_GEOJSON_URL);
      return null;
    }
    officialData = data;
    console.log('[TT][layers] Официальные посты загружены:', data.features.length, 'из', OFFICIAL_GEOJSON_URL);
    return data;
  })();

  return officialLoadingPromise;
}

/* ------------------------------------------------------
   Frames manager
------------------------------------------------------ */
function ensureFramesManager() {
  const map = getMap();
  if (!map || !hasYmaps()) return null;

  if (!framesManager) {
    framesManager = new ymaps.ObjectManager({
      clusterize: true,
      gridSize: 64,
      clusterDisableClickZoom: false
    });

    framesManager.options.set({
      geoObjectOpenBalloonOnClick: true,
      geoObjectHideIconOnBalloonOpen: false
    });

    try {
      framesManager.objects.options.set({
        preset: 'islands#orangeDotIconWithCaption',
        hasBalloon: true,
        hasHint: true,
        iconCaptionMaxWidth: 220
      });
    } catch (e) {
      console.warn('[TT][layers] preset with caption недоступен, fallback:', e);
      framesManager.objects.options.set({
        preset: 'islands#orangeDotIcon',
        hasBalloon: true,
        hasHint: true
      });
    }

    console.log('[TT][layers] ObjectManager (frames) создан');
  }

  if (framesVisible) {
    try { map.geoObjects.add(framesManager); } catch (_) {}
  } else {
    try { map.geoObjects.remove(framesManager); } catch (_) {}
  }

  return framesManager;
}

async function ensureFramesLoadedAndAdded() {
  const manager = ensureFramesManager();
  if (!manager) return false;

  const data = framesData || (await loadFramesGeoJSON());
  if (!data) {
    framesReadyResolver?.();
    return false;
  }

  if (data && Array.isArray(data.features)) {
    for (const f of data.features) {
      if (!f) continue;
      if (!f.properties) f.properties = {};
      if (f.geometry?.type === 'Point') applyDynamicProps(f, null);
    }
  }

  if (!framesAddedToManager) {
    try {
      manager.add(data);
      framesAddedToManager = true;
      framesReadyResolver?.();
      console.log('[TT][layers] Рамки добавлены в ObjectManager:', data.features.length);
    } catch (e) {
      console.warn('[TT][layers] Не удалось добавить рамки в ObjectManager:', e);
      return false;
    }
  }

  framesReadyResolver?.();

  return true;
}

/* ------------------------------------------------------
   Official manager
------------------------------------------------------ */
function ensureOfficialManager() {
  const map = getMap();
  if (!map || !hasYmaps()) return null;

  if (!officialManager) {
    officialManager = new ymaps.ObjectManager({
      clusterize: true,
      gridSize: 64,
      clusterDisableClickZoom: false
    });

    officialManager.options.set({
      geoObjectOpenBalloonOnClick: true,
      geoObjectHideIconOnBalloonOpen: false
    });

    try {
      officialManager.objects.options.set({
        preset: 'islands#blueDotIconWithCaption',
        hasBalloon: true,
        hasHint: true,
        iconCaptionMaxWidth: 200
      });
    } catch (e) {
      console.warn('[TT][layers] official preset недоступен, fallback:', e);
      officialManager.objects.options.set({
        preset: 'islands#blueDotIcon',
        hasBalloon: true,
        hasHint: true
      });
    }

    console.log('[TT][layers] ObjectManager (official) создан');
  }

  if (officialVisible) {
    try { map.geoObjects.add(officialManager); } catch (_) {}
  } else {
    try { map.geoObjects.remove(officialManager); } catch (_) {}
  }

  return officialManager;
}

async function ensureOfficialLoadedAndAdded() {
  const manager = ensureOfficialManager();
  if (!manager) return false;

  const data = officialData || (await loadOfficialGeoJSON());
  if (!data) return false;

  if (data && Array.isArray(data.features)) {
    for (const f of data.features) {
      if (!f) continue;
      if (!f.properties) f.properties = {};
      if (f.geometry?.type === 'Point') applyOfficialProps(f);
    }
  }

  if (!officialAddedToManager) {
    try {
      manager.add(data);
      officialAddedToManager = true;
      console.log('[TT][layers] Официальные посты добавлены в ObjectManager:', data.features.length);
    } catch (e) {
      console.warn('[TT][layers] Не удалось добавить official в ObjectManager:', e);
      return false;
    }
  }

  return true;
}

/* ------------------------------------------------------
   Geometry: point -> polyline distance
------------------------------------------------------ */
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

  const norm = normalizeCoordPair(g.coordinates);
  if (!norm) return null;

  const lon = Number(norm[0]);
  const lat = Number(norm[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;

  return [lon, lat];
}

/* ------------------------------------------------------
   Frames filtering (ROUTE ONLY)
------------------------------------------------------ */
async function internalApplyFramesFilter() {
  const ok = await ensureFramesLoadedAndAdded();
  if (!ok) return;

  const manager = ensureFramesManager();
  if (!manager) return;

  const useRoute = Array.isArray(framesRouteLonLat) && framesRouteLonLat.length >= 2;

  manager.setFilter((obj) => {
    if (!framesVisible) return false;

    if (!useRoute) {
      applyDynamicProps(obj, null);
      return false;
    }

    const pt = collectFramePointLonLat(obj);
    if (!pt) return false;

    const d = distancePointToPolylineMeters(pt, framesRouteLonLat);
    if (d <= (framesRouteMeters || 150)) {
      applyDynamicProps(obj, d);
      return true;
    }

    applyDynamicProps(obj, null);
    return false;
  });
}

/* ------------------------------------------------------
   Official visibility
------------------------------------------------------ */
async function internalSetOfficialVisible(visible) {
  officialVisible = !!visible;
  const ok = await ensureOfficialLoadedAndAdded();
  if (!ok) return;
  ensureOfficialManager();
}

/* ------------------------------------------------------
   API
------------------------------------------------------ */
if (HAS_WINDOW) {
  const api = (window.__TT_LAYERS = window.__TT_LAYERS || {});

  api.setFramesVisible = function setFramesVisible(visible) {
    framesVisible = !!visible;
    internalApplyFramesFilter().catch((e) => console.warn('[TT][layers] setFramesVisible error:', e));
  };

  api.setFramesRoute = function setFramesRoute(routeCoords, meters = 150) {
    const normRoute = normalizeRouteToLonLat(routeCoords);

    framesRouteLonLat = normRoute;
    framesRouteMeters = Math.max(10, Number(meters) || 150);

    framesVisible = !!(framesRouteLonLat && framesRouteLonLat.length >= 2);

    internalApplyFramesFilter().catch((e) => console.warn('[TT][layers] setFramesRoute error:', e));
  };

  api.clearFramesRoute = function clearFramesRoute() {
    framesRouteLonLat = null;
    framesVisible = false;
    internalApplyFramesFilter().catch((e) => console.warn('[TT][layers] clearFramesRoute error:', e));
  };

  api.countFramesOnRoute = function apiCountFramesOnRoute(routeCoords, meters = 150) {
    if (!framesData || !Array.isArray(framesData.features)) return { count: null, ids: [] };

    const routeLonLat = normalizeRouteToLonLat(routeCoords);
    if (!routeLonLat || routeLonLat.length < 2) return { count: null, ids: [] };

    const ids = [];
    const radius = Math.max(10, Number(meters) || 150);

    for (let i = 0; i < framesData.features.length; i++) {
      const f = framesData.features[i];
      const pt = collectFramePointLonLat(f);
      if (!pt) continue;

      const d = distancePointToPolylineMeters(pt, routeLonLat);
      if (d <= radius) ids.push(f?.id ?? f?.properties?.id ?? i);
    }
    return { count: ids.length, ids };
  };

  api.waitForFramesReady = function waitForFramesReady() {
    return framesReadyPromise;
  };

  api.setOfficialVisible = function setOfficialVisible(visible) {
    internalSetOfficialVisible(visible).catch((e) => console.warn('[TT][layers] setOfficialVisible error:', e));
  };

  ensureFramesLoadedAndAdded().catch(() => {});
  loadOfficialGeoJSON().catch(() => {});

  console.log('[TT][layers] Модуль слоёв загружен (frames route-only + route normalize fix)');
}

export {};
