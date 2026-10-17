<?php
header('Content-Type: application/json');

$privateKeyPath = __DIR__ . '/../private_key.pem';
if (!file_exists($privateKeyPath)) {
    http_response_code(500);
    echo json_encode(["ok" => false, "message" => "Private key file missing"]);
    exit;
}

$privateKey = openssl_pkey_get_private(file_get_contents($privateKeyPath));
$inputData = json_decode(file_get_contents('php://input'), true);

$rawKey = isset($inputData['license_key']) ? trim($inputData['license_key']) : '';
$licenseKey = preg_replace('/[^A-Za-z0-9\-]/', '', $rawKey);

if (empty($licenseKey)) {
    echo json_encode(["ok" => false, "message" => "Chave inválida."]);
    exit;
}

$deviceId = isset($inputData['device_id']) ? $inputData['device_id'] : 'default_device_id';

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
        "url" => "https://shadow-license-server.vercel.app/api/v1/library.php?version=2.0.42"
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
