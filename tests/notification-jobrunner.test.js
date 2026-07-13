const test = require('node:test');
const assert = require('node:assert/strict');

const notificationRepository = require('../modules/notifications/notificationRepository');
const { runNotificationJobs } = require('../modules/notifications/jobRunner');

const original = {
  createDailyReminderEvents: notificationRepository.createDailyReminderEvents,
  createBudgetThresholdEvents: notificationRepository.createBudgetThresholdEvents,
  createDebtReminderEvents: notificationRepository.createDebtReminderEvents,
  sendPendingNotificationEvents: notificationRepository.sendPendingNotificationEvents,
};

test.afterEach(function cleanup() {
  Object.assign(notificationRepository, original);
});

test('runNotificationJobs still sends pending notifications when one job creator rejects', async function () {
  notificationRepository.createDailyReminderEvents = async function createDailyReminderEvents() {
    throw new Error('transient db error');
  };
  notificationRepository.createBudgetThresholdEvents = async function createBudgetThresholdEvents() {
    return [{ id: 'budget-event' }];
  };
  notificationRepository.createDebtReminderEvents = async function createDebtReminderEvents() {
    return [{ id: 'debt-event-1' }, { id: 'debt-event-2' }];
  };
  let sendPendingCalled = false;
  notificationRepository.sendPendingNotificationEvents = async function sendPendingNotificationEvents() {
    sendPendingCalled = true;
    return [{ id: 'pending-1' }];
  };

  const result = await runNotificationJobs(new Date('2026-06-15T00:00:00.000Z'));

  assert.equal(sendPendingCalled, true, 'sendPendingNotificationEvents must still run despite the failed job');
  assert.equal(result.dailyReminderCount, 0);
  assert.equal(result.budgetThresholdCount, 1);
  assert.equal(result.debtReminderCount, 2);
  assert.equal(result.pendingNotificationCount, 1);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].job, 'dailyReminder');
  assert.match(result.errors[0].error, /transient db error/);
});

test('runNotificationJobs reports all counts when every job succeeds', async function () {
  notificationRepository.createDailyReminderEvents = async function createDailyReminderEvents() {
    return [{ id: 'daily-1' }];
  };
  notificationRepository.createBudgetThresholdEvents = async function createBudgetThresholdEvents() {
    return [];
  };
  notificationRepository.createDebtReminderEvents = async function createDebtReminderEvents() {
    return [];
  };
  notificationRepository.sendPendingNotificationEvents = async function sendPendingNotificationEvents() {
    return [];
  };

  const result = await runNotificationJobs(new Date('2026-06-15T00:00:00.000Z'));

  assert.equal(result.dailyReminderCount, 1);
  assert.equal(result.budgetThresholdCount, 0);
  assert.equal(result.debtReminderCount, 0);
  assert.equal(result.pendingNotificationCount, 0);
  assert.deepEqual(result.errors, []);
});
