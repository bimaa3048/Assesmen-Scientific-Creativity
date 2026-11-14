'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

async function availablePort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const { port } = listener.address();
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return port;
}

test('student saves and restores answers, submits, and sees teacher-published results only', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scientific-creativity-'));
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dataDir,
      TEACHER_PASSWORD: 'IntegrationTeacher123',
    },
    stdio: 'ignore',
  });
  t.after(async () => {
    child.kill();
    await new Promise((resolve) => child.once('exit', resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  async function request(endpoint, method = 'GET', body, cookie = '') {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (cookie) headers.Cookie = cookie;
    const response = await fetch(`${baseUrl}${endpoint}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`Respons API bukan JSON: ${text}`);
    }
    return {
      status: response.status,
      payload,
      cookie: response.headers.getSetCookie?.()[0]?.split(';')[0] || cookie,
    };
  }

  let ready = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await request('/api/me');
      if (response.status === 200 && response.payload.user === null) {
        assert.match(
          response.payload.assessment.simulationEmbedUrl,
          /^https:\/\/phet\.colorado\.edu\/sims\/html\/circuit-construction-kit-dc\//,
        );
        ready = true;
        break;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  assert.equal(ready, true, 'server should start and answer requests');

  const registration = await request('/api/register', 'POST', {
    fullName: 'Siswa Integrasi',
    username: 'student_integration',
    password: 'StudentIntegration123',
    confirmPassword: 'StudentIntegration123',
    className: 'XI IPA 1',
    attendanceNumber: '5',
    schoolName: 'SMA Integrasi',
  });
  assert.equal(registration.status, 201);
  assert.equal(registration.payload.user.role, 'student');
  assert.equal(registration.payload.user.schoolName, 'SMA Integrasi');
  assert.equal('password' in registration.payload.user, false);
  let studentCookie = registration.cookie;

  const started = await request('/api/attempts/start', 'POST', {}, studentCookie);
  assert.equal(started.status, 201);
  const attemptId = started.payload.attempt.id;
  const originalDeadline = started.payload.attempt.deadlineAt;

  const answer = {
    answerText: 'Tiga lampu disusun seri.',
    structuredData: { configurations: '3 lampu seri', measurements: 'Arus total 0,3 A' },
  };
  const saved = await request(`/api/attempts/${attemptId}/answers/q1`, 'PUT', answer, studentCookie);
  assert.equal(saved.status, 200);
  assert.equal(saved.payload.saved, true);
  assert.ok(saved.payload.updatedAt);
  const savedAdditionalConfiguration = await request(`/api/attempts/${attemptId}/answers/q1`, 'PUT', {
    answerText: 'Konfigurasi 1: seri. Konfigurasi 2: paralel.',
    structuredData: {
      ...answer.structuredData,
      answerConfigurations: [{ configurations: '3 lampu paralel', measurements: 'Arus total 0,9 A' }],
    },
  }, studentCookie);
  assert.equal(savedAdditionalConfiguration.status, 200);
  const upload = await request(`/api/attempts/${attemptId}/attachments`, 'POST', {
    questionId: 'q1',
    fileName: 'phet-test.png',
    mimeType: 'image/png',
    dataBase64: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/B5sAAAAASUVORK5CYII=', 'base64').toString('base64'),
  }, studentCookie);
  assert.equal(upload.status, 201);
  const attachmentId = upload.payload.attachment.id;
  const secondUpload = await request(`/api/attempts/${attemptId}/attachments`, 'POST', {
    questionId: 'q1',
    fileName: 'phet-test-2.png',
    mimeType: 'image/png',
    dataBase64: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/B5sAAAAASUVORK5CYII=', 'base64').toString('base64'),
  }, studentCookie);
  assert.equal(secondUpload.status, 201);

  const restarted = await request('/api/attempts/start', 'POST', {}, studentCookie);
  assert.equal(restarted.payload.attempt.deadlineAt, originalDeadline, 'reopening must not reset the server timer');
  await request('/api/logout', 'POST', {}, studentCookie);
  const relogin = await request('/api/login', 'POST', {
    username: 'student_integration',
    password: 'StudentIntegration123',
  });
  studentCookie = relogin.cookie;
  const recovered = await request('/api/student/dashboard', 'GET', undefined, studentCookie);
  assert.equal(recovered.payload.answers[0].structuredData.configurations, '3 lampu seri');
  assert.equal(recovered.payload.answers[0].structuredData.answerConfigurations[0].configurations, '3 lampu paralel');
  assert.equal(recovered.payload.attachments.length, 2, 'all configuration screenshots should persist after login');

  const forbiddenDashboard = await request('/api/teacher/dashboard', 'GET', undefined, studentCookie);
  assert.equal(forbiddenDashboard.status, 403);

  const submitted = await request(`/api/attempts/${attemptId}/submit`, 'POST', {}, studentCookie);
  assert.equal(submitted.payload.submitted, true);
  const lockedAnswer = await request(`/api/attempts/${attemptId}/answers/q1`, 'PUT', answer, studentCookie);
  assert.equal(lockedAnswer.status, 409);
  const waiting = await request('/api/student/results', 'GET', undefined, studentCookie);
  assert.equal(waiting.payload.state, 'waiting');

  const teacherLogin = await request('/api/login', 'POST', {
    username: 'Bimaaditya',
    password: 'IntegrationTeacher123',
  });
  const teacherCookie = teacherLogin.cookie;
  const renamedTeacher = await request('/api/teacher/profile', 'PUT', {
    fullName: 'Guru Integrasi',
  }, teacherCookie);
  assert.equal(renamedTeacher.status, 200);
  assert.equal(renamedTeacher.payload.user.fullName, 'Guru Integrasi');
  assert.equal(renamedTeacher.payload.user.username, 'Bimaaditya');
  const teacherMe = await request('/api/me', 'GET', undefined, teacherCookie);
  assert.equal(teacherMe.payload.user.fullName, 'Guru Integrasi');
  const teacherReview = await request(`/api/teacher/attempts/${attemptId}`, 'GET', undefined, teacherCookie);
  assert.equal(teacherReview.payload.answers[0].structuredData.configurations, '3 lampu seri');
  assert.equal(teacherReview.payload.answers[0].structuredData.answerConfigurations[0].measurements, 'Arus total 0,9 A');
  assert.equal(teacherReview.payload.attachments.length, 2, 'teacher should receive every configuration screenshot');
  assert.equal(teacherReview.payload.attachments[0].id, attachmentId);
  const attachmentResponse = await fetch(`${baseUrl}/api/attachments/${attachmentId}`, {
    headers: { Cookie: teacherCookie },
  });
  assert.equal(attachmentResponse.status, 200);
  assert.equal(attachmentResponse.headers.get('Content-Type'), 'image/png');

  const questionFeedback = [
    { questionId: 'q1', score: 4, feedbackText: 'Lengkap.' },
    { questionId: 'q2', score: 3, feedbackText: 'Baik.' },
    { questionId: 'q3', score: 4, feedbackText: 'Inovatif.' },
    { questionId: 'q4', score: 2, feedbackText: 'Lengkapi tabel.' },
  ];
  const gradeDraft = await request(`/api/teacher/attempts/${attemptId}/grade`, 'PUT', {
    scores: { fluency: 4, flexibility: 3, originality: 4, elaboration: 2 },
    generalFeedback: 'Analisis sangat baik.',
    questionFeedback,
    publish: false,
  }, teacherCookie);
  assert.equal(gradeDraft.payload.published, false);
  const hiddenDraft = await request('/api/student/dashboard', 'GET', undefined, studentCookie);
  assert.equal(hiddenDraft.payload.grade.status, 'draft');
  assert.equal('scores' in hiddenDraft.payload.grade, false);
  assert.equal((await request('/api/student/results', 'GET', undefined, studentCookie)).payload.state, 'waiting');

  const published = await request(`/api/teacher/attempts/${attemptId}/grade`, 'PUT', {
    scores: { fluency: 4, flexibility: 3, originality: 4, elaboration: 2 },
    generalFeedback: 'Analisis sangat baik.',
    questionFeedback,
    publish: true,
  }, teacherCookie);
  assert.equal(published.payload.grade.total, 13);
  assert.equal(published.payload.grade.finalScore, 81.25);
  const teacherDashboardAfterGrading = await request('/api/teacher/dashboard', 'GET', undefined, teacherCookie);
  const registeredStudent = teacherDashboardAfterGrading.payload.students.find((student) => student.id === registration.payload.user.id);
  assert.equal(registeredStudent.school_name, 'SMA Integrasi');
  const dashboardGrade = teacherDashboardAfterGrading.payload.attempts.find((attempt) => attempt.id === attemptId).grade;
  assert.equal(dashboardGrade.finalScore, 81.25);
  assert.equal(dashboardGrade.totalScore, 13);
  assert.equal(dashboardGrade.scores.flexibility, 3);
  assert.equal(dashboardGrade.category, 'Sangat Kreatif');
  const result = await request('/api/student/results', 'GET', undefined, studentCookie);
  assert.equal(result.payload.state, 'published');
  assert.equal(result.payload.grade.finalScore, 81.25);

  const otherStudent = await request('/api/register', 'POST', {
    fullName: 'Siswa Lain',
    username: 'student_integration_2',
    password: 'StudentIntegration123',
    confirmPassword: 'StudentIntegration123',
    className: 'XI IPA 2',
    schoolName: 'SMA Integrasi',
  });
  const crossAttempt = await request(`/api/attempts/${attemptId}/answers/q1`, 'PUT', answer, otherStudent.cookie);
  assert.equal(crossAttempt.status, 404);
  const studentRename = await request('/api/teacher/profile', 'PUT', { fullName: 'Tidak Diizinkan' }, otherStudent.cookie);
  assert.equal(studentRename.status, 403);
  const crossAttachment = await fetch(`${baseUrl}/api/attachments/${attachmentId}`, {
    headers: { Cookie: otherStudent.cookie },
  });
  assert.equal(crossAttachment.status, 403);

  const removableStudent = await request('/api/register', 'POST', {
    fullName: 'Siswa Untuk Dihapus',
    username: 'student_to_delete',
    password: 'StudentIntegration123',
    confirmPassword: 'StudentIntegration123',
    className: 'XI IPA 3',
    schoolName: 'SMA Integrasi',
  });
  const removableStarted = await request('/api/attempts/start', 'POST', {}, removableStudent.cookie);
  const uploadFilesBeforeDelete = new Set(fs.readdirSync(path.join(dataDir, 'uploads')));
  const removableUpload = await request(`/api/attempts/${removableStarted.payload.attempt.id}/attachments`, 'POST', {
    questionId: 'q1',
    fileName: 'student-to-delete.png',
    mimeType: 'image/png',
    dataBase64: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/B5sAAAAASUVORK5CYII=', 'base64').toString('base64'),
  }, removableStudent.cookie);
  const removableAttachmentId = removableUpload.payload.attachment.id;
  const uploadFilesWithRemovableStudent = new Set(fs.readdirSync(path.join(dataDir, 'uploads')));
  const removableFile = [...uploadFilesWithRemovableStudent].find((file) => !uploadFilesBeforeDelete.has(file));
  assert.ok(removableFile, 'uploaded attachment should exist on disk');
  const forbiddenDelete = await request(`/api/teacher/students/${removableStudent.payload.user.id}`, 'DELETE', undefined, removableStudent.cookie);
  assert.equal(forbiddenDelete.status, 403);
  const protectedTeacher = await request(`/api/teacher/students/${teacherMe.payload.user.id}`, 'DELETE', undefined, teacherCookie);
  assert.equal(protectedTeacher.status, 404, 'teacher accounts must not be deletable through the student endpoint');
  const deletedStudent = await request(`/api/teacher/students/${removableStudent.payload.user.id}`, 'DELETE', undefined, teacherCookie);
  assert.equal(deletedStudent.status, 200);
  assert.equal(deletedStudent.payload.deleted, true);
  assert.equal(deletedStudent.payload.spreadsheetCleanup.status, 'not_configured');
  const dashboardAfterDelete = await request('/api/teacher/dashboard', 'GET', undefined, teacherCookie);
  assert.equal(dashboardAfterDelete.payload.students.some((student) => student.id === removableStudent.payload.user.id), false);
  assert.equal(dashboardAfterDelete.payload.attempts.some((attempt) => attempt.id === removableStarted.payload.attempt.id), false);
  assert.equal((await request(`/api/attachments/${removableAttachmentId}`, 'GET', undefined, teacherCookie)).status, 404);
  assert.equal(fs.existsSync(path.join(dataDir, 'uploads', removableFile)), false, 'deleted student attachment file should be removed');
  assert.equal((await request('/api/me', 'GET', undefined, removableStudent.cookie)).payload.user, null);
  assert.equal((await request('/api/login', 'POST', {
    username: 'student_to_delete',
    password: 'StudentIntegration123',
  })).status, 401);

  const resettableStudent = await request('/api/register', 'POST', {
    fullName: 'Siswa Untuk Reset',
    username: 'student_to_reset',
    password: 'StudentIntegration123',
    confirmPassword: 'StudentIntegration123',
    className: 'XI IPA 4',
    schoolName: 'SMA Integrasi',
  });
  const resettableAttempt = await request('/api/attempts/start', 'POST', {}, resettableStudent.cookie);
  const resettableAttemptId = resettableAttempt.payload.attempt.id;
  await request(`/api/attempts/${resettableAttemptId}/answers/q1`, 'PUT', answer, resettableStudent.cookie);
  const resettableUpload = await request(`/api/attempts/${resettableAttemptId}/attachments`, 'POST', {
    questionId: 'q1',
    fileName: 'resettable.png',
    mimeType: 'image/png',
    dataBase64: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/B5sAAAAASUVORK5CYII=', 'base64').toString('base64'),
  }, resettableStudent.cookie);
  const resettableAttachmentId = resettableUpload.payload.attachment.id;
  const resettableFile = fs.readdirSync(path.join(dataDir, 'uploads')).find((file) => file.startsWith(resettableAttachmentId));
  const resettableSubmitted = await request(`/api/attempts/${resettableAttemptId}/submit`, 'POST', {}, resettableStudent.cookie);
  assert.equal(resettableSubmitted.payload.submitted, true);
  const forbiddenAttemptReset = await request(`/api/teacher/attempts/${resettableAttemptId}`, 'DELETE', undefined, resettableStudent.cookie);
  assert.equal(forbiddenAttemptReset.status, 403);
  const resetResult = await request(`/api/teacher/attempts/${resettableAttemptId}`, 'DELETE', undefined, teacherCookie);
  assert.equal(resetResult.status, 200);
  assert.equal(resetResult.payload.reset, true);
  assert.equal(resetResult.payload.spreadsheetCleanup.status, 'not_configured');
  const resettableDashboard = await request('/api/student/dashboard', 'GET', undefined, resettableStudent.cookie);
  assert.equal(resettableDashboard.payload.attempt, null);
  assert.equal(resettableDashboard.payload.answers.length, 0);
  assert.equal(resettableDashboard.payload.attachments.length, 0);
  assert.equal(fs.existsSync(path.join(dataDir, 'uploads', resettableFile)), false);
  assert.equal((await request(`/api/attachments/${resettableAttachmentId}`, 'GET', undefined, teacherCookie)).status, 404);
  const freshAttempt = await request('/api/attempts/start', 'POST', {}, resettableStudent.cookie);
  assert.equal(freshAttempt.status, 201, 'student should be able to start a fresh attempt after reset');

  const reset = await request(`/api/teacher/students/${registration.payload.user.id}/reset-password`, 'POST', {}, teacherCookie);
  assert.equal(reset.status, 200);
  const resetLogin = await request('/api/login', 'POST', {
    username: 'student_integration',
    password: reset.payload.temporaryPassword,
  });
  assert.equal(resetLogin.payload.user.mustChangePassword, true);
});
