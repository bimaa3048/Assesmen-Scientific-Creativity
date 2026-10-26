'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { DatabaseSync } = require('node:sqlite');
const { scoreSummary, INDICATORS } = require('./domain');

const scrypt = promisify(crypto.scrypt);
const ROOT = __dirname;
if (fs.existsSync(path.join(ROOT, '.env'))) process.loadEnvFile(path.join(ROOT, '.env'));
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const PORT = Number(process.env.PORT || 3000);
const SESSION_DAYS = 7;
const MAX_BODY_BYTES = 7 * 1024 * 1024;
const ASSESSMENT_ID = 'scientific-creativity-electric-circuits';

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'assessment.sqlite'));
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('teacher', 'student')),
    class_name TEXT,
    attendance_number TEXT,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS assessments (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    subject TEXT NOT NULL,
    material TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
  );
  CREATE TABLE IF NOT EXISTS attempts (
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL REFERENCES users(id),
    assessment_id TEXT NOT NULL REFERENCES assessments(id),
    started_at TEXT NOT NULL,
    deadline_at TEXT NOT NULL,
    submitted_at TEXT,
    status TEXT NOT NULL CHECK (status IN ('in_progress', 'submitted')),
    created_at TEXT NOT NULL,
    UNIQUE(student_id, assessment_id)
  );
  CREATE TABLE IF NOT EXISTS answers (
    id TEXT PRIMARY KEY,
    attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
    question_id TEXT NOT NULL,
    answer_text TEXT NOT NULL DEFAULT '',
    structured_data TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(attempt_id, question_id)
  );
  CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
    question_id TEXT NOT NULL,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS grades (
    id TEXT PRIMARY KEY,
    attempt_id TEXT NOT NULL UNIQUE REFERENCES attempts(id) ON DELETE CASCADE,
    fluency_score INTEGER,
    flexibility_score INTEGER,
    originality_score INTEGER,
    elaboration_score INTEGER,
    total_score INTEGER,
    final_score REAL,
    category TEXT,
    general_feedback TEXT NOT NULL DEFAULT '',
    graded_by TEXT REFERENCES users(id),
    graded_at TEXT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published'))
  );
  CREATE TABLE IF NOT EXISTS question_feedback (
    id TEXT PRIMARY KEY,
    grade_id TEXT NOT NULL REFERENCES grades(id) ON DELETE CASCADE,
    question_id TEXT NOT NULL,
    score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 4),
    feedback_text TEXT NOT NULL DEFAULT '',
    UNIQUE(grade_id, question_id)
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sync_logs (
    id TEXT PRIMARY KEY,
    attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
    sync_status TEXT NOT NULL,
    error_message TEXT,
    last_attempt_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_attempts_student ON attempts(student_id);
  CREATE INDEX IF NOT EXISTS idx_answers_attempt ON answers(attempt_id);
  CREATE INDEX IF NOT EXISTS idx_sync_logs_attempt ON sync_logs(attempt_id);
`);

const questions = [
  {
    id: 'q1',
    indicator: 'Fluency (Kelancaran)',
    title: 'Menemukan variasi rangkaian',
    prompt: 'Gunakan 1 baterai 9 V dan 3 lampu identik untuk menemukan berbagai konfigurasi rangkaian berbeda agar ketiga lampu menyala bersamaan. Untuk setiap konfigurasi, sertakan sketsa/diagram, klasifikasi (seri, paralel, atau campuran), arus total dari baterai, tingkat kecerahan tiap lampu, dan bukti screenshot jika tersedia.',
    fields: [
      { key: 'configurations', label: 'Konfigurasi rangkaian (sketsa, klasifikasi, arus total, dan kecerahan tiap lampu)', type: 'textarea' },
      { key: 'measurements', label: 'Data pengukuran tambahan', type: 'textarea' },
    ],
    rubric: [
      '4 — Empat konfigurasi berbeda berfungsi dan benar; sketsa, data arus, kecerahan, serta bukti lengkap.',
      '3 — Tiga konfigurasi berfungsi dengan data pendukung.',
      '2 — Satu–dua konfigurasi berfungsi, atau beberapa data/sketsa terlewat.',
      '1 — Rangkaian dicoba tetapi sebagian besar tidak berfungsi atau korsleting.',
      '0 — Tidak menjawab.',
    ],
  },
  {
    id: 'q2',
    indicator: 'Flexibility (Keluwesan)',
    title: 'Membandingkan seri dan paralel',
    prompt: 'Buat Rangkaian A: 2 lampu seri dengan baterai 9 V; dan Rangkaian B: 2 lampu paralel dengan baterai 9 V. Jelaskan mengapa lampu pada rangkaian paralel tampak lebih terang menggunakan sedikitnya dua pendekatan konsep yang berbeda dari hambatan total, distribusi tegangan, atau kuat arus. Untuk setiap pendekatan, tuliskan nama, data ukur PhET (voltmeter/amperemeter), penalaran fisika, dan persamaan matematis yang mendukung.',
    fields: [
      { key: 'approaches', label: 'Pendekatan konsep, penjelasan, dan persamaan', type: 'textarea' },
      { key: 'measurements', label: 'Data ukur rangkaian A dan B', type: 'textarea' },
    ],
    rubric: [
      '4 — Sedikitnya dua pendekatan yang benar-benar berbeda, tepat dan logis, didukung data ukur.',
      '3 — Dua pendekatan berbeda, tetapi salah satu penjelasan/data kurang lengkap atau kurang tepat.',
      '2 — Hanya satu pendekatan benar, atau dua penjelasan berasal dari kategori konsep yang sama.',
      '1 — Penjelasan tidak tepat secara prinsip kelistrikan dasar.',
      '0 — Tidak menjawab.',
    ],
  },
  {
    id: 'q3',
    indicator: 'Originality (Keaslian)',
    title: 'Merancang pencahayaan pintar',
    prompt: 'Rancang sistem pencahayaan lorong dengan satu baterai, satu lampu utama, beberapa sakelar, dan resistor/lampu tambahan sebagai hambatan. Buat minimal tiga tingkat kecerahan (terang, sedang, redup) yang dipilih dengan membuka/menutup sakelar. Sertakan sketsa/diagram, aturan kombinasi sakelar untuk tiap tingkat dan penjelasan fisikanya, bukti pengujian (screenshot tiap tingkat jika tersedia), serta hal yang membuat rancangan unik.',
    fields: [
      { key: 'design', label: 'Sketsa/diagram rancangan', type: 'textarea' },
      { key: 'switchRules', label: 'Aturan sakelar dan penjelasan tiga tingkat kecerahan', type: 'textarea' },
      { key: 'uniqueness', label: 'Keunikan dan kreativitas rancangan', type: 'textarea' },
    ],
    rubric: [
      '4 — Rancangan unik/inovatif, tiga tingkat terbukti berfungsi di PhET, logika dijelaskan sangat jelas.',
      '3 — Rancangan cukup unik dan berfungsi, tetapi penjelasan logika sakelar kurang jelas.',
      '2 — Rancangan terlalu standar/sederhana, tetapi konsep fisika benar.',
      '1 — Rancangan inovatif dicoba tetapi tidak berfungsi atau korsleting.',
      '0 — Tidak memberikan rancangan.',
    ],
  },
  {
    id: 'q4',
    indicator: 'Elaboration (Elaborasi)',
    title: 'Menyelidiki penambahan lampu seri',
    prompt: 'Investigasi pengaruh jumlah lampu seri dari 1 sampai 5 terhadap arus total dan tegangan pada salah satu lampu. Buat tabel hasil ukur untuk tiap jumlah lampu, grafik jumlah lampu (sumbu-X) terhadap arus total (sumbu-Y), analisis tren dengan mengaitkan hambatan ekuivalen, dan kesimpulan berdasarkan data. Jangan mengarang data pengukuran.',
    fields: [
      { key: 'dataTable', label: 'Tabel hasil ukur: jumlah lampu | arus total (A) | tegangan satu lampu (V)', type: 'textarea' },
      { key: 'graph', label: 'Catatan grafik (opsional; grafik dibuat otomatis dari tabel)', type: 'textarea' },
      { key: 'analysis', label: 'Analisis tren dan kaitan dengan hambatan ekuivalen', type: 'textarea' },
      { key: 'conclusion', label: 'Kesimpulan berdasarkan hasil', type: 'textarea' },
    ],
    rubric: [
      '4 — Tabel 1–5 lampu lengkap, grafik tepat, analisis dan kesimpulan mendalam mengaitkan data dengan hambatan seri.',
      '3 — Eksperimen lengkap dengan tabel dan grafik baik; analisis hambatan ekuivalen kurang mendalam.',
      '2 — Data tidak lengkap, tanpa grafik, atau analisis tidak menjelaskan konsep inti.',
      '1 — Hanya penjelasan singkat tanpa data dan grafik.',
      '0 — Tidak menjawab.',
    ],
  },
];

const assessment = {
  id: ASSESSMENT_ID,
  title: 'Pengembangan Instrumen Asesmen Scientific Creativity Berbasis Simulasi PhET pada Materi Rangkaian Listrik Dasar untuk Siswa SMA',
  subject: 'Fisika',
  material: 'Rangkaian listrik dasar: seri, paralel, dan campuran',
  audience: 'Siswa Sekolah Menengah Atas (SMA)',
  durationMinutes: 60,
  maximumScore: 16,
  simulationUrl: 'https://phet.colorado.edu/en/simulations/circuit-construction-kit-dc',
  simulationEmbedUrl: 'https://phet.colorado.edu/sims/html/circuit-construction-kit-dc/latest/circuit-construction-kit-dc_en.html',
  questions,
};

db.prepare(`INSERT OR IGNORE INTO assessments
  (id, title, subject, material, duration_minutes, status)
  VALUES (?, ?, ?, ?, ?, 'active')`)
  .run(assessment.id, assessment.title, assessment.subject, assessment.material, assessment.durationMinutes);

function nowIso() {
  return new Date().toISOString();
}

function uuid() {
  return crypto.randomUUID();
}

function tokenDigest(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt:${salt.toString('hex')}:${derived.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [algorithm, saltHex, hashHex] = String(stored).split(':');
  if (algorithm !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

async function seedTeacher() {
  const username = process.env.TEACHER_USERNAME || 'Bimaaditya';
  const password = process.env.TEACHER_PASSWORD || 'Bimmbou01';
  const current = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (!current) {
    db.prepare(`INSERT INTO users
      (id, full_name, username, password_hash, role, must_change_password, created_at)
      VALUES (?, ?, ?, ?, 'teacher', 1, ?)`)
      .run(uuid(), process.env.TEACHER_NAME || 'Guru Fisika', username, await hashPassword(password), nowIso());
    console.log(`Akun guru awal dibuat (${username}); ganti kata sandi saat masuk pertama.`);
  }
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => {
    const index = part.indexOf('=');
    if (index < 0) return ['', ''];
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(([key]) => key));
}

function sendJson(res, status, value, headers = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'same-origin',
    ...headers,
  });
  res.end(body);
}

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw fail(413, 'Ukuran permintaan terlalu besar.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    console.error(`JSON tidak valid pada ${req.method} ${req.url}: ${error.message}`);
    throw fail(400, 'Format JSON tidak valid.');
  }
}

function requireString(value, label, maximum = 10000) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum) {
    throw fail(400, `${label} wajib diisi dan maksimal ${maximum} karakter.`);
  }
  return value.trim();
}

function cleanUser(user) {
  return {
    id: user.id,
    fullName: user.full_name,
    username: user.username,
    role: user.role,
    className: user.class_name,
    attendanceNumber: user.attendance_number,
    mustChangePassword: Boolean(user.must_change_password),
    createdAt: user.created_at,
  };
}

function expireAttempt(attempt) {
  if (attempt && attempt.status === 'in_progress' && Date.now() >= Date.parse(attempt.deadline_at)) {
    db.prepare(`UPDATE attempts SET status = 'submitted', submitted_at = ?
      WHERE id = ? AND status = 'in_progress'`).run(nowIso(), attempt.id);
    synchronizeAttempt(attempt.id).catch((error) => console.error(`Sinkronisasi otomatis gagal: ${error.message}`));
    return db.prepare('SELECT * FROM attempts WHERE id = ?').get(attempt.id);
  }
  return attempt;
}

function userFromRequest(req) {
  const token = parseCookies(req.headers.cookie).assessment_session;
  if (!token) return null;
  const session = db.prepare(`SELECT users.*, sessions.expires_at
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ?`).get(tokenDigest(token));
  if (!session) return null;
  if (Date.parse(session.expires_at) <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenDigest(token));
    return null;
  }
  return session;
}

function requireAuth(user) {
  if (!user) throw fail(401, 'Silakan masuk kembali untuk melanjutkan.');
}

function requireRole(user, role) {
  requireAuth(user);
  if (user.role !== role) throw fail(403, 'Anda tidak memiliki izin untuk tindakan ini.');
}

function attemptForStudent(id, studentId) {
  const attempt = db.prepare('SELECT * FROM attempts WHERE id = ? AND student_id = ?').get(id, studentId);
  if (!attempt) throw fail(404, 'Percobaan asesmen tidak ditemukan.');
  return expireAttempt(attempt);
}

function readAnswers(attemptId) {
  return db.prepare(`SELECT question_id, answer_text, structured_data, created_at, updated_at
    FROM answers WHERE attempt_id = ?`).all(attemptId).map((answer) => ({
    questionId: answer.question_id,
    answerText: answer.answer_text,
    structuredData: JSON.parse(answer.structured_data),
    createdAt: answer.created_at,
    updatedAt: answer.updated_at,
  }));
}

function gradeForAttempt(attemptId) {
  const grade = db.prepare('SELECT * FROM grades WHERE attempt_id = ?').get(attemptId);
  if (!grade) return null;
  if (grade.status !== 'published') return { status: grade.status, published: false };
  const feedback = db.prepare(`SELECT question_id, score, feedback_text
    FROM question_feedback WHERE grade_id = ?`).all(grade.id);
  return {
    status: grade.status,
    published: true,
    scores: {
      fluency: grade.fluency_score,
      flexibility: grade.flexibility_score,
      originality: grade.originality_score,
      elaboration: grade.elaboration_score,
    },
    totalScore: grade.total_score,
    finalScore: grade.final_score,
    category: grade.category,
    generalFeedback: grade.general_feedback,
    gradedAt: grade.graded_at,
    questionFeedback: feedback,
  };
}

function attemptPayload(attempt) {
  if (!attempt) return null;
  return {
    id: attempt.id,
    status: attempt.status,
    startedAt: attempt.started_at,
    deadlineAt: attempt.deadline_at,
    submittedAt: attempt.submitted_at,
  };
}

async function createSession(user, res) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiry = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(tokenDigest(token), user.id, expiry, nowIso());
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `assessment_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}${secure}`);
}

function removeSession(req, res) {
  const token = parseCookies(req.headers.cookie).assessment_session;
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenDigest(token));
  res.setHeader('Set-Cookie', 'assessment_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
}

function checkOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  const expected = `http://${req.headers.host}`;
  const expectedTls = `https://${req.headers.host}`;
  if (origin !== expected && origin !== expectedTls) throw fail(403, 'Asal permintaan tidak diizinkan.');
}

