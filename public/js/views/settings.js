import { api, meta } from '../api.js';
import { html, render as paint, toast, askConfirm, STANDALONE } from '../ui.js';

const GOAL_LABEL = { track: 'Understand my cycle', conceive: 'Trying to conceive', avoid: 'Avoid pregnancy (awareness)', perimenopause: 'Perimenopause' };
const COND_LABEL = { pcos: 'PCOS', endometriosis: 'Endometriosis', thyroid: 'Thyroid condition', anemia: 'Anaemia / low iron', pmdd: 'PMDD / severe PMS' };

export async function render(root, ctx) {
  const m = await meta();
  await ctx.refreshMe();
  const { user, profile: p } = ctx.me;

  paint(root, html`
    <h1>Settings</h1>
    <form id="profile" class="card">
      <h2>👤 Profile & personalisation</h2>
      <div class="field-row">
        <div class="field"><label for="name">Name</label><input id="name" name="name" value="${user.name}" maxlength="80" required></div>
        <div class="field"><label for="birth_year">Birth year</label><input id="birth_year" name="birth_year" type="number" value="${p.birth_year ?? ''}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label for="goal">Goal</label><select id="goal" name="goal">${m.goals.map((g) => html`<option value="${g}" ${p.goal === g ? 'selected' : ''}>${GOAL_LABEL[g]}</option>`)}</select></div>
        <div class="field"><label for="diet">Diet</label><select id="diet" name="diet">${m.diets.map((d) => html`<option value="${d}" ${p.diet === d ? 'selected' : ''}>${d}</option>`)}</select></div>
      </div>
      <div class="field"><label>Conditions</label><div class="chips">${m.conditions.map((c) => html`<label class="chip ${p.conditions.includes(c) ? 'on' : ''}" style="font-weight:500"><input type="checkbox" name="cond" value="${c}" ${p.conditions.includes(c) ? 'checked' : ''} style="display:none"> ${COND_LABEL[c]}</label>`)}</div></div>
      <div class="field-row">
        <div class="field"><label for="cycle_length">Default cycle length</label><input id="cycle_length" name="cycle_length" type="number" min="15" max="90" value="${p.cycle_length}"></div>
        <div class="field"><label for="period_length">Default period length</label><input id="period_length" name="period_length" type="number" min="1" max="15" value="${p.period_length}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label for="luteal_length">Luteal phase (if known)</label><input id="luteal_length" name="luteal_length" type="number" min="7" max="20" value="${p.luteal_length}"></div>
        <div class="field"><label for="temp_unit">Temperature unit</label><select id="temp_unit" name="temp_unit"><option value="C" ${p.temp_unit === 'C' ? 'selected' : ''}>°C</option><option value="F" ${p.temp_unit === 'F' ? 'selected' : ''}>°F</option></select></div>
      </div>
      <small class="muted">Defaults are only used until Lunaria has learned from your logged cycles. Timezone: ${p.timezone}</small>
      <div style="margin-top:12px"><button class="btn" type="submit">Save changes</button></div>
    </form>

    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <h2>🔔 Notifications</h2>
        <p class="muted">Choose which nudges you get, quiet hours and medication reminders.</p>
        <a class="btn btn-soft" href="/notifications?tab=settings">Notification settings</a>
      </div>
      <div class="card">
        <h2>📄 Your data</h2>
        <p class="muted">${STANDALONE ? 'In this test version your data is stored privately for you in this browser/account, never on a Lunaria server.' : 'Your data lives on this Lunaria server — never sold, never shared. Export it any time.'}</p>
        <div class="row">${STANDALONE ? html`<button type="button" class="btn btn-soft" id="export">Show my data (JSON)</button>` : html`<a class="btn btn-soft" href="/api/export" download="lunaria-export.json">Export JSON</a>`}<a class="btn btn-ghost" href="/report">Doctor report</a></div>
        <div id="export-box" class="hidden" style="margin-top:10px"><textarea id="export-text" rows="8" readonly></textarea><button type="button" class="btn btn-ghost btn-sm" id="export-copy" style="margin-top:6px">Copy</button></div>
      </div>
    </div>

    <form id="pw" class="card" style="margin-top:16px">
      <h2>🔒 Change password</h2>
      <div class="field-row">
        <div class="field"><label for="cur">Current password</label><input id="cur" name="current" type="password" autocomplete="current-password" required></div>
        <div class="field"><label for="nxt">New password</label><input id="nxt" name="next" type="password" minlength="8" autocomplete="new-password" required></div>
      </div>
      <button class="btn btn-soft" type="submit">Update password</button>
      <small class="muted"> Other devices will be signed out.</small>
    </form>

    <div class="card" style="margin-top:16px">
      <div class="row between"><div><b>Signed in as</b><br><span class="muted">${user.email}</span></div><button class="btn btn-ghost" id="logout">Sign out</button></div>
    </div>

    <form id="del" class="card flag consult" style="margin-top:16px">
      <h2>Delete account</h2>
      <p class="muted">Permanently deletes your account and every log. This can’t be undone.</p>
      <div class="row"><input name="password" type="password" placeholder="Confirm with your password" autocomplete="current-password" required style="flex:1;min-width:200px"><button class="btn btn-danger" type="submit">Delete everything</button></div>
    </form>
  `);

  root.querySelectorAll('label.chip input').forEach((i) => i.addEventListener('change', () => i.parentElement.classList.toggle('on', i.checked)));

  root.querySelector('#profile').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api.put('/profile', {
        name: f.name.value,
        birth_year: f.birth_year.value ? Number(f.birth_year.value) : null,
        goal: f.goal.value,
        diet: f.diet.value,
        conditions: [...f.querySelectorAll('input[name=cond]:checked')].map((x) => x.value),
        cycle_length: Number(f.cycle_length.value),
        period_length: Number(f.period_length.value),
        luteal_length: Number(f.luteal_length.value),
        temp_unit: f.temp_unit.value,
      });
      await ctx.refreshMe();
      toast('Profile saved ✓');
    } catch (ex) { toast(ex.message); }
  });
  root.querySelector('#pw').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.post('/auth/password', { current: e.target.current.value, next: e.target.next.value });
      e.target.reset();
      toast('Password updated');
    } catch (ex) { toast(ex.message); }
  });
  root.querySelector('#export')?.addEventListener('click', async () => {
    const data = await api.get('/export');
    root.querySelector('#export-text').value = JSON.stringify(data, null, 2);
    root.querySelector('#export-box').classList.remove('hidden');
  });
  root.querySelector('#export-copy')?.addEventListener('click', async () => {
    const t = root.querySelector('#export-text');
    try { await navigator.clipboard.writeText(t.value); toast('Copied'); } catch { t.select(); toast('Selected — copy it with your keyboard or long-press'); }
  });
  root.querySelector('#logout').addEventListener('click', () => ctx.signOut());
  root.querySelector('#del').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!(await askConfirm('Really delete your account and all data? This can’t be undone.', { confirmLabel: 'Delete everything', danger: true }))) return;
    try {
      await api.del('/auth/account', { password: e.target.password.value });
      toast('Account deleted');
      ctx.signOut();
    } catch (ex) { toast(ex.message); }
  });
}
