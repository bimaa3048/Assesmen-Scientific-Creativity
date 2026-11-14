import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { assessment, questions } from '../../../lib/assessment.js';
import { ensureSchema, pool, transaction } from '../../../lib/db.js';
import scoring from '../../../domain.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const { scoreSummary } = scoring;
const ASSESSMENT_ID = assessment.id;
const SESSION_DAYS = 7;
const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;
const scrypt = promisify(crypto.scrypt);

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function fail(status, message) {
  throw new ApiError(status, message);
}

function uuid() {
  return crypto.randomUUID();
}

function now() {
  return new Date();
}

function tokenDigest(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [algorithm, saltHex, hashHex] = String(stored).split(':');
  if (algorithm !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

let initialization;
async function initialize() {
  if (!initialization) {
    initialization = (async () => {
      await ensureSchema();
      await pool.query(
        `INSERT INTO assessments (id, title, subject, material, duration_minutes, status)
         VALUES ($1, $2, $3, $4, $5, 'active') ON CONFLICT (id) DO NOTHING`,
        [ASSESSMENT_ID, assessment.title, assessment.subject, assessment.material, assessment.durationMinutes],
      );
      const username = process.env.TEACHER_USERNAME || 'Bimaaditya';
      const existingTeacher = await pool.query(
        "SELECT id FROM users WHERE role = 'teacher' AND LOWER(username) = LOWER($1)",
        [username],
      );
      if (!existingTeacher.rowCount) {
        const password = process.env.TEACHER_PASSWORD || (process.env.NODE_ENV === 'production' ? '' : 'Bimmbou01');
        if (!password) throw new Error('TEACHER_PASSWORD harus diatur sebelum akun guru awal dibuat.');
        const seeded = await pool.query(
          `INSERT INTO users
           (id, full_name, username, password_hash, role, must_change_password, created_at)
           VALUES ($1, $2, $3, $4, 'teacher', TRUE, $5)
           ON CONFLICT DO NOTHING RETURNING id`,
          [uuid(), process.env.TEACHER_NAME || 'Guru Fisika', username, await hashPassword(password), now()],
        );
        if (seeded.rowCount) {
          console.info(`Initial teacher account created for ${username}. Change the password after sign-in.`);
        }
      }
    })().catch((error) => {
      initialization = undefined;
      throw error;
    });
  }
  return initialization;
}

function json(data, status = 200, headers = {}) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Referrer-Policy': 'same-origin',
      ...headers,
    },
  });
}

function requireString(value, label, maximum = 10000) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    fail(400, `${label} wajib diisi dan maksimal ${maximum} karakter.`);
  }
  return value.trim();
}

async function bodyJson(request) {
  try {
    return await request.json();
  } catch {
    fail(400, 'Format JSON tidak valid.');
  }
}

