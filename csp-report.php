<?php
/**
 * Обработчик отчётов CSP для /map.
 * Пишет репорты в logs/csp-YYYY-MM-DD.log и отвечает 204.
 */

$raw = file_get_contents('php://input');

if ($raw !== false && $raw !== '') {
    $logDir = __DIR__ . '/logs';

    if (!is_dir($logDir)) {
        @mkdir($logDir, 0755, true);
    }

    $file = $logDir . '/csp-' . date('Y-m-d') . '.log';
    $entry = '[' . date('c') . '] ' . $raw . PHP_EOL;

    @file_put_contents($file, $entry, FILE_APPEND);
}

http_response_code(204);
header('Content-Type: application/json; charset=utf-8');
echo json_encode(['status' => 'ok']);
