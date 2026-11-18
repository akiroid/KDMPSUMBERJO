/**
 * ============================================================================
 * 🏗️ BACKEND GOOGLE APPS SCRIPT (Code.gs)
 * WEB-APP KOPERASI DESA MERAH PUTIH (KDMP) DESA SUMBERJO
 * ============================================================================
 * Arsitektur: Single Page Application (SPA) + Google Sheets DB (5 Sheets) + Google Drive Storage
 *
 * CARA PENGGUNAAN CEPAT:
 * 1. Buat Google Spreadsheet baru atau buka Spreadsheet KDMP Sumberjo.
 * 2. Klik Extensions > Apps Script.
 * 3. Salin seluruh kode ini ke dalam file `Code.gs`.
 * 4. Buat file HTML baru bernama `Index.html` dan salin kode dari file HTML aplikasi.
 * 5. Jalankan fungsi `setupDatabase()` satu kali dari editor Apps Script untuk membuat
 *    5 Sheet beserta data awal dan folder Google Drive otomatis.
 * 6. Klik Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone).
 * ============================================================================
 */

const CONFIG = {
  SPREADSHEET_ID: '', // Kosongkan jika script terikat langsung (Container-bound) di Google Sheets, atau isi ID Spreadsheet
  DRIVE_FOLDER_ID: '', // Opsional: Isi ID Folder Google Drive khusus foto. Jika kosong, sistem membuat folder otomatis.
  DRIVE_FOLDER_NAME: 'KDMP_SUMBERJO_MEDIA_STORAGE',
  SHEETS: {
    SETTINGS: 'Settings',
    LINKS: 'Links',
    PRODUK: 'Produk_KDMP',
    UMKM: 'Potensi_UMKM',
    ADMIN: 'Admin'
  }
};

/**
 * Helper membuat response JSON bebas hambatan CORS untuk Frontend Vercel / GitHub / Netlify
 */
