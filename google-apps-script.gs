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
      const attempts = Array.isArray(payload.attempts)
        ? payload.attempts
        : (Array.isArray(payload.students) ? payload.students.filter((student) => student && student.attemptId) : []);
      if (!Array.isArray(payload.students) || payload.students.some((student) => (
        !student || typeof student.studentId !== 'string' || !student.studentId
      )) || !Array.isArray(attempts) || attempts.some((attempt) => (
        !attempt || typeof attempt.studentId !== 'string' || !attempt.studentId ||
        typeof attempt.attemptId !== 'string' || !attempt.attemptId
      ))) {
        return jsonResponse({ ok: false, error: 'Daftar profil atau hasil asesmen tidak valid.' });
      }
      const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
      const profileSheet = spreadsheet.getSheetByName('Profil Siswa') || spreadsheet.insertSheet('Profil Siswa');
      const profileHeaders = [
        'ID Siswa', 'Nama', 'Username', 'Nama Sekolah', 'Kelas', 'Nomor Absen', 'Terdaftar Sejak',
      ];
      if (!ensureHeaders(profileSheet, profileHeaders)) {
        return jsonResponse({ ok: false, error: 'Susunan kolom tab Profil Siswa tidak sesuai versi aplikasi.' });
      }
      const rosterSheet = spreadsheet.getSheetByName('Rekap Siswa') || spreadsheet.insertSheet('Rekap Siswa');
      const rosterHeaders = [
        'ID Siswa', 'ID Percobaan', 'Nama', 'Username', 'Kelas', 'Nomor Absen',
        'Status Asesmen', 'Waktu Pengumpulan', 'Status Penilaian',
        'Skor Fluency', 'Skor Flexibility', 'Skor Originality', 'Skor Elaboration',
        'Skor Total', 'Nilai Akhir', 'Kategori', 'Waktu Penilaian', 'Nama Sekolah',
      ];
      if (!ensureHeaders(rosterSheet, rosterHeaders)) {
        return jsonResponse({ ok: false, error: 'Susunan kolom tab Rekap Siswa tidak sesuai versi aplikasi.' });
      }
      const profileRows = payload.students.map((student) => [
        sheetCell(student.studentId),
        sheetCell(student.fullName || ''),
        sheetCell(student.username || ''),
        sheetCell(student.schoolName || ''),
        sheetCell(student.className || ''),
        sheetCell(student.attendanceNumber || ''),
        sheetCell(student.registeredAt || ''),
      ]);
      const rosterRows = attempts.map((attempt) => {
        const scores = attempt.scores || {};
        return [
          sheetCell(attempt.studentId),
          sheetCell(attempt.attemptId),
          sheetCell(attempt.fullName || ''),
          sheetCell(attempt.username || ''),
          sheetCell(attempt.className || ''),
          sheetCell(attempt.attendanceNumber || ''),
          sheetCell(attempt.status || ''),
          sheetCell(attempt.submittedAt || ''),
          sheetCell(attempt.gradeStatus || 'not_graded'),
          scoreCell(scores.fluency),
          scoreCell(scores.flexibility),
          scoreCell(scores.originality),
          scoreCell(scores.elaboration),
          scoreCell(attempt.totalScore),
          scoreCell(attempt.finalScore),
          sheetCell(attempt.category || ''),
          sheetCell(attempt.gradedAt || ''),
          sheetCell(attempt.schoolName || ''),
        ];
      });
      replaceSheetRows(profileSheet, profileHeaders.length, profileRows);
      replaceSheetRows(rosterSheet, rosterHeaders.length, rosterRows);
      return jsonResponse({
        ok: true,
        profileCount: payload.students.length,
        syncedCount: attempts.length,
      });
    }
    if (payload.action === 'deleteAttempts') {
      if (!Array.isArray(payload.attemptIds) || payload.attemptIds.some((id) => typeof id !== 'string' || !id)) {
        return jsonResponse({ ok: false, error: 'Daftar ID percobaan tidak valid.' });
      }
      const studentIds = payload.studentIds || [];
      if (!Array.isArray(studentIds) || studentIds.some((id) => typeof id !== 'string' || !id)) {
        return jsonResponse({ ok: false, error: 'Daftar ID siswa tidak valid.' });
      }
      if (payload.attemptIds.length === 0 && studentIds.length === 0) {
        return jsonResponse({ ok: true, deletedRows: 0 });
      }
      const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
      const idsToDelete = new Set(payload.attemptIds);
      const studentIdsToDelete = new Set(studentIds);
      const photoSheet = spreadsheet.getSheetByName('Lampiran Foto');
      const deletedFiles = deleteDriveFilesForAttempts(photoSheet, idsToDelete);
      const deletedRows = deleteRowsMatching(spreadsheet.getSheetByName('Hasil Asesmen'), 1, idsToDelete) +
        deleteRowsMatching(spreadsheet.getSheetByName('Rekap Siswa'), 1, studentIdsToDelete) +
        deleteRowsMatching(spreadsheet.getSheetByName('Rekap Siswa'), 2, idsToDelete) +
        deleteRowsMatching(spreadsheet.getSheetByName('Profil Siswa'), 1, studentIdsToDelete) +
        deleteRowsMatching(photoSheet, 1, idsToDelete);
      return jsonResponse({ ok: true, deletedRows, deletedFiles });
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
    const driveAttachments = copyAttachmentsToDrive(spreadsheet, payload, expectedToken);

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
      sheetCell(JSON.stringify(driveAttachments)),
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

function replaceSheetRows(sheet, columnCount, rows) {
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, columnCount).clearContent();
  if (rows.length) sheet.getRange(2, 1, rows.length, columnCount).setValues(rows);
}

