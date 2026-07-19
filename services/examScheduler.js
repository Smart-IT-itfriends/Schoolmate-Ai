const examService = require('./examService');

const MS_MINUTE = 60 * 1000;
const MS_HOUR = 60 * MS_MINUTE;
const MS_DAY = 24 * MS_HOUR;

function shouldSendReminder(msUntil, offsetMs, nextOffsetMs) {
  if (msUntil <= 0) {
    return false;
  }

  const lowerBound = nextOffsetMs || 0;
  return msUntil <= offsetMs && msUntil > lowerBound;
}

function processExamReminders(bot, config, sendMessage) {
  const now = new Date();
  const defaultReminders = [
    { field: 'notified2d', offsetMs: 2 * MS_DAY, messageKey: 'examReminder2d' },
    { field: 'notified1d', offsetMs: MS_DAY, messageKey: 'examReminder1d' },
    { field: 'notified2h', offsetMs: 2 * MS_HOUR, messageKey: 'examReminder2h' },
  ];
  const reminders = config.exams?.reminders || defaultReminders;

  let sent = 0;

  for (const exam of examService.getAllExams()) {
    const scheduledAt = new Date(exam.scheduledAt);
    if (scheduledAt <= now) {
      continue;
    }

    const msUntil = scheduledAt - now;

    for (let i = 0; i < reminders.length; i += 1) {
      const reminder = reminders[i];
      const nextOffsetMs = i < reminders.length - 1 ? reminders[i + 1].offsetMs : 0;

      if (exam[reminder.field]) {
        continue;
      }

      if (!shouldSendReminder(msUntil, reminder.offsetMs, nextOffsetMs)) {
        continue;
      }

      const template = config.messages[reminder.messageKey];
      const formattedDate = examService.formatExamDate(exam.scheduledAt, exam.timezone);
      const message = template
        .replace('{title}', exam.title)
        .replace('{date}', formattedDate);

      sendMessage(bot, exam.chatId, message);
      examService.markNotified(exam.id, reminder.field);
      sent += 1;
    }
  }

  return sent;
}

function startExamScheduler(bot, config) {
  const intervalMs = (config.exams?.checkIntervalMinutes || 1) * MS_MINUTE;

  const tick = () => {
    try {
      const sent = processExamReminders(bot, config, (telegramBot, chatId, message) => {
        telegramBot.sendMessage(chatId, message, { parse_mode: 'HTML' });
      });

      if (sent > 0) {
        console.log(`[exams] Надіслано ${sent} нагадувань про КР`);
      }
    } catch (error) {
      console.error('[exams] Помилка планувальника:', error);
    }
  };

  tick();
  return setInterval(tick, intervalMs);
}

module.exports = {
  processExamReminders,
  startExamScheduler,
};
