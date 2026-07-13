const notificationRepository = require('./notificationRepository');

const JOBS = [
  { key: 'dailyReminder', run: (runDate) => notificationRepository.createDailyReminderEvents(runDate) },
  { key: 'budgetThreshold', run: () => notificationRepository.createBudgetThresholdEvents() },
  { key: 'debtReminder', run: (runDate) => notificationRepository.createDebtReminderEvents(runDate) },
];

/**
 * Chạy 3 job tạo event độc lập nhau bằng allSettled - 1 job lỗi (vd lỗi
 * DB thoáng qua, hoặc lỗi mạng khi gửi push ngay trong lúc tạo event)
 * không được chặn 2 job còn lại, và không được chặn việc gửi các
 * notification đang chờ từ các lượt chạy trước.
 */
async function runNotificationJobs(now = new Date()) {
  const runDate = now.toISOString().slice(0, 10);
  const results = await Promise.allSettled(JOBS.map((job) => job.run(runDate)));

  const counts = {};
  const errors = [];

  results.forEach((result, index) => {
    const { key } = JOBS[index];

    if (result.status === 'fulfilled') {
      counts[key] = result.value.length;
    } else {
      counts[key] = 0;
      errors.push({ job: key, error: result.reason?.message || String(result.reason) });
      console.error({ job: `notifications.${key}`, error: errors[errors.length - 1].error });
    }
  });

  let pendingNotificationCount = 0;

  try {
    const pendingNotifications = await notificationRepository.sendPendingNotificationEvents();

    pendingNotificationCount = pendingNotifications.length;
  } catch (err) {
    errors.push({ job: 'sendPendingNotificationEvents', error: err.message });
    console.error({ job: 'notifications.sendPendingNotificationEvents', error: err.message });
  }

  return {
    dailyReminderCount: counts.dailyReminder,
    budgetThresholdCount: counts.budgetThreshold,
    debtReminderCount: counts.debtReminder,
    pendingNotificationCount,
    errors,
  };
}

module.exports = {
  runNotificationJobs,
};
