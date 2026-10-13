'use strict';
const webpush = require('web-push');

let configured = false;
let publicKey = null;

/** Load (or create once) VAPID keys so Web Push survives restarts. */
function initPush(db, subject = process.env.VAPID_SUBJECT || 'mailto:admin@lunaria.local') {
  let pub = process.env.VAPID_PUBLIC_KEY;
  let priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) {
    const row = db.prepare("SELECT value FROM app_kv WHERE key = 'vapid'").get();
    if (row) ({ publicKey: pub, privateKey: priv } = JSON.parse(row.value));
    else {
      const keys = webpush.generateVAPIDKeys();
      db.prepare("INSERT INTO app_kv (key, value) VALUES ('vapid', ?)").run(JSON.stringify(keys));
      ({ publicKey: pub, privateKey: priv } = keys);
    }
  }
  webpush.setVapidDetails(subject, pub, priv);
  publicKey = pub;
  configured = true;
  return pub;
}

function getPublicKey() {
  return publicKey;
}

async function sendPush(db, userId, payload) {
  if (!configured) return 0;
  const subs = db.prepare('SELECT id, endpoint, keys FROM push_subscriptions WHERE user_id = ?').all(userId);
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: JSON.parse(s.keys) }, JSON.stringify(payload), { TTL: 3600 });
      sent++;
    } catch (err) {
      // 404/410: the browser dropped this subscription.
      if (err.statusCode === 404 || err.statusCode === 410) {
        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(s.id);
      }
    }
  }));
  return sent;
}

module.exports = { initPush, getPublicKey, sendPush };
