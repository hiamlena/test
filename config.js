// config.js - статический конфиг проекта Trans-Time

window.TRANSTIME_CONFIG = {
  yandex: {
    apiKey: '317aa42d-aa15-4acf-885a-6d6bfddb2339',
    suggestKey: '317aa42d-aa15-4acf-885a-6d6bfddb2339',
    lang: 'ru_RU',
    version: '2.1.95'
  },
  // ВАЖНО: порядок [долгота, широта], т.к. coordorder=longlat
  map: {
    // Было [55.751244, 37.618423] (lat, lon), исправлено на (lon, lat)
    center: [37.618423, 55.751244],
    zoom: 8
  },
  debug: true
};

// Конфиг для модулей карты (map.js читает TT_CONFIG)
window.TT_CONFIG = {
  defaultCenter: window.TRANSTIME_CONFIG.map.center,
  defaultZoom: window.TRANSTIME_CONFIG.map.zoom
};
