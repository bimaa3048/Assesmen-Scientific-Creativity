function doGet() {
  const appUrl = PropertiesService.getScriptProperties().getProperty('VERCEL_APP_URL');
  if (!appUrl) {
    return HtmlService.createHtmlOutput(
      '<!doctype html><html lang="id"><meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>Creative Thinking Skills</title><p>VERCEL_APP_URL belum diatur pada Script Properties.</p></html>',
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
    '<title>Creative Thinking Skills</title>' +
    '<style>' +
    '*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;' +
    'font-family:Arial,sans-serif;background:#f1f5f5;color:#102c38}.card{width:min(100%,440px);padding:32px;' +
    'background:#fff;border-radius:20px;box-shadow:0 12px 36px #102c381a;text-align:center}' +
    'h1{font-size:1.5rem;margin:0 0 12px}p{line-height:1.6;color:#52636a;margin:0 0 24px}' +
    'a{display:block;padding:14px 20px;border-radius:12px;background:#126b68;color:#fff;text-decoration:none;' +
    'font-weight:700}a:focus-visible{outline:3px solid #e6a23c;outline-offset:3px}' +
    '</style></head><body><main class="card"><h1>Creative Thinking Skills</h1>' +
    '<p>Buka aplikasi asesmen. Aplikasi dapat digunakan dari handphone maupun laptop.</p>' +
    '<a href="' + escapedUrl + '" target="_top" rel="noopener">Buka aplikasi</a>' +
    '</main></body></html>',
  ).setTitle('Creative Thinking Skills');
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
    if (payload.action === 'syncRoster') {
      if (!Array.isArray(payload.students) || payload.students.some((student) => (
        !student || typeof student.studentId !== 'string' || !student.studentId ||
        typeof student.attemptId !== 'string' || !student.attemptId
      ))) {
        return jsonResponse({ ok: false, error: 'Daftar siswa selesai asesmen tidak valid.' });
      }
      const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
      const sheet = spreadsheet.getSheetByName('Rekap Siswa') || spreadsheet.insertSheet('Rekap Siswa');
      const headers = [
        'ID Siswa', 'ID Percobaan', 'Nama', 'Username', 'Kelas', 'Nomor Absen',
        'Status Asesmen', 'Waktu Pengumpulan', 'Status Penilaian',
        'Skor Fluency', 'Skor Flexibility', 'Skor Originality', 'Skor Elaboration',
        'Skor Total', 'Nilai Akhir', 'Kategori', 'Waktu Penilaian', 'Nama Sekolah',
      ];
      if (!ensureHeaders(sheet, headers)) {
        return jsonResponse({ ok: false, error: 'Susunan kolom tab Rekap Siswa tidak sesuai versi aplikasi.' });
      }

      const lastRow = sheet.getLastRow();
      const ids = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat() : [];
      const rowByStudentId = new Map(ids.map((id, index) => [String(id), index + 2]));
      const newRows = [];
      payload.students.forEach((student) => {
        const scores = student.scores || {};
        const values = [
          sheetCell(student.studentId),
          sheetCell(student.attemptId),
          sheetCell(student.fullName || ''),
          sheetCell(student.username || ''),
          sheetCell(student.className || ''),
          sheetCell(student.attendanceNumber || ''),
          sheetCell(student.status || ''),
          sheetCell(student.submittedAt || ''),
          sheetCell(student.gradeStatus || 'not_graded'),
          scoreCell(scores.fluency),
          scoreCell(scores.flexibility),
          scoreCell(scores.originality),
          scoreCell(scores.elaboration),
          scoreCell(student.totalScore),
          scoreCell(student.finalScore),
          sheetCell(student.category || ''),
          sheetCell(student.gradedAt || ''),
          sheetCell(student.schoolName || ''),
        ];
        const rowNumber = rowByStudentId.get(String(student.studentId));
        if (rowNumber) {
          sheet.getRange(rowNumber, 1, 1, values.length).setValues([values]);
        } else {
          newRows.push(values);
        }
      });
      if (newRows.length) {
        sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, headers.length).setValues(newRows);
      }
      return jsonResponse({ ok: true, syncedCount: payload.students.length });
    }
    if (payload.action === 'deleteAttempts') {
      if (!Array.isArray(payload.attemptIds) || payload.attemptIds.some((id) => typeof id !== 'string' || !id)) {
        return jsonResponse({ ok: false, error: 'Daftar ID percobaan tidak valid.' });
      }
      if (payload.attemptIds.length === 0) {
        return jsonResponse({ ok: true, deletedRows: 0 });
      }
      const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
      const idsToDelete = new Set(payload.attemptIds);
      const deletedRows = deleteRowsMatching(spreadsheet.getSheetByName('Hasil Asesmen'), 1, idsToDelete) +
        deleteRowsMatching(spreadsheet.getSheetByName('Rekap Siswa'), 2, idsToDelete);
      return jsonResponse({ ok: true, deletedRows });
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
      'Skor Total', 'Nilai Akhir', 'Kategori', 'Umpan Balik Umum', 'Waktu Penilaian', 'Nama Sekolah',
    ];
    if (!ensureHeaders(sheet, headers)) {
      return jsonResponse({ ok: false, error: 'Susunan kolom spreadsheet tidak sesuai versi aplikasi.' });
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
      sheetCell(payload.student.schoolName || ''),
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

function ensureHeaders(sheet, headers) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    return true;
  }
  const existingHeaders = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  if (headers.every((header, index) => existingHeaders[index] === header)) return true;

  const isPreviousVersion = headers.slice(0, -1).every((header, index) => existingHeaders[index] === header) &&
    !existingHeaders[headers.length - 1];
  if (!isPreviousVersion) return false;
  sheet.getRange(1, headers.length).setValue(headers[headers.length - 1]);
  return true;
}

function deleteRowsMatching(sheet, column, idsToDelete) {
  if (!sheet || sheet.getLastRow() < 2) return 0;
  const rows = sheet.getRange(2, column, sheet.getLastRow() - 1, 1).getValues().flat();
  const rowNumbers = rows
    .map((id, index) => idsToDelete.has(String(id)) ? index + 2 : null)
    .filter((rowNumber) => rowNumber !== null)
    .sort((left, right) => right - left);
  rowNumbers.forEach((rowNumber) => sheet.deleteRow(rowNumber));
  return rowNumbers.length;
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
