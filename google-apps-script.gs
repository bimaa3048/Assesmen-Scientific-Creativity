function doGet() {
  const appUrl = PropertiesService.getScriptProperties().getProperty('VERCEL_APP_URL');
  if (!appUrl) {
    return HtmlService.createHtmlOutput(
      '<!doctype html><html lang="id"><meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>Asesmen Scientific Creativity</title><p>VERCEL_APP_URL belum diatur pada Script Properties.</p></html>',
    );
  }
  if (!/^https:\/\/[a-z0-9.-]+(?::\d{1,5})?(?:\/[^\s"'<>]*)?$/i.test(appUrl)) {
    throw new Error('VERCEL_APP_URL harus berupa URL HTTPS yang valid.');
  }

  const escapedUrl = escapeHtml(appUrl);
  return HtmlService.createHtmlOutput(
    '<!doctype html><html lang="id"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="theme-color" content="#102c38">' +
    '<title>Asesmen Scientific Creativity</title>' +
    '<style>' +
    '*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;' +
    'font-family:Arial,sans-serif;background:#f1f5f5;color:#102c38}.card{width:min(100%,440px);padding:32px;' +
    'background:#fff;border-radius:20px;box-shadow:0 12px 36px #102c381a;text-align:center}' +
    'h1{font-size:1.5rem;margin:0 0 12px}p{line-height:1.6;color:#52636a;margin:0 0 24px}' +
    'a{display:block;padding:14px 20px;border-radius:12px;background:#126b68;color:#fff;text-decoration:none;' +
    'font-weight:700}a:focus-visible{outline:3px solid #e6a23c;outline-offset:3px}' +
    '</style></head><body><main class="card"><h1>Asesmen Scientific Creativity</h1>' +
    '<p>Buka aplikasi asesmen. Aplikasi dapat digunakan dari handphone maupun laptop.</p>' +
    '<a href="' + escapedUrl + '" target="_top" rel="noopener">Buka aplikasi</a>' +
    '</main></body></html>',
  ).setTitle('Asesmen Scientific Creativity');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function doPost(e) {
  try {
    const properties = PropertiesService.getScriptProperties();
    const expectedToken = properties.getProperty('SYNC_TOKEN');
    const payload = JSON.parse(e.postData.contents || '{}');
    if (!expectedToken || payload.token !== expectedToken) {
      return jsonResponse({ ok: false, error: 'Token tidak valid.' });
    }

    const spreadsheetId = properties.getProperty('SPREADSHEET_ID');
    if (!spreadsheetId) {
      return jsonResponse({ ok: false, error: 'SPREADSHEET_ID belum diatur.' });
    }
    if (payload.action === 'deleteAttempts') {
      if (!Array.isArray(payload.attemptIds) || payload.attemptIds.some((id) => typeof id !== 'string' || !id)) {
        return jsonResponse({ ok: false, error: 'Daftar ID percobaan tidak valid.' });
      }
      const sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName('Hasil Asesmen');
      if (!sheet || sheet.getLastRow() < 2 || payload.attemptIds.length === 0) {
        return jsonResponse({ ok: true, deletedRows: 0 });
      }
      const idsToDelete = new Set(payload.attemptIds);
      const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().flat();
      const rowNumbers = rows
        .map((id, index) => idsToDelete.has(String(id)) ? index + 2 : null)
        .filter((rowNumber) => rowNumber !== null)
        .sort((left, right) => right - left);
      rowNumbers.forEach((rowNumber) => sheet.deleteRow(rowNumber));
      return jsonResponse({ ok: true, deletedRows: rowNumbers.length });
    }
    if (!payload.attemptId || !payload.student) {
      return jsonResponse({ ok: false, error: 'ID percobaan atau identitas siswa tidak tersedia.' });
    }

    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    const sheet = spreadsheet.getSheetByName('Hasil Asesmen') || spreadsheet.insertSheet('Hasil Asesmen');
    const headers = [
      'ID Percobaan', 'Nama', 'Username', 'Kelas', 'Nomor Absen', 'Status',
      'Waktu Mulai', 'Batas Waktu', 'Waktu Pengumpulan', 'Jawaban (JSON)',
      'Lampiran (JSON)',
      'Skor Fluency', 'Skor Flexibility', 'Skor Originality', 'Skor Elaboration',
      'Skor Total', 'Nilai Akhir', 'Kategori', 'Umpan Balik Umum', 'Waktu Penilaian',
    ];
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(headers);
    } else {
      const existingHeaders = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
      if (headers.some((header, index) => existingHeaders[index] !== header)) {
        return jsonResponse({ ok: false, error: 'Susunan kolom spreadsheet tidak sesuai versi aplikasi.' });
      }
    }

    const grade = payload.grade || {};
    const scores = grade.scores || {};
    const values = [
      sheetCell(payload.attemptId),
      sheetCell(payload.student.fullName || ''),
      sheetCell(payload.student.username || ''),
      sheetCell(payload.student.className || ''),
      sheetCell(payload.student.attendanceNumber || ''),
      sheetCell(payload.status || ''),
      sheetCell(payload.startedAt || ''),
      sheetCell(payload.deadlineAt || ''),
      sheetCell(payload.submittedAt || ''),
      sheetCell(JSON.stringify(payload.answers || [])),
      sheetCell(JSON.stringify(payload.attachments || [])),
      scoreCell(scores.fluency),
      scoreCell(scores.flexibility),
      scoreCell(scores.originality),
      scoreCell(scores.elaboration),
      scoreCell(grade.totalScore),
      scoreCell(grade.finalScore),
      sheetCell(grade.category || ''),
      sheetCell(grade.generalFeedback || ''),
      sheetCell(grade.gradedAt || ''),
    ];
    const lastRow = sheet.getLastRow();
    const ids = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat() : [];
    const existingIndex = ids.findIndex((id) => String(id) === String(payload.attemptId));
    if (existingIndex >= 0) {
      sheet.getRange(existingIndex + 2, 1, 1, values.length).setValues([values]);
    } else {
      sheet.appendRow(values);
    }
    return jsonResponse({ ok: true, attemptId: payload.attemptId });
  } catch (error) {
    console.error(error);
    return jsonResponse({ ok: false, error: String(error.message || error) });
  }
}

function scoreCell(value) {
  return value === null || value === undefined ? '' : value;
}

function sheetCell(value) {
  const text = String(value);
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function jsonResponse(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
