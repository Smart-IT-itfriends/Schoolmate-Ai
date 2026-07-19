// Configuration for Schoolmate-Ai Bot
module.exports = {
  // Replace with your Telegram Bot Token from BotFather
  TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN || 'YOUR_BOT_TOKEN_HERE',

  punishment: {
    softThresholdHours: 24,
    hardThresholdDays: 3,
    xpPenalty: 50,
    freezeItemCost: 100,
    riskThresholdHours: 18,
    checkIntervalHours: 6,
  },

  // Bot messages
  messages: {
    start: 'Привіт 👋 Ласкаво просимо до Schoolmate AI!\n\nЯ допоможу тобі з навчанням. Вибери, що тебе цікавить:',
    explainTopic: 'Яку тему ти хочеш розібрати? Напиши назву теми або номер параграфа.',
    createTest: '🧠 <b>Створення тесту</b>\n\n<i>Ця функція з\'явиться пізніше від AI.</i>',
    myProgress: 'Твій прогрес:\n\n📊 Всього завдань розв\'язано: 0\n✅ Успішно: 0\n⏳ В процесі: 0\n\n(Дані будуть заповнені)',
    help: 'Довідка по кнопкам:\n\n📚 <b>Пояснити тему</b> - отримай пояснення будь-якої теми\n🧠 <b>Створити тест</b> - генеруй тести для тренування (скоро від AI)\n📈 <b>Мій прогрес</b> - подивись свою статистику\n👤 <b>Мій профіль</b> - подивись свої дані\n🎁 <b>Забрати нагороду</b> - отримай щоденний бонус\n⚙️ <b>Допомога</b> - натисни ще раз для деталей',
    error: 'Вибачте, сталася помилка. Спробуйте ще раз.',
    rewardClaimed: '🎉 Ти отримав нагороду!',
    rewardAlreadyClaimed: '⏳ Ти вже забрав свою нагороду сьогодні! Повертайся завтра.',
    rewardSoon: 'Ще трохи почекай — нагорода доступна раз на день.',
    rewardUnavailable: 'Наразі нагорода недоступна. Спробуй знову завтра.',
    rewardResult: '🎁 <b>Нагорода:</b> %s\n📈 <b>Отримано XP:</b> %s\n🔥 <b>Поточний стрік:</b> %s день(ів)',
    profileTitle: '👤 <b>Мій профіль</b>\n\n',
    profileNoRegistration: 'Ти ще не завершив реєстрацію. Натисни /start, щоб почати.',
    profileNoSubject: 'Не обрано',
    profileNoData: 'Невідомо',
    punishmentSoft: '💤 Ой! Ти довго не заходив(ла), тому твій вогник активності згас. Стрік скинуто до 0. Повертайся до навчання щодня! 🔥',
    punishmentHard: '😢 О ні! Ти пропустив(ла) навчання більше 3 днів. Стрік скинуто, і ти втратив(ла) <b>{xp} XP</b> через лінощі. Залишилось XP: <b>{remaining}</b>. Час повертатися до навчання!',
    punishmentFreezeUsed: '🧊 Твоя <b>Заморозка стріку</b> спрацювала! Стрік і XP залишились без змін. Наступного разу бережи прогрес сам(а)!',
    progressStatusActive: '🔥 Статус: <b>Вогонь горить</b> — так тримати!',
    progressStatusRisk: '⚠️ Статус: <b>Є ризик втрати прогресу</b> — зайди сьогодні!',
    progressStatusCold: '💤 Статус: <b>Вогонь згас</b> — віднови стрік активності!',
    progressHasFreeze: '🧊 Заморозка стріку: <b>є в інвентарі</b>',
    progressNoFreeze: '🧊 Заморозка стріку: <b>немає</b> (купи за {cost} XP)',
    freezePurchased: '🧊 Ти купив(ла) <b>Заморозку стріку</b> за {cost} XP! Вона один раз захистить тебе від штрафу за пропуск.',
    freezeAlreadyOwned: 'У тебе вже є Заморозка стріку в інвентарі.',
    freezeNotEnoughXp: 'Недостатньо XP. Заморозка коштує {cost} XP.',
  }
};
