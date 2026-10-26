'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..');
if (require('node:fs').existsSync(path.join(ROOT, '.env'))) {
  process.loadEnvFile(path.join(ROOT, '.env'));
}

const dataDir = path.resolve(ROOT, process.env.DATA_DIR || 'data');
const db = new DatabaseSync(path.join(dataDir, 'assessment.sqlite'));
const username = 'contoh_rangkaian01';
const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);

if (existing) {
  const attempt = db.prepare(`SELECT id, status FROM attempts
    WHERE student_id = ? AND assessment_id = ?`).get(existing.id, 'scientific-creativity-electric-circuits');
  if (attempt) {
    console.log(`Data demonstrasi sudah tersedia: ${username}, status ${attempt.status}.`);
    db.close();
    process.exit(0);
  }
}

const now = new Date();
const submittedAt = now.toISOString();
const startedAt = new Date(now.getTime() - 30 * 60_000).toISOString();
const deadlineAt = new Date(now.getTime() + 30 * 60_000).toISOString();
const createdAt = now.toISOString();
const attemptId = crypto.randomUUID();
const userId = existing?.id || crypto.randomUUID();
const generatedPassword = crypto.randomBytes(32).toString('base64url');
const salt = crypto.randomBytes(16);
const passwordHash = `scrypt:${salt.toString('hex')}:${crypto.scryptSync(generatedPassword, salt, 64).toString('hex')}`;

const answers = [
  {
    questionId: 'q1',
    answerText: 'Empat konfigurasi berbeda: tiga lampu seri, tiga lampu paralel, satu lampu seri dengan dua lampu paralel, dan satu lampu paralel dengan cabang dua lampu seri. Ketiganya dinyalakan pada rangkaian tertutup. Kecerahan bergantung pada tegangan dan arus di tiap cabang.',
    structuredData: {
      configurations: '1) L1—L2—L3 seri. 2) L1 || L2 || L3 paralel. 3) L1 seri dengan cabang L2||L3. 4) L1 paralel dengan cabang L2—L3. Semua menggunakan baterai 9 V.',
      measurements: 'Contoh demonstrasi ini belum memuat angka arus aktual. Isi hasil ukur amperemeter PhET sebelum menggunakan jawaban sebagai laporan eksperimen.',
    },
  },
  {
    questionId: 'q2',
    answerText: 'Pada susunan seri, tegangan sumber terbagi di antara kedua lampu; paralel memberikan tegangan sumber pada setiap cabang. Hambatan ekuivalen paralel lebih kecil daripada seri sehingga arus total sumber lebih besar. Data numerik perlu diukur langsung di PhET.',
    structuredData: {
      approaches: 'Tegangan: seri Vtotal=V1+V2; paralel V1=V2=Vbaterai. Daya P=V²/R menjelaskan lampu paralel lebih terang. Hambatan: Rseri=R1+R2, sedangkan 1/Rpar=1/R1+1/R2. Hukum Ohm Itotal=Vbaterai/Req.',
      measurements: 'Catat voltase tiap lampu, arus total, dan arus cabang pada kedua susunan. Angka pengukuran aktual belum disertakan pada contoh ini.',
    },
  },
  {
    questionId: 'q3',
    answerText: 'Rancang pemilih tiga posisi untuk satu lampu utama: jalur langsung untuk terang, satu resistor seri untuk sedang, dan dua resistor seri untuk redup. Gunakan sakelar pemilih sehingga satu jalur saja aktif dan hindari korsleting. Rancangan perlu diuji langsung di PhET.',
    structuredData: {
      design: 'Baterai (+)—pemilih S1/S2/S3—jalur pilihan (langsung/R1/R1+R2)—lampu utama—baterai (−).',
      switchRules: 'Terang: S1 tertutup. Sedang: S2 tertutup, satu resistor seri. Redup: S3 tertutup, dua resistor seri. Dua sakelar pilihan lain harus terbuka setiap saat.',
      uniqueness: 'Pemilih memberikan tiga tingkat kecerahan, bukan hanya keadaan nyala/mati. Tambahkan screenshot dan data setelah pengujian langsung di PhET.',
    },
  },
  {
    questionId: 'q4',
    answerText: 'Contoh tabel dan grafik berikut hanya ilustrasi teoritis (asumsi sumber 9 V dan tiap lampu mempunyai R tetap 10 Ω), bukan hasil pengukuran PhET. Ganti dengan data simulasi untuk laporan eksperimen sebenarnya.',
    structuredData: {
      dataTable: 'ILUSTRASI, BUKAN PENGUKURAN: Jumlah lampu | Req Ω | I A | V/lampu V. 1 | 10 | 0,90 | 9,00. 2 | 20 | 0,45 | 4,50. 3 | 30 | 0,30 | 3,00. 4 | 40 | 0,225 | 2,25. 5 | 50 | 0,18 | 1,80.',
      graph: 'Titik grafik ilustrasi: (1;0,90), (2;0,45), (3;0,30), (4;0,225), (5;0,18). Arus menurun saat jumlah lampu bertambah.',
      analysis: 'Model hambatan tetap: Rtotal=nR, maka I=V/Rtotal menurun saat n bertambah. Lampu identik membagi tegangan: Vlampu=V/n. Bohlam PhET dapat tidak ohmik sehingga angka aktual mungkin berbeda.',
      conclusion: 'Dalam model ideal, penambahan lampu seri memperbesar hambatan ekuivalen dan menurunkan arus total serta tegangan tiap lampu. Kesimpulan akhir perlu berdasarkan data yang benar-benar diukur.',
    },
  },
];

db.exec('BEGIN IMMEDIATE');
try {
  if (!existing) {
    db.prepare(`INSERT INTO users
      (id, full_name, username, password_hash, role, class_name, attendance_number, must_change_password, created_at)
      VALUES (?, ?, ?, ?, 'student', ?, ?, 1, ?)`)
      .run(userId, 'Contoh Siswa — Data Demonstrasi', username, passwordHash, 'XI IPA 1', '01', createdAt);
  }

  db.prepare(`INSERT INTO attempts
    (id, student_id, assessment_id, started_at, deadline_at, submitted_at, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'submitted', ?)`)
    .run(attemptId, userId, 'scientific-creativity-electric-circuits', startedAt, deadlineAt, submittedAt, startedAt);

  const insertAnswer = db.prepare(`INSERT INTO answers
    (id, attempt_id, question_id, answer_text, structured_data, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  for (const answer of answers) {
    insertAnswer.run(
      crypto.randomUUID(),
      attemptId,
      answer.questionId,
      answer.answerText,
      JSON.stringify(answer.structuredData),
      startedAt,
      submittedAt,
    );
  }
  db.exec('COMMIT');
  console.log(`Data demonstrasi berhasil dibuat: ${username}, 4 jawaban, status sudah dikumpulkan. Username ini hanya untuk contoh.`);
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
} finally {
  db.close();
}