function createJsonResponse_(dataObj) {
  return ContentService.createTextOutput(JSON.stringify(dataObj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Entry point HTTP GET:
 * - Jika dipanggil dari Vercel/GitHub dengan `?action=getInitialAppData` (atau `format=json`),
 *   maka merespons sebagai REST API JSON.
 * - Jika dibuka langsung di browser tanpa parameter JSON, merender `Index.html` (jika ada) atau info status API.
 */
function doGet(e) {
  ensureDatabaseInitialized_();
  const params = (e && e.parameter) ? e.parameter : {};

  if (params.action === 'getInitialAppData' || params.format === 'json' || params.api === '1') {
    const token = params.token ? String(params.token) : '';
    return createJsonResponse_(getInitialAppData(token));
  }

  if (params.action === 'ping') {
    return createJsonResponse_({
      success: true,
      service: 'KDMP Desa Sumberjo Headless GAS API',
      status: 'ONLINE',
      timestamp: new Date().toISOString()
    });
  }

  try {
    const template = HtmlService.createTemplateFromFile('Index');
    const initialPage = params.page ? String(params.page) : '';
    template.initialPage = initialPage;

    return template.evaluate()
      .setTitle('Portal Resmi KDMP Desa Sumberjo — Koperasi Desa Merah Putih')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=5');
  } catch (err) {
    // Jika di-deploy murni sebagai Headless Backend API tanpa file Index.html di Apps Script
    return createJsonResponse_(getInitialAppData(params.token || ''));
  }
}

/**
 * Entry point HTTP POST (Headless REST API untuk Vercel / GitHub Pages / Netlify):
 * Menerima request `fetch(GAS_API_URL, { method: 'POST', headers: {'Content-Type': 'text/plain;charset=utf-8'}, body: JSON.stringify(...) })`
 * Menggunakan text/plain agar browser tidak mengirim preflight OPTIONS yang ditolak GAS.
 */
function doPost(e) {
  try {
    ensureDatabaseInitialized_();
    const rawBody = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    const req = JSON.parse(rawBody);
    const action = String(req.action || '').trim();
    const token = String(req.token || '').trim();

    if (action === 'getInitialAppData') {
      return createJsonResponse_(getInitialAppData(token));
    }
    if (action === 'adminLogin') {
      return createJsonResponse_(adminLogin(req.username, req.password));
    }
    if (action === 'adminLogout') {
      return createJsonResponse_(adminLogout(token));
    }
    if (action === 'saveGlobalSettings') {
      return createJsonResponse_(saveGlobalSettings(token, req.settings || req.payload));
    }
    if (action === 'updateAdminAccount') {
      return createJsonResponse_(updateAdminAccount(token, req.newUsername, req.newPassword));
    }
    if (action === 'saveEntityRecord') {
      return createJsonResponse_(saveEntityRecord(token, req.entityType, req.payload));
    }
    if (action === 'toggleEntityStatus') {
      return createJsonResponse_(toggleEntityStatus(token, req.entityType, req.recordId));
    }
    if (action === 'deleteEntityRecord') {
      return createJsonResponse_(deleteEntityRecord(token, req.entityType, req.recordId));
    }

    return createJsonResponse_({
      success: false,
      message: 'Action API tidak dikenali: ' + action
    });
  } catch (err) {
    return createJsonResponse_({
      success: false,
      message: 'Kesalahan Server GAS doPost: ' + err.message
    });
  }
}

/**
 * Helper mengambil objek Spreadsheet aktif
 */
function getSpreadsheet_() {
  if (CONFIG.SPREADSHEET_ID && CONFIG.SPREADSHEET_ID.trim() !== '') {
    return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID.trim());
  }
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;

  const props = PropertiesService.getScriptProperties();
  const savedId = props.getProperty('KDMP_SPREADSHEET_ID');
  if (savedId) {
    try {
      return SpreadsheetApp.openById(savedId);
    } catch (err) {
      // Lanjut buat spreadsheet baru jika tidak ditemukan
    }
  }
  const created = SpreadsheetApp.create('DATABASE_WEBAPP_KDMP_SUMBERJO');
  props.setProperty('KDMP_SPREADSHEET_ID', created.getId());
  return created;
}

/**
 * Helper mengambil atau membuat Folder Google Drive untuk penyimpanan foto publik
 */
function getOrCreateStorageFolder_() {
  const props = PropertiesService.getScriptProperties();
  const folderId = CONFIG.DRIVE_FOLDER_ID || props.getProperty('KDMP_DRIVE_FOLDER_ID');

  if (folderId) {
    try {
      const existingFolder = DriveApp.getFolderById(folderId);
      return existingFolder;
    } catch (err) {
      // Buat folder baru jika ID tidak valid
    }
  }

  const folders = DriveApp.getFoldersByName(CONFIG.DRIVE_FOLDER_NAME);
  let folder;
  if (folders.hasNext()) {
    folder = folders.next();
  } else {
    folder = DriveApp.createFolder(CONFIG.DRIVE_FOLDER_NAME);
  }

  // Atur izin folder menjadi Public (Anyone with link can view)
  try {
    folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {
    Logger.log('Info izin folder: ' + e.message);
  }

  props.setProperty('KDMP_DRIVE_FOLDER_ID', folder.getId());
  return folder;
}

/**
 * Fungsi Hash Sederhana SHA-256 (Hexadecimal) untuk keamanan Password Admin
 */
function hashPassword_(rawPassword) {
  const text = String(rawPassword || '').trim();
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return digest.map(function(byte) {
    const v = (byte < 0) ? 256 + byte : byte;
    return ('0' + v.toString(16)).slice(-2);
  }).join('');
}

/**
 * Inisialisasi Otomatis 5 Sheet sesuai Master Blueprint KDMP Sumberjo
 * Dapat dijalankan manual dari Editor Apps Script (Run > setupDatabase)
 */
function setupDatabase() {
  const ss = getSpreadsheet_();
  const S = CONFIG.SHEETS;

  // 1. Sheet Settings (Parameter | Nilai)
  let shSettings = ss.getSheetByName(S.SETTINGS);
  if (!shSettings) {
    shSettings = ss.insertSheet(S.SETTINGS);
    shSettings.getRange(1, 1, 1, 2).setValues([['Parameter', 'Nilai']]).setFontWeight('bold');
    shSettings.getRange(2, 1, 10, 2).setValues([
      ['Nama_Web', 'KDMP Desa Sumberjo'],
      ['Subjudul_Web', 'Koperasi Desa Merah Putih & Sentra Ekonomi Warga Sumberjo'],
      ['Judul_Sambutan', 'Sinergi Ekonomi Kerakyatan & Etalase Digital Desa Sumberjo'],
      ['Sambutan_Utama', 'Selamat datang di Portal Digital Koperasi Desa Merah Putih (KDMP) Desa Sumberjo. Melalui sinergi ekonomi kerakyatan, kami menghadirkan produk unggulan koperasi, layanan kemitraan agribisnis, serta etalase produk UMKM dan potensi terbaik warga Desa Sumberjo dalam satu layanan terpadu yang transparan dan mudah diakses.'],
      ['Tokoh_Sambutan', 'Ketua Pengurus KDMP & Kepala Desa Sumberjo'],
      ['Jabatan_Sambutan', 'Pemerintah Desa & Pengurus Koperasi Desa Merah Putih Sumberjo'],
      ['ID_Foto_Sambutan', 'DEMO_TOKOH'],
      ['ID_Logo_Web', ''],
      ['Pesan_Footer', '© 2026 Koperasi Desa Merah Putih (KDMP) Desa Sumberjo, Kec. Lamongan, Kab. Lamongan. Membangun Desa Mandiri & Sejahtera.'],
      ['Nomor_WA_Default', '6281234567890']
    ]);
  }

  // 2. Sheet Links (ID | Judul Tautan | URL | Ikon | Status)
  let shLinks = ss.getSheetByName(S.LINKS);
  if (!shLinks) {
    shLinks = ss.insertSheet(S.LINKS);
    shLinks.getRange(1, 1, 1, 5).setValues([['ID', 'Judul Tautan', 'URL', 'Ikon', 'Status']]).setFontWeight('bold');
    shLinks.getRange(2, 1, 6, 5).setValues([
      ['LNK-001', 'Portal Berita Desa Sumberjo', 'https://lamongankab.go.id', 'newspaper', 'Aktif'],
      ['LNK-002', 'Pendaftaran Mitra UMKM KDMP', 'https://forms.gle/kdkmpSumberjoMitra', 'store', 'Aktif'],
      ['LNK-003', 'Instagram Resmi KDMP Sumberjo', 'https://instagram.com/kdmpsumberjo', 'instagram', 'Aktif'],
      ['LNK-004', 'Layanan Simpan Pinjam & PPOB', 'https://wa.me/6281234567890?text=Halo%20Admin%20KDMP%2C%20saya%20ingin%20informasi%20layanan%20Koperasi', 'wallet', 'Aktif'],
      ['LNK-005', 'YouTube Profil Desa Sumberjo', 'https://youtube.com', 'video', 'Aktif'],
      ['LNK-006', 'Laporan RAT Koperasi Tahunan', 'https://drive.google.com', 'file-text', 'Draft']
    ]);
  }

  // 3. Sheet Produk_KDMP (ID | Nama Produk | Harga | Deskripsi | ID_Foto_Drive | No_WA_Pemesanan | Status)
  let shProduk = ss.getSheetByName(S.PRODUK);
  if (!shProduk) {
    shProduk = ss.insertSheet(S.PRODUK);
    shProduk.getRange(1, 1, 1, 7).setValues([
      ['ID', 'Nama Produk', 'Harga', 'Deskripsi', 'ID_Foto_Drive', 'No_WA_Pemesanan', 'Status']
    ]).setFontWeight('bold');
    shProduk.getRange(2, 1, 5, 7).setValues([
      ['PRD-001', 'Kaos Seragam KDKMP Sumberjo Exclusive', 85000, 'Kaos polo katun combed 24s bordir presisi logo Koperasi Desa Merah Putih Sumberjo. Nyaman dipakai kegiatan lapangan maupun rapat anggota.', 'DEMO_KAOS', '6281234567890', 'Aktif'],
      ['PRD-002', 'Beras Premium Sumberjo Pulen Wangi (5 Kg)', 72500, 'Beras pilihan hasil panen petani anggota KDMP Desa Sumberjo. Diproses tanpa pemutih, bersih, pulen, dan dikemas higienis.', 'DEMO_BERAS', '6281234567890', 'Aktif'],
      ['PRD-003', 'Paket Sembako Hemat Merah Putih', 125000, 'Paket sembako koperasi berisi Beras 5 Kg, Minyak Goreng 1 Liter, Gula Pasir 1 Kg, dan Teh Celup untuk kebutuhan rumah tangga warga.', 'DEMO_SEMBAKO', '6281234567890', 'Aktif'],
      ['PRD-004', 'Pupuk Organik Cair & Hayati Tani Makmur (1L)', 45000, 'Formula nutrisi organik produksi unit agribisnis KDMP Sumberjo untuk meningkatkan hasil panen padi, jagung, dan hortikultura.', 'DEMO_PUPUK', '6281234567890', 'Aktif'],
      ['PRD-005', 'Merchandise Topi & Tumbler KDMP Sumberjo', 65000, 'Paket suvenir resmi anggota Koperasi Desa Merah Putih Sumberjo berbahan stainless tahan panas dan topi bordir.', 'DEMO_MERCH', '6281234567890', 'Aktif']
    ]);
  }

  // 4. Sheet Potensi_UMKM (ID | Nama | Pengelola/Desa | Deskripsi Singkat | ID_Foto_Drive | No_WA_Kontak | Status)
  let shUmkm = ss.getSheetByName(S.UMKM);
  if (!shUmkm) {
    shUmkm = ss.insertSheet(S.UMKM);
    shUmkm.getRange(1, 1, 1, 7).setValues([
      ['ID', 'Nama', 'Pengelola/Desa', 'Deskripsi Singkat', 'ID_Foto_Drive', 'No_WA_Kontak', 'Status']
    ]).setFontWeight('bold');
    shUmkm.getRange(2, 1, 5, 7).setValues([
      ['UMK-001', 'Agrowisata Petik Melon Hidroponik', 'POKDARWIS & BUMDes Sumberjo', 'Wisata edukasi greenhouse melon golden premium manis renyah. Pengunjung dapat memetik langsung buah melon segar dari kebun.', 'DEMO_MELON', '6281330112233', 'Aktif'],
      ['UMK-002', 'Keripik Singkong & Pisang Renyah Ibu Kartini', 'KWT Melati Dusun Sumberjo', 'Camilan tradisional olahan hasil kebun warga tanpa bahan pengawet dengan varian rasa balado daun jeruk, bawang gurih, dan cokelat.', 'DEMO_KERIPIK', '6281330445566', 'Aktif'],
      ['UMK-003', 'Batik Tulis & Tenun Motif Lokal Sumberjo', 'Sanggar Kreatif Sekar Sumberjo', 'Kerajinan kain batik tulis dan selendang motif khas pesisir dan agraris Lamongan hasil karya perajin muda Desa Sumberjo.', 'DEMO_BATIK', '6281330778899', 'Aktif'],
      ['UMK-004', 'Madu Murni Randu & Kaliandra Hutan Desa', 'Kelompok Ternak Lebah Lestari', 'Madu asli 100% murni hasil budidaya lebah warga Sumberjo, kaya enzim alami untuk menjaga daya tahan tubuh keluarga.', 'DEMO_MADU', '6281330990011', 'Aktif'],
      ['UMK-005', 'Olahan Bandeng Cabut Duri & Otak-Otak', 'UMKM Berkah Bahari Sumberjo', 'Produk olahan ikan bandeng segar tanpa duri siap goreng dan kukus, dikemas vakum tahan lama untuk oleh-oleh khas.', 'DEMO_BANDENG', '6281330223344', 'Aktif']
    ]);
  }

  // 5. Sheet Admin (Username | Password | Token_Sesi)
  let shAdmin = ss.getSheetByName(S.ADMIN);
  if (!shAdmin) {
    shAdmin = ss.insertSheet(S.ADMIN);
    shAdmin.getRange(1, 1, 1, 3).setValues([['Username', 'Password', 'Token_Sesi']]).setFontWeight('bold');
    // Default kredensial: admin / sumberjo2026 (disimpan dalam SHA-256 hash)
    shAdmin.getRange(2, 1, 1, 3).setValues([
      ['admin', hashPassword_('sumberjo2026'), '']
    ]);
  }

  return {
    success: true,
    spreadsheetId: ss.getId(),
    spreadsheetUrl: ss.getUrl(),
    message: 'Database 5 Sheet KDMP Sumberjo berhasil diinisialisasi.'
  };
}

function ensureDatabaseInitialized_() {
  const ss = getSpreadsheet_();
  if (!ss.getSheetByName(CONFIG.SHEETS.SETTINGS)) {
    setupDatabase();
  }
}

/**
 * Mengonversi ID_Foto_Drive menjadi URL gambar publik yang dapat dirender langsung di <img>
 */
function buildDriveImageUrl_(idOrUrl) {
  const raw = String(idOrUrl || '').trim();
  if (!raw) return '';
  if (raw.indexOf('data:') === 0 || raw.indexOf('http://') === 0 || raw.indexOf('https://') === 0 || raw.indexOf('DEMO_') === 0) {
    return raw;
  }
  return 'https://lh3.googleusercontent.com/d/' + raw;
}

/**
 * API PUBLIK & ADMIN: Mengambil seluruh data dari 5 Sheet sekaligus (1x Request Cepat)
 */
function getInitialAppData(sessionToken) {
  try {
    ensureDatabaseInitialized_();
    const ss = getSpreadsheet_();
    const S = CONFIG.SHEETS;
    const isAdmin = verifyAdminToken_(sessionToken);

    // 1. Baca Settings
    const settingsRows = ss.getSheetByName(S.SETTINGS).getDataRange().getValues();
    const settings = {};
    for (let i = 1; i < settingsRows.length; i++) {
      const key = String(settingsRows[i][0] || '').trim();
      const val = String(settingsRows[i][1] || '').trim();
      if (key) settings[key] = val;
    }
    settings.Foto_Sambutan_Url = buildDriveImageUrl_(settings.ID_Foto_Sambutan || 'DEMO_TOKOH');
    settings.Logo_Web_Url = buildDriveImageUrl_(settings.ID_Logo_Web || '');

    // 2. Baca Links
    const linkRows = ss.getSheetByName(S.LINKS).getDataRange().getValues();
    const links = [];
    for (let i = 1; i < linkRows.length; i++) {
      const r = linkRows[i];
      if (!r[0]) continue;
      const status = String(r[4] || 'Aktif').trim();
      if (!isAdmin && status.toLowerCase() !== 'aktif') continue;
      links.push({
        id: String(r[0]),
        title: String(r[1] || ''),
        url: String(r[2] || ''),
        icon: String(r[3] || 'link'),
        status: status
      });
    }

    // 3. Baca Produk_KDMP
    const produkRows = ss.getSheetByName(S.PRODUK).getDataRange().getValues();
    const produk = [];
    for (let i = 1; i < produkRows.length; i++) {
      const r = produkRows[i];
      if (!r[0]) continue;
      const status = String(r[6] || 'Aktif').trim();
      if (!isAdmin && status.toLowerCase() !== 'aktif') continue;
      const driveId = String(r[4] || '');
      produk.push({
        id: String(r[0]),
        nama: String(r[1] || ''),
        harga: Number(r[2] || 0),
        deskripsi: String(r[3] || ''),
        idFotoDrive: driveId,
        fotoUrl: buildDriveImageUrl_(driveId),
        noWa: String(r[5] || ''),
        status: status
      });
    }

    // 4. Baca Potensi_UMKM
    const umkmRows = ss.getSheetByName(S.UMKM).getDataRange().getValues();
    const umkm = [];
    for (let i = 1; i < umkmRows.length; i++) {
      const r = umkmRows[i];
      if (!r[0]) continue;
      const status = String(r[6] || 'Aktif').trim();
      if (!isAdmin && status.toLowerCase() !== 'aktif') continue;
      const driveId = String(r[4] || '');
      umkm.push({
        id: String(r[0]),
        nama: String(r[1] || ''),
        pengelola: String(r[2] || ''),
        deskripsi: String(r[3] || ''),
        idFotoDrive: driveId,
        fotoUrl: buildDriveImageUrl_(driveId),
        noWa: String(r[5] || ''),
        status: status
      });
    }

    return {
      success: true,
      isAdmin: isAdmin,
      settings: settings,
      links: links,
      produk: produk,
      umkm: umkm
    };
  } catch (err) {
    return {
      success: false,
      message: 'Gagal memuat data dari Google Sheets: ' + err.message
    };
  }
}

/**
 * API KEAMANAN: Login Admin (Mencocokkan dengan Sheet Admin & membuat Token_Sesi)
 */
function adminLogin(username, password) {
  try {
    ensureDatabaseInitialized_();
    const ss = getSpreadsheet_();
    const shAdmin = ss.getSheetByName(CONFIG.SHEETS.ADMIN);
    const rows = shAdmin.getDataRange().getValues();

    const cleanUser = String(username || '').trim().toLowerCase();
    const cleanPass = String(password || '').trim();
    const hashedInput = hashPassword_(cleanPass);

    for (let i = 1; i < rows.length; i++) {
      const dbUser = String(rows[i][0] || '').trim().toLowerCase();
      const dbPass = String(rows[i][1] || '').trim();

      if (dbUser === cleanUser && (dbPass === hashedInput || dbPass === cleanPass)) {
        const token = 'SESI_' + Utilities.getUuid().replace(/-/g, '');
        shAdmin.getRange(i + 1, 3).setValue(token);
        // Jika password di Sheet masih plain text, otomatis upgrade ke SHA-256 hash
        if (dbPass === cleanPass) {
          shAdmin.getRange(i + 1, 2).setValue(hashedInput);
        }
        return {
          success: true,
          username: rows[i][0],
          token: token,
          message: 'Login berhasil. Selamat datang di Portal Admin KDMP Sumberjo.'
        };
      }
    }

    return {
      success: false,
      message: 'Username atau Password tidak sesuai dengan Sheet Admin.'
    };
  } catch (err) {
    return {
      success: false,
      message: 'Kesalahan sistem saat verifikasi login: ' + err.message
    };
  }
}

/**
 * Verifikasi apakah Token_Sesi valid di Sheet Admin
 */
function verifyAdminToken_(token) {
  if (!token || String(token).trim() === '') return false;
  const ss = getSpreadsheet_();
  const shAdmin = ss.getSheetByName(CONFIG.SHEETS.ADMIN);
  if (!shAdmin) return false;
  const rows = shAdmin.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][2] || '').trim() === String(token).trim()) {
      return true;
    }
  }
  return false;
}

