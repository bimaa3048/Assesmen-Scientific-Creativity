# Assesmen Scientific Creativity

Aplikasi web Assesmen Scientific Creativity untuk empat indikator kreativitas ilmiah dengan soal Fisika rangkaian listrik seri, paralel, dan campuran. Aplikasi siap deploy ke Vercel menggunakan Next.js App Router, PostgreSQL terkelola, dan route handler Node.js. `server.js` dan SQLite tetap tersedia khusus untuk menjalankan versi lokal lama.

## Fitur

- Registrasi siswa dan login berbasis session cookie `HttpOnly`/`SameSite=Strict`.
- Password di-hash memakai `scrypt`; guru dapat mengubah password dan mereset password siswa.
- Guru dapat mengubah nama lengkap dari menu **Profil**; perubahan tersimpan di PostgreSQL dan langsung tercermin di dashboard guru.
- Guru dapat menghapus akun siswa dari daftar siswa; aksi meminta konfirmasi dan menghapus percobaan, jawaban, penilaian, sesi, serta file lampiran siswa tersebut. Jika Google Sheets dikonfigurasi, baris percobaan terkait juga dihapus melalui Apps Script.
- Guru dapat mereset hasil pengerjaan dari daftar siswa tanpa menghapus akun; jawaban, nilai, dan lampiran percobaan dihapus agar siswa dapat memulai asesmen baru. Baris percobaan di Google Sheets juga dihapus bila sinkronisasi dikonfigurasi.
- Otorisasi peran dan pemeriksaan kepemilikan percobaan dijalankan pada backend.
- Empat soal dan rubrik sesuai instrumen: Fluency, Flexibility, Originality, Elaboration.
- Autosave jawaban dengan debounce 700 ms, status penyimpanan berdasarkan respons server, retry ketika koneksi pulih, upsert, dan pemulihan dari PostgreSQL setelah login/perangkat lain.
- Siswa dapat menambahkan beberapa konfigurasi jawaban pada setiap soal; setiap konfigurasi memuat isian jawaban soal yang sama, tersimpan otomatis, dan tampil terpisah pada halaman penilaian guru.
- Pada soal 4 Elaboration, grafik jumlah lampu seri terhadap arus total diperbarui otomatis dari tabel. Isi satu hasil ukur per baris dengan kolom dipisahkan `|`, tab, atau titik koma; desimal koma didukung. Grafik hanya memakai data yang dimasukkan siswa dan juga tampil pada peninjauan guru untuk setiap konfigurasi.
- Timer 60 menit disimpan pada server; refresh tidak mengatur ulang waktu. Jawaban tersimpan dikunci otomatis ketika waktu berakhir.
- Pengumpulan memaksa semua jawaban lokal yang berubah berhasil tersimpan dahulu.
- Beberapa screenshot konfigurasi PhET dapat ditambahkan pada setiap soal (JPG/PNG/WebP, maksimal 3 MB per gambar); lampiran tersimpan privat sebagai BYTEA di PostgreSQL dan dapat dibuka oleh pemilik atau guru.
- Dashboard siswa dan guru, skor draf/publikasi, umpan balik, hasil yang disembunyikan sampai penilaian diterbitkan, pencarian/filter siswa. Dashboard guru menampilkan nilai akhir sebagai persentase kreativitas ilmiah, kategori, total skor, serta persentase setiap indikator setelah penilaian dipublikasikan; halaman utamanya juga merangkum rata-rata persentase kreativitas dan distribusi kategori dalam diagram lingkaran beserta penjelasannya.
- Tampilan responsif untuk laptop, tablet, dan handphone; navigasi bawah pada layar kecil tetap menyediakan tombol keluar, sementara formulir, simulasi, diagram, dan tabel menyesuaikan atau dapat digulir sesuai lebar layar.
- Integrasi spreadsheet opsional melalui Google Apps Script; PostgreSQL tetap sumber data utama pada versi Vercel.
- Contoh jawaban demonstrasi siswa tersedia untuk dicoba guru menilai.

## Menjalankan versi Next.js secara lokal

1. Instal Node.js 20.9 atau lebih baru dan siapkan database PostgreSQL (misalnya Neon).
2. Salin `.env.example` menjadi `.env.local`, lalu isi `DATABASE_URL` dan `TEACHER_PASSWORD`. Jangan commit file environment.
3. Instal paket dan jalankan Next.js:

   ```powershell
   npm install
   npm run dev
   ```

4. Buka `http://localhost:3000`. Skema database dan akun guru awal dibuat otomatis saat API pertama kali diakses.
5. Username guru awal memakai `TEACHER_USERNAME` (default `Bimaaditya`). Ganti kata sandi awal melalui menu **Profil**. Password hanya disimpan sebagai hash.
6. Daftarkan akun siswa dari layar masuk. Panjang password siswa minimal 10 karakter.

Untuk menjalankan versi lama berbasis SQLite secara lokal gunakan `npm run start:local`. Versi SQLite tersebut bukan backend yang dipakai oleh Vercel.

