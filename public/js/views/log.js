import { api, meta } from '../api.js';
import { html, render as paint, dates, toast } from '../ui.js';

const MOODS = ['😞', '😕', '😐', '🙂', '😄'];
const ENERGY = ['🪫', '😴', '🙂', '⚡', '🚀'];
const STRESS = ['😌', '🙂', '😐', '😣', '🤯'];
const GROUPS = { pain: 'Pain', digestion: 'Digestion & appetite', energy: 'Energy & sleep', mood: 'Mood & libido', body: 'Body', bleeding: 'Bleeding' };
const MUCUS_COPY = { dry: 'Dry', sticky: 'Sticky', creamy: 'Creamy', watery: 'Watery', eggwhite: 'Egg-white' };

export async function render(root, ctx) {
  const m = await meta();
  const today = dates.local();
  const date = ctx.params.get('date') || today;
  const { log, period } = await api.get(`/logs/${date}`);
  const unitF = ctx.me.profile.temp_unit === 'F';
  const s = {
    flow: log?.flow ?? null, symptoms: log?.symptoms || [], mood: log?.mood ?? null, energy: log?.energy ?? null,
    stress: log?.stress ?? null, lh: log?.lh ?? null, mucus: log?.mucus ?? null, sex: log?.sex ?? null,
  };
  const bbtShown = log?.bbt ? (unitF ? Math.round((log.bbt * 9 / 5 + 32) * 100) / 100 : log.bbt) : '';

  const scale = (name, icons, from = 1) => html`<div class="scale" data-scale="${name}">
    ${icons.map((ic, i) => html`<button type="button" class="chip ${s[name] === i + from ? 'on' : ''}" data-v="${i + from}" aria-label="${name} ${i + from}">${ic}</button>`)}</div>`;
  const choice = (name, values, labels) => html`<div class="chips" data-choice="${name}">
    ${values.map((v) => html`<button type="button" class="chip ${s[name] === v ? 'on' : ''}" data-v="${v}">${labels[v] || v}</button>`)}</div>`;

  paint(root, html`
    <div class="row between" style="margin-bottom:12px">
      <a class="btn btn-ghost btn-sm" href="/log?date=${dates.add(date, -1)}">‹</a>
      <div style="text-align:center"><h1 style="margin:0">${date === today ? 'Today' : dates.pretty(date)}</h1>
        ${period ? html`<small class="pill menstrual">Period day ${dates.diff(period.start_date, date) + 1}</small>` : ''}</div>
      ${date < today ? html`<a class="btn btn-ghost btn-sm" href="/log?date=${dates.add(date, 1)}">›</a>` : html`<span style="width:42px"></span>`}
    </div>
    <form id="log-form" class="grid">
      <div class="card">
        <h2>🩸 Flow</h2>
        <div class="chips" data-choice="flow">
          ${m.flow.map((label, i) => html`<button type="button" class="chip ${s.flow === i ? (i >= 2 ? 'flow-on' : 'on') : ''}" data-v="${i}">${label}</button>`)}
        </div>
        <small class="muted">Logging light flow or more starts (or extends) a period automatically.</small>
      </div>
      <div class="card grid grid-3">
        <div><label>Mood</label>${scale('mood', MOODS)}</div>
        <div><label>Energy</label>${scale('energy', ENERGY)}</div>
        <div><label>Stress</label>${scale('stress', STRESS)}</div>
      </div>
      <div class="card">
        <h2>🌡️ Symptoms</h2>
        ${Object.entries(GROUPS).map(([g, label]) => html`<div class="field"><label>${label}</label><div class="chips" data-multi="symptoms">
          ${m.symptoms.filter((x) => x.group === g).map((x) => html`<button type="button" class="chip ${s.symptoms.includes(x.id) ? 'on' : ''}" data-v="${x.id}">${x.label}</button>`)}
        </div></div>`)}
        <div class="field"><label for="pain">Pain level: <span id="pain-val">${log?.pain ?? '–'}</span>/10</label>
          <input id="pain" name="pain" type="range" min="0" max="10" value="${log?.pain ?? 0}"></div>
      </div>
      <div class="card">
        <h2>🛌 Lifestyle</h2>
        <div class="grid grid-3">
          <div class="field"><label for="sleep_hours">Sleep (hours)</label><input id="sleep_hours" name="sleep_hours" type="number" step="0.5" min="0" max="24" value="${log?.sleep_hours ?? ''}"></div>
          <div class="field"><label for="exercise_min">Exercise (min)</label><input id="exercise_min" name="exercise_min" type="number" min="0" max="1440" value="${log?.exercise_min ?? ''}"></div>
          <div class="field"><label for="water_ml">Water (ml)</label><input id="water_ml" name="water_ml" type="number" step="50" min="0" max="10000" value="${log?.water_ml ?? 0}"></div>
        </div>
      </div>
      <div class="card">
        <h2>🔬 Fertility signs</h2>
        <p class="muted"><small>Temperature and LH tests let Lunaria <b>confirm</b> ovulation and pin down your next period far more accurately than calendar averages.</small></p>
        <div class="field"><label for="bbt">Basal body temperature (°${unitF ? 'F' : 'C'})</label>
          <input id="bbt" name="bbt" type="number" step="0.01" min="${unitF ? 93 : 34}" max="${unitF ? 108 : 42}" value="${bbtShown}" placeholder="${unitF ? '97.70' : '36.50'}"></div>
        <div class="field"><label>Ovulation (LH) test</label>${choice('lh', m.lh, { negative: 'Negative', positive: 'Positive', peak: 'Peak' })}</div>
        <div class="field"><label>Cervical mucus</label>${choice('mucus', m.mucus, MUCUS_COPY)}</div>
        <div class="field"><label>Sex</label>${choice('sex', m.sex, { none: 'None', protected: 'Protected', unprotected: 'Unprotected' })}</div>
      </div>
      <div class="card">
        <label for="notes">Notes</label>
        <textarea id="notes" name="notes" rows="3" maxlength="2000" placeholder="Anything else worth remembering?">${log?.notes ?? ''}</textarea>
      </div>
      <p class="error" id="log-error" role="alert"></p>
      <button class="btn btn-block" type="submit">Save log</button>
    </form>`);

  const form = root.querySelector('#log-form');
  // Only record pain once the user has actually set it, so untouched logs don't read as "0 pain".
  let painTouched = log?.pain != null;
  form.pain.addEventListener('input', () => { painTouched = true; root.querySelector('#pain-val').textContent = form.pain.value; });
  form.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    const single = b.closest('[data-scale],[data-choice]');
    const multi = b.closest('[data-multi]');
    if (single) {
      const name = single.dataset.scale || single.dataset.choice;
      const raw = b.dataset.v;
      const val = single.dataset.scale || name === 'flow' ? Number(raw) : raw;
      s[name] = s[name] === val ? null : val; // tap again to clear
      single.querySelectorAll('button').forEach((x) => {
        const on = String(s[name]) === x.dataset.v;
        x.classList.toggle('on', on && !(name === 'flow' && Number(x.dataset.v) >= 2));
        x.classList.toggle('flow-on', on && name === 'flow' && Number(x.dataset.v) >= 2);
      });
    } else if (multi) {
      const v = b.dataset.v;
      s.symptoms = s.symptoms.includes(v) ? s.symptoms.filter((x) => x !== v) : [...s.symptoms, v];
      b.classList.toggle('on');
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = root.querySelector('#log-error');
    err.textContent = '';
    const num = (v) => (v === '' ? null : Number(v));
    let bbt = num(form.bbt.value);
    if (bbt != null && unitF) bbt = Math.round(((bbt - 32) * 5 / 9) * 100) / 100;
    try {
      const res = await api.put(`/logs/${date}`, {
        ...s,
        pain: painTouched ? Number(form.pain.value) : null,
        sleep_hours: num(form.sleep_hours.value),
        exercise_min: num(form.exercise_min.value),
        water_ml: num(form.water_ml.value) || 0,
        bbt,
        notes: form.notes.value,
      });
      const ev = res.periodEvent;
      toast(ev?.type === 'started' ? 'Saved — new period started 🩸' : ev ? 'Saved — period updated' : 'Saved ✓');
      ctx.navigate('/');
    } catch (ex) {
      err.textContent = ex.message;
    }
  });
}
