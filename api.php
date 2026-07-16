<?php
/**
 * Daymark API
 * PHP 7.4+ / SQLite3
 *
 * Routes:
 *   GET  /api/health
 *   GET  /api/state
 *   PUT  /api/state
 *   GET  /api/records
 *   POST /api/records
 *   PUT  /api/records/{id}
 *   DELETE /api/records/{id}
 */

header('Content-Type: application/json; charset=UTF-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Cache-Control: no-store, no-cache, must-revalidate');
header('X-Content-Type-Options: nosniff');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

define('DATA_DIR', __DIR__ . DIRECTORY_SEPARATOR . 'data');
$legacyDbFile = DATA_DIR . DIRECTORY_SEPARATOR . 'finflow.db';
define('DB_FILE', file_exists($legacyDbFile) ? $legacyDbFile : DATA_DIR . DIRECTORY_SEPARATOR . 'daymark.db');
define('MAX_BODY_BYTES', 10 * 1024 * 1024);

if (!is_dir(DATA_DIR) && !mkdir(DATA_DIR, 0755, true) && !is_dir(DATA_DIR)) {
    respond(array('ok' => false, 'error' => '无法创建数据目录'), 500);
}

try {
    $db = new SQLite3(DB_FILE);
    $db->busyTimeout(5000);
    $db->exec('PRAGMA journal_mode=WAL');
    $db->exec('PRAGMA synchronous=NORMAL');
    $db->exec('CREATE TABLE IF NOT EXISTS records (
        id INTEGER PRIMARY KEY,
        type TEXT NOT NULL,
        amount REAL NOT NULL,
        category TEXT NOT NULL DEFAULT \'其他\',
        account TEXT NOT NULL DEFAULT \'其他\',
        date TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT \'\',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_records_date ON records(date)');
    $db->exec('CREATE TABLE IF NOT EXISTS app_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )');
    ensure_column($db, 'records', 'account', "TEXT NOT NULL DEFAULT '其他'");
} catch (Exception $e) {
    respond(array('ok' => false, 'error' => 'SQLite 初始化失败: ' . $e->getMessage()), 500);
}

$method = isset($_SERVER['REQUEST_METHOD']) ? strtoupper($_SERVER['REQUEST_METHOD']) : 'GET';
$path = resolve_path();
if (strpos($path, '/api/') !== 0) {
    $path = '/api' . ($path === '/' ? '/health' : $path);
}

if ($method === 'GET' && $path === '/api/health') {
    $recordCount = (int)$db->querySingle('SELECT COUNT(*) FROM records');
    $hasState = (int)$db->querySingle('SELECT COUNT(*) FROM app_state WHERE id = 1') > 0;
    respond(array(
        'ok' => true,
        'time' => date('c'),
        'php' => PHP_VERSION,
        'sqlite' => SQLite3::version()['versionString'],
        'storage' => 'sqlite',
        'records' => $recordCount,
        'state' => $hasState,
        'version' => '4.0'
    ));
}

if ($method === 'GET' && $path === '/api/state') {
    $row = $db->querySingle('SELECT payload, updated_at FROM app_state WHERE id = 1', true);
    if (!$row) {
        respond(array('ok' => true, 'data' => new stdClass(), 'updatedAt' => null));
    }
    $payload = json_decode($row['payload'], true);
    if (!is_array($payload)) {
        respond(array('ok' => false, 'error' => '服务器状态数据损坏'), 500);
    }
    respond(array('ok' => true, 'data' => $payload, 'updatedAt' => $row['updated_at']));
}

