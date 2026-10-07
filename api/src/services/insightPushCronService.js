const PushToken = require('../models/pushToken');
const User = require('../models/user');
const { dispatchInsightPushesForUser } = require('./insightPushDispatcher');
const { notifyCronAlert } = require('./cronAlertService');
const { captureException } = require('./observability');

async function runInsightPushCron() {
  const userIds = await PushToken.findAllUserIds();
  let usersProcessed = 0;
  let usersFailed = 0;
  let notificationsSent = 0;

  for (const userId of userIds) {
    try {
      const user = await User.findById(userId);
      if (!user) continue;
      const result = await dispatchInsightPushesForUser(user);
      usersProcessed += 1;
      notificationsSent += Number(result.sent || 0);
    } catch (error) {
      usersFailed += 1;
      captureException(error, {
        area: 'insights_push_scheduler',
        phase: 'dispatch_user',
      });
    }
  }

  const result = {
    ok: usersFailed === 0,
    users_targeted: userIds.length,
    users_processed: usersProcessed,
    users_failed: usersFailed,
    notifications_sent: notificationsSent,
  };

  if (!result.ok) {
    await notifyCronAlert({
      job: 'insights-push',
      level: 'error',
      message: 'Insight push scheduler could not process one or more users.',
      metadata: result,
    });
  }

  return result;
}

module.exports = { runInsightPushCron };
