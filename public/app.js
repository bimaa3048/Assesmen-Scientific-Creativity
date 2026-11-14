'use strict';

const root = document.getElementById('app');
const app = {
  user: null,
  assessment: null,
  page: 'dashboard',
  dashboard: null,
  results: null,
  activeQuestion: 'q1',
  answers: {},
  attachments: [],
  dirty: new Set(),
  versions: new Map(),
  timers: new Map(),
  saving: new Map(),
  savedAt: new Map(),
  online: navigator.onLine,
  teacherData: null,
  teacherAttempt: null,
  teacherDetail: null,
  message: '',
  busy: false,
  serverTimeOffset: 0,
  serverAvailable: true,
};

const indicators = [
  { key: 'fluency', label: 'Fluency · Kelancaran' },
  { key: 'flexibility', label: 'Flexibility · Keluwesan' },
  { key: 'originality', label: 'Originality · Keaslian' },
  { key: 'elaboration', label: 'Elaboration · Elaborasi' },
];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function displayDuration(startedAt, submittedAt) {
  if (!startedAt) return '—';
  const minutes = Math.max(0, Math.round((Date.parse(submittedAt || new Date()) - Date.parse(startedAt)) / 60_000));
  return `${minutes} menit`;
}

async function api(url, options = {}) {
  let response;
  try {
    response = await fetch(url, {
      credentials: 'same-origin',
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    });
    app.serverAvailable = true;
  } catch (error) {
    app.serverAvailable = false;
    if (!navigator.onLine) throw new Error('Koneksi internet terputus. Periksa jaringan lalu coba lagi.');
    throw new Error('Server asesmen tidak merespons. Pastikan aplikasi server sedang berjalan, lalu coba lagi.');
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('Respons server tidak dapat dibaca.');
  }
  if (!response.ok) throw new Error(data.error || `Permintaan gagal (${response.status}).`);
  return data;
}

function toast(message, kind = '') {
  const region = document.getElementById('toast-region');
  const item = document.createElement('div');
  item.className = `toast ${kind}`;
  item.textContent = message;
  region.append(item);
  setTimeout(() => item.remove(), 4200);
}

function setFormError(form, message) {
  const node = form.querySelector('.form-error');
  if (node) {
    node.textContent = message;
    node.hidden = !message;
  }
}

function renderAuth(mode = 'login', error = '') {
  const register = mode === 'register';
  root.innerHTML = `
    <div class="auth-layout">
      <section class="auth-story">
        <div class="brand"><span class="brand-mark">ϟ</span><span>Creative Thinking Skills</span></div>
        <div class="story-copy">
          <span class="eyebrow">Fisika · Eksplorasi · Kreativitas</span>
          <h1>Ide besar dimulai dari rasa ingin tahu.</h1>
          <p>Jelajahi rangkaian listrik dengan simulasi PhET. Rancang, ukur, dan ceritakan cara berpikirmu.</p>
        </div>
        <div class="story-facts"><span>◷ &nbsp;60 menit</span><span>⚡ &nbsp;4 indikator kreativitas</span><span>⌁ &nbsp;Berbasis PhET</span></div>
      </section>
      <section class="auth-panel">
        <form class="auth-form" id="auth-form" data-mode="${register ? 'register' : 'login'}">
          <span class="eyebrow">${register ? 'Mulai perjalananmu' : 'Selamat datang kembali'}</span>
          <h2>${register ? 'Buat akun siswa' : 'Masuk ke ruang belajar'}</h2>
          <p class="lead">${register ? 'Daftar dengan identitas kelas untuk memulai asesmen.' : 'Masuk untuk melanjutkan eksplorasi rangkaian listrik.'}</p>
          <div class="form-error" ${error ? '' : 'hidden'}>${escapeHtml(error)}</div>
          ${register ? `
            <div class="field"><label for="fullName">Nama lengkap</label><input id="fullName" name="fullName" autocomplete="name" required maxlength="120" placeholder="Nama sesuai daftar kelas"></div>
            <div class="field"><label for="schoolName">Nama sekolah</label><input id="schoolName" name="schoolName" autocomplete="organization" required maxlength="160" placeholder="Nama sekolah"></div>
            <div class="form-grid">
              <div class="field"><label for="className">Kelas</label><input id="className" name="className" required maxlength="40" placeholder="Contoh: XI IPA 1"></div>
              <div class="field"><label for="attendanceNumber">Nomor absen <span class="field-hint">(opsional)</span></label><input id="attendanceNumber" name="attendanceNumber" maxlength="20" placeholder="—"></div>
            </div>
          ` : ''}
          <div class="field"><label for="username">Username</label><input id="username" name="username" autocomplete="username" required maxlength="40" placeholder="Masukkan username"></div>
          <div class="field"><label for="password">Kata sandi</label><input id="password" name="password" type="password" autocomplete="${register ? 'new-password' : 'current-password'}" required maxlength="200" placeholder="${register ? 'Minimal 10 karakter' : 'Masukkan kata sandi'}"></div>
          ${register ? '<div class="field"><label for="confirmPassword">Konfirmasi kata sandi</label><input id="confirmPassword" name="confirmPassword" type="password" autocomplete="new-password" required maxlength="200" placeholder="Ulangi kata sandi"></div>' : ''}
          <button class="button block" type="submit">${register ? 'Buat akun siswa' : 'Masuk'} <span>→</span></button>
          <p class="auth-switch">${register ? 'Sudah punya akun?' : 'Belum punya akun siswa?'} <button class="text-button" type="button" data-action="auth-switch" data-mode="${register ? 'login' : 'register'}">${register ? 'Masuk' : 'Daftar di sini'}</button></p>
          ${register ? '' : '<p class="field-hint" style="text-align:center">Guru: masuk dengan akun yang diberikan sekolah (username awal: Bimaaditya). Siswa baru: buat akun melalui Daftar.</p>'}
        </form>
      </section>
    </div>`;
  root.querySelector('#auth-form').addEventListener('submit', handleAuthSubmit);
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = 'Memproses…';
  setFormError(form, '');
  const values = Object.fromEntries(new FormData(form).entries());
  const mode = form.dataset.mode;
  try {
    const result = await api(mode === 'register' ? '/api/register' : '/api/login', {
      method: 'POST',
      body: JSON.stringify(values),
    });
    app.user = result.user;
    if (app.user.role === 'student') await refreshStudentDashboard();
    else await refreshTeacherDashboard();
    render();
  } catch (error) {
    setFormError(form, error.message);
    button.disabled = false;
    button.textContent = mode === 'register' ? 'Buat akun siswa →' : 'Masuk →';
  }
}

function navigationItems() {
  return app.user.role === 'teacher'
    ? [
      { id: 'dashboard', label: 'Ringkasan', icon: '⌂' },
      { id: 'students', label: 'Daftar siswa', icon: '♧' },
      { id: 'profile', label: 'Profil', icon: '◉' },
    ]
    : [
      { id: 'dashboard', label: 'Dashboard', icon: '⌂' },
      { id: 'assessment', label: 'Asesmen', icon: '✎' },
      { id: 'results', label: 'Hasil nilai', icon: '▤' },
      { id: 'profile', label: 'Profil', icon: '◉' },
    ];
}

