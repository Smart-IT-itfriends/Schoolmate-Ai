const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EXAMS_FILE = path.join(__dirname, '..', 'data', 'exams.json');

function loadData() {
  try {
    const data = fs.readFileSync(EXAMS_FILE, 'utf8');
    const parsed = JSON.parse(data || '{"exams":[]}');
    return Array.isArray(parsed.exams) ? parsed : { exams: [] };
  } catch {
    return { exams: [] };
  }
}

function saveData(data) {
  fs.writeFileSync(EXAMS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function generateId() {
  return crypto.randomBytes(6).toString('hex');
}

function getZonedParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const map = Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));

  return {
    year: parseInt(map.year, 10),
    month: parseInt(map.month, 10),
    day: parseInt(map.day, 10),
    hour: parseInt(map.hour, 10),
    minute: parseInt(map.minute, 10),
  };
}

function zonedTimeToUtc(year, month, day, hour, minute, timeZone) {
  let guess = Date.UTC(year, month - 1, day, hour, minute);

  for (let i = 0; i < 6; i += 1) {
    const parts = getZonedParts(new Date(guess), timeZone);
    const diffMinutes =
      (year - parts.year) * 525600 +
      (month - parts.month) * 43800 +
      (day - parts.day) * 1440 +
      (hour - parts.hour) * 60 +
      (minute - parts.minute);

    if (diffMinutes === 0) {
      return new Date(guess);
    }

    guess += diffMinutes * 60 * 1000;
  }

  return new Date(guess);
}

function parseExamDate(dateStr, timeZone = 'Europe/Kyiv') {
  const match = dateStr.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (!match) {
    return { valid: false, error: 'format' };
  }

  const day = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const year = parseInt(match[3], 10);
  const hour = parseInt(match[4] || '9', 10);
  const minute = parseInt(match[5] || '0', 10);

  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    return { valid: false, error: 'invalid' };
  }

  const scheduledAt = zonedTimeToUtc(year, month, day, hour, minute, timeZone);

  if (Number.isNaN(scheduledAt.getTime())) {
    return { valid: false, error: 'invalid' };
  }

  if (scheduledAt <= new Date()) {
    return { valid: false, error: 'past' };
  }

  return { valid: true, scheduledAt };
}

function formatExamDate(isoString, timeZone = 'Europe/Kyiv') {
  return new Date(isoString).toLocaleString('uk-UA', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getExamsByUser(userId) {
  const data = loadData();
  return data.exams
    .filter((exam) => String(exam.userId) === String(userId))
    .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
}

function getUpcomingExamsByUser(userId) {
  const now = new Date();
  return getExamsByUser(userId).filter((exam) => new Date(exam.scheduledAt) > now);
}

function getExamById(examId) {
  const data = loadData();
  return data.exams.find((exam) => exam.id === examId) || null;
}

function createExam({ userId, chatId, title, scheduledAt, timezone }) {
  const data = loadData();
  const exam = {
    id: generateId(),
    userId: String(userId),
    chatId,
    title: title.trim(),
    scheduledAt: scheduledAt.toISOString(),
    timezone: timezone || 'Europe/Kyiv',
    createdAt: new Date().toISOString(),
    notified2d: false,
    notified1d: false,
    notified2h: false,
  };

  data.exams.push(exam);
  saveData(data);
  return exam;
}

function updateExam(examId, userId, updates) {
  const data = loadData();
  const index = data.exams.findIndex(
    (exam) => exam.id === examId && String(exam.userId) === String(userId)
  );

  if (index === -1) {
    return null;
  }

  data.exams[index] = { ...data.exams[index], ...updates };
  saveData(data);
  return data.exams[index];
}

function deleteExam(examId, userId) {
  const data = loadData();
  const index = data.exams.findIndex(
    (exam) => exam.id === examId && String(exam.userId) === String(userId)
  );

  if (index === -1) {
    return false;
  }

  data.exams.splice(index, 1);
  saveData(data);
  return true;
}

function getAllExams() {
  return loadData().exams;
}

function markNotified(examId, field) {
  const data = loadData();
  const exam = data.exams.find((item) => item.id === examId);
  if (!exam) {
    return null;
  }

  exam[field] = true;
  saveData(data);
  return exam;
}

module.exports = {
  parseExamDate,
  formatExamDate,
  getExamsByUser,
  getUpcomingExamsByUser,
  getExamById,
  createExam,
  updateExam,
  deleteExam,
  getAllExams,
  markNotified,
};
