// core.js - базовые утилиты

// Безопасные обёртки над querySelector / querySelectorAll
export const $ = (s) => {
  // улучшено: защита от окружений без document (тесты/SSR)
  if (typeof document === 'undefined' || !s) return null;
  return document.querySelector(s);
};

export const $$ = (s) => {
  // улучшено: защита от окружений без document
  if (typeof document === 'undefined' || !s) return [];
  return Array.from(document.querySelectorAll(s));
};

// Внутренний helper для ленивого создания элемента
function ensureBody() {
  if (typeof document === 'undefined') return null;
  if (!document.body) return null;
  return document.body;
}

// Вспомогательный singleton для escapeHtml
let _escapeDiv = null;

/**
 * Показать toast-сообщение.
 * По умолчанию текст экранируется для безопасности.
 */
export function toast(message, ms = 4000) {
  const body = ensureBody();
  if (!body) {
    // улучшено: тихий фоллбек без падения, если body ещё нет
    if (typeof console !== 'undefined') {
      console.warn('[TT] toast: document.body not ready');
    }
    return;
  }

  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    body.appendChild(el);
  }

  // улучшено: экранируем текст, чтобы не словить XSS
  el.textContent = message != null ? String(message) : '';

  el.style.display = 'block';

  if (el._t) {
    clearTimeout(el._t);
  }

  el._t = setTimeout(() => {
    el.style.display = 'none';
  }, ms);
}

/**
 * Форматирование расстояния в метрах -> строка в км.
 * Пример: 12345 -> "12,3 км"
 */
export function fmtDist(m) {
  const num = Number(m);
  if (!Number.isFinite(num) || num < 0) {
    // улучшено: защита от мусора
    return '—';
  }

  // Можно в будущем добавить логику для метров (< 1000 м), пока оставим км
  const km = num / 1000;
  const value = km.toFixed(1).replace('.', ',');
  return value + ' км'; // улучшено: русские единицы измерения
}

/**
 * Форматирование времени в секундах -> строка.
 * Пример: 125 -> "2 мин", 3720 -> "1 ч 2 мин"
 */
export function fmtTime(s) {
  const num = Number(s);
  if (!Number.isFinite(num) || num < 0) {
    // улучшено: защита от мусора
    return '—';
  }

  const totalSeconds = Math.round(num);
  const h = (totalSeconds / 3600) | 0;
  const m = Math.round((totalSeconds % 3600) / 60);

  if (h > 0) {
    // улучшено: русские сокращения
    return `${h} ч ${m} мин`;
  }
  return `${m} мин`;
}

/**
 * Безопасное экранирование HTML.
 */
export function escapeHtml(s = '') {
  if (typeof document === 'undefined') {
    // улучшено: фоллбек без DOM
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  if (!_escapeDiv) {
    _escapeDiv = document.createElement('div'); // улучшено: переиспользуем один элемент
  }
  _escapeDiv.textContent = String(s);
  return _escapeDiv.innerHTML;
}

/**
 * Лог с поддержкой конфигурации TRANSTIME_CONFIG.debug.
 */
export const log = (...args) => {
  // улучшено: безопасная проверка window
  if (typeof window !== 'undefined' && window.TRANSTIME_CONFIG?.debug) {
    // eslint-disable-next-line no-console
    console.log('[TT]', ...args);
  }
};