/**
 * Logout Admin (Menghapus Token_Sesi dari Sheet Admin)
 */
function adminLogout(token) {
  const ss = getSpreadsheet_();
  const shAdmin = ss.getSheetByName(CONFIG.SHEETS.ADMIN);
  const rows = shAdmin.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][2] || '').trim() === String(token).trim()) {
      shAdmin.getRange(i + 1, 3).setValue('');
    }
  }
  return { success: true };
}

/**
 * FITUR UPLOAD FOTO OTOMATIS:
 * Mengubah string Base64 dari browser menjadi file gambar di Google Drive,
 * mengatur izin akses publik, dan mengembalikan ID File Drive.
 */
function uploadPhotoBase64ToDrive_(base64DataUrl, fileNamePrefix) {
  if (!base64DataUrl || String(base64DataUrl).indexOf('data:image/') !== 0) {
    return '';
  }

  const parts = String(base64DataUrl).split(',');
  const meta = parts[0];
  const base64String = parts[1];
  const mimeMatch = meta.match(/data:(.*?);base64/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const ext = mimeType.split('/')[1] || 'jpg';

  const decodedBytes = Utilities.base64Decode(base64String);
  const safeName = (fileNamePrefix || 'KDMP_Foto').replace(/[^a-zA-Z0-9_-]/g, '_') + '_' + new Date().getTime() + '.' + ext;
  const blob = Utilities.newBlob(decodedBytes, mimeType, safeName);

  const folder = getOrCreateStorageFolder_();
  const file = folder.createFile(blob);

  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {
    Logger.log('Info sharing file: ' + e.message);
  }

  return file.getId();
}

/**
 * API ADMIN: Simpan / Perbarui Pengaturan Global (Sheet Settings)
 */
function saveGlobalSettings(token, newSettingsObj) {
  if (!verifyAdminToken_(token)) {
    return { success: false, message: 'Sesi Admin tidak valid. Silakan login kembali.' };
  }

  const payload = Object.assign({}, newSettingsObj || {});

  // Proses upload Foto Tokoh Sambutan (Base64 -> Google Drive) jika ada foto baru
  if (payload.base64FotoSambutan && String(payload.base64FotoSambutan).indexOf('data:image/') === 0) {
    const uploadedSambutanId = uploadPhotoBase64ToDrive_(payload.base64FotoSambutan, 'Sambutan_Tokoh_KDMP');
    if (uploadedSambutanId) {
      payload.ID_Foto_Sambutan = uploadedSambutanId;
    }
  }
  delete payload.base64FotoSambutan;

  // Proses upload Logo Web (Base64 -> Google Drive) jika ada logo baru
  if (payload.base64LogoWeb && String(payload.base64LogoWeb).indexOf('data:image/') === 0) {
    const uploadedLogoId = uploadPhotoBase64ToDrive_(payload.base64LogoWeb, 'Logo_KDMP_Sumberjo');
    if (uploadedLogoId) {
      payload.ID_Logo_Web = uploadedLogoId;
    }
  }
  delete payload.base64LogoWeb;

  const ss = getSpreadsheet_();
  const sh = ss.getSheetByName(CONFIG.SHEETS.SETTINGS);
  const rows = sh.getDataRange().getValues();
  const existingMap = {};

  for (let i = 1; i < rows.length; i++) {
    existingMap[String(rows[i][0]).trim()] = i + 1;
  }

  Object.keys(payload).forEach(function(param) {
    const val = String(payload[param] !== undefined ? payload[param] : '');
    if (existingMap[param]) {
      sh.getRange(existingMap[param], 2).setValue(val);
    } else {
      sh.appendRow([param, val]);
    }
  });

  return getInitialAppData(token);
}

/**
 * API ADMIN: Ubah Password Admin di Sheet Admin
 */
function updateAdminAccount(token, newUsername, newPassword) {
  if (!verifyAdminToken_(token)) {
    return { success: false, message: 'Sesi Admin tidak valid.' };
  }

  const ss = getSpreadsheet_();
  const sh = ss.getSheetByName(CONFIG.SHEETS.ADMIN);
  const rows = sh.getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][2] || '').trim() === String(token).trim()) {
      if (newUsername && String(newUsername).trim() !== '') {
        sh.getRange(i + 1, 1).setValue(String(newUsername).trim());
      }
      if (newPassword && String(newPassword).trim() !== '') {
        sh.getRange(i + 1, 2).setValue(hashPassword_(newPassword));
      }
      return { success: true, message: 'Kredensial Admin berhasil diperbarui dengan enkripsi hash.' };
    }
  }
  return { success: false, message: 'Akun admin tidak ditemukan.' };
}

