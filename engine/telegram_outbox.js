'use strict';

const RETRY_BASE_MS = 60_000;
const RETRY_MAX_MS = 6 * 60 * 60 * 1000;

function createSignalNotification(record, payload) {
  return {
    id: `signal:${record.symbol}:${record.dir}:${record.ts}`,
    status: 'pending',
    attempts: 0,
    lastAttemptAt: null,
    nextAttemptAt: null,
    sentAt: null,
    payload
  };
}

function retryDelayMs(attempts) {
  const exponent = Math.max(0, Math.min(30, Number(attempts) - 1));
  return Math.min(RETRY_BASE_MS * (2 ** exponent), RETRY_MAX_MS);
}

async function attemptSignalNotification(record, tracked, { save, send, now = Date.now }) {
  const notification = record?.signalNotification;
  if (!notification || notification.status !== 'pending' || typeof notification.payload !== 'string') return false;

  const time = now();
  const due = Date.parse(notification.nextAttemptAt || '');
  if (Number.isFinite(due) && due > time) return false;

  notification.attempts = Math.max(0, Number(notification.attempts) || 0) + 1;
  notification.lastAttemptAt = new Date(time).toISOString();
  notification.nextAttemptAt = new Date(time + retryDelayMs(notification.attempts)).toISOString();
  save(tracked); // Save attempt and retry time before making the network request.

  let delivered = false;
  try {
    delivered = (await send(notification.payload)) === true;
  } catch (_) {
    delivered = false;
  }

  if (delivered) {
    notification.status = 'sent';
    notification.sentAt = new Date(now()).toISOString();
    notification.nextAttemptAt = null;
  }
  save(tracked);
  return delivered;
}

async function retryPendingSignalNotifications(tracked, options) {
  let attempted = 0;
  for (const record of tracked) {
    const n = record?.signalNotification;
    if (!n || n.status !== 'pending' || typeof n.payload !== 'string') continue;
    const due = Date.parse(n.nextAttemptAt || '');
    const now = options.now ? options.now() : Date.now();
    if (Number.isFinite(due) && due > now) continue;
    attempted++;
    await attemptSignalNotification(record, tracked, options);
  }
  return attempted;
}

module.exports = {
  createSignalNotification,
  attemptSignalNotification,
  retryPendingSignalNotifications,
  retryDelayMs
};