function mapAttemptList(row) {
  const grade = gradeForAttempt(row.id);
  return {
    id: row.id,
    student: {
      id: row.student_id,
      fullName: row.full_name,
      username: row.username,
      className: row.class_name,
      attendanceNumber: row.attendance_number,
    },
    status: row.status,
    startedAt: row.started_at,
    deadlineAt: row.deadline_at,
    submittedAt: row.submitted_at,
    gradeStatus: grade ? grade.status : 'not_graded',
    finalScore: grade && grade.published ? grade.finalScore : null,
    grade: grade && grade.published ? {
      scores: grade.scores,
      totalScore: grade.totalScore,
      finalScore: grade.finalScore,
      category: grade.category,
    } : null,
  };
}

function listTeacherAttempts() {
  const rows = db.prepare(`SELECT attempts.*, users.id AS student_id, users.full_name,
    users.username, users.class_name, users.attendance_number
    FROM attempts JOIN users ON users.id = attempts.student_id
    ORDER BY attempts.created_at DESC`).all();
  return rows.map((row) => mapAttemptList(expireAttempt(row)));
}

function syncPayload(attemptId) {
  const attempt = db.prepare(`SELECT attempts.*, users.full_name, users.username,
      users.class_name, users.attendance_number, grades.status AS grade_status,
      grades.fluency_score, grades.flexibility_score, grades.originality_score,
      grades.elaboration_score, grades.total_score, grades.final_score,
      grades.category, grades.general_feedback, grades.graded_at
    FROM attempts JOIN users ON users.id = attempts.student_id
    LEFT JOIN grades ON grades.attempt_id = attempts.id
    WHERE attempts.id = ?`).get(attemptId);
  if (!attempt) throw fail(404, 'Percobaan asesmen tidak ditemukan.');
  return {
    attemptId,
    student: {
      fullName: attempt.full_name,
      username: attempt.username,
      className: attempt.class_name,
      attendanceNumber: attempt.attendance_number,
    },
    status: attempt.status,
    startedAt: attempt.started_at,
    deadlineAt: attempt.deadline_at,
    submittedAt: attempt.submitted_at,
    answers: readAnswers(attemptId),
    attachments: db.prepare(`SELECT id, question_id, original_name, mime_type, size_bytes, created_at
      FROM attachments WHERE attempt_id = ? ORDER BY created_at`).all(attemptId).map((attachment) => ({
      id: attachment.id,
      questionId: attachment.question_id,
      originalName: attachment.original_name,
      mimeType: attachment.mime_type,
      sizeBytes: attachment.size_bytes,
      createdAt: attachment.created_at,
      url: `${(process.env.APP_PUBLIC_URL || '').replace(/\/$/, '')}/api/attachments/${encodeURIComponent(attachment.id)}`,
    })),
    grade: attempt.grade_status === 'published' ? {
      scores: {
        fluency: attempt.fluency_score,
        flexibility: attempt.flexibility_score,
        originality: attempt.originality_score,
        elaboration: attempt.elaboration_score,
      },
      totalScore: attempt.total_score,
      finalScore: attempt.final_score,
      category: attempt.category,
      generalFeedback: attempt.general_feedback,
      gradedAt: attempt.graded_at,
    } : null,
  };
}

