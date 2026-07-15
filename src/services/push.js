const webpush = require('web-push');
const { getSetting, setSetting } = require('../db');

// VAPID keys are generated once and persisted in the settings table so they
// stay stable across restarts (subscriptions created against one keypair
// stop working if the keypair changes).
let publicKey = getSetting('vapid_public_key');
let privateKey = getSetting('vapid_private_key');

if (!publicKey || !privateKey) {
  const keys = webpush.generateVAPIDKeys();
  publicKey = keys.publicKey;
  privateKey = keys.privateKey;
  setSetting('vapid_public_key', publicKey);
  setSetting('vapid_private_key', privateKey);
}

webpush.setVapidDetails('mailto:roy@royaleagleweb.com', publicKey, privateKey);

function getPublicKey() {
  return publicKey;
}

/**
 * Sends a push notification to a single subscription.
 * On a 404/410 ("Gone") response the subscription is no longer valid — the
 * caller should delete it. We signal that by throwing an error tagged with
 * `expired: true` (mirrors the status-coded Error pattern already used in
 * src/utils/helpers.js for badRequest/notFound).
 */
async function sendPush(subscription, payload) {
  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify({ title: payload.title, body: payload.body, url: payload.url || '/' }),
    );
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) {
      const goneErr = new Error('Push subscription is no longer valid');
      goneErr.expired = true;
      throw goneErr;
    }
    throw err;
  }
}

module.exports = { getPublicKey, sendPush };