## Deploy ke Vercel

1. Buat database PostgreSQL terkelola, misalnya proyek Neon. Salin **pooled connection string** (dengan TLS/SSL) dari penyedia.
2. Impor folder/repository proyek ini ke Vercel. Framework akan terdeteksi sebagai Next.js; konfigurasi build juga tersedia pada `vercel.json`.
3. Pada **Project → Settings → Environment Variables**, tambahkan:
   - `DATABASE_URL`: connection string PostgreSQL untuk environment deployment.
   - `TEACHER_PASSWORD`: kata sandi awal yang kuat dan unik (minimal 10 karakter).
   - `TEACHER_USERNAME`: username guru awal, opsional (default `Bimaaditya`).
   - `TEACHER_NAME`: nama guru awal, opsional.
   - `GOOGLE_APPS_SCRIPT_URL` dan `GOOGLE_APPS_SCRIPT_TOKEN`: opsional untuk sinkronisasi spreadsheet.
4. Deploy atau redeploy project. Saat route API pertama dipanggil, aplikasi membuat tabel PostgreSQL yang belum ada dan seed akun guru awal. Akun seed tidak menimpa akun yang telah ada.
5. Masuk ke URL deployment, uji daftar siswa, autosave, pengumpulan, penilaian guru, dan lampiran sebelum membagikan tautan kepada kelas.

Jangan pernah memasukkan rahasia ke `vercel.json`, kode, atau Git. `TEACHER_PASSWORD` hanya digunakan untuk membuat akun guru pertama kali; perubahan environment tidak mengubah kredensial akun yang sudah tersimpan. Data SQLite lokal tidak otomatis dipindahkan ke PostgreSQL.

Lampiran disimpan di kolom PostgreSQL privat, bukan URL Blob publik, dan dibatasi 3 MB per gambar agar unggahan JSON tetap di bawah batas ukuran body Vercel Functions. Unduhan melewati API yang memeriksa sesi dan kepemilikan/peran.

### Opsional: portal Apps Script

Apps Script tidak menjalankan Next.js atau backend PostgreSQL aplikasi. Jika ingin membagikan pintu masuk Apps Script, fungsi `doGet` pada `google-apps-script.gs` menampilkan halaman responsif dengan tombol menuju deployment Vercel. Situs, API, login, dan database tetap dijalankan di Vercel; tampilan utama tetap bisa digunakan dari handphone dan laptop.

1. Deploy aplikasi utama ke Vercel dan salin URL HTTPS-nya.
2. Pada proyek Google Apps Script yang digunakan untuk sinkronisasi Sheets, buka **Project Settings → Script Properties**, lalu tambahkan `VERCEL_APP_URL` dengan URL deployment Vercel.
3. Salin isi `google-apps-script.gs` ke editor Apps Script, simpan, lalu pilih **Deploy → Manage deployments → Edit** dan deploy versi baru sebagai Web App. Atur akses sesuai kebutuhan.
4. Gunakan URL Web App Apps Script untuk membuka halaman portal. `doPost` tetap menangani sinkronisasi Google Sheets; di Vercel, `GOOGLE_APPS_SCRIPT_URL` tetap harus menunjuk URL `/exec` yang sama dan token sync tetap diatur seperti biasa.

Portal ini bukan hosting mandiri: deployment Vercel dan `DATABASE_URL` PostgreSQL tetap wajib. Jika URL Vercel berubah, perbarui `VERCEL_APP_URL` lalu deploy ulang versi Apps Script.

## Contoh jawaban untuk penilaian guru

Untuk membuat satu percobaan demonstrasi yang sudah dikumpulkan, jalankan:

```powershell
node .\scripts\create-demo-submission.js
```

Akun siswa demonstrasi bernama **Contoh Siswa — Data Demonstrasi** (`contoh_rangkaian01`), kelas XI IPA 1. Percobaannya muncul pada dashboard guru sebagai menunggu penilaian dan dapat dibuka melalui **Buka & nilai**. Skrip aman dijalankan ulang dan tidak menggandakan percobaan yang sudah ada. Jawaban menyatakan dengan jelas bahwa tabel dan grafik soal 4 hanya ilustrasi teoritis, bukan hasil ukur PhET.

Akun awal dibuat sekali saat server pertama dijalankan. Untuk mengubah kredensial *sebelum* akun awal dibuat, atur `TEACHER_USERNAME`, `TEACHER_NAME`, dan `TEACHER_PASSWORD` pada environment. Nilai environment tidak menimpa akun yang sudah ada.

## Data dan konfigurasi

Untuk versi Vercel, database PostgreSQL diatur melalui `DATABASE_URL`; skema berada di `db/schema.sql`. Jawaban terstruktur disimpan sebagai JSONB dan lampiran sebagai BYTEA. Backup database PostgreSQL secara berkala. Folder `data/assessment.sqlite` dan `data/uploads/` hanya digunakan oleh server SQLite lokal lama.

Konfigurasi server melalui environment:

