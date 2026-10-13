import { api } from '../api.js';
import { html, render, formData, STANDALONE } from '../ui.js';

export function render_(root, { onSignedIn }, mode = 'login') {
  render(root, html`<div class="auth-wrap">
    <div class="auth-hero">
      <img src="/icons/icon.svg" alt="">
      <h1>Lunaria</h1>
      <p class="muted">Your whole-body cycle health companion.</p>
    </div>
    <div class="card">
      <div class="tabs" role="tablist">
        <button type="button" data-mode="login" class="${mode === 'login' ? 'on' : ''}">Sign in</button>
        <button type="button" data-mode="register" class="${mode === 'register' ? 'on' : ''}">Create account</button>
      </div>
      <form id="auth-form" novalidate>
        ${mode === 'register' ? html`<div class="field"><label for="name">Name</label><input id="name" name="name" autocomplete="given-name" required maxlength="80"></div>` : ''}
        <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" required></div>
        <div class="field"><label for="password">Password</label>
          <input id="password" name="password" type="password" minlength="8" required autocomplete="${mode === 'register' ? 'new-password' : 'current-password'}">
          ${mode === 'register' ? html`<small>At least 8 characters.</small>` : ''}
        </div>
        <p class="error" id="auth-error" role="alert"></p>
        <button class="btn btn-block" type="submit">${mode === 'register' ? 'Create my account' : 'Sign in'}</button>
      </form>
    </div>
    ${STANDALONE ? html`<div class="card card-tint" style="margin-top:16px;text-align:center">
      <p style="margin-bottom:10px"><b>Just testing?</b> Open a demo account filled with 7 months of sample data.</p>
      <button type="button" class="btn btn-block" id="demo">Try with demo data</button>
      <small class="muted" style="display:block;margin-top:8px">Your data in this test version stays private to you on this device or your Claude account.</small>
    </div>` : ''}
    <div class="feature-list">
      <div>🔮 <b>Predictions that learn</b> — confirms ovulation from temperature & LH, not just averages.</div>
      <div>🧠 <b>Symptom intelligence</b> — personal forecasts of what tomorrow may bring and why.</div>
      <div>🥗 <b>Phase-synced nutrition</b> — nutrient tracking with gap-filling food suggestions.</div>
      <div>🩺 <b>Health screening</b> — flags patterns worth discussing with a clinician + a doctor-ready report.</div>
      <div>🔔 <b>Smart notifications</b> — period, fertility, hydration, iron, medication and forecast nudges.</div>
    </div>
  </div>`);

  root.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => render_(root, { onSignedIn }, b.dataset.mode)));
  root.querySelector('#demo')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    e.target.textContent = 'Preparing demo…';
    try {
      await api.post('/auth/demo');
      await onSignedIn();
    } catch (ex) {
      root.querySelector('#auth-error').textContent = ex.message;
      e.target.disabled = false;
    }
  });
  const form = root.querySelector('#auth-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = root.querySelector('#auth-error');
    const btn = form.querySelector('button[type=submit]');
    err.textContent = '';
    btn.disabled = true;
    const data = formData(form);
    try {
      if (mode === 'register') {
        await api.post('/auth/register', { ...data, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      } else {
        await api.post('/auth/login', data);
      }
      await onSignedIn();
    } catch (ex) {
      err.textContent = ex.message;
      btn.disabled = false;
    }
  });
}

export { render_ as render };