function renderShell(content) {
  const items = navigationItems();
  const existingSimulation = root.querySelector('#phet-simulation');
  if (existingSimulation) existingSimulation.remove();
  root.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand"><span class="brand-mark">ϟ</span><span>Creative Thinking Skills</span></div>
        <div class="nav-caption">Menu utama</div>
        <nav class="nav-list" aria-label="Navigasi utama">
          ${items.map((item) => `<button class="nav-item ${app.page === item.id || (app.page === 'teacher-attempt' && item.id === 'students') ? 'active' : ''}" type="button" data-action="navigate" data-page="${item.id}"><span class="nav-icon">${item.icon}</span><span>${item.label}</span></button>`).join('')}
          <button class="nav-item mobile-logout" type="button" data-action="logout"><span class="nav-icon">↪</span><span>Keluar</span></button>
        </nav>
        <div class="sidebar-bottom">
          <div class="user-chip"><span class="avatar">${escapeHtml(initials(app.user.fullName))}</span><div><strong>${escapeHtml(app.user.fullName)}</strong><span>${app.user.role === 'teacher' ? 'Guru/admin' : `Siswa · ${escapeHtml(app.user.className || '')}`}</span></div></div>
          <button class="nav-item" type="button" data-action="logout"><span class="nav-icon">↪</span><span>Keluar</span></button>
        </div>
      </aside>
      <div class="main-column">
        <header class="topbar">
          <div class="breadcrumb"><span class="online-dot ${app.serverAvailable && navigator.onLine ? '' : 'offline'}"></span> ${!navigator.onLine ? 'Koneksi terputus' : app.serverAvailable ? 'Server aktif' : 'Server tidak merespons'}</div>
          <div class="top-actions"><span class="top-note">Creative Thinking Skills · Fisika</span><span class="avatar">${escapeHtml(initials(app.user.fullName))}</span></div>
        </header>
        <main class="main-content">${content}</main>
      </div>
    </div>`;
  const simulationContainer = root.querySelector('[data-phet-container]');
  if (simulationContainer && existingSimulation) {
    simulationContainer.querySelector('#phet-simulation')?.replaceWith(existingSimulation);
  }
  if (app.page === 'assessment' && app.dashboard?.attempt?.status === 'in_progress') startTimer();
}

function pageHeading(eyebrow, title, description, trailing = '') {
  return `<div class="page-heading"><div><span class="eyebrow">${escapeHtml(eyebrow)}</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></div>${trailing}</div>`;
}

function hasAnswerContent(values = {}) {
  const primary = Object.entries(values).some(([key, value]) => key !== 'answerConfigurations' && typeof value === 'string' && value.trim());
  const additional = (Array.isArray(values.answerConfigurations) ? values.answerConfigurations : []).some((configuration) =>
    Object.values(configuration).some((value) => typeof value === 'string' && value.trim()));
  return primary || additional;
}

function progressValue() {
  const total = app.assessment?.questions?.length || 4;
  const answered = Object.values(app.answers).filter((answer) => hasAnswerContent(answer.structuredData)).length;
  return { answered, total, percent: Math.round(answered / total * 100) };
}

function statusBadge(status, gradeStatus) {
  if (!status) return '<span class="badge gray">Belum mulai</span>';
  if (status === 'in_progress') return '<span class="badge amber">Sedang mengerjakan</span>';
  if (gradeStatus === 'published') return '<span class="badge green">Selesai dinilai</span>';
  return '<span class="badge gray">Menunggu penilaian</span>';
}

function studentDashboardView() {
  const data = app.dashboard;
  const attempt = data.attempt;
  const progress = progressValue();
  const status = attempt?.status === 'in_progress' ? 'Sedang dikerjakan' : attempt?.status === 'submitted' ? 'Sudah dikumpulkan' : 'Belum dimulai';
  const action = attempt?.status === 'in_progress'
    ? '<button class="button" data-action="navigate" data-page="assessment">Lanjutkan asesmen →</button>'
    : attempt?.status === 'submitted'
      ? '<button class="button" data-action="navigate" data-page="results">Lihat status asesmen →</button>'
      : '<button class="button" data-action="navigate" data-page="assessment">Lihat asesmen →</button>';
  return `${pageHeading('Dashboard siswa', `Halo, ${app.user.fullName.split(' ')[0]}`, 'Selamat datang kembali. Siapkan rasa ingin tahu dan mulailah bereksperimen.')}
    ${app.user.mustChangePassword ? '<div class="banner-warning">Untuk keamanan akun, segera ganti kata sandi awal di menu Profil.</div>' : ''}
    <section class="welcome-card">
      <div class="welcome-copy"><span class="eyebrow">Asesmen Fisika · 60 menit</span><h2>Rangkaian listrik, banyak cara berpikir.</h2><p>Uji kreativitas ilmiahmu melalui empat tantangan rangkaian seri, paralel, dan campuran berbantuan PhET.</p></div>
      <div class="welcome-action">${action}</div>
    </section>
    <div class="stats-grid">
      <article class="card stat-card"><div class="stat-label">Status asesmen</div><div class="stat-value" style="font-size:18px">${escapeHtml(status)}</div><div class="stat-foot">${attempt?.submittedAt ? `Dikumpulkan ${formatDate(attempt.submittedAt)}` : 'Progres tersimpan otomatis'}</div></article>
      <article class="card stat-card"><div class="stat-label">Progres jawaban</div><div class="stat-value">${progress.answered}<span style="color:#9bacac;font-size:15px"> / ${progress.total}</span></div><div class="stat-foot">Indikator dengan jawaban terisi</div></article>
      <article class="card stat-card"><div class="stat-label">Waktu pengerjaan</div><div class="stat-value">60<span style="font-size:14px;color:#819294"> menit</span></div><div class="stat-foot">${attempt ? `Dimulai ${formatDate(attempt.startedAt)}` : 'Dimulai saat menekan Mulai Asesmen'}</div></article>
      <article class="card stat-card"><div class="stat-label">Status penilaian</div><div class="stat-value" style="font-size:18px">${data.grade?.published ? 'Selesai' : 'Menunggu'}</div><div class="stat-foot">${data.grade?.published ? `Nilai ${data.grade.finalScore}/100` : 'Nilai dibuka setelah guru selesai menilai'}</div></article>
    </div>
    <div class="dashboard-grid">
      <section class="card section-card">
        <div class="section-title"><div><h2>Perjalanan asesmen</h2><p>Jawaban dipulihkan dari penyimpanan server.</p></div>${statusBadge(attempt?.status, data.grade?.status)}</div>
        <div class="progress-line"><span style="width:${progress.percent}%"></span></div>
        <div class="progress-copy"><span>${progress.answered} dari ${progress.total} soal terisi</span><span>${progress.percent}%</span></div>
        <div class="info-row"><span class="info-icon">✎</span><div><strong>Empat indikator kreativitas ilmiah</strong><p>Fluency, Flexibility, Originality, dan Elaboration; masing-masing dinilai 0–4.</p></div></div>
        <div class="info-row"><span class="info-icon">⌁</span><div><strong>Simulasi PhET Circuit Construction Kit: DC</strong><p>Buka simulasi resmi di tab baru, lalu tuliskan data hasil pengukuran pada jawaban.</p></div></div>
      </section>
      <section class="card section-card">
        <div class="section-title"><div><h2>Informasi asesmen</h2><p>Yang perlu kamu siapkan.</p></div></div>
        <div class="info-row"><span class="info-icon">◷</span><div><strong>Durasi 60 menit</strong><p>Waktu dihitung sejak asesmen dimulai dan tidak berubah saat halaman dimuat ulang.</p></div></div>
        <div class="info-row"><span class="info-icon">⇧</span><div><strong>Simpan otomatis</strong><p>Jawaban dikirim ke server saat kamu mengetik. Lanjutkan di perangkat lain dengan akun yang sama.</p></div></div>
        <div class="info-row"><span class="info-icon">✓</span><div><strong>Nilai setelah penilaian</strong><p>Guru memberi skor dan umpan balik sebelum hasil ditampilkan di dashboard.</p></div></div>
      </section>
    </div>
    <section class="card sim-card"><div><strong>Siap bereksperimen?</strong><p>Simulasi dapat dibuka tanpa meninggalkan jawabanmu.</p></div><a class="button secondary small" href="${escapeHtml(data.assessment.simulationUrl)}" target="_blank" rel="noopener noreferrer">Buka simulasi PhET ↗</a></section>`;
}

function questionAnswer(questionId) {
  if (!app.answers[questionId]) app.answers[questionId] = { answerText: '', structuredData: {} };
  return app.answers[questionId];
}

function answerStatus(questionId) {
  if (app.dirty.has(questionId)) {
    return `<span class="save-state ${app.online ? '' : 'failed'}" id="save-state-${questionId}">${app.online ? '◷ Belum tersimpan' : '⚠ Offline — belum tersimpan'}</span>`;
  }
  const saved = app.savedAt.get(questionId);
  if (saved) return `<span class="save-state saved" id="save-state-${questionId}">✓ Tersimpan ${formatDate(saved)}</span>`;
  return `<span class="save-state" id="save-state-${questionId}">Belum ada perubahan</span>`;
}

function attachmentsForQuestion(questionId) {
  return app.attachments.filter((attachment) => attachment.question_id === questionId);
}

function parseElaborationPoints(table) {
  return String(table || '').split(/\r?\n/).flatMap((line) => {
    const separator = line.includes('|') ? '|' : line.includes('\t') ? '\t' : line.includes(';') ? ';' : null;
    if (!separator) return [];
    const cells = line.split(separator);
    if (cells.length < 2) return [];
    const numberFromCell = (cell) => {
      const match = cell.match(/[-+]?\d+(?:[.,]\d+)?/);
      return match ? Number(match[0].replace(',', '.')) : NaN;
    };
    const lampCount = numberFromCell(cells[0]);
    let current = numberFromCell(cells[1]);
    if (!Number.isInteger(lampCount) || lampCount < 1 || lampCount > 5 || !Number.isFinite(current) || current < 0) return [];
    if (/\bmA\b/i.test(cells[1])) current /= 1000;
    return [{ lampCount, current }];
  }).sort((left, right) => left.lampCount - right.lampCount);
}

function elaborationGraphMarkup(table, id = 'elaboration-graph') {
  const points = parseElaborationPoints(table);
  const plot = { left: 60, right: 610, top: 24, bottom: 230 };
  const maxCurrent = points.length ? Math.max(...points.map((point) => point.current)) : 0;
  const maxY = maxCurrent > 0 ? maxCurrent * 1.15 : 1;
  const y = (current) => plot.bottom - current / maxY * (plot.bottom - plot.top);
  const x = (lampCount) => plot.left + (lampCount - 1) / 4 * (plot.right - plot.left);
  const ticks = Array.from({ length: 5 }, (_, index) => {
    const value = maxY * index / 4;
    const position = y(value);
    return `<line class="graph-grid-line" x1="${plot.left}" y1="${position}" x2="${plot.right}" y2="${position}"></line><text class="graph-tick-label" x="${plot.left - 9}" y="${position + 4}" text-anchor="end">${Number(value.toPrecision(3))}</text>`;
  }).join('');
  const polyline = points.map((point) => `${x(point.lampCount)},${y(point.current)}`).join(' ');
  const marks = points.map((point) => `<circle class="graph-point" cx="${x(point.lampCount)}" cy="${y(point.current)}" r="5"><title>${point.lampCount} lampu seri: ${point.current} A</title></circle><text class="graph-point-label" x="${x(point.lampCount)}" y="${y(point.current) - 9}" text-anchor="middle">${point.current}</text>`).join('');
  const xTicks = [1, 2, 3, 4, 5].map((lampCount) => `<line class="graph-axis-tick" x1="${x(lampCount)}" y1="${plot.bottom}" x2="${x(lampCount)}" y2="${plot.bottom + 5}"></line><text class="graph-tick-label" x="${x(lampCount)}" y="${plot.bottom + 20}" text-anchor="middle">${lampCount}</text>`).join('');
  const graphic = points.length
    ? `<polyline class="graph-line" points="${polyline}"></polyline>${marks}`
    : `<text class="graph-empty-message" x="335" y="128" text-anchor="middle">Masukkan data tabel dengan pemisah |, tab, atau ;</text>`;
  return `<div class="elaboration-graph" id="${id}" role="img" aria-label="${points.length ? `Grafik otomatis arus total terhadap jumlah lampu dari ${points.length} titik data` : 'Grafik otomatis menunggu data ukur pada tabel'}">
    <div class="elaboration-graph-heading"><strong>Grafik otomatis: jumlah lampu seri vs arus total</strong><span>${points.length} titik data</span></div>
    <svg viewBox="0 0 660 290" aria-hidden="true">
      ${ticks}<line class="graph-axis-line" x1="${plot.left}" y1="${plot.top}" x2="${plot.left}" y2="${plot.bottom}"></line><line class="graph-axis-line" x1="${plot.left}" y1="${plot.bottom}" x2="${plot.right}" y2="${plot.bottom}"></line>
      ${xTicks}${graphic}
      <text class="graph-axis-label" x="335" y="278" text-anchor="middle">Jumlah lampu seri</text>
      <text class="graph-axis-label" transform="translate(17 128) rotate(-90)" text-anchor="middle">Arus total (A)</text>
    </svg>
    <p class="field-hint">Grafik hanya memplot data yang diisi pada kolom tabel; data tidak dibuat otomatis.</p>
  </div>`;
}

function attachmentMarkup(questionId) {
  const attachments = attachmentsForQuestion(questionId);
  return `<div class="file-upload">
    <label for="upload-${questionId}">Tambah konfigurasi rangkaian dari PhET (JPG, PNG, WebP · maks. 3 MB per gambar)</label>
    <p class="field-hint">Unggah satu atau beberapa screenshot rangkaian untuk soal ini. Konfigurasi tersimpan saat kamu berpindah soal.</p>
    <input type="file" id="upload-${questionId}" data-upload-question="${questionId}" accept="image/jpeg,image/png,image/webp" multiple ${app.dashboard.attempt.status !== 'in_progress' ? 'disabled' : ''}>
    <div class="attachment-list">${attachments.map((attachment) => `<a class="attachment-link" href="/api/attachments/${encodeURIComponent(attachment.id)}" target="_blank" rel="noopener noreferrer">${escapeHtml(attachment.original_name)} ↗</a>`).join('')}</div>
  </div>`;
}

function simulationEmbedMarkup() {
  return `<section class="phet-card" aria-label="Simulasi PhET">
    <div class="phet-card-heading"><div><strong>Simulasi PhET Circuit Construction Kit: DC</strong><p>Pilih Intro Screen atau Lab Screen untuk mulai merakit rangkaian.</p></div>
      <a class="button secondary small" href="${escapeHtml(app.assessment.simulationUrl)}" target="_blank" rel="noopener noreferrer">Buka layar penuh ↗</a>
    </div>
    <div class="phet-frame-wrap" data-phet-container>
      <iframe id="phet-simulation" class="phet-embed-frame" src="${escapeHtml(app.assessment.simulationEmbedUrl)}" title="Simulasi interaktif PhET Circuit Construction Kit: DC" loading="eager" allow="fullscreen" referrerpolicy="strict-origin-when-cross-origin"></iframe>
    </div>
    <div class="phet-card-foot">Simulasi berjalan dari PhET resmi. Perubahan rangkaian di dalam simulasi tidak dibaca otomatis oleh asesmen—catat hasil pengukuran pada jawabanmu.</div>
  </section>`;
}

function questionNavMarkup() {
  return `<aside class="card question-nav"><h3>Empat tantangan</h3>${app.assessment.questions.map((question, index) => {
    const values = questionAnswer(question.id).structuredData;
    const done = hasAnswerContent(values);
    return `<button class="question-nav-button ${app.activeQuestion === question.id ? 'active' : ''} ${done ? 'done' : ''}" data-action="question" data-question="${question.id}" type="button"><span class="question-number">${done ? '✓' : `0${index + 1}`}</span><span><strong>${escapeHtml(question.indicator.split(' ')[0])}</strong><small>${escapeHtml(question.title)}</small></span></button>`;
  }).join('')}</aside>`;
}

function questionPanelMarkup(question, index) {
  const data = questionAnswer(question.id).structuredData;
  const editable = app.dashboard.attempt.status === 'in_progress';
  const renderFields = (values, configurationIndex = '') => question.fields.map((field) => {
    const suffix = configurationIndex === '' ? '' : `-configuration-${configurationIndex}`;
    const className = field.type === 'textarea' && ['measurements', 'uniqueness', 'conclusion'].includes(field.key) ? 'short' : '';
    const placeholder = question.id === 'q4' && field.key === 'dataTable'
      ? 'Jumlah lampu | Arus total (A) | Tegangan satu lampu (V)'
      : 'Tuliskan hasil pengamatan, persamaan, sketsa teks, dan penalaranmu…';
    const graph = question.id === 'q4' && field.key === 'dataTable'
      ? elaborationGraphMarkup(values.dataTable, `graph-q4-${configurationIndex === '' ? 'main' : configurationIndex}`)
      : '';
    return `<div class="answer-field">
      <label for="answer-${question.id}-${field.key}${suffix}">${escapeHtml(field.label)}</label>
      ${question.id === 'q4' && field.key === 'dataTable' ? '<p class="field-hint">Masukkan satu hasil ukur per baris. Pisahkan kolom dengan tanda |, tab, atau titik koma. Grafik mengikuti kolom jumlah lampu dan arus; gunakan data hasil ukur PhET, bukan angka contoh.</p>' : ''}
      <textarea id="answer-${question.id}-${field.key}${suffix}" class="${className}" data-answer-question="${question.id}" data-answer-field="${field.key}" ${configurationIndex === '' ? '' : `data-answer-configuration="${configurationIndex}"`} maxlength="20000" placeholder="${placeholder}" ${editable ? '' : 'readonly'}>${escapeHtml(values[field.key] || '')}</textarea>
      ${graph}
    </div>`;
  }).join('');
  const fields = `<section class="answer-configuration"><h3>Konfigurasi jawaban 1</h3>${renderFields(data)}</section>
    ${(Array.isArray(data.answerConfigurations) ? data.answerConfigurations : []).map((configuration, configurationIndex) => `<section class="answer-configuration"><h3>Konfigurasi jawaban ${configurationIndex + 2}</h3>${renderFields(configuration, configurationIndex)}</section>`).join('')}
    ${editable ? `<button class="button secondary small add-answer-configuration" type="button" data-action="add-answer-configuration" data-question="${question.id}">＋ Tambah konfigurasi jawaban</button>` : ''}`;
  const prev = app.assessment.questions[index - 1];
  const next = app.assessment.questions[index + 1];
  return `<section class="card question-panel">
    <div class="question-topline">
      <div><span class="eyebrow">Soal ${index + 1} dari 4 · ${escapeHtml(question.indicator)}</span><h2>${escapeHtml(question.title)}</h2></div>
      <div>${answerStatus(question.id)}</div>
    </div>
    <div class="question-prompt">${escapeHtml(question.prompt)}</div>
    ${simulationEmbedMarkup()}
    ${fields}
    ${attachmentMarkup(question.id)}
    <div class="question-actions">
      <button class="button secondary small" data-action="question" data-question="${prev ? prev.id : question.id}" type="button" ${prev ? '' : 'disabled'}>← Soal sebelumnya</button>
      <div class="question-actions-right">
        ${editable ? `<button class="button ghost small" data-action="save-now" data-question="${question.id}" type="button">Simpan sekarang</button>` : ''}
        <button class="button small" data-action="question" data-question="${next ? next.id : question.id}" type="button" ${next ? '' : 'disabled'}>${next ? 'Soal berikutnya →' : 'Soal terakhir ✓'}</button>
      </div>
    </div>
  </section>`;
}

function formatTimer(milliseconds) {
  const total = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function assessmentView() {
  const attempt = app.dashboard.attempt;
  if (!attempt) {
    return `${pageHeading('Asesmen individu', 'Creative Thinking Skills · Rangkaian listrik', 'Empat soal uraian dan kinerja berbantuan PhET Circuit Construction Kit: DC. Alokasi waktu 60 menit.')}
      <section class="card empty-state"><div class="empty-illustration">ϟ</div><h2>Mulai saat kamu siap</h2><p>Timer 60 menit dimulai saat tombol ditekan. Jawaban akan tersimpan otomatis ke server setelah setiap perubahan.</p>
      <p><strong>Pastikan kamu memiliki koneksi internet</strong> sebelum memulai asesmen.</p>
      <button class="button" data-action="start-assessment" type="button">Mulai asesmen · 60 menit →</button></section>
      ${simulationEmbedMarkup()}`;
  }
  if (attempt.status === 'submitted') {
    return `${pageHeading('Asesmen individu', 'Jawaban sudah dikumpulkan', 'Pengerjaan terkunci. Status nilai dan umpan balik tersedia pada menu Hasil Nilai.')}
      <section class="card empty-state"><div class="empty-illustration">✓</div><h2>Terima kasih sudah bereksperimen!</h2><p>Jawaban yang terakhir dikonfirmasi oleh server telah dikumpulkan pada ${escapeHtml(formatDate(attempt.submittedAt))}. Kamu tidak dapat mengubahnya lagi.</p><button class="button" data-action="navigate" data-page="results">Lihat status penilaian →</button></section>`;
  }
  const question = app.assessment.questions.find((item) => item.id === app.activeQuestion) || app.assessment.questions[0];
  const index = app.assessment.questions.indexOf(question);
  const progress = progressValue();
  return `${pageHeading('Asesmen sedang berlangsung', 'Eksplorasi rangkaian listrik', 'Tuliskan jawaban dan hasil pengukuran. Progres disimpan otomatis ke server.', `<div class="timer-card"><span>◷</span><div><strong id="assessment-timer">--:--</strong><span>SISA WAKTU</span></div></div>`)}
    ${!app.online ? '<div class="banner-warning">Koneksi terputus. Perubahan belum tersimpan di server. Sambungkan kembali untuk mengirim ulang jawaban.</div>' : ''}
    <div class="assessment-layout">
      ${questionNavMarkup()}
      <div>${questionPanelMarkup(question, index)}
        <section class="card section-card" style="margin-top:13px">
          <div class="section-title"><div><h2>Ringkasan pengumpulan</h2><p>Pastikan empat soal selesai sebelum mengumpulkan.</p></div><span class="badge ${progress.answered === 4 ? 'green' : 'amber'}">${progress.answered}/4 soal terisi</span></div>
          <div class="progress-line"><span style="width:${progress.percent}%"></span></div>
          <div class="submission-warning">Setelah dikumpulkan, jawaban terkunci dan tidak dapat diubah. Sistem hanya mengumpulkan jawaban yang telah dikonfirmasi tersimpan oleh server.</div>
          <button class="button danger" data-action="review-submit" type="button">Periksa jawaban & kumpulkan →</button>
        </section>
      </div>
    </div>
    <div class="phet-assessment-note">Gunakan simulasi PhET di atas untuk menguji rangkaian. Ingat, angka/data ukur perlu kamu masukkan sendiri ke jawaban.</div>`;
}

function submitReviewView() {
  const answers = app.answers;
  const rows = app.assessment.questions.map((question, index) => {
    const values = answers[question.id]?.structuredData || {};
    const additionalConfigurations = Array.isArray(values.answerConfigurations) ? values.answerConfigurations : [];
    const filled = Object.entries(values).filter(([key, value]) => key !== 'answerConfigurations' && typeof value === 'string' && value.trim()).length
      + additionalConfigurations.reduce((count, configuration) => count + Object.values(configuration).filter((value) => typeof value === 'string' && value.trim()).length, 0);
    const configurations = 1 + additionalConfigurations.length;
    const attached = attachmentsForQuestion(question.id).length;
    return `<div class="summary-row"><strong>Soal ${index + 1} · ${escapeHtml(question.indicator)}</strong><span>${filled ? `${filled} bagian terisi · ${configurations} konfigurasi jawaban` : 'Belum diisi'}${attached ? ` · ${attached} lampiran` : ''}</span></div>`;
  }).join('');
  return `${pageHeading('Periksa sebelum mengumpulkan', 'Ringkasan jawaban', 'Perubahan yang masih menunggu server akan disimpan terlebih dahulu. Pengumpulan tidak akan berhasil jika penyimpanan gagal.')}
    <section class="card section-card" style="max-width:760px;margin:auto">
      <div class="section-title"><div><h2>Empat soal asesmen</h2><p>Status di bawah menunjukkan isi lokal terkini.</p></div></div>
      ${rows}
      <div class="submission-warning">Dengan memilih “Kumpulkan Jawaban”, kamu menyatakan bahwa pengerjaan selesai. Jawaban akan terkunci setelah server mengonfirmasi pengumpulan.</div>
      <div class="question-actions"><button class="button secondary" data-action="navigate" data-page="assessment">← Kembali ke jawaban</button><button class="button danger" data-action="submit-assessment">Simpan perubahan & kumpulkan</button></div>
    </section>`;
}

function resultsView() {
  const result = app.results;
  if (!result || result.state === 'not_started') {
    return `${pageHeading('Hasil penilaian', 'Hasil Nilai', 'Nilai akan tersedia setelah asesmen selesai dinilai oleh guru.')}
      <section class="card empty-state"><div class="empty-illustration">▤</div><h2>Asesmen belum dimulai</h2><p>Mulai asesmen terlebih dahulu untuk melihat status dan hasil penilaian.</p><button class="button" data-action="navigate" data-page="assessment">Lihat asesmen →</button></section>`;
  }
  if (result.state === 'waiting') {
    return `${pageHeading('Hasil penilaian', 'Menunggu Penilaian Guru', 'Jawaban sudah disimpan. Skor dan umpan balik akan ditampilkan setelah guru menyelesaikan penilaian.')}
      <section class="card empty-state"><div class="empty-illustration">◷</div><h2>Jawabanmu sedang ditinjau</h2><p>Asesmen dikumpulkan ${escapeHtml(formatDate(result.submittedAt))}. Nilai belum ditampilkan sampai penilaian guru selesai.</p><span class="badge amber">Menunggu Penilaian Guru</span></section>`;
  }
  const grade = result.grade;
  const feedbackByQuestion = new Map(grade.questionFeedback.map((item) => [item.question_id, item]));
  return `${pageHeading('Hasil penilaian', 'Hasil asesmenmu', `Tanggal penilaian ${formatDate(grade.gradedAt)}.`)}
    <section class="score-banner"><div><span>Nilai akhir</span><strong>${grade.finalScore}<span style="font-size:15px"> / 100</span></strong></div><span class="badge">${escapeHtml(grade.category)}</span></section>
    <section class="card section-card" style="margin-top:15px">
      <div class="section-title"><div><h2>Skor indikator</h2><p>Skor maksimum setiap indikator adalah 4.</p></div><span class="badge green">Total ${grade.totalScore} / 16</span></div>
      <div class="result-score">${indicators.map((indicator) => `<div class="result-indicator"><span>${escapeHtml(indicator.label)}</span><strong>${grade.scores[indicator.key]} / 4</strong></div>`).join('')}</div>
    </section>
    <section class="card section-card" style="margin-top:15px"><div class="section-title"><div><h2>Umpan balik guru</h2><p>Catatan untuk membantumu berkembang.</p></div></div>
      ${app.assessment.questions.map((question, index) => {
        const feedback = feedbackByQuestion.get(question.id);
        return `<div class="feedback-block"><strong>Soal ${index + 1} · ${escapeHtml(question.indicator)} · ${feedback ? feedback.score : '—'}/4</strong><p>${escapeHtml(feedback?.feedback_text || 'Belum ada umpan balik khusus.')}</p></div>`;
      }).join('')}
      <div class="feedback-block"><strong>Umpan balik umum</strong><p>${escapeHtml(grade.generalFeedback || 'Tidak ada umpan balik umum.')}</p></div>
    </section>`;
}

function profileView() {
  const user = app.user;
  const isTeacher = user.role === 'teacher';
  return `${pageHeading('Pengaturan akun', isTeacher ? 'Profil guru' : 'Profil siswa', 'Informasi akunmu dan pengaturan keamanan.')}
    ${user.mustChangePassword ? '<div class="banner-warning">Kata sandi awal belum diganti. Perbarui sekarang demi keamanan akun.</div>' : ''}
    <div class="profile-grid">
      <section class="card section-card"><div class="section-title"><div><h2>Identitas</h2><p>Informasi akun yang tercatat.</p></div></div>
        ${isTeacher ? `<form id="teacher-profile-form">
          <div class="field"><label for="teacher-full-name">Nama lengkap guru/admin</label><input id="teacher-full-name" name="fullName" autocomplete="name" maxlength="120" required value="${escapeHtml(user.fullName)}"></div>
          <div class="form-error" hidden></div><button class="button" type="submit">Simpan nama lengkap</button>
        </form>` : `<div class="profile-value"><span>Nama lengkap</span><strong>${escapeHtml(user.fullName)}</strong></div>`}
        <div class="profile-value"><span>Username</span><strong>${escapeHtml(user.username)}</strong></div>
        ${isTeacher ? '' : `<div class="profile-value"><span>Kelas</span><strong>${escapeHtml(user.className || '—')}</strong></div>
        <div class="profile-value"><span>Nama sekolah</span><strong>${escapeHtml(user.schoolName || '—')}</strong></div>
        <div class="profile-value"><span>Nomor absen</span><strong>${escapeHtml(user.attendanceNumber || '—')}</strong></div>`}
        <div class="profile-value"><span>Peran</span><strong>${isTeacher ? 'Guru/admin' : 'Siswa'}</strong></div>
      </section>
      <section class="card section-card"><div class="section-title"><div><h2>Ganti kata sandi</h2><p>Kata sandi disimpan dalam bentuk hash aman.</p></div></div>
        <form id="password-form">
          <div class="field"><label for="currentPassword">Kata sandi saat ini</label><input id="currentPassword" name="currentPassword" type="password" autocomplete="current-password" required></div>
          <div class="field"><label for="newPassword">Kata sandi baru</label><input id="newPassword" name="newPassword" type="password" autocomplete="new-password" minlength="10" required></div>
          <div class="field"><label for="confirmPassword">Konfirmasi kata sandi baru</label><input id="confirmPassword" name="confirmPassword" type="password" autocomplete="new-password" minlength="10" required></div>
          <div class="form-error" hidden></div><button class="button" type="submit">Perbarui kata sandi</button>
        </form>
      </section>
    </div>`;
}

function attemptRow(attempt, student, teacherAttempts) {
  const name = attempt?.student.fullName || student.full_name;
  const username = attempt?.student.username || student.username;
  const className = attempt?.student.className || student.class_name || '—';
  const schoolName = attempt?.student.schoolName || student.school_name || '—';
  const rowStatus = attempt ? statusBadge(attempt.status, attempt.gradeStatus) : '<span class="badge gray">Belum mulai</span>';
  const gradeLabel = !attempt ? '—' : attempt.gradeStatus === 'published'
    ? `<div class="dashboard-grade"><strong>${attempt.grade.finalScore}% kreativitas ilmiah</strong><span>${attempt.grade.totalScore}/16 · ${escapeHtml(attempt.grade.category)}</span><div class="dashboard-grade-breakdown">${indicators.map((indicator) => `<span>${escapeHtml(indicator.label.split(' · ')[0])} ${attempt.grade.scores[indicator.key] * 25}%</span>`).join('')}</div></div>`
    : attempt.gradeStatus === 'draft' ? 'Draf' : 'Menunggu';
  const dates = attempt ? `${formatDate(attempt.startedAt)}<br><span class="field-hint">Kumpul: ${formatDate(attempt.submittedAt)}</span>` : '—';
  const action = attempt ? `<button class="button secondary small" data-action="open-attempt" data-attempt="${attempt.id}">${attempt.status === 'submitted' ? 'Buka & nilai' : 'Lihat progres'}</button>` : '<span class="field-hint">Belum ada percobaan</span>';
  const reset = `<button class="button ghost small" data-action="reset-password" data-student="${student.id}" data-name="${escapeHtml(name)}">Reset sandi</button>`;
  const resetAttempt = attempt ? `<button class="button ghost small" data-action="reset-attempt" data-attempt="${attempt.id}" data-name="${escapeHtml(name)}">Reset pengerjaan</button>` : '';
  const remove = `<button class="button danger small" data-action="delete-student" data-student="${student.id}" data-name="${escapeHtml(name)}">Hapus siswa</button>`;
  return `<tr data-student-row data-search="${escapeHtml(`${name} ${username} ${className} ${schoolName}`.toLocaleLowerCase())}" data-class="${escapeHtml(className)}">
    <td><strong>${escapeHtml(name)}</strong><br><span class="field-hint">@${escapeHtml(username)}</span></td><td>${escapeHtml(schoolName)}</td><td>${escapeHtml(className)}</td><td>${escapeHtml(student.attendance_number || attempt?.student.attendanceNumber || '—')}</td>
    <td>${rowStatus}</td><td>${dates}</td><td>${attempt?.submittedAt ? formatDate(attempt.submittedAt) : '—'}</td><td>${gradeLabel}</td><td><div style="display:flex;flex-wrap:wrap;gap:6px">${action}${reset}${resetAttempt}${remove}</div></td>
  </tr>`;
}

const creativityCategories = [
  { name: 'Sangat Kreatif', minimum: 81, color: '#20815f' },
  { name: 'Kreatif', minimum: 61, color: '#63ae85' },
  { name: 'Cukup Kreatif', minimum: 41, color: '#e5b94f' },
  { name: 'Kurang Kreatif', minimum: 21, color: '#e5894f' },
  { name: 'Sangat Kurang Kreatif', minimum: 0, color: '#c95b55' },
];

function creativitySummaryMarkup(attempts) {
  const graded = attempts.filter((attempt) => attempt.gradeStatus === 'published' && attempt.grade);
  const categoryCounts = creativityCategories.map((category, index) => ({
    ...category,
    count: graded.filter((attempt) => attempt.grade.finalScore >= category.minimum
      && (index === 0 || attempt.grade.finalScore < creativityCategories[index - 1].minimum)).length,
  }));
  const total = graded.length;
  let angle = 0;
  const segments = categoryCounts.filter((category) => category.count > 0).map((category) => {
    const start = angle;
    angle += category.count / total * 360;
    return `${category.color} ${start}deg ${angle}deg`;
  });
  const average = total
    ? (graded.reduce((sum, attempt) => sum + attempt.grade.finalScore, 0) / total).toFixed(1)
    : null;
  const legend = categoryCounts.map((category, index) => {
    const upper = index === 0 ? 100 : creativityCategories[index - 1].minimum - 1;
    const share = total ? `${(category.count / total * 100).toFixed(0)}%` : '0%';
    return `<li><span class="creativity-legend-color" style="--category-color:${category.color}"></span><span class="creativity-legend-copy"><strong>${category.name}</strong><small>${category.minimum}–${upper}% kreativitas</small></span><span class="creativity-legend-count">${category.count}<small>${share}</small></span></li>`;
  }).join('');
  return `<section class="card creativity-summary" aria-labelledby="creativity-summary-title">
    <div class="section-title"><div><h2 id="creativity-summary-title">Persentase kreativitas ilmiah</h2><p>Ringkasan hasil siswa yang penilaiannya sudah dipublikasikan.</p></div><span class="badge ${total ? 'green' : 'gray'}">${total} siswa dinilai</span></div>
    <div class="creativity-summary-content">
      <div class="creativity-chart-wrap">
        <div class="creativity-pie ${total ? '' : 'empty'}" role="img" aria-label="${total ? `Diagram kategori kreativitas dari ${total} siswa yang telah dinilai` : 'Belum ada siswa yang selesai dinilai'}" style="--pie-segments:${segments.length ? segments.join(',') : '#e8eeeb 0deg 360deg'}">
          <div class="creativity-pie-center"><strong>${average === null ? '—' : `${average}%`}</strong><span>rata-rata</span></div>
        </div>
        <p>Rata-rata persentase kreativitas seluruh siswa yang sudah dinilai.</p>
      </div>
      <div class="creativity-legend">
        <h3>Distribusi kategori kreativitas</h3>
        <ul>${legend}</ul>
        <p class="creativity-explanation">Diagram lingkaran menunjukkan proporsi siswa pada tiap kategori. Persentase kreativitas setiap siswa dihitung dari skor total ÷ 16 × 100. Kategori: Sangat Kreatif (81–100%), Kreatif (61–80%), Cukup Kreatif (41–60%), Kurang Kreatif (21–40%), dan Sangat Kurang Kreatif (0–20%). Draf penilaian dan siswa yang belum dinilai belum dihitung.</p>
      </div>
    </div>
  </section>`;
}

function teacherStudentsView() {
  const data = app.teacherData;
  const classes = [...new Set(data.students.map((student) => student.class_name).filter(Boolean))].sort();
  const attemptsByStudent = new Map(data.attempts.map((attempt) => [attempt.student.id, attempt]));
  const submittedCount = data.attempts.filter((attempt) => attempt.status === 'submitted').length;
  const rows = data.students.map((student) => attemptRow(attemptsByStudent.get(student.id), student, data.attempts)).join('');
  return `${pageHeading('Ruang guru', 'Daftar siswa', 'Cari siswa, pantau asesmen, buka jawaban untuk dinilai, atau kelola akun siswa.') }
    <section class="card section-card">
      <div class="section-title"><div><h2>Daftar siswa & asesmen</h2><p>Jawaban diambil langsung dari database website saat dibuka.</p></div><span class="badge ${data.spreadsheetConfigured ? 'green' : 'gray'}">Google Sheets ${data.spreadsheetConfigured ? 'terhubung' : 'belum dikonfigurasi'}</span></div>
      <div class="toolbar"><input id="student-search" type="search" placeholder="Cari nama, sekolah, username, atau kelas…" aria-label="Cari siswa"><select id="class-filter"><option value="">Semua kelas</option>${classes.map((className) => `<option value="${escapeHtml(className)}">${escapeHtml(className)}</option>`).join('')}</select><button class="button secondary small" data-action="refresh-teacher">↻ Muat ulang</button><button class="button small" data-action="sync-all-attempts" ${!data.spreadsheetConfigured || !submittedCount ? 'disabled' : ''}>Kirim ${submittedCount} jawaban ke Google Sheets</button><button class="button secondary small" data-action="sync-student-roster" ${!data.spreadsheetConfigured || !submittedCount ? 'disabled' : ''}>Kirim rekap ${submittedCount} siswa selesai</button></div>
      <div class="table-wrap"><table><thead><tr><th>Siswa</th><th>Sekolah</th><th>Kelas</th><th>Absen</th><th>Status</th><th>Waktu mulai</th><th>Waktu kumpul</th><th>Hasil penilaian & persentase</th><th>Aksi</th></tr></thead><tbody>${rows || '<tr><td colspan="9" class="table-empty">Belum ada siswa terdaftar.</td></tr>'}</tbody></table></div>
      <p class="sync-note">${data.spreadsheetConfigured ? 'Pengiriman ke spreadsheet dilakukan saat guru menekan tombol di atas. Semua percobaan yang sudah dikumpulkan akan dikirim; siswa yang belum mengumpulkan tidak disertakan. Siswa dan jawaban tetap tersimpan di database website.' : 'Google Sheets opsional. Untuk mengaktifkan, atur GOOGLE_APPS_SCRIPT_URL dan GOOGLE_APPS_SCRIPT_TOKEN di environment server; PostgreSQL tetap menjadi sumber data utama.'}</p>
    </section>`;
}

function teacherDashboardView() {
  const data = app.teacherData;
  const failedSync = data.syncLogs.filter((log) => log.sync_status === 'failed');
  return `${pageHeading('Ruang guru', 'Ringkasan asesmen', 'Pantau progres, buka jawaban tersimpan dari server, dan berikan penilaian.')}
    <div class="stats-grid">
      <article class="card stat-card"><div class="stat-label">Belum mulai</div><div class="stat-value">${data.counts.notStarted}</div><div class="stat-foot">Siswa terdaftar</div></article>
      <article class="card stat-card"><div class="stat-label">Sedang mengerjakan</div><div class="stat-value">${data.counts.inProgress}</div><div class="stat-foot">Timer berjalan di server</div></article>
      <article class="card stat-card"><div class="stat-label">Sudah mengumpulkan</div><div class="stat-value">${data.counts.submitted}</div><div class="stat-foot">Jawaban terkunci</div></article>
      <article class="card stat-card"><div class="stat-label">Menunggu penilaian</div><div class="stat-value">${data.counts.awaitingGrade}</div><div class="stat-foot">Perlu ditinjau guru</div></article>
    </div>
    ${creativitySummaryMarkup(data.attempts)}
    ${failedSync.length ? `<div class="banner-warning">${failedSync.length} sinkronisasi Google Sheets terakhir gagal. Data utama tetap tersimpan di website. Buka jawaban terkait untuk mencoba sinkronisasi ulang.</div>` : ''}
    ${data.counts.awaitingGrade ? `<section class="card section-card"><div class="section-title"><div><h2>Perlu penilaian</h2><p>${data.counts.awaitingGrade} percobaan menunggu tinjauan guru.</p></div><button class="button secondary small" type="button" data-action="navigate" data-page="students">Buka daftar siswa →</button></div></section>` : ''}`;
}

function answerText(answer, includeElaborationGraphs = false) {
  const values = answer?.structuredData || {};
  const renderValues = (configuration, graphId) => Object.entries(configuration)
    .filter(([, value]) => typeof value === 'string' && value.trim())
    .map(([key, value]) => `<div class="answer-key">${escapeHtml(key)}</div><p>${escapeHtml(value)}</p>${includeElaborationGraphs && key === 'dataTable' ? elaborationGraphMarkup(value, graphId) : ''}`).join('');
  const primary = renderValues(values, 'teacher-graph-q4-main');
  const additional = (values.answerConfigurations || []).map((configuration, index) => {
    const content = renderValues(configuration, `teacher-graph-q4-${index + 1}`);
    return content ? `<div class="answer-key">Konfigurasi jawaban ${index + 2}</div>${content}` : '';
  }).join('');
  const text = `${primary}${additional}`;
  return text || '<p class="field-hint">Belum ada jawaban tersimpan.</p>';
}

function teacherAttemptView() {
  const data = app.teacherDetail;
  const attempt = data.attempt;
  const answerByQuestion = new Map(data.answers.map((answer) => [answer.questionId, answer]));
  const feedbackByQuestion = new Map((data.grade?.questionFeedback || []).map((item) => [item.question_id, item]));
  const editableGrade = data.grade?.status === 'published';
  const answerCards = data.questions.map((question, index) => {
    const attachments = data.attachments.filter((attachment) => attachment.question_id === question.id);
    return `<section class="card answer-review">
      <span class="indicator-name">Soal ${index + 1} · ${escapeHtml(question.indicator)}</span><h3>${escapeHtml(question.title)}</h3>
      <p>${escapeHtml(question.prompt)}</p>${answerText(answerByQuestion.get(question.id), question.id === 'q4')}
      <span class="field-hint">Pembaruan terakhir: ${formatDate(answerByQuestion.get(question.id)?.updatedAt)}</span>
      ${attachments.length ? `<div class="attachment-list">${attachments.map((attachment) => `<a class="attachment-link" href="/api/attachments/${encodeURIComponent(attachment.id)}" target="_blank" rel="noopener noreferrer">${escapeHtml(attachment.original_name)} · ${(attachment.size_bytes / 1024).toFixed(0)} KB ↗</a>`).join('')}</div>` : ''}
    </section>`;
  }).join('');
  const grades = data.grade?.scores || {};
  const gradeForm = data.questions.map((question, index) => {
    const indicator = indicators[index];
    const feedback = feedbackByQuestion.get(question.id);
    const value = grades[indicator.key];
    const selected = value === null || value === undefined ? '' : String(value);
    return `<div class="grade-question">
      <div class="grade-question-head"><strong>Soal ${index + 1} · ${escapeHtml(indicator.label)}</strong><select name="score-${question.id}" required aria-label="Skor soal ${index + 1}">
        <option value="" ${selected === '' ? 'selected' : ''} disabled>Pilih 0–4</option>${[0, 1, 2, 3, 4].map((score) => `<option value="${score}" ${selected === String(score) ? 'selected' : ''}>${score} / 4</option>`).join('')}
      </select></div>
      <textarea class="feedback-area" name="feedback-${question.id}" maxlength="5000" placeholder="Umpan balik untuk soal ini…">${escapeHtml(feedback?.feedback_text || '')}</textarea>
    </div>`;
  }).join('');
  return `${pageHeading('Peninjauan jawaban', attempt.student.fullName, `${attempt.student.schoolName || 'Sekolah —'} · ${attempt.student.className || 'Kelas —'} · @${attempt.student.username}`, statusBadge(attempt.status, data.grade?.status))}
    <div class="toolbar"><button class="button secondary small" data-action="navigate" data-page="students">← Kembali ke daftar</button><span class="field-hint">Mulai ${formatDate(attempt.startedAt)} · Kumpul ${formatDate(attempt.submittedAt)}</span></div>
    <div class="attempt-details">
      <div>${answerCards}</div>
      <section class="card grade-panel">
        <div class="section-title"><div><h2>Penilaian guru</h2><p>Skor setiap soal 0–4. Total dan kategori dihitung server.</p></div></div>
        ${attempt.status !== 'submitted' ? '<div class="banner-warning">Siswa masih mengerjakan. Skor hanya dapat disimpan setelah pengumpulan.</div>' : ''}
        <form id="grade-form" data-attempt="${escapeHtml(attempt.id)}" data-published="${data.grade?.status === 'published'}">
          ${gradeForm}
          <div class="field" style="margin-top:14px"><label for="general-feedback">Umpan balik umum</label><textarea class="feedback-area" id="general-feedback" name="generalFeedback" maxlength="5000" placeholder="Catatan umum untuk siswa…">${escapeHtml(data.grade?.generalFeedback || '')}</textarea></div>
          <div class="form-error" hidden></div>
          ${editableGrade ? '' : `<button class="button secondary block" type="button" data-action="save-grade" data-publish="false" ${attempt.status !== 'submitted' ? 'disabled' : ''}>Simpan draf penilaian</button><div style="height:8px"></div>`}
          <button class="button block" type="button" data-action="save-grade" data-publish="true" ${attempt.status !== 'submitted' ? 'disabled' : ''}>${editableGrade ? 'Simpan perubahan & publikasikan' : 'Simpan & selesaikan penilaian'}</button>
        </form>
        ${data.grade?.status === 'published' ? `<div class="sync-note">Nilai telah dipublikasikan ${formatDate(data.grade.gradedAt)}. Perubahan nilai tetap harus dipublikasikan kembali.</div>` : ''}
        ${app.teacherData?.spreadsheetConfigured ? `<button class="button ghost small" style="margin-top:12px" data-action="retry-sync" data-attempt="${escapeHtml(attempt.id)}">↻ Sinkronkan ulang spreadsheet</button>` : ''}
      </section>
    </div>`;
}

function render() {
  if (!app.user) {
    renderAuth();
    return;
  }
  if (app.user.role === 'teacher') {
    renderShell(app.page === 'profile'
      ? profileView()
      : app.page === 'teacher-attempt' && app.teacherDetail
        ? teacherAttemptView()
        : app.page === 'students'
          ? teacherStudentsView()
          : teacherDashboardView());
    bindSearch();
    return;
  }
  if (!app.assessment) return;
  let content;
  switch (app.page) {
    case 'assessment': content = assessmentView(); break;
    case 'submit-review': content = submitReviewView(); break;
    case 'results': content = resultsView(); break;
    case 'profile': content = profileView(); break;
    default: content = studentDashboardView();
  }
  renderShell(content);
}

async function refreshStudentDashboard() {
  const data = await api('/api/student/dashboard');
  app.serverTimeOffset = Date.parse(data.serverNow) - Date.now();
  app.assessment = data.assessment;
  app.dashboard = data;
  app.attachments = data.attachments || [];
  app.answers = {};
  app.savedAt = new Map();
  for (const answer of data.answers || []) {
    app.answers[answer.questionId] = { answerText: answer.answerText, structuredData: answer.structuredData || {} };
    app.savedAt.set(answer.questionId, answer.updatedAt);
  }
}

async function refreshTeacherDashboard() {
  app.teacherData = await api('/api/teacher/dashboard');
}

async function openTeacherAttempt(attemptId) {
  app.teacherAttempt = attemptId;
  app.teacherDetail = await api(`/api/teacher/attempts/${encodeURIComponent(attemptId)}`);
  app.page = 'teacher-attempt';
  render();
}

function setQuestionSaveState(questionId, text, className = '') {
  const node = document.getElementById(`save-state-${questionId}`);
  if (!node) return;
  node.className = `save-state ${className}`;
  node.textContent = text;
}

function answerBody(questionId) {
  const answer = questionAnswer(questionId);
  const primary = Object.entries(answer.structuredData)
    .filter(([key, value]) => key !== 'answerConfigurations' && typeof value === 'string' && value.trim())
    .map(([key, value]) => `${key}: ${value}`);
  const additional = (Array.isArray(answer.structuredData.answerConfigurations) ? answer.structuredData.answerConfigurations : []).flatMap((configuration, index) =>
    Object.entries(configuration).filter(([, value]) => typeof value === 'string' && value.trim())
      .map(([key, value]) => `Konfigurasi jawaban ${index + 2} · ${key}: ${value}`));
  const answerTextValue = [...primary, ...additional].join('\n\n');
  return { answerText: answerTextValue, structuredData: answer.structuredData };
}

function scheduleSave(questionId, delay = 700) {
  if (app.dashboard?.attempt?.status !== 'in_progress') return;
  clearTimeout(app.timers.get(questionId));
  app.timers.set(questionId, setTimeout(() => saveQuestion(questionId), delay));
}

async function saveQuestion(questionId, retry = true) {
  if (app.dashboard?.attempt?.status !== 'in_progress') return false;
  clearTimeout(app.timers.get(questionId));
  if (!app.dirty.has(questionId)) return true;
  if (!navigator.onLine) {
    setQuestionSaveState(questionId, '⚠ Offline — belum tersimpan', 'failed');
    return false;
  }
  if (app.saving.has(questionId)) return app.saving.get(questionId);
  const version = app.versions.get(questionId) || 0;
  const body = answerBody(questionId);
  setQuestionSaveState(questionId, '◷ Menyimpan…');
  const operation = api(`/api/attempts/${encodeURIComponent(app.dashboard.attempt.id)}/answers/${encodeURIComponent(questionId)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  }).then((result) => {
    if ((app.versions.get(questionId) || 0) === version) {
      app.dirty.delete(questionId);
      app.savedAt.set(questionId, result.updatedAt);
      setQuestionSaveState(questionId, `✓ Tersimpan ${formatDate(result.updatedAt)}`, 'saved');
      const navButton = root.querySelector(`[data-question="${questionId}"] .question-number`);
      if (navButton) navButton.textContent = hasAnswerContent(questionAnswer(questionId).structuredData) ? '✓' : navButton.textContent;
    }
    return true;
  }).catch((error) => {
    setQuestionSaveState(questionId, `⚠ Gagal menyimpan — coba lagi`, 'failed');
    toast(error.message, 'error');
    if (retry && app.dashboard?.attempt?.status === 'in_progress') {
      app.timers.set(questionId, setTimeout(() => saveQuestion(questionId, true), 2500));
    }
    return false;
  }).finally(() => {
    app.saving.delete(questionId);
    if (app.dirty.has(questionId) && (app.versions.get(questionId) || 0) !== version) scheduleSave(questionId, 50);
  });
  app.saving.set(questionId, operation);
  return operation;
}

