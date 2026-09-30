// Titik masuk fungsi Vercel (Build Output API). Dibundel oleh
// scripts/build-vercel.mjs menjadi api.func/index.mjs.
//
// index.js mengekspor aplikasi Express-nya dan tidak memanggil app.listen()
// saat process.env.VERCEL terpasang, karena di sini platform yang memegang
// socket-nya. Aplikasi Express sendiri sudah berbentuk (req, res) handler,
// jadi bisa langsung dipakai.

import app from './index.js';

export default app;