async function synchronizeAttempt(attemptId) {
  const endpoint = process.env.GOOGLE_APPS_SCRIPT_URL;
  if (!endpoint) return { configured: false, status: 'not_configured' };
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: process.env.GOOGLE_APPS_SCRIPT_TOKEN || '',
        ...syncPayload(attemptId),
      }),
      signal: AbortSignal.timeout(12000),
    });
    const responseText = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${responseText.slice(0, 400)}`);
    let result;
    try {
      result = JSON.parse(responseText);
    } catch {
      throw new Error('Respons Apps Script bukan JSON yang valid.');
    }
    if (result.ok !== true) throw new Error(result.error || 'Apps Script menolak sinkronisasi.');
    db.prepare(`INSERT INTO sync_logs (id, attempt_id, sync_status, error_message, last_attempt_at)
      VALUES (?, ?, 'success', NULL, ?)`).run(uuid(), attemptId, nowIso());
    return { configured: true, status: 'success' };
  } catch (error) {
    db.prepare(`INSERT INTO sync_logs (id, attempt_id, sync_status, error_message, last_attempt_at)
      VALUES (?, ?, 'failed', ?, ?)`).run(uuid(), attemptId, String(error.message).slice(0, 1000), nowIso());
    console.error(`Sinkronisasi spreadsheet gagal untuk ${attemptId}: ${error.message}`);
    return { configured: true, status: 'failed' };
  }
}

async function synchronizeDeletedAttempts(attemptIds) {
  const endpoint = process.env.GOOGLE_APPS_SCRIPT_URL;
  if (!endpoint || attemptIds.length === 0) return { configured: Boolean(endpoint), status: endpoint ? 'not_needed' : 'not_configured' };
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'deleteAttempts',
        token: process.env.GOOGLE_APPS_SCRIPT_TOKEN || '',
        attemptIds,
      }),
      signal: AbortSignal.timeout(12000),
    });
    const responseText = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${responseText.slice(0, 400)}`);
    let result;
    try {
      result = JSON.parse(responseText);
    } catch {
      throw new Error('Respons Apps Script bukan JSON yang valid.');
    }
    if (result.ok !== true) throw new Error(result.error || 'Apps Script menolak penghapusan.');
    return { configured: true, status: 'success', deletedRows: result.deletedRows };
  } catch (error) {
    console.error(`Gagal menghapus hasil siswa dari spreadsheet: ${error.message}`);
    return { configured: true, status: 'failed' };
  }
}