async function flushSaves() {
  for (const timer of app.timers.values()) clearTimeout(timer);
  app.timers.clear();
  for (let attempt = 0; app.dirty.size > 0 && attempt < 20; attempt += 1) {
    const questionIds = [...app.dirty];
    const results = await Promise.all(questionIds.map((id) => saveQuestion(id, false)));
    if (!results.every(Boolean)) return false;
  }
  return app.dirty.size === 0;
}

async function handleAnswerInput(event) {
  const input = event.target.closest('[data-answer-question]');
  if (!input) return;
  const questionId = input.dataset.answerQuestion;
  const field = input.dataset.answerField;
  const structuredData = questionAnswer(questionId).structuredData;
  const configurationIndex = input.dataset.answerConfiguration;
  if (configurationIndex === undefined) structuredData[field] = input.value;
  else structuredData.answerConfigurations[Number(configurationIndex)][field] = input.value;
  if (questionId === 'q4' && field === 'dataTable') {
    const graph = input.closest('.answer-configuration')?.querySelector('.elaboration-graph');
    if (graph) graph.outerHTML = elaborationGraphMarkup(input.value, graph.id);
  }
  app.dirty.add(questionId);
  app.versions.set(questionId, (app.versions.get(questionId) || 0) + 1);
  setQuestionSaveState(questionId, navigator.onLine ? '◷ Belum tersimpan' : '⚠ Offline — belum tersimpan', navigator.onLine ? '' : 'failed');
  scheduleSave(questionId);
}