function cleanUser(user) {
  return {
    id: user.id,
    fullName: user.full_name,
    username: user.username,
    role: user.role,
    className: user.class_name,
    attendanceNumber: user.attendance_number,
    schoolName: user.school_name,
    mustChangePassword: Boolean(user.must_change_password),
    createdAt: user.created_at,
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

function cookieHeader(token, clear = false) {
  const attributes = [
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${clear ? 0 : SESSION_DAYS * 86400}`,
  ];
  if (process.env.NODE_ENV === 'production') attributes.push('Secure');
  return `assessment_session=${clear ? '' : encodeURIComponent(token)}; ${attributes.join('; ')}`;
}

async function createSession(user) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000);
  await pool.query(
    'INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES ($1, $2, $3, $4)',
    [tokenDigest(token), user.id, expiresAt, now()],
  );
  return token;
}

function requireAuth(user) {
  if (!user) fail(401, 'Silakan masuk kembali untuk melanjutkan.');
}

function requireRole(user, role) {
  requireAuth(user);
  if (user.role !== role) fail(403, 'Anda tidak memiliki izin untuk tindakan ini.');
}

async function userForRequest(request) {
  const token = request.cookies.get('assessment_session')?.value;
  if (!token) return null;
  const result = await pool.query(
    `SELECT users.*, sessions.expires_at
     FROM sessions JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = $1`,
    [tokenDigest(token)],
  );
  const user = result.rows[0];
  if (!user) return null;
  if (new Date(user.expires_at).getTime() <= Date.now()) {
    await pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenDigest(token)]);
    return null;
  }
  return user;
}

async function readAnswers(attemptId) {
  const result = await pool.query(
    `SELECT question_id, answer_text, structured_data, created_at, updated_at
     FROM answers WHERE attempt_id = $1 ORDER BY question_id`,
    [attemptId],
  );
  return result.rows.map((answer) => ({
    questionId: answer.question_id,
    answerText: answer.answer_text,
    structuredData: answer.structured_data,
    createdAt: answer.created_at,
    updatedAt: answer.updated_at,
  }));
}

async function gradeForAttempt(attemptId) {
  const result = await pool.query('SELECT * FROM grades WHERE attempt_id = $1', [attemptId]);
  const grade = result.rows[0];
  if (!grade) return null;
  if (grade.status !== 'published') return { status: grade.status, published: false };
  const feedback = await pool.query(
    'SELECT question_id, score, feedback_text FROM question_feedback WHERE grade_id = $1',
    [grade.id],
  );
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
    finalScore: Number(grade.final_score),
    category: grade.category,
    generalFeedback: grade.general_feedback,
    gradedAt: grade.graded_at,
    questionFeedback: feedback.rows,
  };
}

async function expireAttempt(attempt) {
  if (attempt && attempt.status === 'in_progress' && Date.now() >= new Date(attempt.deadline_at).getTime()) {
    const submittedAt = now();
    await pool.query(
      `UPDATE attempts SET status = 'submitted', submitted_at = $1
       WHERE id = $2 AND status = 'in_progress'`,
      [submittedAt, attempt.id],
    );
    const updated = await pool.query('SELECT * FROM attempts WHERE id = $1', [attempt.id]);
    return updated.rows[0];
  }
  return attempt;
}

async function attemptForStudent(id, studentId) {
  const result = await pool.query('SELECT * FROM attempts WHERE id = $1 AND student_id = $2', [id, studentId]);
  if (!result.rowCount) fail(404, 'Percobaan asesmen tidak ditemukan.');
  return expireAttempt(result.rows[0]);
}

async function syncPayload(attemptId) {
  const result = await pool.query(
    `SELECT attempts.*, users.full_name, users.username, users.class_name, users.attendance_number, users.school_name,
            grades.status AS grade_status, grades.fluency_score, grades.flexibility_score,
            grades.originality_score, grades.elaboration_score, grades.total_score,
            grades.final_score, grades.category, grades.general_feedback, grades.graded_at
     FROM attempts JOIN users ON users.id = attempts.student_id
     LEFT JOIN grades ON grades.attempt_id = attempts.id WHERE attempts.id = $1`,
    [attemptId],
  );
  const attempt = result.rows[0];
  if (!attempt) fail(404, 'Percobaan asesmen tidak ditemukan.');
  const attachmentResult = await pool.query(
    `SELECT id, question_id, original_name, mime_type, size_bytes, created_at
     FROM attachments WHERE attempt_id = $1 ORDER BY created_at`,
    [attemptId],
  );
  const appPublicUrl = process.env.APP_PUBLIC_URL?.replace(/\/$/, '');
  if (attachmentResult.rowCount && !appPublicUrl) {
    throw new Error('APP_PUBLIC_URL wajib diatur agar foto dapat disalin ke Google Drive.');
  }
  if (attachmentResult.rowCount && !/^https:\/\//i.test(appPublicUrl)) {
    throw new Error('APP_PUBLIC_URL harus berupa URL HTTPS agar foto dapat disalin ke Google Drive.');
  }
  return {
    attemptId,
    student: {
      studentId: attempt.student_id,
      fullName: attempt.full_name,
      username: attempt.username,
      className: attempt.class_name,
      attendanceNumber: attempt.attendance_number,
      schoolName: attempt.school_name,
    },
    status: attempt.status,
    startedAt: attempt.started_at,
    deadlineAt: attempt.deadline_at,
    submittedAt: attempt.submitted_at,
    answers: await readAnswers(attemptId),
    attachments: attachmentResult.rows.map((attachment) => ({
      id: attachment.id,
      questionId: attachment.question_id,
      originalName: attachment.original_name,
      mimeType: attachment.mime_type,
      sizeBytes: attachment.size_bytes,
      createdAt: attachment.created_at,
      url: `${appPublicUrl}/api/sync/attachments/${encodeURIComponent(attachment.id)}`,
    })),
    grade: attempt.grade_status === 'published' ? {
      scores: {
        fluency: attempt.fluency_score,
        flexibility: attempt.flexibility_score,
        originality: attempt.originality_score,
        elaboration: attempt.elaboration_score,
      },
      totalScore: attempt.total_score,
      finalScore: Number(attempt.final_score),
      category: attempt.category,
      generalFeedback: attempt.general_feedback,
      gradedAt: attempt.graded_at,
    } : null,
  };
}

async function logSync(attemptId, status, message = null) {
  await pool.query(
    `INSERT INTO sync_logs (id, attempt_id, sync_status, error_message, last_attempt_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [uuid(), attemptId, status, message, now()],
  );
}

async function synchronizeAttempt(attemptId) {
  const endpoint = process.env.GOOGLE_APPS_SCRIPT_URL;
  if (!endpoint) return { configured: false, status: 'not_configured' };
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: process.env.GOOGLE_APPS_SCRIPT_TOKEN || '', ...await syncPayload(attemptId) }),
      signal: AbortSignal.timeout(25000),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 400)}`);
    let result;
    try {
      result = JSON.parse(text);
    } catch {
      throw new Error('Respons Apps Script bukan JSON yang valid.');
    }
    if (result.ok !== true) throw new Error(result.error || 'Apps Script menolak sinkronisasi.');
    await logSync(attemptId, 'success');
    return { configured: true, status: 'success' };
  } catch (error) {
    await logSync(attemptId, 'failed', String(error.message).slice(0, 1000));
    console.error(`Spreadsheet sync failed for attempt ${attemptId}:`, error);
    return { configured: true, status: 'failed' };
  }
}

async function synchronizeStudentRoster() {
  const endpoint = process.env.GOOGLE_APPS_SCRIPT_URL;
  if (!endpoint) return { configured: false, status: 'not_configured' };

  try {
    const profilesResult = await pool.query(
      `SELECT id, full_name, username, class_name, attendance_number, school_name, created_at
       FROM users WHERE role = 'student' ORDER BY LOWER(full_name)`,
    );
    const result = await pool.query(
      `SELECT attempts.id AS attempt_id, users.id AS student_id, users.full_name, users.username,
              users.class_name, users.attendance_number, users.school_name, attempts.status, attempts.submitted_at,
              grades.status AS grade_status, grades.fluency_score, grades.flexibility_score,
              grades.originality_score, grades.elaboration_score, grades.total_score,
              grades.final_score, grades.category, grades.graded_at
       FROM attempts
       JOIN users ON users.id = attempts.student_id
       LEFT JOIN grades ON grades.attempt_id = attempts.id
       WHERE attempts.status = 'submitted'
       ORDER BY users.full_name`,
    );
    const students = profilesResult.rows.map((row) => ({
       studentId: row.id,
       fullName: row.full_name,
       username: row.username,
       className: row.class_name,
       attendanceNumber: row.attendance_number,
       schoolName: row.school_name,
       registeredAt: row.created_at,
    }));
    const attempts = result.rows.map((row) => {
      const published = row.grade_status === 'published';
      return {
        studentId: row.student_id,
        attemptId: row.attempt_id,
        fullName: row.full_name,
        username: row.username,
        className: row.class_name,
        attendanceNumber: row.attendance_number,
        schoolName: row.school_name,
        status: row.status,
        submittedAt: row.submitted_at,
        gradeStatus: row.grade_status || 'not_graded',
        scores: published ? {
          fluency: row.fluency_score,
          flexibility: row.flexibility_score,
          originality: row.originality_score,
          elaboration: row.elaboration_score,
        } : null,
        totalScore: published ? row.total_score : null,
        finalScore: published ? Number(row.final_score) : null,
        category: published ? row.category : '',
        gradedAt: published ? row.graded_at : null,
      };
    });
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'syncRoster',
        token: process.env.GOOGLE_APPS_SCRIPT_TOKEN || '',
        students,
        attempts,
      }),
      signal: AbortSignal.timeout(12000),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 400)}`);
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error('Respons Apps Script bukan JSON yang valid.');
    }
    if (payload.ok !== true) throw new Error(payload.error || 'Apps Script menolak sinkronisasi rekap siswa.');
    return {
      configured: true,
      status: 'success',
      syncedCount: payload.syncedCount,
      profileCount: payload.profileCount,
    };
  } catch (error) {
    console.error('Student roster spreadsheet sync failed:', error);
    return { configured: true, status: 'failed', error: String(error.message || error).slice(0, 300) };
  }
}

