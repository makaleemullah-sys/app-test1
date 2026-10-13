import { api, meta } from '../api.js';
import { html, render as paint, dates, toast } from '../ui.js';

const GOAL_COPY = {
  track: ['🌙', 'Understand my cycle', 'Predictions, symptoms & wellbeing'],
  conceive: ['👶', 'Trying to conceive', 'Fertile window, LH & BBT confirmation'],
  avoid: ['🛡️', 'Avoid pregnancy awareness', 'Know high-fertility days (not contraception)'],
  perimenopause: ['🌗', 'Perimenopause', 'Track changing cycles, flushes & sleep'],
};
const CONDITION_COPY = { pcos: 'PCOS', endometriosis: 'Endometriosis', thyroid: 'Thyroid condition', anemia: 'Anaemia / low iron', pmdd: 'PMDD / severe PMS' };

export async function render(root, { me, onDone }) {
  const m = await meta();
  const today = dates.local();
  const s = { goal: 'track', conditions: [], diet: 'omnivore' };

  paint(root, html`<div class="auth-wrap" style="max-width:560px">
    <h1>Welcome, ${me.user.name} 🌸</h1>
    <p class="muted">A few questions so Lunaria can personalise predictions, nutrition targets and reminders. You can change all of this later.</p>
    <form id="ob" class="card stack" novalidate>
      <div class="field">
        <label>What brings you to Lunaria?</label>
        <div class="grid grid-2" id="goals">
          ${m.goals.map((g) => html`<button type="button" class="chip ${g === 'track' ? 'on' : ''}" data-goal="${g}" style="border-radius:14px;padding:12px;text-align:left">
            <div>${GOAL_COPY[g][0]} <b>${GOAL_COPY[g][1]}</b></div><small>${GOAL_COPY[g][2]}</small></button>`)}
        </div>
      </div>
      <div class="field-row">
        <div class="field"><label for="last">Last period started</label><input id="last" name="last" type="date" max="${today}" required></div>
        <div class="field"><label for="prev">Period before that <small>(optional)</small></label><input id="prev" name="prev" type="date" max="${today}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label for="cycle_length">Typical cycle length</label><input id="cycle_length" name="cycle_length" type="number" min="15" max="90" value="28"></div>
        <div class="field"><label for="period_length">Period length (days)</label><input id="period_length" name="period_length" type="number" min="1" max="15" value="5"></div>
      </div>
      <div class="field-row">
        <div class="field"><label for="birth_year">Birth year</label><input id="birth_year" name="birth_year" type="number" min="1900" max="${new Date().getFullYear() - 8}" placeholder="e.g. 1995"></div>
        <div class="field"><label for="diet">Diet</label>
          <select id="diet" name="diet">${m.diets.map((d) => html`<option value="${d}">${d[0].toUpperCase() + d.slice(1)}</option>`)}</select></div>
      </div>
      <div class="field">
        <label>Any conditions we should tailor for? <small>(optional)</small></label>
        <div class="chips" id="conds">${m.conditions.map((c) => html`<button type="button" class="chip" data-cond="${c}">${CONDITION_COPY[c]}</button>`)}</div>
      </div>
      <p class="error" id="ob-error" role="alert"></p>
      <button class="btn btn-block" type="submit">Start my journey</button>
      <p class="disclaimer">Lunaria offers wellness information, not medical advice. Predictions are not a form of contraception.</p>
    </form>
  </div>`);

  root.querySelector('#goals').addEventListener('click', (e) => {
    const b = e.target.closest('[data-goal]');
    if (!b) return;
    s.goal = b.dataset.goal;
    root.querySelectorAll('[data-goal]').forEach((x) => x.classList.toggle('on', x === b));
  });
  root.querySelector('#conds').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cond]');
    if (!b) return;
    b.classList.toggle('on');
    const c = b.dataset.cond;
    s.conditions = b.classList.contains('on') ? [...s.conditions, c] : s.conditions.filter((x) => x !== c);
  });
  root.querySelector('#ob').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const err = root.querySelector('#ob-error');
    err.textContent = '';
    if (!f.last.value) { err.textContent = 'Please enter when your last period started.'; return; }
    if (f.prev.value && f.prev.value >= f.last.value) { err.textContent = 'The earlier period should be before your last one.'; return; }
    try {
      await api.post('/onboarding', {
        goal: s.goal,
        conditions: s.conditions,
        diet: f.diet.value,
        cycle_length: Number(f.cycle_length.value) || 28,
        period_length: Number(f.period_length.value) || 5,
        birth_year: f.birth_year.value ? Number(f.birth_year.value) : null,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        period_starts: [f.prev.value, f.last.value].filter(Boolean),
      });
      toast('All set! 🌙');
      await onDone();
    } catch (ex) {
      err.textContent = ex.message;
    }
  });
}