function updateTimer() {
  const node = document.getElementById('assessment-timer');
  const attempt = app.dashboard?.attempt;
  if (!node || !attempt || attempt.status !== 'in_progress') return;
  const remaining = Date.parse(attempt.deadlineAt) - (Date.now() + app.serverTimeOffset);
  node.textContent = formatTimer(remaining);
  if (remaining <= 0) {
    clearInterval(app.timerInterval);
    refreshStudentDashboard().then(() => {
      app.page = 'assessment';
      render();
      toast('Waktu asesmen habis. Jawaban terakhir yang tersimpan di server telah dikumpulkan.');
    }).catch((error) => toast(`Tidak dapat memeriksa status akhir asesmen: ${error.message}`, 'error'));
  }
}

function startTimer() {
  clearInterval(app.timerInterval);
  updateTimer();
  app.timerInterval = setInterval(updateTimer, 1000);
}

async function startAssessment() {
  const button = root.querySelector('[data-action="start-assessment"]');
  if (button) button.disabled = true;
  try {
    const result = await api('/api/attempts/start', { method: 'POST', body: '{}' });
    await refreshStudentDashboard();
    app.page = 'assessment';
    render();
    toast(result.attempt.status === 'in_progress' ? 'Asesmen dimulai. Timer 60 menit berjalan.' : 'Asesmen telah dikumpulkan sebelumnya.');
  } catch (error) {
    if (button) button.disabled = false;
    toast(error.message, 'error');
  }
}

