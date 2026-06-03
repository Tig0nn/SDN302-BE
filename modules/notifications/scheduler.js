const env = require('../../config/env');
const { runNotificationJobs } = require('./jobRunner');

function startNotificationScheduler() {
  if (!env.NOTIFICATION_JOBS_ENABLED) {
    return function stopDisabledScheduler() {};
  }

  let isRunning = false;

  async function tick() {
    if (isRunning) return;

    isRunning = true;

    try {
      await runNotificationJobs();
    } catch (err) {
      console.error({
        job: 'notifications',
        error: err.message,
      });
    } finally {
      isRunning = false;
    }
  }

  const timer = setInterval(tick, env.NOTIFICATION_JOB_INTERVAL_MS);

  if (timer.unref) {
    timer.unref();
  }

  tick();

  return function stopNotificationScheduler() {
    clearInterval(timer);
  };
}

module.exports = {
  startNotificationScheduler,
};