| Variabel | Default | Keterangan |
| --- | --- | --- |
| `DATABASE_URL` | — | Wajib: connection string PostgreSQL; gunakan connection string pooled dari penyedia database |
| `PG_POOL_MAX` | `5` | Ukuran maksimum kumpulan koneksi PostgreSQL per instance |
| `NODE_ENV` | dikelola platform | Cookie sesi memakai atribut `Secure` ketika production |
| `APP_PUBLIC_URL` | kosong | URL publik aplikasi (mis. `https://asesmen.sekolah.id`) untuk tautan lampiran pada data spreadsheet |
| `TEACHER_USERNAME` | `Bimaaditya` | Username akun awal jika belum ada |
| `TEACHER_NAME` | `Guru Fisika` | Nama akun guru awal |
| `TEACHER_PASSWORD` | kosong pada production | Wajib di production untuk seed akun awal; simpan hanya sebagai secret environment |
| `GOOGLE_APPS_SCRIPT_URL` | kosong | URL Web App Apps Script |
| `GOOGLE_APPS_SCRIPT_TOKEN` | kosong | Token rahasia bersama backend dan Apps Script |

Jangan masukkan password, token, atau connection string ke repository. Gunakan HTTPS, secret manager/environment platform, dan backup terkelola untuk PostgreSQL.

## Integrasi Google Sheets

1. Buat Google Spreadsheet dan catat ID dari URL-nya.
2. Buka **Extensions → Apps Script**, lalu salin isi `google-apps-script.gs`.
3. Pada **Project Settings → Script Properties**, tambahkan:
   - `SPREADSHEET_ID`: ID spreadsheet.
   - `SYNC_TOKEN`: secret acak panjang yang sama dengan `GOOGLE_APPS_SCRIPT_TOKEN` di server.
4. **Deploy → New deployment → Web app**. Jalankan sebagai akun pemilik spreadsheet, lalu atur akses Web App sesuai kebijakan sekolah. Endpoint perlu dapat dipanggil server aplikasi.
5. Atur `GOOGLE_APPS_SCRIPT_URL` dengan URL deployment dan `GOOGLE_APPS_SCRIPT_TOKEN` dengan token yang sama pada environment server, lalu restart.
6. Saat siswa mengumpulkan dan guru mempublikasikan nilai, backend mengirim data ke Apps Script. Baris diperbarui berdasarkan ID percobaan sehingga tidak membuat duplikat. Kegagalan dicatat pada `sync_logs`; guru dapat memilih **Sinkronkan ulang spreadsheet** dari halaman jawaban.

Data yang dikirim berisi identitas siswa, ID percobaan, status/waktu, jawaban, skor indikator, skor total, nilai akhir, kategori, umpan balik umum, dan waktu penilaian. Spreadsheet merupakan salinan; jika sinkronisasi gagal, data utama tidak hilang dari PostgreSQL.

Spreadsheet belum terhubung ke akun tertentu sampai pemilik membuat Spreadsheet, menetapkan `SPREADSHEET_ID` dan `SYNC_TOKEN` di Script Properties, lalu memasukkan URL deployment dan token yang sama pada environment server. Jangan mengirim token melalui chat atau menyimpan nilainya di repository. Setelah deployment, uji dengan satu percobaan siswa dan pastikan baris **Hasil Asesmen** muncul sebelum digunakan untuk seluruh kelas.

## PhET

Setiap soal dan halaman mulai asesmen menampilkan simulasi resmi [Circuit Construction Kit: DC](https://phet.colorado.edu/en/simulations/circuit-construction-kit-dc) langsung di halaman melalui iframe. Pada layar awal PhET, pilih **Intro Screen** atau **Lab Screen** untuk mulai merakit. Tombol **Buka layar penuh** tersedia bila siswa memerlukan ruang simulasi lebih luas. Rangkaian tidak dibaca otomatis oleh website; siswa dapat menyimpan satu atau beberapa screenshot konfigurasi pada soal terkait dan memasukkan hasil ukur sendiri.

## Pengujian

Jalankan tes perhitungan nilai:

```powershell
node --test
```

Tes backend mencakup batas kategori, penghitungan total/nilai, dan validasi rentang skor. Uji alur aplikasi dengan dua sesi browser: daftar/login siswa, mulai asesmen, ubah jawaban dan tunggu status server **Tersimpan**, refresh/login pada browser lain, uji unggahan, pengumpulan, login guru, tinjau jawaban, simpan draf, publikasikan penilaian, dan pastikan hasil siswa baru terlihat setelah publikasi. Putuskan jaringan untuk memastikan status autosave gagal/offline dan pengumpulan ditolak sampai simpan server berhasil.

## Catatan keamanan dan deployment

API berjalan pada runtime Node.js Vercel Functions. Cookie sesi bersifat `HttpOnly`, `SameSite=Strict`, dan `Secure` pada production; semua route memeriksa role dan kepemilikan data. Gunakan kredensial database khusus aplikasi, batasi akses database sesuai kebutuhan, aktifkan backup, dan uji deployment dengan akun uji sebelum memakai data siswa sungguhan.
