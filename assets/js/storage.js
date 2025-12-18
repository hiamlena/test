// storage.js - сохранение и загрузка маршрутов

import { $, toast, fmtDist, fmtTime, escapeHtml } from './core.js'; // улучшено: добавили форматирование и экранирование
import { buildRouteWithState } from './router.js';

const STORAGE_KEY = 'TT_SAVED_ROUTES_V2';
const MAX_ROUTES = 100;

export function saveCurrentRoute() {
  if (typeof window === 'undefined') {
    return;
  }

  if (!window.routes || !window.multiRoute) {
    toast('Нет активного маршрута для сохранения'); // улучшено: русский текст
    return;
  }

  const active = window.multiRoute.getActiveRoute?.();
  if (!active) {
    toast('Не выбран активный маршрут'); // улучшено
    return;
  }

  const points = [
    window.routes.legacyWaypoints?.[0]?.request || 'Точка A',
    ...window.routes.viaPoints.map((_, i) => `Через ${i + 1}`),
    window.routes.legacyWaypoints?.[1]?.request || 'Точка B'
  ].join(' → ');

  const duration = active.properties.get('durationInTraffic') || active.properties.get('duration') || {};
  const distance = active.properties.get('distance') || {};

  const routeData = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
    points,
    title: points,
    distance: distance.text || (distance.value ? fmtDist(distance.value) : '—'), // улучшено: единый формат
    time: duration.text || (duration.value ? fmtTime(duration.value) : '—'),    // улучшено
    state: getRouteState(),
    savedAt: new Date().toISOString()
  };

  try {
    const saved = loadRaw();
    saved.unshift(routeData);
    if (saved.length > MAX_ROUTES) saved.length = MAX_ROUTES;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    toast('Маршрут сохранён'); // улучшено
    renderSavedRoutes();
  } catch (e) {
    console.error('Save failed:', e);
    toast('Не удалось сохранить маршрут'); // улучшено
  }
}

function getRouteState() {
  return {
    from: $('#from')?.value || '',
    to:   $('#to')?.value || '',
    veh:  document.querySelector('input[name=veh]:checked')?.value || 'truck40',
    viaPoints: (typeof window !== 'undefined' && window.routes && window.routes.viaPoints) || [],
    truckParams: (typeof window !== 'undefined' && window.__TT_TRUCK_PARAMS) || {}
  };
}

function loadRaw() {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

export function loadSavedRoutes() {
  return loadRaw();
}

export function renderSavedRoutes() {
  const list = $('#savedRoutesList');
  if (!list) return;

  const routes = loadSavedRoutes();
  list.innerHTML = '';

  if (routes.length === 0) {
    const li = document.createElement('li');
    li.className = 'tt-saved-item';
    li.style.fontSize = '12px';
    li.style.color = '#666';
    li.textContent = 'Сохранённых маршрутов нет'; // улучшено
    list.appendChild(li);
    return;
  }

  routes.forEach((route) => {
    const li = document.createElement('li');
    li.className = 'tt-saved-item';
    li.style.marginBottom = '8px';
    li.style.cursor = 'pointer';
    li.style.padding = '6px 8px';
    li.style.borderRadius = '4px';
    li.style.backgroundColor = '#f8f8f8';

    // улучшено: экранируем потенциально вредное содержимое
    const title   = escapeHtml(route.title || '');
    const distTxt = escapeHtml(route.distance || '—');
    const timeTxt = escapeHtml(route.time || '—');

    li.innerHTML = `
      <div style="font-size:13px; font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
        ${title}
      </div>
      <div style="font-size:12px; color:#666; margin-top:2px;">
        ${distTxt} • ${timeTxt}
      </div>
    `;

    li.addEventListener('click', () => loadRoute(route));
    li.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      deleteRoute(route.id);
    });

    list.appendChild(li);
  });
}

function loadRoute(route) {
  try {
    if (typeof window === 'undefined') return;

    const fromInput = $('#from');
    const toInput   = $('#to');

    if (fromInput) fromInput.value = route.state.from || '';
    if (toInput)   toInput.value   = route.state.to   || '';

    const radio = document.querySelector(`input[name=veh][value="${route.state.veh}"]`);
    if (radio) radio.checked = true;

    window.__TT_TRUCK_PARAMS = route.state.truckParams || {};

    const weightInput = $('#truckWeight');
    const heightInput = $('#truckHeight');
    const widthInput  = $('#truckWidth');
    const lengthInput = $('#truckLength');

    if (weightInput) weightInput.value = route.state.truckParams?.weight || 40;
    if (heightInput) heightInput.value = route.state.truckParams?.height || 4.0;
    if (widthInput)  widthInput.value  = route.state.truckParams?.width  || 2.55;
    if (lengthInput) lengthInput.value = route.state.truckParams?.length || 16;

    // гарантируем наличие структур для via-точек
    window.routes = window.routes || {};
    window.routes.viaPoints = Array.isArray(route.state.viaPoints) ? [...route.state.viaPoints] : [];
    window.routes.viaMarkers = [];

    const globalMap = window.map || (window.__TT_MAP && window.__TT_MAP.map) || null;

    if (globalMap && typeof ymaps !== 'undefined') {
      window.routes.viaPoints.forEach((coords, idx) => {
        const mark = new ymaps.Placemark(
          coords,
          {
            hintContent: `Точка заезда ${idx + 1}`
          },
          {
            preset: 'islands#darkGreenCircleDotIcon'
          }
        );

        mark.events.add('click', () => {
          const index = window.routes.viaMarkers.indexOf(mark);
          if (index !== -1) {
            window.routes.viaPoints.splice(index, 1);
            window.routes.viaMarkers.splice(index, 1);
            globalMap.geoObjects.remove(mark);
            if ($('#from')?.value.trim() && $('#to')?.value.trim()) {
              buildRouteWithState();
            }
          }
        });

        globalMap.geoObjects.add(mark);
        window.routes.viaMarkers.push(mark);
      });
    }

    buildRouteWithState();
    toast('Маршрут загружен'); // улучшено
  } catch (e) {
    console.error('Load failed:', e);
    toast('Не удалось загрузить маршрут'); // улучшено
  }
}

function deleteRoute(id) {
  if (typeof window === 'undefined') return;
  try {
    const saved = loadSavedRoutes();
    const filtered = saved.filter((r) => r.id !== id);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    renderSavedRoutes();
    toast('Маршрут удалён'); // улучшено
  } catch (e) {
    console.error('Delete failed:', e);
    toast('Не удалось удалить маршрут'); // улучшено
  }
}