if ($method === 'PUT' && $path === '/api/state') {
    $body = read_json_body();
    if (!is_array($body)) {
        respond(array('ok' => false, 'error' => '状态必须是 JSON 对象'), 400);
    }
    if (!isset($body['version']) || !isset($body['updatedAt'])) {
        respond(array('ok' => false, 'error' => '状态缺少 version 或 updatedAt'), 422);
    }
    $payload = json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($payload === false) {
        respond(array('ok' => false, 'error' => '状态序列化失败'), 400);
    }
    $stmt = $db->prepare('INSERT INTO app_state (id, payload, updated_at) VALUES (1, :payload, :updated_at)
        ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at');
    $stmt->bindValue(':payload', $payload, SQLITE3_TEXT);
    $stmt->bindValue(':updated_at', date('c'), SQLITE3_TEXT);
    $stmt->execute();
    respond(array('ok' => true, 'bytes' => strlen($payload), 'updatedAt' => date('c')));
}

if ($method === 'GET' && $path === '/api/records') {
    $result = $db->query('SELECT id, type, amount, category, account, date, note, created_at FROM records ORDER BY date DESC, id DESC');
    $records = array();
    while ($row = $result->fetchArray(SQLITE3_ASSOC)) {
        $row['id'] = (int)$row['id'];
        $row['amount'] = (float)$row['amount'];
        $row['createdAt'] = $row['created_at'];
        unset($row['created_at']);
        $records[] = $row;
    }
    respond(array('ok' => true, 'data' => $records));
}

if ($method === 'GET' && $path === '/api/categories') {
    respond(array('ok' => true, 'data' => array(
        'expense' => array('餐饮', '购物', '交通', '住房', '娱乐', '医疗', '教育', '通讯', '日用', '人情', '旅行', '其他'),
        'income' => array('工资', '奖金', '投资', '副业', '退款', '礼金', '其他')
    )));
}

if ($method === 'POST' && $path === '/api/records') {
    $body = read_json_body();
    $items = is_list_array($body) ? $body : array($body);
    if (count($items) === 0) {
        respond(array('ok' => false, 'error' => '请求体为空'), 400);
    }
    $stmt = $db->prepare('INSERT OR REPLACE INTO records (id, type, amount, category, account, date, note, created_at)
        VALUES (:id, :type, :amount, :category, :account, :date, :note, :created_at)');
    $db->exec('BEGIN IMMEDIATE');
    $saved = array();
    try {
        foreach ($items as $item) {
            validate_record($item);
            $id = isset($item['id']) && is_numeric($item['id']) ? (int)$item['id'] : next_record_id();
            $stmt->reset();
            $stmt->clear();
            $stmt->bindValue(':id', $id, SQLITE3_INTEGER);
            $stmt->bindValue(':type', $item['type'], SQLITE3_TEXT);
            $stmt->bindValue(':amount', (float)$item['amount'], SQLITE3_FLOAT);
            $stmt->bindValue(':category', isset($item['category']) ? $item['category'] : '其他', SQLITE3_TEXT);
            $stmt->bindValue(':account', isset($item['account']) ? $item['account'] : '其他', SQLITE3_TEXT);
            $stmt->bindValue(':date', isset($item['date']) ? $item['date'] : date('Y-m-d'), SQLITE3_TEXT);
            $stmt->bindValue(':note', isset($item['note']) ? $item['note'] : '', SQLITE3_TEXT);
            $stmt->bindValue(':created_at', isset($item['createdAt']) ? $item['createdAt'] : date('c'), SQLITE3_TEXT);
            $stmt->execute();
            $item['id'] = $id;
            $saved[] = $item;
        }
        $db->exec('COMMIT');
    } catch (Exception $e) {
        $db->exec('ROLLBACK');
        respond(array('ok' => false, 'error' => '保存失败: ' . $e->getMessage()), 422);
    }
    respond(array('ok' => true, 'data' => is_list_array($body) ? $saved : $saved[0], 'count' => count($saved)), 201);
}

if ($method === 'PUT' && preg_match('#^/api/records/(\d+)$#', $path, $match)) {
    $id = (int)$match[1];
    $body = read_json_body();
    $allowed = array('type', 'amount', 'category', 'account', 'date', 'note');
    $sets = array();
    foreach ($allowed as $field) {
        if (array_key_exists($field, $body)) {
            $sets[] = $field . ' = :' . $field;
        }
    }
    if (!$sets) {
        respond(array('ok' => false, 'error' => '没有可更新字段'), 400);
    }
    if (isset($body['type']) && !in_array($body['type'], array('income', 'expense'), true)) {
        respond(array('ok' => false, 'error' => 'type 只能是 income 或 expense'), 422);
    }
    $stmt = $db->prepare('UPDATE records SET ' . implode(', ', $sets) . ' WHERE id = :id');
    $stmt->bindValue(':id', $id, SQLITE3_INTEGER);
    foreach ($allowed as $field) {
        if (!array_key_exists($field, $body)) continue;
        $type = $field === 'amount' ? SQLITE3_FLOAT : SQLITE3_TEXT;
        $stmt->bindValue(':' . $field, $body[$field], $type);
    }
    $stmt->execute();
    if ($db->changes() === 0) respond(array('ok' => false, 'error' => '记录不存在或内容未变化'), 404);
    respond(array('ok' => true));
}

if ($method === 'DELETE' && preg_match('#^/api/records/(\d+)$#', $path, $match)) {
    $stmt = $db->prepare('DELETE FROM records WHERE id = :id');
    $stmt->bindValue(':id', (int)$match[1], SQLITE3_INTEGER);
    $stmt->execute();
    if ($db->changes() === 0) respond(array('ok' => false, 'error' => '记录不存在'), 404);
    respond(array('ok' => true));
}

respond(array('ok' => false, 'error' => 'Not Found', 'path' => $path), 404);

function respond($data, $status = 200) {
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function resolve_path() {
    if (isset($_GET['endpoint'])) return normalize_path($_GET['endpoint']);
    $uri = isset($_SERVER['REQUEST_URI']) ? parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) : '/';
    $script = isset($_SERVER['SCRIPT_NAME']) ? $_SERVER['SCRIPT_NAME'] : '/api.php';
    $directory = str_replace('\\', '/', dirname($script));
    if ($directory !== '/' && $directory !== '.' && strpos($uri, $directory) === 0) {
        $uri = substr($uri, strlen($directory));
    }
    $uri = preg_replace('#^/api\.php#', '', $uri);
    return normalize_path($uri);
}

function normalize_path($path) {
    $path = trim((string)$path);
    if ($path === '' || $path === '/' || $path === '/api.php') return '/api/health';
    return '/' . trim($path, '/');
}

function read_json_body() {
    $length = isset($_SERVER['CONTENT_LENGTH']) ? (int)$_SERVER['CONTENT_LENGTH'] : 0;
    if ($length > MAX_BODY_BYTES) respond(array('ok' => false, 'error' => '请求体超过 10MB 限制'), 413);
    $raw = file_get_contents('php://input');
    if ($raw === false || trim($raw) === '') return array();
    if (strlen($raw) > MAX_BODY_BYTES) respond(array('ok' => false, 'error' => '请求体超过 10MB 限制'), 413);
    $data = json_decode($raw, true);
    if (json_last_error() !== JSON_ERROR_NONE) respond(array('ok' => false, 'error' => 'JSON 格式错误: ' . json_last_error_msg()), 400);
    return $data;
}

function validate_record($item) {
    if (!is_array($item)) throw new InvalidArgumentException('记录必须是对象');
    if (!isset($item['type']) || !in_array($item['type'], array('income', 'expense'), true)) throw new InvalidArgumentException('type 只能是 income 或 expense');
    if (!isset($item['amount']) || !is_numeric($item['amount']) || (float)$item['amount'] <= 0) throw new InvalidArgumentException('amount 必须大于 0');
    if (isset($item['date']) && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $item['date'])) throw new InvalidArgumentException('date 必须为 YYYY-MM-DD');
}

function is_list_array($value) {
    if (!is_array($value) || $value === array()) return false;
    return array_keys($value) === range(0, count($value) - 1);
}

function next_record_id() {
    return (int)round(microtime(true) * 1000) + random_int(0, 999);
}

function ensure_column($db, $table, $column, $definition) {
    $result = $db->query("PRAGMA table_info($table)");
    while ($row = $result->fetchArray(SQLITE3_ASSOC)) {
        if ($row['name'] === $column) return;
    }
    $db->exec("ALTER TABLE $table ADD COLUMN $column $definition");
}
