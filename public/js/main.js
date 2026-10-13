import { api } from './api.js';
import { html, render } from './ui.js';
import * as authView from './views/auth.js';
import * as onboardingView from './views/onboarding.js';
import * as todayView from './views/today.js';
import * as calendarView from './views/calendar.js';
import * as logView from './views/log.js';
import * as insightsView from './views/insights.js';
import * as nutritionView from './views/nutrition.js';
import * as notificationsView from './views/notifications.js';
import * as settingsView from './views/settings.js';
import * as reportView from './views/report.js';
import * as learnView from './views/learn.js';

const ROUTES = {
  '/': todayView,
  '/calendar': calendarView,
  '/log': logView,
  '/insights': insightsView,
  '/nutrition': nutritionView,
  '/notifications': notificationsView,
  '/settings': settingsView,
  '/report': reportView,
  '/learn': learnView,
};

const app = document.getElementById('app');
const nav = document.getElementById('nav');
const state = { me: null, unread: 0, seenIds: new Set() };

function topbar() {
  return html`<header class="topbar no-print">
    <a href="/" class="brand"><img class="brand-mark" src="/icons/icon.svg" alt="">Lunaria</a>
    <div class="topbar-actions">
      <a href="/notifications" class="icon-btn" aria-label="Notifications">🔔${state.unread ? html`<span class="badge" id="unread-badge">${state.unread}</span>` : ''}</a>
      <a href="/settings" class="icon-btn" aria-label="Settings">⚙️</a>
    </div>
  </header>`;
}

export function navigate(path, { replace = false } = {}) {
  if (replace) history.replaceState({}, '', path);
  else history.pushState({}, '', path);
  route();
}

async function route() {
  window.scrollTo(0, 0);
  if (!state.me) {
    nav.classList.add('hidden');
    return authView.render(app, { onSignedIn: boot });
  }
  if (!state.me.profile.onboarded) {
    nav.classList.add('hidden');
    return onboardingView.render(app, { me: state.me, onDone: boot });
  }
  nav.classList.remove('hidden');
  const path = location.pathname;
  const view = ROUTES[path] || todayView;
  for (const a of nav.querySelectorAll('a')) a.classList.toggle('active', a.dataset.nav === path);
  render(app, html`${topbar()}<main id="view"><p class="empty">Loading…</p></main>`);
  const root = document.getElementById('view');
  try {
    await view.render(root, {
      me: state.me,
      params: new URLSearchParams(location.search),
      navigate,
      refreshMe: async () => { state.me = await api.get('/auth/me'); },
      setUnread,
      signOut,
    });
  } catch (err) {
    if (err.status !== 401) render(root, html`<div class="card"><h2>Something went wrong</h2><p class="muted">${err.message}</p></div>`);
  }
}

function setUnread(n) {
  state.unread = n;
  const link = app.querySelector('a[href="/notifications"].icon-btn');
  if (!link) return;
  link.querySelector('.badge')?.remove();
  if (n) link.insertAdjacentHTML('beforeend', `<span class="badge">${Number(n)}</span>`);
}

async function signOut() {
  await api.post('/auth/logout').catch(() => {});
  state.me = null;
  history.replaceState({}, '', '/');
  route();
}

/**
 * Poll the inbox; when a new notification arrives and the device has no push
 * subscription, show it as a system notification from the service worker.
 */
async function pollNotifications(initial = false) {
  if (!state.me?.profile?.onboarded || document.hidden) return;
  try {
    const { items, unread } = await api.get('/notifications');
    setUnread(unread);
    const fresh = items.filter((n) => !n.read && !state.seenIds.has(n.id));
    items.forEach((n) => state.seenIds.add(n.id));
    if (initial || !fresh.length) return;
    if ('Notification' in window && Notification.permission === 'granted' && 'serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager?.getSubscription?.();
      if (!sub) for (const n of fresh.slice(0, 3)) reg.showNotification(n.title, { body: n.body, icon: '/icons/icon.svg', tag: n.dedupe_key, data: { url: n.link } });
    }
  } catch { /* offline or signed out */ }
}

async function boot() {
  try {
    state.me = await api.get('/auth/me');
    // Keep timezone in sync with the device so reminders fire at local time.
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && state.me.profile.timezone !== tz) await api.put('/profile', { timezone: tz }).catch(() => {});
  } catch {
    state.me = null;
  }
  await route();
  pollNotifications(true);
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (e.defaultPrevented || !a || a.target || a.hasAttribute('download') || e.metaKey || e.ctrlKey || e.shiftKey) return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.preventDefault();
  navigate(url.pathname + url.search);
});
window.addEventListener('popstate', route);
window.addEventListener('lunaria:signed-out', () => { if (state.me) { state.me = null; route(); } });
document.addEventListener('visibilitychange', () => { if (!document.hidden) pollNotifications(); });
setInterval(pollNotifications, 120000);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

boot();