/**
 * API ADMIN CRUD (Create, Update, Toggle Status, Delete) untuk Links, Produk_KDMP, dan Potensi_UMKM
 */
function saveEntityRecord(token, entityType, payload) {
  if (!verifyAdminToken_(token)) {
    return { success: false, message: 'Akses ditolak. Sesi Admin tidak valid.' };
  }

  const ss = getSpreadsheet_();
  const S = CONFIG.SHEETS;
  let sheetName = '';
  let idPrefix = '';

  if (entityType === 'links') {
    sheetName = S.LINKS;
    idPrefix = 'LNK-';
  } else if (entityType === 'produk') {
    sheetName = S.PRODUK;
    idPrefix = 'PRD-';
  } else if (entityType === 'umkm') {
    sheetName = S.UMKM;
    idPrefix = 'UMK-';
  } else {
    return { success: false, message: 'Tipe entitas tidak dikenali.' };
  }

  const sh = ss.getSheetByName(sheetName);
  const rows = sh.getDataRange().getValues();
  const recordId = (payload.id && String(payload.id).trim() !== '')
    ? String(payload.id).trim()
    : idPrefix + String(new Date().getTime()).slice(-5);

  // Proses upload foto otomatis jika ada Base64 baru
  let drivePhotoId = String(payload.idFotoDrive || '').trim();
  if (payload.base64Photo && String(payload.base64Photo).indexOf('data:image/') === 0) {
    drivePhotoId = uploadPhotoBase64ToDrive_(payload.base64Photo, recordId + '_' + (payload.nama || 'Foto'));
  }

  let rowValues = [];
  if (entityType === 'links') {
    rowValues = [
      recordId,
      String(payload.title || '').trim(),
      String(payload.url || '').trim(),
      String(payload.icon || 'link').trim(),
      String(payload.status || 'Aktif').trim()
    ];
  } else if (entityType === 'produk') {
    rowValues = [
      recordId,
      String(payload.nama || '').trim(),
      Number(payload.harga || 0),
      String(payload.deskripsi || '').trim(),
      drivePhotoId,
      String(payload.noWa || '').replace(/[^0-9]/g, ''),
      String(payload.status || 'Aktif').trim()
    ];
  } else if (entityType === 'umkm') {
    rowValues = [
      recordId,
      String(payload.nama || '').trim(),
      String(payload.pengelola || '').trim(),
      String(payload.deskripsi || '').trim(),
      drivePhotoId,
      String(payload.noWa || '').replace(/[^0-9]/g, ''),
      String(payload.status || 'Aktif').trim()
    ];
  }

  // Cari apakah baris dengan ID tersebut sudah ada (Edit) atau belum (Tambah Baru)
  let targetRowIndex = -1;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === recordId) {
      targetRowIndex = i + 1;
      break;
    }
  }

  if (targetRowIndex > 0) {
    sh.getRange(targetRowIndex, 1, 1, rowValues.length).setValues([rowValues]);
  } else {
    sh.appendRow(rowValues);
  }

  return getInitialAppData(token);
}