function copyAttachmentsToDrive(spreadsheet, payload, expectedToken) {
  const attachments = payload.attachments || [];
  if (!Array.isArray(attachments)) throw new Error('Daftar lampiran tidak valid.');
  const sheet = spreadsheet.getSheetByName('Lampiran Foto') || spreadsheet.insertSheet('Lampiran Foto');
  const headers = [
    'ID Percobaan', 'ID Lampiran', 'ID Siswa', 'Nama Siswa', 'Username',
    'Nama Sekolah', 'Kelas', 'ID Soal', 'Nama File', 'Tipe File',
    'Ukuran (byte)', 'File Google Drive', 'ID File Drive', 'Waktu Unggah',
  ];
  if (!ensureHeaders(sheet, headers)) {
    throw new Error('Susunan kolom tab Lampiran Foto tidak sesuai versi aplikasi.');
  }
  if (!attachments.length) return [];
  if (!payload.student || !payload.student.studentId) {
    throw new Error('Profil siswa tidak tersedia untuk lampiran.');
  }
  const properties = PropertiesService.getScriptProperties();
  const appUrl = (properties.getProperty('VERCEL_APP_URL') || '').replace(/\/$/, '');
  if (!appUrl) throw new Error('VERCEL_APP_URL wajib diatur untuk menyalin foto ke Google Drive.');
  const expectedPrefix = appUrl + '/api/sync/attachments/';
  const folder = getPhotoFolder(properties);
  const lastRow = sheet.getLastRow();
  const existingIds = lastRow > 1
    ? sheet.getRange(2, 2, lastRow - 1, 1).getValues().flat()
    : [];
  const rowByAttachmentId = new Map(existingIds.map((id, index) => [String(id), index + 2]));
  const driveAttachments = [];

  attachments.forEach((attachment) => {
    if (!attachment || typeof attachment.id !== 'string' ||
        !/^[0-9a-f-]{36}$/i.test(attachment.id) ||
        attachment.url !== expectedPrefix + encodeURIComponent(attachment.id) ||
        !['image/jpeg', 'image/png', 'image/webp'].includes(attachment.mimeType)) {
      throw new Error('Data lampiran tidak valid atau alamat foto tidak sesuai.');
    }
    const originalName = String(attachment.originalName || 'foto-siswa').replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 120);
    const driveFileName = attachment.id + '_' + originalName;
    const existingFiles = folder.getFilesByName(driveFileName);
    let file;
    if (existingFiles.hasNext()) {
      file = existingFiles.next();
    } else {
      const response = UrlFetchApp.fetch(attachment.url, {
        headers: { Authorization: 'Bearer ' + expectedToken },
        muteHttpExceptions: true,
      });
      if (response.getResponseCode() !== 200) {
        throw new Error('Gagal mengambil foto ' + originalName + ' dari aplikasi (HTTP ' + response.getResponseCode() + ').');
      }
      const blob = response.getBlob();
      const sizeBytes = blob.getBytes().length;
      if (sizeBytes < 1 || sizeBytes > 3 * 1024 * 1024 ||
          Number(attachment.sizeBytes) !== sizeBytes ||
          blob.getContentType() !== attachment.mimeType) {
        throw new Error('Ukuran atau tipe file foto ' + originalName + ' tidak sesuai.');
      }
      file = folder.createFile(blob.setName(driveFileName));
    }

    const rowValues = [
      sheetCell(payload.attemptId),
      sheetCell(attachment.id),
      sheetCell(payload.student.studentId),
      sheetCell(payload.student.fullName || ''),
      sheetCell(payload.student.username || ''),
      sheetCell(payload.student.schoolName || ''),
      sheetCell(payload.student.className || ''),
      sheetCell(attachment.questionId || ''),
      sheetCell(originalName),
      sheetCell(attachment.mimeType),
      Number(attachment.sizeBytes),
      file.getUrl(),
      file.getId(),
      sheetCell(attachment.createdAt || ''),
    ];
    const rowNumber = rowByAttachmentId.get(attachment.id);
    if (rowNumber) {
      writePhotoRow(sheet, rowNumber, rowValues);
    } else {
      const newRow = sheet.getLastRow() + 1;
      writePhotoRow(sheet, newRow, rowValues);
      rowByAttachmentId.set(attachment.id, newRow);
    }
    driveAttachments.push({
      id: attachment.id,
      questionId: attachment.questionId,
      originalName,
      mimeType: attachment.mimeType,
      sizeBytes: Number(attachment.sizeBytes),
      driveUrl: file.getUrl(),
    });
  });
  return driveAttachments;
}