async function route(req, res, url) {
  const method = req.method;
  const pathname = decodeURIComponent(url.pathname);
  const user = userFromRequest(req);
  if (method !== 'GET' && method !== 'HEAD') checkOrigin(req);

  if (method === 'POST' && pathname === '/api/register') {
    const body = await readJson(req);
    const fullName = requireString(body.fullName, 'Nama lengkap', 120);
    const username = requireString(body.username, 'Username', 40);
    const password = requireString(body.password, 'Kata sandi', 200);
    const confirmation = requireString(body.confirmPassword, 'Konfirmasi kata sandi', 200);
    const className = requireString(body.className, 'Kelas', 40);
    const attendanceNumber = typeof body.attendanceNumber === 'string' ? body.attendanceNumber.trim().slice(0, 20) : '';
    if (!/^[\p{L}\p{N}._-]{3,40}$/u.test(username)) {
      throw fail(400, 'Username 3–40 karakter: gunakan huruf, angka, titik, garis bawah, atau tanda hubung.');
    }
    if (password.length < 10) throw fail(400, 'Kata sandi harus terdiri dari sedikitnya 10 karakter.');
    if (password !== confirmation) throw fail(400, 'Kata sandi dan konfirmasi tidak sama.');
    if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) throw fail(409, 'Username sudah digunakan.');
    const student = {
      id: uuid(),
      full_name: fullName,
      username,
      password_hash: await hashPassword(password),
      role: 'student',
      class_name: className,
      attendance_number: attendanceNumber || null,
      must_change_password: 0,
      created_at: nowIso(),
    };
    db.prepare(`INSERT INTO users
      (id, full_name, username, password_hash, role, class_name, attendance_number, created_at)
      VALUES (?, ?, ?, ?, 'student', ?, ?, ?)`)
      .run(student.id, student.full_name, student.username, student.password_hash, className, attendanceNumber || null, student.created_at);
    await createSession(student, res);
    return sendJson(res, 201, { user: cleanUser(student) });
  }

  if (method === 'POST' && pathname === '/api/login') {
    const body = await readJson(req);
    const username = requireString(body.username, 'Username', 40);
    const password = requireString(body.password, 'Kata sandi', 200);
    const account = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!account || !(await verifyPassword(password, account.password_hash))) {
      throw fail(401, 'Username atau kata sandi tidak benar.');
    }
    await createSession(account, res);
    return sendJson(res, 200, { user: cleanUser(account) });
  }

  if (method === 'POST' && pathname === '/api/logout') {
    removeSession(req, res);
    return sendJson(res, 200, { ok: true });
  }

  if (method === 'GET' && pathname === '/api/me') {
    return sendJson(res, 200, { user: user ? cleanUser(user) : null, assessment });
  }

  if (method === 'PUT' && pathname === '/api/teacher/profile') {
    requireRole(user, 'teacher');
    const body = await readJson(req);
    const fullName = requireString(body.fullName, 'Nama lengkap', 120);
    db.prepare("UPDATE users SET full_name = ? WHERE id = ? AND role = 'teacher'")
      .run(fullName, user.id);
    const updatedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    return sendJson(res, 200, { user: cleanUser(updatedUser) });
  }

  if (method === 'POST' && pathname === '/api/change-password') {
    requireAuth(user);
    const body = await readJson(req);
    const currentPassword = requireString(body.currentPassword, 'Kata sandi saat ini', 200);
    const newPassword = requireString(body.newPassword, 'Kata sandi baru', 200);
    const confirmation = requireString(body.confirmPassword, 'Konfirmasi kata sandi', 200);
    if (!(await verifyPassword(currentPassword, user.password_hash))) throw fail(400, 'Kata sandi saat ini tidak benar.');
    if (newPassword.length < 10) throw fail(400, 'Kata sandi baru harus terdiri dari sedikitnya 10 karakter.');
    if (newPassword !== confirmation) throw fail(400, 'Konfirmasi kata sandi baru tidak sama.');
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?')
      .run(await hashPassword(newPassword), user.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    await createSession({ ...user, must_change_password: 0 }, res);
    return sendJson(res, 200, { ok: true });
  }

  if (method === 'GET' && pathname === '/api/student/dashboard') {
    requireRole(user, 'student');
    const raw = db.prepare('SELECT * FROM attempts WHERE student_id = ? AND assessment_id = ?')
      .get(user.id, ASSESSMENT_ID);
    const attempt = expireAttempt(raw);
    return sendJson(res, 200, {
      assessment,
      attempt: attemptPayload(attempt),
      answers: attempt ? readAnswers(attempt.id) : [],
      attachments: attempt ? db.prepare(`SELECT id, question_id, original_name, mime_type, size_bytes, created_at
        FROM attachments WHERE attempt_id = ? ORDER BY created_at`).all(attempt.id) : [],
      grade: attempt ? gradeForAttempt(attempt.id) : null,
      serverNow: nowIso(),
    });
  }

  if (method === 'POST' && pathname === '/api/attempts/start') {
    requireRole(user, 'student');
    const existing = db.prepare('SELECT * FROM attempts WHERE student_id = ? AND assessment_id = ?')
      .get(user.id, ASSESSMENT_ID);
    if (existing) {
      const current = expireAttempt(existing);
      return sendJson(res, 200, { attempt: attemptPayload(current), answers: readAnswers(current.id) });
    }
    const startedAt = new Date();
    const deadlineAt = new Date(startedAt.getTime() + assessment.durationMinutes * 60_000);
    const id = uuid();
    db.prepare(`INSERT INTO attempts
      (id, student_id, assessment_id, started_at, deadline_at, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'in_progress', ?)`)
      .run(id, user.id, ASSESSMENT_ID, startedAt.toISOString(), deadlineAt.toISOString(), startedAt.toISOString());
    return sendJson(res, 201, {
      attempt: attemptPayload(db.prepare('SELECT * FROM attempts WHERE id = ?').get(id)),
      answers: [],
    });
  }

  const saveAnswerMatch = pathname.match(/^\/api\/attempts\/([^/]+)\/answers\/([^/]+)$/);
  if (method === 'PUT' && saveAnswerMatch) {
    requireRole(user, 'student');
    const [, attemptId, questionId] = saveAnswerMatch;
    const attempt = attemptForStudent(attemptId, user.id);
    if (attempt.status !== 'in_progress') throw fail(409, 'Jawaban terkunci karena asesmen telah dikumpulkan atau waktunya habis.');
    if (!questions.some((question) => question.id === questionId)) throw fail(400, 'ID soal tidak valid.');
    const body = await readJson(req);
    if (typeof body.answerText !== 'string' || body.answerText.length > 50000) throw fail(400, 'Jawaban teks tidak valid atau terlalu panjang.');
    if (!body.structuredData || typeof body.structuredData !== 'object' || Array.isArray(body.structuredData)) {
      throw fail(400, 'Data terstruktur tidak valid.');
    }
    if (Buffer.byteLength(JSON.stringify(body.structuredData), 'utf8') > 100000) throw fail(413, 'Data terstruktur terlalu besar.');
    const existing = db.prepare('SELECT id, created_at FROM answers WHERE attempt_id = ? AND question_id = ?').get(attemptId, questionId);
    const id = existing ? existing.id : uuid();
    const createdAt = existing ? existing.created_at : nowIso();
    const updatedAt = nowIso();
    db.prepare(`INSERT INTO answers (id, attempt_id, question_id, answer_text, structured_data, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(attempt_id, question_id) DO UPDATE SET
        answer_text = excluded.answer_text,
        structured_data = excluded.structured_data,
        updated_at = excluded.updated_at`)
      .run(id, attemptId, questionId, body.answerText, JSON.stringify(body.structuredData), createdAt, updatedAt);
    return sendJson(res, 200, { saved: true, questionId, updatedAt });
  }

  const submitMatch = pathname.match(/^\/api\/attempts\/([^/]+)\/submit$/);
  if (method === 'POST' && submitMatch) {
    requireRole(user, 'student');
    const attempt = attemptForStudent(submitMatch[1], user.id);
    if (attempt.status === 'submitted') {
      return sendJson(res, 200, { submitted: true, attempt: attemptPayload(attempt), sync: await synchronizeAttempt(attempt.id) });
    }
    const submittedAt = nowIso();
    db.prepare(`UPDATE attempts SET status = 'submitted', submitted_at = ?
      WHERE id = ? AND student_id = ? AND status = 'in_progress'`)
      .run(submittedAt, attempt.id, user.id);
    const updated = db.prepare('SELECT * FROM attempts WHERE id = ?').get(attempt.id);
    const sync = await synchronizeAttempt(attempt.id);
    return sendJson(res, 200, { submitted: true, attempt: attemptPayload(updated), sync });
  }

  const uploadMatch = pathname.match(/^\/api\/attempts\/([^/]+)\/attachments$/);
  if (method === 'POST' && uploadMatch) {
    requireRole(user, 'student');
    const attempt = attemptForStudent(uploadMatch[1], user.id);
    if (attempt.status !== 'in_progress') throw fail(409, 'Lampiran tidak dapat ditambahkan setelah asesmen dikumpulkan.');
    const body = await readJson(req);
    const questionId = requireString(body.questionId, 'ID soal', 10);
    if (!questions.some((question) => question.id === questionId)) throw fail(400, 'ID soal tidak valid.');
    const originalName = requireString(body.fileName, 'Nama file', 180).replace(/[\\/\u0000-\u001f]/g, '_');
    const mimeType = requireString(body.mimeType, 'Tipe file', 80);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) throw fail(400, 'Lampiran hanya boleh berupa gambar JPG, PNG, atau WebP.');
    if (typeof body.dataBase64 !== 'string' || body.dataBase64.length > 7_000_000) throw fail(400, 'Data gambar tidak valid atau melebihi batas ukuran.');
    const data = Buffer.from(body.dataBase64, 'base64');
    if (data.length === 0 || data.length > 5 * 1024 * 1024) throw fail(400, 'Ukuran gambar maksimum adalah 5 MB.');
    const magic = data.subarray(0, 12).toString('hex');
    const signatures = {
      'image/jpeg': magic.startsWith('ffd8ff'),
      'image/png': magic.startsWith('89504e470d0a1a0a'),
      'image/webp': data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP',
    };
    if (!signatures[mimeType]) throw fail(400, 'Isi file tidak cocok dengan tipe gambar yang dipilih.');
    const id = uuid();
    const storedName = `${id}.${mimeType === 'image/jpeg' ? 'jpg' : mimeType.slice(6)}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, storedName), data, { flag: 'wx' });
    db.prepare(`INSERT INTO attachments
      (id, attempt_id, question_id, original_name, stored_name, mime_type, size_bytes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, attempt.id, questionId, originalName, storedName, mimeType, data.length, nowIso());
    return sendJson(res, 201, {
      attachment: { id, questionId, originalName, mimeType, sizeBytes: data.length, createdAt: nowIso() },
    });
  }

  const attachmentMatch = pathname.match(/^\/api\/attachments\/([0-9a-f-]+)$/i);
  if ((method === 'GET' || method === 'HEAD') && attachmentMatch) {
    requireAuth(user);
    const attachment = db.prepare(`SELECT attachments.*, attempts.student_id
      FROM attachments JOIN attempts ON attempts.id = attachments.attempt_id
      WHERE attachments.id = ?`).get(attachmentMatch[1]);
    if (!attachment) throw fail(404, 'Lampiran tidak ditemukan.');
    if (user.role !== 'teacher' && attachment.student_id !== user.id) throw fail(403, 'Anda tidak memiliki izin melihat lampiran ini.');
    const filePath = path.join(UPLOAD_DIR, attachment.stored_name);
    if (!fs.existsSync(filePath)) throw fail(404, 'File lampiran tidak tersedia di penyimpanan.');
    res.writeHead(200, {
      'Content-Type': attachment.mime_type,
      'Content-Length': attachment.size_bytes,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
    });
    return method === 'HEAD' ? res.end() : fs.createReadStream(filePath).pipe(res);
  }

  if (method === 'GET' && pathname === '/api/student/results') {
    requireRole(user, 'student');
    const attempt = expireAttempt(db.prepare('SELECT * FROM attempts WHERE student_id = ? AND assessment_id = ?')
      .get(user.id, ASSESSMENT_ID));
    if (!attempt) return sendJson(res, 200, { state: 'not_started' });
    const grade = gradeForAttempt(attempt.id);
    if (!grade || !grade.published) return sendJson(res, 200, { state: 'waiting', submittedAt: attempt.submitted_at });
    return sendJson(res, 200, { state: 'published', attempt: attemptPayload(attempt), grade });
  }

  if (method === 'GET' && pathname === '/api/teacher/dashboard') {
    requireRole(user, 'teacher');
    const attempts = listTeacherAttempts();
    const students = db.prepare(`SELECT id, full_name, username, class_name, attendance_number, created_at
      FROM users WHERE role = 'student' ORDER BY full_name COLLATE NOCASE`).all();
    const counts = {
      notStarted: students.filter((student) => !attempts.some((attempt) => attempt.student.id === student.id)).length,
      inProgress: attempts.filter((attempt) => attempt.status === 'in_progress').length,
      submitted: attempts.filter((attempt) => attempt.status === 'submitted').length,
      awaitingGrade: attempts.filter((attempt) => attempt.status === 'submitted' && attempt.gradeStatus !== 'published').length,
    };
    const syncLogs = db.prepare(`SELECT sync_logs.attempt_id, sync_logs.sync_status, sync_logs.error_message, sync_logs.last_attempt_at
      FROM sync_logs JOIN (
        SELECT attempt_id, MAX(last_attempt_at) AS latest FROM sync_logs GROUP BY attempt_id
      ) latest ON latest.attempt_id = sync_logs.attempt_id AND latest.latest = sync_logs.last_attempt_at`).all();
    return sendJson(res, 200, { attempts, students, counts, syncLogs, spreadsheetConfigured: Boolean(process.env.GOOGLE_APPS_SCRIPT_URL) });
  }

  const deleteStudentMatch = pathname.match(/^\/api\/teacher\/students\/([^/]+)$/);
  if (method === 'DELETE' && deleteStudentMatch) {
    requireRole(user, 'teacher');
    const studentId = deleteStudentMatch[1];
    const student = db.prepare("SELECT id, role FROM users WHERE id = ?").get(studentId);
    if (!student || student.role !== 'student') throw fail(404, 'Data siswa tidak ditemukan.');
    const attemptIds = db.prepare('SELECT id FROM attempts WHERE student_id = ?').all(studentId).map((attempt) => attempt.id);
    const attachmentFiles = db.prepare(`SELECT attachments.stored_name
      FROM attachments JOIN attempts ON attempts.id = attachments.attempt_id
      WHERE attempts.student_id = ?`).all(studentId).map((attachment) => path.join(UPLOAD_DIR, attachment.stored_name));

    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM attempts WHERE student_id = ?').run(studentId);
      db.prepare('DELETE FROM users WHERE id = ? AND role = ?').run(studentId, 'student');
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }

    const spreadsheetCleanup = await synchronizeDeletedAttempts(attemptIds);
    const cleanupErrors = [];
    for (const filePath of attachmentFiles) {
      try {
        fs.rmSync(filePath, { force: true });
      } catch (error) {
        cleanupErrors.push(path.basename(filePath));
        console.error(`Gagal menghapus lampiran yatim ${filePath}: ${error.message}`);
      }
    }
    return sendJson(res, 200, { deleted: true, cleanupErrors, spreadsheetCleanup });
  }

  const teacherAttemptMatch = pathname.match(/^\/api\/teacher\/attempts\/([^/]+)$/);
  if (method === 'DELETE' && teacherAttemptMatch) {
    requireRole(user, 'teacher');
    const attempt = db.prepare(`SELECT id FROM attempts WHERE id = ?`).get(teacherAttemptMatch[1]);
    if (!attempt) throw fail(404, 'Hasil pengerjaan siswa tidak ditemukan.');
    const attachmentFiles = db.prepare('SELECT stored_name FROM attachments WHERE attempt_id = ?')
      .all(attempt.id).map((attachment) => path.join(UPLOAD_DIR, attachment.stored_name));
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM attempts WHERE id = ?').run(attempt.id);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }

    const spreadsheetCleanup = await synchronizeDeletedAttempts([attempt.id]);
    const cleanupErrors = [];
    for (const filePath of attachmentFiles) {
      try {
        fs.rmSync(filePath, { force: true });
      } catch (error) {
        cleanupErrors.push(path.basename(filePath));
        console.error(`Gagal menghapus lampiran hasil pengerjaan ${filePath}: ${error.message}`);
      }
    }
    return sendJson(res, 200, { reset: true, cleanupErrors, spreadsheetCleanup });
  }
  if (method === 'GET' && teacherAttemptMatch) {
    requireRole(user, 'teacher');
    const attempt = db.prepare(`SELECT attempts.*, users.full_name, users.username, users.class_name,
      users.attendance_number FROM attempts JOIN users ON users.id = attempts.student_id
      WHERE attempts.id = ?`).get(teacherAttemptMatch[1]);
    if (!attempt) throw fail(404, 'Percobaan asesmen tidak ditemukan.');
    expireAttempt(attempt);
    const grade = db.prepare('SELECT * FROM grades WHERE attempt_id = ?').get(attempt.id);
    const feedback = grade ? db.prepare('SELECT question_id, score, feedback_text FROM question_feedback WHERE grade_id = ?')
      .all(grade.id) : [];
    return sendJson(res, 200, {
      attempt: {
        ...attemptPayload(attempt),
        student: {
          id: attempt.student_id,
          fullName: attempt.full_name,
          username: attempt.username,
          className: attempt.class_name,
          attendanceNumber: attempt.attendance_number,
        },
      },
      answers: readAnswers(attempt.id),
      attachments: db.prepare(`SELECT id, question_id, original_name, mime_type, size_bytes, created_at
        FROM attachments WHERE attempt_id = ? ORDER BY created_at`).all(attempt.id),
      grade: grade ? {
        id: grade.id,
        status: grade.status,
        gradedAt: grade.graded_at,
        scores: {
          fluency: grade.fluency_score,
          flexibility: grade.flexibility_score,
          originality: grade.originality_score,
          elaboration: grade.elaboration_score,
        },
        generalFeedback: grade.general_feedback,
        questionFeedback: feedback,
      } : null,
      questions,
    });
  }

  const gradeMatch = pathname.match(/^\/api\/teacher\/attempts\/([^/]+)\/grade$/);
  if (method === 'PUT' && gradeMatch) {
    requireRole(user, 'teacher');
    const attempt = db.prepare('SELECT * FROM attempts WHERE id = ?').get(gradeMatch[1]);
    if (!attempt) throw fail(404, 'Percobaan asesmen tidak ditemukan.');
    if (attempt.status !== 'submitted') throw fail(409, 'Penilaian hanya dapat dilakukan setelah siswa mengumpulkan asesmen.');
    const body = await readJson(req);
    if (!body.scores || typeof body.scores !== 'object') throw fail(400, 'Skor setiap indikator wajib diisi.');
    let summary;
    try {
      summary = scoreSummary(body.scores);
    } catch (error) {
      throw fail(400, error.message);
    }
    const generalFeedback = typeof body.generalFeedback === 'string' ? body.generalFeedback.trim().slice(0, 5000) : '';
    const feedbackInput = Array.isArray(body.questionFeedback) ? body.questionFeedback : [];
    const feedbackByQuestion = new Map();
    for (const item of feedbackInput) {
      if (!item || !questions.some((question) => question.id === item.questionId)) throw fail(400, 'ID soal pada umpan balik tidak valid.');
      const score = item.score;
      if (!Number.isInteger(score) || score < 0 || score > 4) throw fail(400, 'Skor umpan balik soal harus berupa bilangan bulat 0–4.');
      if (feedbackByQuestion.has(item.questionId)) throw fail(400, 'Terdapat umpan balik ganda untuk satu soal.');
      feedbackByQuestion.set(item.questionId, {
        score,
        feedbackText: typeof item.feedbackText === 'string' ? item.feedbackText.trim().slice(0, 5000) : '',
      });
    }
    if (feedbackByQuestion.size !== questions.length) throw fail(400, 'Skor dan umpan balik keempat soal wajib diisi.');
    const publish = body.publish === true;
    const currentGrade = db.prepare('SELECT status FROM grades WHERE attempt_id = ?').get(attempt.id);
    if (currentGrade?.status === 'published' && !publish) {
      throw fail(409, 'Penilaian yang sudah dipublikasikan hanya dapat diperbarui dengan menyimpan dan memublikasikannya kembali.');
    }
    const gradeId = uuid();
    const gradedAt = publish ? nowIso() : null;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`INSERT INTO grades
        (id, attempt_id, fluency_score, flexibility_score, originality_score, elaboration_score,
         total_score, final_score, category, general_feedback, graded_by, graded_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(attempt_id) DO UPDATE SET
          fluency_score = excluded.fluency_score,
          flexibility_score = excluded.flexibility_score,
          originality_score = excluded.originality_score,
          elaboration_score = excluded.elaboration_score,
          total_score = excluded.total_score,
          final_score = excluded.final_score,
          category = excluded.category,
          general_feedback = excluded.general_feedback,
          graded_by = excluded.graded_by,
          graded_at = excluded.graded_at,
          status = excluded.status`)
        .run(gradeId, attempt.id, summary.fluency, summary.flexibility, summary.originality, summary.elaboration,
          summary.total, summary.finalScore, summary.category, generalFeedback, user.id, gradedAt, publish ? 'published' : 'draft');
      const savedGrade = db.prepare('SELECT id FROM grades WHERE attempt_id = ?').get(attempt.id);
      db.prepare('DELETE FROM question_feedback WHERE grade_id = ?').run(savedGrade.id);
      const insertFeedback = db.prepare(`INSERT INTO question_feedback
        (id, grade_id, question_id, score, feedback_text) VALUES (?, ?, ?, ?, ?)`);
      for (const [questionId, feedback] of feedbackByQuestion) {
        insertFeedback.run(uuid(), savedGrade.id, questionId, feedback.score, feedback.feedbackText);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    const sync = publish ? await synchronizeAttempt(attempt.id) : { configured: Boolean(process.env.GOOGLE_APPS_SCRIPT_URL), status: 'not_requested' };
    return sendJson(res, 200, {
      saved: true,
      published: publish,
      grade: {
        ...summary,
        status: publish ? 'published' : 'draft',
        gradedAt,
      },
      sync,
    });
  }

  const retrySyncMatch = pathname.match(/^\/api\/teacher\/attempts\/([^/]+)\/sync$/);
  if (method === 'POST' && retrySyncMatch) {
    requireRole(user, 'teacher');
    const attempt = db.prepare('SELECT id FROM attempts WHERE id = ?').get(retrySyncMatch[1]);
    if (!attempt) throw fail(404, 'Percobaan asesmen tidak ditemukan.');
    return sendJson(res, 200, { sync: await synchronizeAttempt(attempt.id) });
  }

  const resetPasswordMatch = pathname.match(/^\/api\/teacher\/students\/([^/]+)\/reset-password$/);
  if (method === 'POST' && resetPasswordMatch) {
    requireRole(user, 'teacher');
    const student = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'student'").get(resetPasswordMatch[1]);
    if (!student) throw fail(404, 'Akun siswa tidak ditemukan.');
    const temporaryPassword = crypto.randomBytes(12).toString('base64url');
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?')
      .run(await hashPassword(temporaryPassword), student.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(student.id);
    return sendJson(res, 200, { temporaryPassword });
  }

  if ((method === 'GET' || method === 'HEAD') && pathname === '/') {
    return serveStatic(res, 'index.html', method === 'HEAD');
  }
  if ((method === 'GET' || method === 'HEAD') && pathname.startsWith('/public/')) {
    const relative = pathname.slice('/public/'.length);
    if (!relative || relative.split('/').includes('..')) throw fail(404, 'Halaman tidak ditemukan.');
    return serveStatic(res, relative, method === 'HEAD');
  }

  throw fail(404, 'Endpoint tidak ditemukan.');
}

