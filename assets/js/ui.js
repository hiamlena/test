// assets/js/ui.js
// Инициализация UI-панели Trans-Time.
// UX-логика: автопостроение маршрута, без обязательной кнопки "Построить".

import { $, $$ } from './core.js';
import { buildRouteWithState } from './router.js';

const hasDom = typeof document !== 'undefined';
const hasWindow = typeof window !== 'undefined';

/**
 * Универсальная утилита для UI-событий
 */
function emit(name, detail = {}) {
  if (!hasWindow) return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

/**
 * Инициализация UI
 */
export function initUI() {
  if (!hasDom) return;

  // ─────────────────────────────────────────────
  // Сохранение состояния <details>
  // ─────────────────────────────────────────────

  const details = $$('.tt-details');
  details.forEach((el) => {
    const key = 'DETAILS_' + (el.id || 'unknown');
    try {
      const saved = localStorage.getItem(key);
      if (saved === 'true') el.setAttribute('open', '');
      if (saved === 'false') el.removeAttribute('open');

      el.addEventListener('toggle', () => {
        try {
          localStorage.setItem(key, String(el.open));
        } catch {}
      });
    } catch {}
  });

  // ─────────────────────────────────────────────
  // Подсветка выбранного типа транспорта
  // + автоперестроение маршрута
  // ─────────────────────────────────────────────

  $$('input[name=veh]').forEach((radio) => {
    radio.addEventListener('change', () => {
      $$('.tt-chip').forEach((chip) => chip.classList.remove('active'));
      radio.parentElement?.classList?.add('active');

      emit('tt_ui_vehicle_changed', { value: radio.value });

      // Автоперестроение маршрута при смене ТС
      autoBuildIfReady();
    });

    if (radio.checked) {
      radio.parentElement?.classList?.add('active');
    }
  });

  // ─────────────────────────────────────────────
  // Поля маршрута
  // ─────────────────────────────────────────────

  const fromInput = $('#from');
  const toInput   = $('#to');
  const buildBtn  = $('#buildBtn'); // fallback, если есть

  function hasRouteInputs() {
    return !!(
      fromInput &&
      toInput &&
      fromInput.value.trim() &&
      toInput.value.trim()
    );
  }

  function autoBuildIfReady() {
    if (!hasRouteInputs()) return;

    try {
      buildRouteWithState();
      emit('tt_ui_route_autobuild');
    } catch (e) {
      console.warn('[TT][ui] Автопостроение маршрута не удалось:', e);
    }
  }

  function handleInputChange() {
    emit('tt_ui_input_changed', {
      from: fromInput?.value,
      to: toInput?.value
    });

    // если есть кнопка — поддерживаем её состояние (fallback)
    if (buildBtn) {
      buildBtn.disabled = !hasRouteInputs();
    }

    // главное поведение — автопостроение
    autoBuildIfReady();
  }

  if (fromInput) {
    fromInput.addEventListener('input', handleInputChange);
  }

  if (toInput) {
    toInput.addEventListener('input', handleInputChange);
  }

  // ─────────────────────────────────────────────
  // Кнопка "Построить маршрут" (fallback)
  // ─────────────────────────────────────────────

  if (buildBtn) {
    buildBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (!hasRouteInputs()) return;

      buildRouteWithState();
      emit('tt_ui_route_build_manual');
    });

    // начальное состояние
    buildBtn.disabled = !hasRouteInputs();
  }

  // ─────────────────────────────────────────────
  // Хуки на будущее
  // ─────────────────────────────────────────────

  const editRouteBtn = $('#editRouteBtn');
  if (editRouteBtn) {
    editRouteBtn.addEventListener('click', () => {
      emit('tt_ui_edit_route');
    });
  }

  // Выбор альтернативного маршрута
  if (hasWindow) {
    window.tt_select_route = function (index) {
      emit('tt_ui_select_route', { index });
    };
  }

  // ⚠️ UI больше НЕ управляет рамками
  // Рамки всегда зависят от маршрута и обрабатываются в router.js / layers.js
}