function writePhotoRow(sheet, rowNumber, values) {
  sheet.getRange(rowNumber, 1, 1, values.length).setValues([values]);
  const url = String(values[11]);
  sheet.getRange(rowNumber, 12).setRichTextValue(
    SpreadsheetApp.newRichTextValue().setText(url).setLinkUrl(url).build(),
  );
}

function getPhotoFolder(properties) {
  const folderId = properties.getProperty('DRIVE_FOLDER_ID');
  const folder = folderId
    ? DriveApp.getFolderById(folderId)
    : DriveApp.createFolder('Creative Thinking Skills - Foto Siswa');
  if (!folderId) properties.setProperty('DRIVE_FOLDER_ID', folder.getId());
  const access = folder.getSharingAccess();
  if (access === DriveApp.Access.ANYONE || access === DriveApp.Access.ANYONE_WITH_LINK) {
    throw new Error('Folder foto harus privat; jangan gunakan akses siapa saja atau siapa saja yang memiliki link.');
  }
  return folder;
}

function deleteDriveFilesForAttempts(sheet, attemptIds) {
  if (!sheet || !attemptIds.size || sheet.getLastRow() < 2 || sheet.getLastColumn() < 13) return 0;
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 13).getValues();
  const fileIds = rows
    .filter((row) => attemptIds.has(String(row[0])) && row[12])
    .map((row) => String(row[12]));
  fileIds.forEach((fileId) => DriveApp.getFileById(fileId).setTrashed(true));
  return fileIds.length;
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