function serveStatic(res, relativePath, headOnly) {
  const fullPath = path.resolve(PUBLIC_DIR, relativePath);
  if (!fullPath.startsWith(`${PUBLIC_DIR}${path.sep}`) && fullPath !== path.join(PUBLIC_DIR, 'index.html')) {
    throw fail(404, 'Halaman tidak ditemukan.');
  }
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) throw fail(404, 'Halaman tidak ditemukan.');
  const contentTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml',
  };
  res.writeHead(200, {
    'Content-Type': contentTypes[path.extname(fullPath)] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-src https://phet.colorado.edu; connect-src 'self'; base-uri 'self'; form-action 'self'",
  });
  return headOnly ? res.end() : fs.createReadStream(fullPath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host || `localhost:${PORT}`;
    await route(req, res, new URL(req.url, `http://${host}`));
  } catch (error) {
    if (res.headersSent) {
      console.error('Respons tidak dapat diselesaikan:', error);
      return res.destroy(error);
    }
    const status = Number.isInteger(error.status) ? error.status : 500;
    if (status >= 500) console.error(error);
    sendJson(res, status, { error: status >= 500 ? 'Terjadi kesalahan server. Silakan coba kembali.' : error.message });
  }
});

async function start() {
  await seedTeacher();
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(nowIso());
  const maintenance = setInterval(() => {
    const expired = db.prepare(`SELECT * FROM attempts
      WHERE status = 'in_progress' AND deadline_at <= ?`).all(nowIso());
    for (const attempt of expired) {
      expireAttempt(attempt);
    }

    const failedSyncs = db.prepare(`SELECT latest.attempt_id
      FROM sync_logs AS latest
      WHERE latest.sync_status = 'failed'
        AND latest.last_attempt_at <= ?
        AND latest.id = (
          SELECT newest.id FROM sync_logs AS newest
          WHERE newest.attempt_id = latest.attempt_id
          ORDER BY newest.last_attempt_at DESC, newest.id DESC LIMIT 1
        )
      ORDER BY latest.last_attempt_at LIMIT 10`).all(new Date(Date.now() - 60_000).toISOString());
    for (const item of failedSyncs) {
      synchronizeAttempt(item.attempt_id).catch((error) => console.error(`Sinkronisasi ulang gagal: ${error.message}`));
    }
  }, 15_000);
  maintenance.unref();
  server.listen(PORT, () => {
    console.log(`Aplikasi asesmen berjalan di http://localhost:${PORT}`);
    if (!process.env.GOOGLE_APPS_SCRIPT_URL) console.log('Sinkronisasi Google Sheets belum dikonfigurasi (aplikasi tetap menyimpan data di SQLite).');
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error('Aplikasi gagal dijalankan:', error);
    process.exitCode = 1;
  });
}

module.exports = { server, db, assessment, questions, scoreSummary, INDICATORS };