async function synchronizeDeletedAttempts(attemptIds, studentIds = []) {
  const endpoint = process.env.GOOGLE_APPS_SCRIPT_URL;
  if (!endpoint || (!attemptIds.length && !studentIds.length)) {
    return { configured: Boolean(endpoint), status: endpoint ? 'not_needed' : 'not_configured' };
  }
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'deleteAttempts',
        token: process.env.GOOGLE_APPS_SCRIPT_TOKEN || '',
        attemptIds,
        studentIds,
      }),
      signal: AbortSignal.timeout(12000),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 400)}`);
    const result = JSON.parse(text);
    if (result.ok !== true) throw new Error(result.error || 'Apps Script menolak penghapusan.');
    return { configured: true, status: 'success', deletedRows: result.deletedRows };
  } catch (error) {
    console.error('Failed to remove deleted attempts from spreadsheet:', error);
    return { configured: true, status: 'failed' };
  }
}

function validateOrigin(request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== request.nextUrl.origin) fail(403, 'Asal permintaan tidak diizinkan.');
}

function mapAttemptList(row) {
  const published = row.grade_status === 'published';
  return {
    id: row.id,
    student: {
      id: row.student_id,
      fullName: row.full_name,
      username: row.username,
      className: row.class_name,
      attendanceNumber: row.attendance_number,
      schoolName: row.school_name,
    },
    status: row.status,
    startedAt: row.started_at,
    deadlineAt: row.deadline_at,
    submittedAt: row.submitted_at,
    gradeStatus: row.grade_status || 'not_graded',
    finalScore: published ? Number(row.final_score) : null,
    grade: published ? {
      scores: {
        fluency: row.fluency_score,
        flexibility: row.flexibility_score,
        originality: row.originality_score,
        elaboration: row.elaboration_score,
      },
      totalScore: row.total_score,
      finalScore: Number(row.final_score),
      category: row.category,
    } : null,
  };
}

async function teacherAttempts() {
  const result = await pool.query(
    `SELECT attempts.*, users.id AS student_id, users.full_name, users.username,
            users.class_name, users.attendance_number, users.school_name, grades.status AS grade_status,
            grades.fluency_score, grades.flexibility_score, grades.originality_score,
            grades.elaboration_score, grades.total_score, grades.final_score, grades.category
     FROM attempts JOIN users ON users.id = attempts.student_id
     LEFT JOIN grades ON grades.attempt_id = attempts.id ORDER BY attempts.created_at DESC`,
  );
  const attempts = [];
  for (const row of result.rows) {
    const current = await expireAttempt(row);
    attempts.push(mapAttemptList({ ...row, ...current }));
  }
  return attempts;
}

async function handle(request) {
  await initialize();
  const method = request.method;
  const pathname = decodeURIComponent(request.nextUrl.pathname);
  const syncAttachmentPath = pathname.match(/^\/api\/sync\/attachments\/([0-9a-f-]{36})$/i);
  if (['GET', 'HEAD'].includes(method) && syncAttachmentPath) {
    const expectedToken = process.env.GOOGLE_APPS_SCRIPT_TOKEN || '';
    const authorization = request.headers.get('authorization') || '';
    const suppliedToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    const expectedDigest = crypto.createHash('sha256').update(expectedToken).digest();
    const suppliedDigest = crypto.createHash('sha256').update(suppliedToken).digest();
    if (!expectedToken) fail(503, 'Sinkronisasi Google Apps Script belum dikonfigurasi.');
    if (!suppliedToken || !crypto.timingSafeEqual(expectedDigest, suppliedDigest)) {
      fail(403, 'Token sinkronisasi tidak valid.');
    }

    const result = await pool.query(
      `SELECT data, mime_type, size_bytes FROM attachments WHERE id = $1`,
      [syncAttachmentPath[1]],
    );
    const attachment = result.rows[0];
    if (!attachment) fail(404, 'Lampiran tidak ditemukan.');
    return new Response(method === 'HEAD' ? null : attachment.data, {
      status: 200,
      headers: {
        'Content-Type': attachment.mime_type,
        'Content-Length': String(attachment.size_bytes),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }
  const user = await userForRequest(request);
  if (!['GET', 'HEAD'].includes(method)) validateOrigin(request);

  if (method === 'POST' && pathname === '/api/register') {
    const body = await bodyJson(request);
    const fullName = requireString(body.fullName, 'Nama lengkap', 120);
    const username = requireString(body.username, 'Username', 40);
    const password = requireString(body.password, 'Kata sandi', 200);
    const confirmation = requireString(body.confirmPassword, 'Konfirmasi kata sandi', 200);
    const className = requireString(body.className, 'Kelas', 40);
    const schoolName = requireString(body.schoolName, 'Nama sekolah', 160);
    const attendanceNumber = typeof body.attendanceNumber === 'string' ? body.attendanceNumber.trim().slice(0, 20) : '';
    if (!/^[\p{L}\p{N}._-]{3,40}$/u.test(username)) {
      fail(400, 'Username 3–40 karakter: gunakan huruf, angka, titik, garis bawah, atau tanda hubung.');
    }
    if (password.length < 10) fail(400, 'Kata sandi harus terdiri dari sedikitnya 10 karakter.');
    if (password !== confirmation) fail(400, 'Kata sandi dan konfirmasi tidak sama.');
    const student = {
      id: uuid(),
      full_name: fullName,
      username,
      password_hash: await hashPassword(password),
      role: 'student',
      class_name: className,
      attendance_number: attendanceNumber || null,
      school_name: schoolName,
      must_change_password: false,
      created_at: now(),
    };
    try {
      await pool.query(
        `INSERT INTO users (id, full_name, username, password_hash, role, class_name, attendance_number, school_name, created_at)
         VALUES ($1, $2, $3, $4, 'student', $5, $6, $7, $8)`,
        [student.id, student.full_name, student.username, student.password_hash, className, attendanceNumber || null, schoolName, student.created_at],
      );
    } catch (error) {
      if (error.code === '23505') fail(409, 'Username sudah digunakan.');
      throw error;
    }
    const token = await createSession(student);
    return json({ user: cleanUser(student) }, 201, { 'Set-Cookie': cookieHeader(token) });
  }

  if (method === 'POST' && pathname === '/api/login') {
    const body = await bodyJson(request);
    const username = requireString(body.username, 'Username', 40);
    const password = requireString(body.password, 'Kata sandi', 200);
    const result = await pool.query('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [username]);
    const account = result.rows[0];
    if (!account || !(await verifyPassword(password, account.password_hash))) {
      fail(401, 'Username atau kata sandi tidak benar.');
    }
    const token = await createSession(account);
    return json({ user: cleanUser(account) }, 200, { 'Set-Cookie': cookieHeader(token) });
  }

  if (method === 'POST' && pathname === '/api/logout') {
    const token = request.cookies.get('assessment_session')?.value;
    if (token) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenDigest(token)]);
    return json({ ok: true }, 200, { 'Set-Cookie': cookieHeader('', true) });
  }

  if (method === 'GET' && pathname === '/api/me') {
    return json({ user: user ? cleanUser(user) : null, assessment });
  }

  if (method === 'PUT' && pathname === '/api/teacher/profile') {
    requireRole(user, 'teacher');
    const fullName = requireString((await bodyJson(request)).fullName, 'Nama lengkap', 120);
    await pool.query("UPDATE users SET full_name = $1 WHERE id = $2 AND role = 'teacher'", [fullName, user.id]);
    const updated = await pool.query('SELECT * FROM users WHERE id = $1', [user.id]);
    return json({ user: cleanUser(updated.rows[0]) });
  }

  if (method === 'POST' && pathname === '/api/change-password') {
    requireAuth(user);
    const body = await bodyJson(request);
    const currentPassword = requireString(body.currentPassword, 'Kata sandi saat ini', 200);
    const newPassword = requireString(body.newPassword, 'Kata sandi baru', 200);
    const confirmation = requireString(body.confirmPassword, 'Konfirmasi kata sandi', 200);
    if (!(await verifyPassword(currentPassword, user.password_hash))) fail(400, 'Kata sandi saat ini tidak benar.');
    if (newPassword.length < 10) fail(400, 'Kata sandi baru harus terdiri dari sedikitnya 10 karakter.');
    if (newPassword !== confirmation) fail(400, 'Konfirmasi kata sandi baru tidak sama.');
    await pool.query(
      'UPDATE users SET password_hash = $1, must_change_password = FALSE WHERE id = $2',
      [await hashPassword(newPassword), user.id],
    );
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [user.id]);
    const token = await createSession({ ...user, must_change_password: false });
    return json({ ok: true }, 200, { 'Set-Cookie': cookieHeader(token) });
  }

  if (method === 'GET' && pathname === '/api/student/dashboard') {
    requireRole(user, 'student');
    const result = await pool.query('SELECT * FROM attempts WHERE student_id = $1 AND assessment_id = $2', [user.id, ASSESSMENT_ID]);
    const attempt = await expireAttempt(result.rows[0]);
    const attachments = attempt ? await pool.query(
      `SELECT id, question_id, original_name, mime_type, size_bytes, created_at
       FROM attachments WHERE attempt_id = $1 ORDER BY created_at`,
      [attempt.id],
    ) : { rows: [] };
    return json({
      assessment,
      attempt: attemptPayload(attempt),
      answers: attempt ? await readAnswers(attempt.id) : [],
      attachments: attachments.rows,
      grade: attempt ? await gradeForAttempt(attempt.id) : null,
      serverNow: now().toISOString(),
    });
  }

  if (method === 'POST' && pathname === '/api/attempts/start') {
    requireRole(user, 'student');
    const existing = await pool.query('SELECT * FROM attempts WHERE student_id = $1 AND assessment_id = $2', [user.id, ASSESSMENT_ID]);
    if (existing.rowCount) {
      const current = await expireAttempt(existing.rows[0]);
      return json({ attempt: attemptPayload(current), answers: await readAnswers(current.id) });
    }
    const startedAt = now();
    const deadlineAt = new Date(startedAt.getTime() + assessment.durationMinutes * 60000);
    const id = uuid();
    try {
      await pool.query(
        `INSERT INTO attempts (id, student_id, assessment_id, started_at, deadline_at, status, created_at)
         VALUES ($1, $2, $3, $4, $5, 'in_progress', $4)`,
        [id, user.id, ASSESSMENT_ID, startedAt, deadlineAt],
      );
    } catch (error) {
      if (error.code !== '23505') throw error;
    }
    const attemptResult = await pool.query('SELECT * FROM attempts WHERE student_id = $1 AND assessment_id = $2', [user.id, ASSESSMENT_ID]);
    return json({ attempt: attemptPayload(attemptResult.rows[0]), answers: [] }, 201);
  }

  const saveAnswer = pathname.match(/^\/api\/attempts\/([^/]+)\/answers\/([^/]+)$/);
  if (method === 'PUT' && saveAnswer) {
    requireRole(user, 'student');
    const [, attemptId, questionId] = saveAnswer;
    const attempt = await attemptForStudent(attemptId, user.id);
    if (attempt.status !== 'in_progress') fail(409, 'Jawaban terkunci karena asesmen telah dikumpulkan atau waktunya habis.');
    if (!questions.some((question) => question.id === questionId)) fail(400, 'ID soal tidak valid.');
    const body = await bodyJson(request);
    if (typeof body.answerText !== 'string' || body.answerText.length > 50000) fail(400, 'Jawaban teks tidak valid atau terlalu panjang.');
    if (!body.structuredData || typeof body.structuredData !== 'object' || Array.isArray(body.structuredData)) fail(400, 'Data terstruktur tidak valid.');
    if (Buffer.byteLength(JSON.stringify(body.structuredData), 'utf8') > 100000) fail(413, 'Data terstruktur terlalu besar.');
    const timestamp = now();
    const answer = await pool.query(
      `INSERT INTO answers (id, attempt_id, question_id, answer_text, structured_data, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $6)
       ON CONFLICT (attempt_id, question_id) DO UPDATE SET
         answer_text = EXCLUDED.answer_text, structured_data = EXCLUDED.structured_data,
         updated_at = EXCLUDED.updated_at
       RETURNING created_at, updated_at`,
      [uuid(), attemptId, questionId, body.answerText, JSON.stringify(body.structuredData), timestamp],
    );
    return json({ saved: true, createdAt: answer.rows[0].created_at, updatedAt: answer.rows[0].updated_at });
  }

  const submit = pathname.match(/^\/api\/attempts\/([^/]+)\/submit$/);
  if (method === 'POST' && submit) {
    requireRole(user, 'student');
    const attempt = await attemptForStudent(submit[1], user.id);
    if (attempt.status !== 'submitted') {
      await pool.query(
        `UPDATE attempts SET status = 'submitted', submitted_at = $1
         WHERE id = $2 AND student_id = $3 AND status = 'in_progress'`,
        [now(), attempt.id, user.id],
      );
    }
    const updated = await pool.query('SELECT * FROM attempts WHERE id = $1', [attempt.id]);
    return json({
      submitted: true,
      attempt: attemptPayload(updated.rows[0]),
      sync: { configured: Boolean(process.env.GOOGLE_APPS_SCRIPT_URL), status: 'not_requested' },
    });
  }

  const upload = pathname.match(/^\/api\/attempts\/([^/]+)\/attachments$/);
  if (method === 'POST' && upload) {
    requireRole(user, 'student');
    const attempt = await attemptForStudent(upload[1], user.id);
    if (attempt.status !== 'in_progress') fail(409, 'Lampiran tidak dapat ditambahkan setelah asesmen dikumpulkan.');
    const body = await bodyJson(request);
    const questionId = requireString(body.questionId, 'ID soal', 10);
    if (!questions.some((question) => question.id === questionId)) fail(400, 'ID soal tidak valid.');
    const originalName = requireString(body.fileName, 'Nama file', 180).replace(/[\\/\u0000-\u001f]/g, '_');
    const mimeType = requireString(body.mimeType, 'Tipe file', 80);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) fail(400, 'Lampiran hanya boleh berupa gambar JPG, PNG, atau WebP.');
    if (typeof body.dataBase64 !== 'string' || body.dataBase64.length > 4_300_000) fail(400, 'Data gambar tidak valid atau melebihi batas ukuran.');
    const data = Buffer.from(body.dataBase64, 'base64');
    if (!data.length || data.length > MAX_ATTACHMENT_BYTES) fail(400, 'Ukuran gambar maksimum adalah 3 MB.');
    const signature = data.subarray(0, 12);
    const signatures = {
      'image/jpeg': signature.subarray(0, 3).toString('hex') === 'ffd8ff',
      'image/png': signature.subarray(0, 8).toString('hex') === '89504e470d0a1a0a',
      'image/webp': signature.subarray(0, 4).toString('ascii') === 'RIFF' && signature.subarray(8, 12).toString('ascii') === 'WEBP',
    };
    if (!signatures[mimeType]) fail(400, 'Isi file tidak cocok dengan tipe gambar yang dipilih.');
    const id = uuid();
    const createdAt = now();
    await pool.query(
      `INSERT INTO attachments (id, attempt_id, question_id, original_name, mime_type, size_bytes, data, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, attempt.id, questionId, originalName, mimeType, data.length, data, createdAt],
    );
    return json({
      attachment: { id, questionId, originalName, mimeType, sizeBytes: data.length, createdAt },
    }, 201);
  }

  const attachmentPath = pathname.match(/^\/api\/attachments\/([0-9a-f-]+)$/i);
  if (['GET', 'HEAD'].includes(method) && attachmentPath) {
    requireAuth(user);
    const result = await pool.query(
      `SELECT attachments.*, attempts.student_id FROM attachments
       JOIN attempts ON attempts.id = attachments.attempt_id WHERE attachments.id = $1`,
      [attachmentPath[1]],
    );
    const attachment = result.rows[0];
    if (!attachment) fail(404, 'Lampiran tidak ditemukan.');
    if (user.role !== 'teacher' && attachment.student_id !== user.id) fail(403, 'Anda tidak memiliki izin melihat lampiran ini.');
    return new Response(method === 'HEAD' ? null : attachment.data, {
      status: 200,
      headers: {
        'Content-Type': attachment.mime_type,
        'Content-Length': String(attachment.size_bytes),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': 'inline',
      },
    });
  }

  if (method === 'GET' && pathname === '/api/student/results') {
    requireRole(user, 'student');
    const result = await pool.query('SELECT * FROM attempts WHERE student_id = $1 AND assessment_id = $2', [user.id, ASSESSMENT_ID]);
    const attempt = await expireAttempt(result.rows[0]);
    if (!attempt) return json({ state: 'not_started' });
    const grade = await gradeForAttempt(attempt.id);
    if (!grade || !grade.published) return json({ state: 'waiting', submittedAt: attempt.submitted_at });
    return json({ state: 'published', attempt: attemptPayload(attempt), grade });
  }

  if (method === 'GET' && pathname === '/api/teacher/dashboard') {
    requireRole(user, 'teacher');
    const attempts = await teacherAttempts();
    const studentsResult = await pool.query(
      `SELECT id, full_name, username, class_name, attendance_number, school_name, created_at
       FROM users WHERE role = 'student' ORDER BY LOWER(full_name)`,
    );
    const students = studentsResult.rows;
    const syncLogs = await pool.query(
      `SELECT DISTINCT ON (attempt_id) attempt_id, sync_status, error_message, last_attempt_at
       FROM sync_logs ORDER BY attempt_id, last_attempt_at DESC, id DESC`,
    );
    const counts = {
      notStarted: students.filter((student) => !attempts.some((attempt) => attempt.student.id === student.id)).length,
      inProgress: attempts.filter((attempt) => attempt.status === 'in_progress').length,
      submitted: attempts.filter((attempt) => attempt.status === 'submitted').length,
      awaitingGrade: attempts.filter((attempt) => attempt.status === 'submitted' && attempt.gradeStatus !== 'published').length,
    };
    return json({
      attempts,
      students,
      counts,
      syncLogs: syncLogs.rows,
      spreadsheetConfigured: Boolean(process.env.GOOGLE_APPS_SCRIPT_URL),
    });
  }

  if (method === 'POST' && pathname === '/api/teacher/students/sync') {
    requireRole(user, 'teacher');
    return json({ sync: await synchronizeStudentRoster() });
  }

  const studentPath = pathname.match(/^\/api\/teacher\/students\/([^/]+)$/);
  if (method === 'DELETE' && studentPath) {
    requireRole(user, 'teacher');
    const studentId = studentPath[1];
    const result = await pool.query("SELECT id FROM users WHERE id = $1 AND role = 'student'", [studentId]);
    if (!result.rowCount) fail(404, 'Data siswa tidak ditemukan.');
    const attempts = await pool.query('SELECT id FROM attempts WHERE student_id = $1', [studentId]);
    const attemptIds = attempts.rows.map((row) => row.id);
    await transaction(async (client) => {
      await client.query('DELETE FROM users WHERE id = $1 AND role = $2', [studentId, 'student']);
    });
    return json({
      deleted: true,
      cleanupErrors: [],
      spreadsheetCleanup: await synchronizeDeletedAttempts(attemptIds, [studentId]),
    });
  }

  const attemptPath = pathname.match(/^\/api\/teacher\/attempts\/([^/]+)$/);
  if (method === 'DELETE' && attemptPath) {
    requireRole(user, 'teacher');
    const result = await pool.query('DELETE FROM attempts WHERE id = $1 RETURNING id', [attemptPath[1]]);
    if (!result.rowCount) fail(404, 'Hasil pengerjaan siswa tidak ditemukan.');
    return json({
      reset: true,
      cleanupErrors: [],
      spreadsheetCleanup: await synchronizeDeletedAttempts([result.rows[0].id]),
    });
  }
  if (method === 'GET' && attemptPath) {
    requireRole(user, 'teacher');
    const result = await pool.query(
      `SELECT attempts.*, users.full_name, users.username, users.class_name, users.attendance_number, users.school_name
       FROM attempts JOIN users ON users.id = attempts.student_id WHERE attempts.id = $1`,
      [attemptPath[1]],
    );
    const attempt = result.rows[0];
    if (!attempt) fail(404, 'Percobaan asesmen tidak ditemukan.');
    const answers = await readAnswers(attempt.id);
    const attachments = await pool.query(
      `SELECT id, question_id, original_name, mime_type, size_bytes, created_at
       FROM attachments WHERE attempt_id = $1 ORDER BY created_at`,
      [attempt.id],
    );
    const gradeResult = await pool.query('SELECT * FROM grades WHERE attempt_id = $1', [attempt.id]);
    const grade = gradeResult.rows[0];
    const feedback = grade ? await pool.query(
      `SELECT question_id, score, feedback_text FROM question_feedback WHERE grade_id = $1`,
      [grade.id],
    ) : { rows: [] };
    return json({
      attempt: {
        ...attemptPayload(attempt),
        student: {
          id: attempt.student_id,
          fullName: attempt.full_name,
          username: attempt.username,
          className: attempt.class_name,
          attendanceNumber: attempt.attendance_number,
          schoolName: attempt.school_name,
        },
      },
      answers,
      attachments: attachments.rows,
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
        questionFeedback: feedback.rows,
      } : null,
      questions,
    });
  }

  const gradePath = pathname.match(/^\/api\/teacher\/attempts\/([^/]+)\/grade$/);
  if (method === 'PUT' && gradePath) {
    requireRole(user, 'teacher');
    const result = await pool.query('SELECT * FROM attempts WHERE id = $1', [gradePath[1]]);
    const attempt = result.rows[0];
    if (!attempt) fail(404, 'Percobaan asesmen tidak ditemukan.');
    if (attempt.status !== 'submitted') fail(409, 'Penilaian hanya dapat dilakukan setelah siswa mengumpulkan asesmen.');
    const body = await bodyJson(request);
    if (!body.scores || typeof body.scores !== 'object') fail(400, 'Skor setiap indikator wajib diisi.');
    let summary;
    try {
      summary = scoreSummary(body.scores);
    } catch (error) {
      fail(400, error.message);
    }
    const generalFeedback = typeof body.generalFeedback === 'string' ? body.generalFeedback.trim().slice(0, 5000) : '';
    const feedbackInput = Array.isArray(body.questionFeedback) ? body.questionFeedback : [];
    const feedbackByQuestion = new Map();
    for (const item of feedbackInput) {
      if (!item || !questions.some((question) => question.id === item.questionId)) fail(400, 'ID soal pada umpan balik tidak valid.');
      if (!Number.isInteger(item.score) || item.score < 0 || item.score > 4) fail(400, 'Skor umpan balik soal harus berupa bilangan bulat 0–4.');
      if (feedbackByQuestion.has(item.questionId)) fail(400, 'Terdapat umpan balik ganda untuk satu soal.');
      feedbackByQuestion.set(item.questionId, {
        score: item.score,
        feedbackText: typeof item.feedbackText === 'string' ? item.feedbackText.trim().slice(0, 5000) : '',
      });
    }
    if (feedbackByQuestion.size !== questions.length) fail(400, 'Skor dan umpan balik keempat soal wajib diisi.');
    const publish = body.publish === true;
    const existingGrade = await pool.query('SELECT id, status FROM grades WHERE attempt_id = $1', [attempt.id]);
    if (existingGrade.rows[0]?.status === 'published' && !publish) {
      fail(409, 'Penilaian yang sudah dipublikasikan hanya dapat diperbarui dengan menyimpan dan memublikasikannya kembali.');
    }
    const gradedAt = publish ? now() : null;
    await transaction(async (client) => {
      const saved = await client.query(
        `INSERT INTO grades
         (id, attempt_id, fluency_score, flexibility_score, originality_score, elaboration_score,
          total_score, final_score, category, general_feedback, graded_by, graded_at, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (attempt_id) DO UPDATE SET
          fluency_score = EXCLUDED.fluency_score,
          flexibility_score = EXCLUDED.flexibility_score,
          originality_score = EXCLUDED.originality_score,
          elaboration_score = EXCLUDED.elaboration_score,
          total_score = EXCLUDED.total_score,
          final_score = EXCLUDED.final_score,
          category = EXCLUDED.category,
          general_feedback = EXCLUDED.general_feedback,
          graded_by = EXCLUDED.graded_by,
          graded_at = EXCLUDED.graded_at,
          status = EXCLUDED.status
         RETURNING id`,
        [uuid(), attempt.id, summary.fluency, summary.flexibility, summary.originality, summary.elaboration,
          summary.total, summary.finalScore, summary.category, generalFeedback, user.id, gradedAt, publish ? 'published' : 'draft'],
      );
      const gradeId = saved.rows[0].id;
      await client.query('DELETE FROM question_feedback WHERE grade_id = $1', [gradeId]);
      for (const [questionId, item] of feedbackByQuestion) {
        await client.query(
          `INSERT INTO question_feedback (id, grade_id, question_id, score, feedback_text)
           VALUES ($1, $2, $3, $4, $5)`,
          [uuid(), gradeId, questionId, item.score, item.feedbackText],
        );
      }
    });
    const sync = { configured: Boolean(process.env.GOOGLE_APPS_SCRIPT_URL), status: 'not_requested' };
    return json({ saved: true, published: publish, grade: { ...summary, status: publish ? 'published' : 'draft', gradedAt }, sync });
  }

  const syncPath = pathname.match(/^\/api\/teacher\/attempts\/([^/]+)\/sync$/);
  if (method === 'POST' && syncPath) {
    requireRole(user, 'teacher');
    const result = await pool.query('SELECT id FROM attempts WHERE id = $1', [syncPath[1]]);
    if (!result.rowCount) fail(404, 'Percobaan asesmen tidak ditemukan.');
    return json({ sync: await synchronizeAttempt(result.rows[0].id) });
  }

  const resetPassword = pathname.match(/^\/api\/teacher\/students\/([^/]+)\/reset-password$/);
  if (method === 'POST' && resetPassword) {
    requireRole(user, 'teacher');
    const student = await pool.query("SELECT id FROM users WHERE id = $1 AND role = 'student'", [resetPassword[1]]);
    if (!student.rowCount) fail(404, 'Akun siswa tidak ditemukan.');
    const temporaryPassword = crypto.randomBytes(12).toString('base64url');
    await pool.query(
      'UPDATE users SET password_hash = $1, must_change_password = TRUE WHERE id = $2',
      [await hashPassword(temporaryPassword), student.rows[0].id],
    );
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [student.rows[0].id]);
    return json({ temporaryPassword });
  }

  fail(404, 'Endpoint tidak ditemukan.');
}

async function route(request) {
  try {
    return await handle(request);
  } catch (error) {
    const status = Number.isInteger(error.status) ? error.status : 500;
    if (status >= 500) console.error('API route failed:', error);
    return json({ error: status >= 500 ? 'Terjadi kesalahan server. Silakan coba kembali.' : error.message }, status);
  }
}

export const GET = route;
export const HEAD = route;
export const POST = route;
export const PUT = route;
export const DELETE = route;