async function submitAssessment() {
  const button = root.querySelector('[data-action="submit-assessment"]');
  if (button) {
    button.disabled = true;
    button.textContent = 'Menyimpan jawaban…';
  }
  const saved = await flushSaves();
  if (!saved) {
    if (button) {
      button.disabled = false;
      button.textContent = 'Coba lagi — jawaban belum tersimpan';
    }
    toast('Pengumpulan dibatalkan: ada jawaban yang belum dikonfirmasi tersimpan oleh server.', 'error');
    return;
  }
  try {
    await api(`/api/attempts/${encodeURIComponent(app.dashboard.attempt.id)}/submit`, { method: 'POST', body: '{}' });
    await refreshStudentDashboard();
    app.page = 'assessment';
    render();
    toast('Jawaban berhasil disimpan dan dikumpulkan.');
  } catch (error) {
    if (button) {
      button.disabled = false;
      button.textContent = 'Coba kumpulkan kembali';
    }
    toast(`Pengumpulan gagal: ${error.message}`, 'error');
  }
}

async function uploadAttachment(input) {
  const files = Array.from(input.files || []);
  if (!files.length) return;
  const oversized = files.find((file) => file.size > 3 * 1024 * 1024);
  if (oversized) {
    toast(`${oversized.name}: ukuran gambar maksimum 3 MB.`, 'error');
    input.value = '';
    return;
  }
  input.disabled = true;
  const failures = [];
  let uploaded = 0;
  for (const file of files) {
    try {
      const dataBase64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('File gambar tidak dapat dibaca.'));
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
        reader.readAsDataURL(file);
      });
      const result = await api(`/api/attempts/${encodeURIComponent(app.dashboard.attempt.id)}/attachments`, {
        method: 'POST',
        body: JSON.stringify({
          questionId: input.dataset.uploadQuestion,
          fileName: file.name,
          mimeType: file.type,
          dataBase64,
        }),
      });
      app.attachments.push({
        id: result.attachment.id,
        question_id: result.attachment.questionId,
        original_name: result.attachment.originalName,
        mime_type: result.attachment.mimeType,
        size_bytes: result.attachment.sizeBytes,
        created_at: result.attachment.createdAt,
      });
      const list = input.parentElement.querySelector('.attachment-list');
      const attachment = result.attachment;
      list.insertAdjacentHTML('beforeend', `<a class="attachment-link" href="/api/attachments/${encodeURIComponent(attachment.id)}" target="_blank" rel="noopener noreferrer">${escapeHtml(attachment.originalName)} ↗</a>`);
      uploaded += 1;
    } catch (error) {
      failures.push(`${file.name}: ${error.message}`);
    }
  }
  if (failures.length) toast(`${uploaded} gambar tersimpan. Gagal: ${failures.join('; ')}`, 'error');
  else toast(`${uploaded} konfigurasi berhasil tersimpan di server.`);
  input.disabled = false;
  input.value = '';
}

