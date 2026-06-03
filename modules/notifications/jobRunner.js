const notificationRepository = require('./notificationRepository');

async function runNotificationJobs(now = new Date()) {
  const runDate = now.toISOString().slice(0, 10);
  const [dailyReminders, budgetThresholds, debtReminders] = await Promise.all([
    notificationRepository.createDailyReminderEvents(runDate),
    notificationRepository.createBudgetThresholdEvents(),
    notificationRepository.createDebtReminderEvents(runDate),
  ]);
  const pendingNotifications =
    await notificationRepository.sendPendingNotificationEvents();

  return {
    dailyReminderCount: dailyReminders.length,
    budgetThresholdCount: budgetThresholds.length,
    debtReminderCount: debtReminders.length,
    pendingNotificationCount: pendingNotifications.length,
  };
}

module.exports = {
  runNotificationJobs,
};
