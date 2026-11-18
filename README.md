# 🏗️ Web-App KDMP Desa Sumberjo (GitHub + Vercel + Headless Google Apps Script)

Portal Digital **Koperasi Desa Merah Putih (KDMP) Desa Sumberjo** berdesain **Modern Glassmorphism Single Page Application (SPA)**. Menggunakan arsitektur *Headless* di mana Frontend di-hosting super cepat di **Vercel / GitHub**, sedangkan Database tetap menggunakan **5 Sheet Google Sheets** dan penyimpanan foto otomatis di **Google Drive** secara gratis.

---

## 📂 Daftar File dalam Paket Ini

1. **`index.html`** — Frontend Single Page Application (SPA) dengan desain Glassmorphism, Light/Dark mode persisten, katalog Produk KDMP, galeri Potensi UMKM, dan Portal Admin tersembunyi (dilengkapi jembatan `fetch()` REST API untuk Vercel & fallback `google.script.run`).
2. **`vercel.json`** — Konfigurasi routing SPA Vercel agar URL seperti `/admin` maupun `#/admin` langsung diarahkan ke `index.html` tanpa error 404.
3. **`package.json` & `.gitignore`** — Metadata standar repositori GitHub agar langsung dikenali oleh Vercel.
4. **`Code.gs`** — Skrip Backend Google Apps Script yang kini mendukung **REST API JSON (`doPost` & `doGet`)** bebas kendala CORS (`text/plain;charset=utf-8`), sekaligus tetap kompatibel jika dibuka dari URL GAS maupun Google Sites.

---

## 🚀 Langkah 1: Setup Backend API di Google Sheets & Apps Script

1. Buka Google Spreadsheet KDMP Desa Sumberjo Anda, lalu klik **Ekstensi (Extensions) > Apps Script**.
2. Ganti seluruh isi file `Code.gs` di editor Apps Script dengan isi file **`Code.gs`** dari paket ini, lalu tekan `Ctrl + S`.
3. Jika pertama kali membuat database, pilih fungsi **`setupDatabase`** di toolbar atas lalu klik **Run (Jalankan)** agar 5 Sheet (`Settings`, `Links`, `Produk_KDMP`, `Potensi_UMKM`, `Admin`) dan folder Google Drive publik terbentuk otomatis.
4. Klik **Terapkan (Deploy) > Deployment baru (New deployment)** (atau **Kelola deployment > Edit > Versi Baru** jika memperbarui deployment sebelumnya):
   - **Jenis:** Aplikasi Web (*Web app*)
   - **Jalankan sebagai (*Execute as*):** Saya (*Me*)
   - **Siapa yang memiliki akses (*Who has access*):** Siapa saja (*Anyone*) — *Wajib "Anyone" agar Vercel dapat memanggil API JSON tanpa terblokir halaman login Google.*
5. Salin **URL Aplikasi Web** yang berakhiran `/exec` (contoh: `https://script.google.com/macros/s/AKfycb.../exec`).

---

## 🔗 Langkah 2: Hubungkan URL API GAS ke `index.html`

Anda dapat menghubungkan URL `/exec` Google Apps Script ke frontend dengan **dua cara mudah**:

- **Cara A (Permanen di Kode Sebelum Push ke GitHub):**
  Buka file `index.html`, cari baris konfigurasi `DEFAULT_GAS_WEB_APP_URL` (sekitar baris 814), lalu tempelkan URL `/exec` Anda:
  ```javascript
  var DEFAULT_GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycb.../exec';
  ```
- **Cara B (Langsung dari Dashboard Admin di Browser):**
  Buka web Anda, ketuk logo **MP** di kiri atas **3 kali berturut-turut** (atau buka `/admin`), login (`admin` / `sumberjo2026`), buka tab **5. Sheet Admin & Struktur DB**, lalu tempelkan URL `/exec` Anda pada kolom **Koneksi API Backend GAS (Vercel / GitHub)** dan klik **Simpan & Sinkronkan API**.

---

## ☁️ Langkah 3: Push ke GitHub & Deploy ke Vercel

1. Buat repositori baru di **GitHub** (misalnya `kdmp-sumberjo-webapp`).
2. Upload file **`index.html`**, **`vercel.json`**, **`package.json`**, **`.gitignore`**, dan **`README.md`** ke repositori GitHub tersebut (file `Code.gs` juga boleh ikut disimpan di GitHub sebagai cadangan).
3. Buka [vercel.com](https://vercel.com), login dengan akun GitHub Anda, lalu klik **Add New... > Project**.
4. Pilih repositori `kdmp-sumberjo-webapp` dan klik **Import**.
5. Pada bagian *Framework Preset*, biarkan **Other** (Static HTML), lalu klik **Deploy**.
6. Dalam waktu kurang dari 30 detik, Web-App KDMP Desa Sumberjo Anda sudah aktif di domain `.vercel.app`!
