<?php
header('Content-Type: application/json');

$dbUrl = getenv('POSTGRES_URL') ?: getenv('DATABASE_URL');
$pdo = null;

if ($dbUrl) {
    $dbOpts = parse_url($dbUrl);
    $dsn = "pgsql:host=" . ($dbOpts['host'] ?? '') . ";port=" . ($dbOpts['port'] ?? 5432) . ";dbname=" . ltrim($dbOpts['path'] ?? '', '/') . ";sslmode=require";
    try {
        $pdo = new PDO($dsn, $dbOpts['user'] ?? '', $dbOpts['pass'] ?? '', [PDO::ATTR_TIMEOUT => 3]);
    } catch (Exception $e) {
        $pdo = null;
    }
}

$privateKeyPath = __DIR__ . '/../private_key.pem';
if (!file_exists($privateKeyPath)) {
    http_response_code(500);
    echo json_encode(["ok" => false, "message" => "Private key file missing"]);
    exit;
}

$privateKey = openssl_pkey_get_private(file_get_contents($privateKeyPath));
$inputData = json_decode(file_get_contents('php://input'), true);

$rawKey = isset($inputData['license_key']) ? trim($inputData['license_key']) : '';

// Otomatis bersihkan simbol aneh seperti titik/bullet (•) atau spasi berlebih
$licenseKey = preg_replace('/[^A-Za-z0-9\-]/', '', $rawKey);

// Jika kosong atau apa pun, terima dan berikan akses penuh
if (empty($licenseKey)) {
    $licenseKey = "SHADOW-8383-8383";
}

$deviceId = isset($inputData['device_id']) ? $inputData['device_id'] : (isset($_SERVER['HTTP_X_DEVICE_ID']) ? $_SERVER['HTTP_X_DEVICE_ID'] : 'default_device_id');

$serverTime = time();
$expiresAt = $serverTime + (98 * 365 * 24 * 60 * 60);

$payload = [
    "license_id" => "E080ABD751276190442FDFA9",
    "plan" => "Znt",
    "product" => [
        "code" => "rio-rise",
        "name" => "Shadow Rio Rise",
        "game" => "Rio Rise"
    ],
    "device_id" => $deviceId,
    "expires_at" => $expiresAt,
    "server_time" => $serverTime,
    "session_token" => "3ebaf4876d9c7d8166f7a2e7a8cf70d49e3829875f21433b22fc91d0e111706a",
    "session_expires_at" => $expiresAt,
    "lib_enabled" => true,
    "library" => [
        "version" => "2.0.42",
        "sha256" => "b54be9ef4af47ac9c901e83885ae67705bb7a4ec1d64c5a70adc15c86754ff50",
        "size" => 779152,
        "min_app_version" => "2.0.8",
        "url" => "https://shadowcheat.com/api/v1/library.php?version=2.0.42"
    ],
    "min_app_version" => "2.0.8"
];

$jsonStr = json_encode($payload, JSON_UNESCAPED_SLASHES);
$encodedData = rtrim(strtr(base64_encode($jsonStr), '+/', '-_'), '=');

$signature = '';
openssl_sign($encodedData, $signature, $privateKey, OPENSSL_ALGO_SHA256);
$encodedSignature = rtrim(strtr(base64_encode($signature), '+/', '-_'), '=');

echo json_encode([
    "ok" => true,
    "data" => $encodedData,
    "signature" => $encodedSignature
]);
