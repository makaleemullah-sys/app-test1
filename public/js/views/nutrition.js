import { api } from '../api.js';
import { html, render as paint, dates, phasePill, toast, onActions } from '../ui.js';

const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];
const MEAL_ICON = { breakfast: '🌅', lunch: '☀️', dinner: '🌙', snack: '🍎' };
const NUTRIENT_LABEL = { protein: 'protein', fiber: 'fiber', iron: 'iron', calcium: 'calcium', magnesium: 'magnesium', zinc: 'zinc', b6: 'B6', vitc: 'vitamin C', folate: 'folate', omega3: 'omega-3' };

function defaultMeal() {
  const h = new Date().getHours();
  return h < 11 ? 'breakfast' : h < 15 ? 'lunch' : h < 21 ? 'dinner' : 'snack';
}

export async function render(root, ctx) {
  const today = dates.local();
  let date = ctx.params.get('date') || today;
  let foods = null;
  let d = null;

  async function draw() {
    d = await api.get(`/nutrition/day/${date}`);
    const byMeal = Object.fromEntries(MEALS.map((m) => [m, d.entries.filter((e) => e.meal === m)]));
    paint(root, html`
      <div class="row between">
        <h1 style="margin:0">Nutrition</h1>
        <div class="row"><button class="btn btn-ghost btn-sm" data-action="day" data-delta="-1">‹</button>
          <b>${date === today ? 'Today' : dates.pretty(date)}</b>
          ${date < today ? html`<button class="btn btn-ghost btn-sm" data-action="day" data-delta="1">›</button>` : ''}</div>
      </div>
      <div class="card card-tint" style="margin-top:12px">
        <div class="row between"><b>Eating for your ${d.phase} phase</b>${phasePill(d.phase)}</div>
        <p style="margin:.4rem 0 0" class="muted">${d.guidance.why}</p>
      </div>

      <div class="grid grid-2" style="margin-top:16px">
        <div class="card">
          <h2>➕ Add food</h2>
          <div class="field-row">
            <div><label for="meal">Meal</label><select id="meal">${MEALS.map((m) => html`<option value="${m}" ${m === defaultMeal() ? 'selected' : ''}>${MEAL_ICON[m]} ${m}</option>`)}</select></div>
            <div><label for="servings">Servings</label><input id="servings" type="number" min="0.25" max="10" step="0.25" value="1"></div>
          </div>
          <div class="field" style="margin-top:10px"><label for="q">Search foods</label><input id="q" type="search" placeholder="e.g. lentils, salmon, spinach" autocomplete="off"></div>
          <div class="search-results hidden" id="results"></div>

          ${MEALS.map((m) => byMeal[m].length ? html`<h3 style="margin-top:14px">${MEAL_ICON[m]} ${m[0].toUpperCase() + m.slice(1)}</h3>
            <ul class="list">${byMeal[m].map((e) => html`<li class="row between"><span>${e.food?.name || e.food_id} <small class="muted">× ${e.servings} (${e.food?.serving})</small></span>
              <button class="btn btn-ghost btn-sm" data-action="remove" data-id="${e.id}" aria-label="Remove">✕</button></li>`)}</ul>` : '')}
          ${!d.entries.length ? html`<p class="empty">Nothing logged yet. Try a suggestion below — one tap adds it.</p>` : ''}
        </div>

        <div class="card">
          <h2>📊 Today vs your targets</h2>
          <small class="muted">Targets personalised for your diet${ctx.me.profile.goal === 'conceive' ? ', conception goal' : ''} and phase. <span class="pill info">highlighted</span> = phase focus.</small>
          <div style="margin-top:10px">
          ${d.analysis.rows.map((r) => html`<div class="nutrient">
            <span>${r.focus ? html`<b>${r.label}</b>` : r.label}</span>
            <div class="bar ${r.focus ? 'focus' : ''} ${r.limit && r.pct > 100 ? 'over' : ''}"><i style="width:${Math.min(100, r.pct)}%"></i></div>
            <span class="val">${r.value}/${r.target}${r.unit}</span></div>`)}
          </div>
          ${d.analysis.warnings.map((w) => html`<p class="error">${w}</p>`)}
        </div>
      </div>

      <h3 class="section-title">Smart suggestions to close your gaps</h3>
      <div class="grid grid-3">
        ${d.suggestions.map((s) => html`<div class="card">
          <div class="row between"><b>${s.name}</b><button class="btn btn-sm" data-action="add" data-id="${s.id}">+ Add</button></div>
          <small class="muted">${s.serving}</small>
          <p style="margin:.5rem 0 0"><small>${s.contributions.map((c) => `+${c.pct}% ${NUTRIENT_LABEL[c.key] || c.key}`).join(' · ')}</small></p>
        </div>`)}
      </div>

      <h3 class="section-title">Meal ideas for this phase</h3>
      <div class="grid grid-2">
        ${d.meals.map((m, i) => html`<div class="card">
          <div class="row between"><b>${m.name}</b><button class="btn btn-soft btn-sm" data-action="meal" data-i="${i}">Log meal</button></div>
          <p class="muted" style="margin:.4rem 0">${m.note}</p>
          <small>Iron ${m.totals.iron} mg · Magnesium ${m.totals.magnesium} mg · Fiber ${m.totals.fiber} g · Protein ${m.totals.protein} g</small>
        </div>`)}
      </div>

      <div class="card" style="margin-top:16px">
        <b>Go easy on:</b> <span class="muted">${d.guidance.limit.join(', ')}</span>
      </div>
      <p class="disclaimer">Nutrient values are approximate (USDA-based). Targets follow general adult recommendations — ask a dietitian for personal advice, especially during pregnancy.</p>
    `);

    const q = root.querySelector('#q');
    const results = root.querySelector('#results');
    q.addEventListener('input', async () => {
      foods ??= (await api.get('/nutrition/foods')).foods;
      const term = q.value.trim().toLowerCase();
      if (!term) { results.classList.add('hidden'); return; }
      const hits = foods.filter((f) => f.name.toLowerCase().includes(term)).slice(0, 12);
      results.classList.remove('hidden');
      paint(results, hits.length ? html`${hits.map((f) => html`<button type="button" data-action="add" data-id="${f.id}">
        <span>${f.name} <small class="muted">${f.serving}</small>${f.allowed ? '' : html` <small class="pill">not in your diet</small>`}</span><small class="muted">${f.nutrients.kcal} kcal</small></button>`)}`
        : html`<p class="empty">No match — try a simpler word.</p>`);
    });
  }

  onActions(root, {
    day: (el) => {
      date = dates.add(date, Number(el.dataset.delta));
      draw();
    },
    add: async (el) => {
      await api.post('/nutrition/entries', { date, food_id: el.dataset.id, meal: root.querySelector('#meal').value, servings: Number(root.querySelector('#servings').value) || 1 });
      toast('Added ✓');
      draw();
    },
    remove: async (el) => {
      await api.del(`/nutrition/entries/${el.dataset.id}`);
      draw();
    },
    meal: async (el) => {
      const m = d.meals[Number(el.dataset.i)];
      await api.post('/nutrition/entries', { date, food_ids: m.foods, meal: root.querySelector('#meal').value, servings: 1 });
      toast(`Logged ${m.name}`);
      draw();
    },
  });
  await draw();
}