async function loadPage(page) {
  if (app.user.role === 'student') {
    if (page === 'results') app.results = await api('/api/student/results');
    if (page === 'assessment' || page === 'dashboard') await refreshStudentDashboard();
  } else if (page === 'dashboard' || page === 'students') {
    await refreshTeacherDashboard();
  }
  app.page = page;
  render();
}

function bindSearch() {
  const search = document.getElementById('student-search');
  const filter = document.getElementById('class-filter');
  const apply = () => {
    const query = (search?.value || '').trim().toLocaleLowerCase();
    const selectedClass = filter?.value || '';
    root.querySelectorAll('[data-student-row]').forEach((row) => {
      row.hidden = !row.dataset.search.includes(query) || (selectedClass && row.dataset.class !== selectedClass);
    });
  };
  search?.addEventListener('input', apply);
  filter?.addEventListener('change', apply);
}

async function submitGrade(button) {
  const form = document.getElementById('grade-form');
  if (!form) return;
  const data = new FormData(form);
  const body = {
    scores: {},
    generalFeedback: data.get('generalFeedback') || '',
    questionFeedback: [],
    publish: button.dataset.publish === 'true',
  };
  const questions = app.teacherDetail.questions;
  questions.forEach((question, index) => {
    const value = data.get(`score-${question.id}`);
    if (value === null || value === '') throw new Error(`Pilih skor untuk soal ${index + 1}.`);
    const score = Number(value);
    body.scores[indicators[index].key] = score;
    body.questionFeedback.push({
      questionId: question.id,
      score,
      feedbackText: data.get(`feedback-${question.id}`) || '',
    });
  });
  button.disabled = true;
  button.textContent = 'Menyimpan penilaian…';
  const allGradeButtons = form.querySelectorAll('[data-action="save-grade"]');
  allGradeButtons.forEach((item) => { item.disabled = true; });
  try {
    const result = await api(`/api/teacher/attempts/${encodeURIComponent(form.dataset.attempt)}/grade`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    await refreshTeacherDashboard();
    if (result.published) {
      app.page = 'dashboard';
    } else {
      await openTeacherAttempt(form.dataset.attempt);
    }
    render();
    toast(result.published ? 'Penilaian dipublikasikan. Nilai kini tersedia untuk siswa.' : 'Draf penilaian tersimpan.');
  } catch (error) {
    const currentForm = document.getElementById('grade-form');
    setFormError(currentForm || form, error.message);
    allGradeButtons.forEach((item) => { item.disabled = false; });
    button.disabled = false;
    button.textContent = button.dataset.publish === 'true' ? 'Simpan & selesaikan penilaian' : 'Simpan draf penilaian';
  }
}

async function syncAllSubmittedAttempts(button) {
  const attempts = app.teacherData.attempts.filter((attempt) => attempt.status === 'submitted');
  if (!attempts.length) {
    toast('Belum ada jawaban yang dikumpulkan untuk dikirim.');
    return;
  }
  if (!app.teacherData.spreadsheetConfigured) {
    toast('Google Sheets belum dikonfigurasi di server.', 'error');
    return;
  }
  if (!window.confirm(`Kirim atau perbarui data ${attempts.length} percobaan yang sudah dikumpulkan ke Google Sheets?`)) return;

  button.disabled = true;
  let succeeded = 0;
  let failed = 0;
  for (const [index, attempt] of attempts.entries()) {
    button.textContent = `Mengirim ${index + 1}/${attempts.length}…`;
    try {
      const result = await api(`/api/teacher/attempts/${encodeURIComponent(attempt.id)}/sync`, {
        method: 'POST',
        body: '{}',
      });
      if (result.sync.status === 'success') succeeded += 1;
      else failed += 1;
    } catch {
      failed += 1;
    }
  }
  try {
    await refreshTeacherDashboard();
    render();
    toast(`${succeeded} percobaan berhasil dikirim${failed ? `; ${failed} gagal. Periksa log sinkronisasi atau coba ulang.` : '.'}`, failed ? 'error' : '');
  } catch (error) {
    button.disabled = false;
    button.textContent = `Kirim ${attempts.length} jawaban ke Google Sheets`;
    toast(`Pengiriman selesai (${succeeded} berhasil, ${failed} gagal), tetapi daftar siswa gagal dimuat ulang: ${error.message}`, 'error');
  }
}

async function resetStudentPassword(button) {
  const { student, name } = button.dataset;
  if (!window.confirm(`Buat kata sandi sementara untuk ${name}? Sesi siswa akan dikeluarkan.`)) return;
  button.disabled = true;
  try {
    const result = await api(`/api/teacher/students/${encodeURIComponent(student)}/reset-password`, {
      method: 'POST',
      body: '{}',
    });
    window.prompt('Kata sandi sementara (hanya ditampilkan sekali; minta siswa menggantinya setelah masuk):', result.temporaryPassword);
    toast('Kata sandi berhasil direset. Minta siswa menggantinya saat masuk.');
  } catch (error) {
    button.disabled = false;
    toast(error.message, 'error');
  }
}

async function deleteStudent(button) {
  const { student, name } = button.dataset;
  const confirmed = window.confirm(`Hapus data siswa ${name} secara permanen?\n\nAkun, percobaan asesmen, jawaban, nilai, lampiran, dan sesi login terkait akan dihapus. Tindakan ini tidak dapat dibatalkan.`);
  if (!confirmed) return;
  button.disabled = true;
  try {
    const result = await api(`/api/teacher/students/${encodeURIComponent(student)}`, { method: 'DELETE' });
    await refreshTeacherDashboard();
    render();
    toast(`Data siswa ${name} dan seluruh data asesmennya berhasil dihapus.`);
    if (result.cleanupErrors.length) toast(`Sebagian file lampiran tidak dapat dibersihkan: ${result.cleanupErrors.join(', ')}`, 'error');
    if (result.spreadsheetCleanup.status === 'failed') toast('Data lokal sudah dihapus, tetapi penghapusan salinan Google Sheets gagal. Periksa Apps Script dan Spreadsheet.', 'error');
  } catch (error) {
    button.disabled = false;
    toast(`Data siswa gagal dihapus: ${error.message}`, 'error');
  }
}

async function resetStudentAttempt(button) {
  const { attempt, name } = button.dataset;
  const confirmed = window.confirm(`Reset hasil pengerjaan ${name}?\n\nSemua jawaban, nilai, dan lampiran percobaan ini akan dihapus permanen. Akun siswa tetap ada dan siswa dapat memulai asesmen baru. Tindakan ini tidak dapat dibatalkan.`);
  if (!confirmed) return;
  button.disabled = true;
  try {
    const result = await api(`/api/teacher/attempts/${encodeURIComponent(attempt)}`, { method: 'DELETE' });
    await refreshTeacherDashboard();
    render();
    toast(`Hasil pengerjaan ${name} berhasil direset. Siswa dapat memulai kembali.`);
    if (result.cleanupErrors.length) toast(`Sebagian file lampiran tidak dapat dibersihkan: ${result.cleanupErrors.join(', ')}`, 'error');
    if (result.spreadsheetCleanup.status === 'failed') toast('Hasil lokal sudah direset, tetapi penghapusan salinan Google Sheets gagal. Periksa Apps Script dan Spreadsheet.', 'error');
  } catch (error) {
    button.disabled = false;
    toast(`Hasil pengerjaan gagal direset: ${error.message}`, 'error');
  }
}

root.addEventListener('input', handleAnswerInput);
root.addEventListener('focusout', (event) => {
  const input = event.target.closest('[data-answer-question]');
  if (input) scheduleSave(input.dataset.answerQuestion, 0);
});
root.addEventListener('change', (event) => {
  if (event.target.matches('[data-upload-question]')) uploadAttachment(event.target);
});

root.addEventListener('submit', async (event) => {
  if (event.target.id === 'teacher-profile-form') {
    event.preventDefault();
    const form = event.target;
    const button = form.querySelector('button[type="submit"]');
    const fullName = new FormData(form).get('fullName');
    button.disabled = true;
    setFormError(form, '');
    try {
      const result = await api('/api/teacher/profile', {
        method: 'PUT',
        body: JSON.stringify({ fullName }),
      });
      app.user = result.user;
      await refreshTeacherDashboard();
      render();
      toast('Nama lengkap guru berhasil diperbarui.');
    } catch (error) {
      setFormError(form, error.message);
      button.disabled = false;
    }
    return;
  }
  if (event.target.id !== 'password-form') return;
  event.preventDefault();
  const form = event.target;
  const body = Object.fromEntries(new FormData(form).entries());
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  setFormError(form, '');
  try {
    await api('/api/change-password', { method: 'POST', body: JSON.stringify(body) });
    app.user.mustChangePassword = false;
    toast('Kata sandi berhasil diperbarui.');
    render();
  } catch (error) {
    setFormError(form, error.message);
    button.disabled = false;
  }
});

root.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  try {
    if (action === 'auth-switch') return renderAuth(button.dataset.mode);
    if (action === 'navigate') return await loadPage(button.dataset.page);
    if (action === 'add-answer-configuration') {
      const questionId = button.dataset.question;
      const structuredData = questionAnswer(questionId).structuredData;
      if (!Array.isArray(structuredData.answerConfigurations)) structuredData.answerConfigurations = [];
      structuredData.answerConfigurations.push({});
      app.dirty.add(questionId);
      app.versions.set(questionId, (app.versions.get(questionId) || 0) + 1);
      render();
      scheduleSave(questionId);
      root.querySelector(`[data-answer-question="${questionId}"][data-answer-configuration="${structuredData.answerConfigurations.length - 1}"]`)?.focus();
      return;
    }
    if (action === 'logout') {
      if (app.dirty.size) {
        const saved = await flushSaves();
        if (!saved) return toast('Keluar dibatalkan karena jawaban belum tersimpan ke server.', 'error');
      }
      await api('/api/logout', { method: 'POST', body: '{}' });
      clearInterval(app.timerInterval);
      app.user = null;
      app.dashboard = null;
      app.teacherData = null;
      app.dirty.clear();
      renderAuth();
      return;
    }
    if (action === 'start-assessment') return await startAssessment();
    if (action === 'question') {
      const current = app.activeQuestion;
      if (app.dirty.has(current)) scheduleSave(current, 0);
      app.activeQuestion = button.dataset.question;
      render();
      return;
    }
    if (action === 'save-now') {
      const success = await saveQuestion(button.dataset.question, false);
      if (!success) toast('Jawaban belum tersimpan. Periksa koneksi dan coba lagi.', 'error');
      return;
    }
    if (action === 'review-submit') {
      app.page = 'submit-review';
      render();
      return;
    }
    if (action === 'submit-assessment') return await submitAssessment();
    if (action === 'refresh-teacher') {
      await refreshTeacherDashboard();
      render();
      toast('Daftar siswa diperbarui dari database.');
      return;
    }
    if (action === 'open-attempt') return await openTeacherAttempt(button.dataset.attempt);
    if (action === 'save-grade') return await submitGrade(button);
    if (action === 'sync-all-attempts') return await syncAllSubmittedAttempts(button);
    if (action === 'sync-student-roster') {
      if (!window.confirm(`Kirim atau perbarui rekap ${app.teacherData.counts.submitted} siswa yang sudah mengumpulkan asesmen?`)) return;
      button.disabled = true;
      button.textContent = 'Mengirim rekap…';
      try {
        const result = await api('/api/teacher/students/sync', { method: 'POST', body: '{}' });
        if (result.sync.status === 'success') {
          toast(`Rekap ${result.sync.syncedCount} siswa berhasil diperbarui pada tab Rekap Siswa.`);
        } else {
          toast(result.sync.status === 'not_configured'
            ? 'Google Sheets belum dikonfigurasi di server.'
            : `Sinkronisasi rekap siswa gagal: ${result.sync.error || 'coba lagi nanti.'}`, 'error');
        }
        await refreshTeacherDashboard();
        render();
      } catch (error) {
        button.disabled = false;
        button.textContent = `Kirim rekap ${app.teacherData.counts.submitted} siswa selesai`;
        toast(`Gagal mengirim rekap siswa: ${error.message}`, 'error');
      }
      return;
    }
    if (action === 'reset-password') return await resetStudentPassword(button);
    if (action === 'delete-student') return await deleteStudent(button);
    if (action === 'reset-attempt') return await resetStudentAttempt(button);
    if (action === 'retry-sync') {
      button.disabled = true;
      const result = await api(`/api/teacher/attempts/${encodeURIComponent(button.dataset.attempt)}/sync`, { method: 'POST', body: '{}' });
      await refreshTeacherDashboard();
      await openTeacherAttempt(button.dataset.attempt);
      toast(result.sync.status === 'success' ? 'Data berhasil disinkronkan.' : result.sync.status === 'not_configured' ? 'URL Google Apps Script belum dikonfigurasi.' : 'Sinkronisasi gagal; detail tercatat di log.', result.sync.status === 'failed' ? 'error' : '');
      return;
    }
  } catch (error) {
    toast(error.message, 'error');
  }
});

window.addEventListener('online', () => {
  app.online = true;
  if (app.dirty.size && app.dashboard?.attempt?.status === 'in_progress') {
    for (const questionId of app.dirty) scheduleSave(questionId, 100);
  }
  if (app.user) render();
});
window.addEventListener('offline', () => {
  app.online = false;
  if (app.user) render();
});
window.addEventListener('beforeunload', (event) => {
  if (app.dirty.size) {
    event.preventDefault();
    event.returnValue = '';
  }
});

(async function initialize() {
  try {
    const response = await api('/api/me');
    if (!response.user) {
      app.assessment = response.assessment;
      renderAuth();
      return;
    }
    app.user = response.user;
    app.assessment = response.assessment;
    if (app.user.role === 'student') {
      await refreshStudentDashboard();
    } else {
      await refreshTeacherDashboard();
    }
    render();
    if (app.user.mustChangePassword && app.user.role === 'teacher') {
      toast('Demi keamanan, ganti kata sandi awal sebelum membagikan akses guru.', 'error');
    }
  } catch (error) {
    if (error.message.includes('Silakan masuk kembali')) {
      renderAuth();
    } else {
      renderAuth('login', `Aplikasi tidak dapat dimuat: ${error.message}`);
    }
  }
})();
