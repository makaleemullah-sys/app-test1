import { api } from '../api.js';
import { html, render as paint, toast, onActions, askConfirm, STANDALONE } from '../ui.js';

const ICON = { period: '🩸', fertility: '🌸', reminder: '✍️', hydration: '💧', medication: '💊', phase: '🌙', forecast: '🔮', nutrition: '🥗', health: '🩺', test: '🔔' };
const PREF_COPY = [
  ['period_upcoming', 'Period coming soon', 'A heads-up before your predicted period'],
  ['period_late', 'Late period', 'Check-ins if your period is late'],
  ['fertility', 'Fertile window & ovulation', 'When your fertile window opens'],
  ['phase_tips', 'Phase coaching', 'Nutrition & movement tips when you enter a new phase'],
  ['forecasts', 'Symptom forecasts', 'Evening heads-up when a symptom is likely tomorrow'],
  ['daily_log', 'Daily check-in', 'Reminder to log if you haven’t yet'],
  ['hydration', 'Hydration nudges', 'Only when you’re behind your water goal'],
  ['nutrition', 'Iron nudges during your period', 'If your iron intake is low on period days'],
  ['medications', 'Medication & supplement reminders', 'At the times you set below'],
  ['bbt_reminder', 'Morning temperature', 'Reminder to take your BBT'],
  ['health_alerts', 'Health screening alerts', 'When a pattern is worth discussing with a clinician'],
  ['discreet', 'Discreet mode', 'Hide cycle details in notification text'],
];

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...b].map((c) => c.charCodeAt(0)));
}

async function pushStatus() {
  // The phone build has no service worker: notifications show while the app is open.
  if (STANDALONE) {
    if (!('Notification' in window)) return 'inapp';
    return Notification.permission === 'granted' ? 'local-on' : Notification.permission === 'denied' ? 'inapp' : 'local-off';
  }
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return sub ? 'on' : 'off';
}