/**
 * API ADMIN: Toggle Status Cepat (Aktif <-> Draft/Sembunyikan)
 */
function toggleEntityStatus(token, entityType, recordId) {
  if (!verifyAdminToken_(token)) {
    return { success: false, message: 'Akses ditolak. Sesi Admin tidak valid.' };
  }

  const ss = getSpreadsheet_();
  const S = CONFIG.SHEETS;
  const sheetMap = {
    links: { name: S.LINKS, statusCol: 5 },
    produk: { name: S.PRODUK, statusCol: 7 },
    umkm: { name: S.UMKM, statusCol: 7 }
  };

  const cfg = sheetMap[entityType];
  if (!cfg) return { success: false, message: 'Entitas tidak valid.' };

  const sh = ss.getSheetByName(cfg.name);
  const rows = sh.getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === String(recordId).trim()) {
      const currentStatus = String(rows[i][cfg.statusCol - 1] || 'Aktif').trim();
      const nextStatus = (currentStatus.toLowerCase() === 'aktif') ? 'Draft' : 'Aktif';
      sh.getRange(i + 1, cfg.statusCol).setValue(nextStatus);
      break;
    }
  }

  return getInitialAppData(token);
}

/**
 * API ADMIN: Hapus Baris Data Permanen dari Google Sheets
 */
function deleteEntityRecord(token, entityType, recordId) {
  if (!verifyAdminToken_(token)) {
    return { success: false, message: 'Akses ditolak. Sesi Admin tidak valid.' };
  }

  const ss = getSpreadsheet_();
  const S = CONFIG.SHEETS;
  const sheetMap = {
    links: S.LINKS,
    produk: S.PRODUK,
    umkm: S.UMKM
  };

  const sheetName = sheetMap[entityType];
  if (!sheetName) return { success: false, message: 'Entitas tidak valid.' };

  const sh = ss.getSheetByName(sheetName);
  const rows = sh.getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === String(recordId).trim()) {
      sh.deleteRow(i + 1);
      break;
    }
  }

  return getInitialAppData(token);
}
