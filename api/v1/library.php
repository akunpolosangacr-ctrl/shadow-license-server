<?php
header('Content-Type: application/octet-stream');
// Mengembalikan file dummy/biner kosong agar aplikasi mengira unduhan berhasil
echo str_repeat("\x00", 1024);
exit;