export async function render(root, ctx) {
  let tab = ctx.params.get('tab') || 'inbox';

  async function draw() {
    const [{ items, unread }, { prefs }, { meds }, push] = await Promise.all([
      api.get('/notifications'), api.get('/notifications/prefs'), api.get('/meds'), pushStatus().catch(() => 'unsupported'),
    ]);
    ctx.setUnread(unread);
    paint(root, html`
      <h1>Notifications</h1>
      <div class="tabs">
        <button type="button" data-action="tab" data-tab="inbox" class="${tab === 'inbox' ? 'on' : ''}">Inbox${unread ? ` (${unread})` : ''}</button>
        <button type="button" data-action="tab" data-tab="meds" class="${tab === 'meds' ? 'on' : ''}">Meds & supplements</button>
        <button type="button" data-action="tab" data-tab="settings" class="${tab === 'settings' ? 'on' : ''}">Settings</button>
      </div>

      ${tab === 'inbox' ? html`<div class="card">
        <div class="row between"><b>${items.length ? 'Recent' : ''}</b>
          <div class="row">${unread ? html`<button class="btn btn-ghost btn-sm" data-action="read-all">Mark all read</button>` : ''}
          ${items.some((n) => n.read) ? html`<button class="btn btn-ghost btn-sm" data-action="clear">Clear read</button>` : ''}</div></div>
        ${items.length ? items.map((n) => html`<div class="notif ${n.read ? '' : 'unread'}">
          <span class="ico">${ICON[n.type] || '🔔'}</span>
          <div style="flex:1"><div class="t">${n.title}</div><div class="muted">${n.body}</div>
            <small class="muted">${new Date(n.created_at.replace(' ', 'T') + 'Z').toLocaleString()}</small></div>
          ${n.link && n.link !== '/notifications' ? html`<a class="btn btn-ghost btn-sm" href="${n.link}" data-action="open" data-id="${n.id}" data-link="${n.link}">Open</a>` : ''}
        </div>`) : html`<p class="empty">You’re all caught up 🌙<br><small>Smart nudges will appear here — period & fertility alerts, phase coaching, symptom forecasts, hydration, iron and medication reminders.</small></p>`}
      </div>` : ''}

      ${tab === 'meds' ? html`<div class="card">
        <h2>💊 Medications, supplements & contraceptives</h2>
        <p class="muted"><small>Get a reminder at the time you choose. Mark doses as taken from the Today screen.</small></p>
        <form id="med-form" class="grid grid-3" style="align-items:end">
          <div><label for="mn">Name</label><input id="mn" name="name" required maxlength="80" placeholder="e.g. Iron, Folic acid, Pill"></div>
          <div><label for="md">Dose</label><input id="md" name="dose" maxlength="80" placeholder="e.g. 18 mg"></div>
          <div><label for="mt">Time</label><input id="mt" name="time" type="time" value="09:00" required></div>
          <div><label for="mk">Type</label><select id="mk" name="kind"><option value="supplement">Supplement</option><option value="medication">Medication</option><option value="contraceptive">Contraceptive</option></select></div>
          <button class="btn" type="submit">Add reminder</button>
        </form>
        <ul class="list" style="margin-top:12px">${meds.map((m) => html`<li class="row between">
          <span><b>${m.name}</b> ${m.dose ? html`<small>${m.dose}</small>` : ''} <small class="muted">· ${m.time} · ${m.kind} · taken ${m.taken7}/7 days</small>${m.active ? '' : html` <span class="pill">paused</span>`}</span>
          <span class="row"><button class="btn btn-ghost btn-sm" data-action="toggle-med" data-id="${m.id}" data-active="${m.active ? 1 : 0}">${m.active ? 'Pause' : 'Resume'}</button>
          <button class="btn btn-ghost btn-sm" data-action="del-med" data-id="${m.id}">Delete</button></span></li>`)}</ul>
        ${!meds.length ? html`<p class="empty">No reminders yet.</p>` : ''}
      </div>` : ''}

      ${tab === 'settings' ? html`<div class="grid">
        <div class="card">
          <h2>📲 Push notifications on this device</h2>
          ${push === 'inapp' ? html`<p class="muted">This test version shows notifications inside the app (🔔 inbox and pop-up banners) while it's open. System notifications are blocked here; the hosted version delivers them to your phone even when it's closed.</p><button class="btn btn-soft btn-sm" data-action="test">Send test</button>`
            : push === 'local-on' ? html`<p>✅ Device notifications on while Lunaria is open.</p><button class="btn btn-soft btn-sm" data-action="test">Send test</button>`
            : push === 'local-off' ? html`<p class="muted">Show reminders as device notifications while Lunaria is open.</p><button class="btn" data-action="local-on">Allow notifications</button>`
            : push === 'unsupported' ? html`<p class="muted">This browser doesn’t support push. Install Lunaria to your home screen (iOS 16.4+) or use Chrome/Edge/Firefox. You’ll still get in-app notifications.</p>`
            : push === 'denied' ? html`<p class="muted">Notifications are blocked in your browser settings for this site.</p>`
            : push === 'on' ? html`<p>✅ Enabled on this device.</p><div class="row"><button class="btn btn-soft btn-sm" data-action="test">Send test</button><button class="btn btn-ghost btn-sm" data-action="push-off">Disable</button></div>`
            : html`<p class="muted">Get reminders even when Lunaria is closed.</p><button class="btn" data-action="push-on">Enable push notifications</button>`}
        </div>
        <div class="card">
          <h2>What to notify me about</h2>
          ${PREF_COPY.map(([k, t, sub]) => html`<div class="toggle"><label for="p-${k}">${t}<br><small class="muted">${sub}</small></label>
            <input type="checkbox" id="p-${k}" data-pref="${k}" ${prefs[k] ? 'checked' : ''}></div>`)}
        </div>
        <div class="card grid grid-2">
          <div class="field"><label for="period_days_before">Period heads-up (days before)</label><input type="number" min="1" max="7" id="period_days_before" data-pref-v="period_days_before" value="${prefs.period_days_before}"></div>
          <div class="field"><label for="daily_log_time">Daily check-in time</label><input type="time" id="daily_log_time" data-pref-v="daily_log_time" value="${prefs.daily_log_time}"></div>
          <div class="field"><label for="bbt_time">BBT reminder time</label><input type="time" id="bbt_time" data-pref-v="bbt_time" value="${prefs.bbt_time}"></div>
          <div class="field"><label>Quiet hours</label><div class="row"><input type="time" data-pref-v="quiet_start" value="${prefs.quiet_start}" aria-label="Quiet hours start" style="flex:1"> to <input type="time" data-pref-v="quiet_end" value="${prefs.quiet_end}" aria-label="Quiet hours end" style="flex:1"></div>
            <small class="muted">Only medication reminders come through during quiet hours.</small></div>
        </div>
      </div>` : ''}
    `);

    root.querySelector('#med-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      try {
        await api.post('/meds', { name: f.name.value, dose: f.dose.value, time: f.time.value, kind: f.kind.value });
        toast('Reminder added');
        draw();
      } catch (ex) { toast(ex.message); }
    });
    root.querySelectorAll('[data-pref]').forEach((el) => el.addEventListener('change', async () => {
      await api.put('/notifications/prefs', { [el.dataset.pref]: el.checked });
      toast('Saved');
    }));
    root.querySelectorAll('[data-pref-v]').forEach((el) => el.addEventListener('change', async () => {
      try {
        await api.put('/notifications/prefs', { [el.dataset.prefV]: el.type === 'number' ? Number(el.value) : el.value });
        toast('Saved');
      } catch (ex) { toast(ex.message); }
    }));
  }

  onActions(root, {
    tab: (el) => { tab = el.dataset.tab; ctx.replaceUrl(`/notifications?tab=${tab}`); draw(); },
    'read-all': async () => { await api.post('/notifications/read', { all: true }); draw(); },
    clear: async () => { await api.del('/notifications'); draw(); },
    open: async (el) => { await api.post('/notifications/read', { ids: [Number(el.dataset.id)] }); ctx.navigate(el.dataset.link); },
    'toggle-med': async (el) => { await api.put(`/meds/${el.dataset.id}`, { active: el.dataset.active !== '1' }); draw(); },
    'del-med': async (el) => { if (await askConfirm('Delete this reminder?', { confirmLabel: 'Delete', danger: true })) { await api.del(`/meds/${el.dataset.id}`); draw(); } },
    test: async () => { await api.post('/notifications/test'); toast('Test sent — check the 🔔 inbox'); draw(); },
    'local-on': async () => {
      const perm = await Notification.requestPermission().catch(() => 'denied');
      toast(perm === 'granted' ? 'Notifications allowed 🔔' : 'Not allowed — you’ll still get in-app banners');
      draw();
    },
    'push-on': async () => {
      try {
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') { toast('Permission not granted'); return draw(); }
        const reg = await navigator.serviceWorker.ready;
        const { publicKey } = await api.get('/push/key');
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
        await api.post('/push/subscribe', sub.toJSON());
        toast('Push notifications enabled 🔔');
        await api.post('/notifications/test');
      } catch (ex) {
        toast(`Couldn’t enable push: ${ex.message}`);
      }
      draw();
    },
    'push-off': async () => {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await api.post('/push/unsubscribe', { endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      draw();
    },
  });
  await draw();
  // Opening the inbox marks what you've now seen as read.
  if (tab === 'inbox') api.post('/notifications/read', { all: true }).then(() => ctx.setUnread(0)).catch(() => {});
}
