import { api } from '../api.js';
import { html, raw, render, dates, phasePill, plural, toast, onActions, PHASE_META } from '../ui.js';

const MOOD = ['', '😞', '😕', '😐', '🙂', '😄'];

function ring(cur, stats) {
  const total = Math.max(Math.round(stats.avgCycle || 28), cur.cycleDay);
  const size = 260, r = 112, cx = size / 2, cy = size / 2;
  const ovDay = dates.diff(cur.start, cur.ovulation.date) + 1;
  const segs = [
    ['menstrual', 1, cur.periodLength],
    ['follicular', cur.periodLength + 1, ovDay - 2],
    ['ovulatory', ovDay - 1, ovDay + 1],
    ['luteal', ovDay + 2, total],
  ].filter(([, a, b]) => b >= a);
  const arc = (from, to, color, width, radius = r) => {
    const cc = 2 * Math.PI * radius;
    const len = ((to - from + 1) / total) * cc;
    const off = ((from - 1) / total) * cc;
    return `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" style="stroke:${color}" stroke-width="${width}"
      stroke-dasharray="${Math.max(len - 2, 0.1)} ${cc}" stroke-dashoffset="${-off}" transform="rotate(-90 ${cx} ${cy})" stroke-linecap="butt"/>`;
  };
  const fertFrom = dates.diff(cur.start, cur.fertileWindow.start) + 1;
  const fertTo = dates.diff(cur.start, cur.fertileWindow.end) + 1;
  const angle = ((cur.cycleDay - 0.5) / total) * 2 * Math.PI - Math.PI / 2;
  let svg = `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" style="stroke:var(--surface-2)" stroke-width="18"/>`;
  for (const [p, a, b] of segs) svg += arc(a, b, PHASE_META[p].color, 18);
  if (fertTo >= 1) svg += arc(Math.max(1, fertFrom), Math.min(total, fertTo), 'var(--primary)', 5, r - 17);
  svg += `<circle cx="${cx + r * Math.cos(angle)}" cy="${cy + r * Math.sin(angle)}" r="13" style="fill:var(--surface);stroke:var(--text)" stroke-width="3"/>`;
  return raw(svg + '</svg>');
}

function headline(cur) {
  if (cur.isLate) return html`Period is <b>${plural(cur.daysLate, 'day')} late</b>`;
  if (cur.inPeriod) return html`Period day <b>${cur.cycleDay}</b>`;
  if (cur.daysUntilNext === 0) return html`Period expected <b>today</b>`;
  return html`Period in <b>${plural(cur.daysUntilNext, 'day')}</b>`;
}

function fertilityText(cur, goal) {
  if (goal === 'perimenopause') return '';
  const f = cur.fertility;
  const label = { peak: 'Peak fertility', high: 'High fertility', medium: 'Medium fertility', low: 'Low fertility' }[f] || '';
  const conf = cur.ovulation.confirmed ? ` · ovulation confirmed by ${cur.ovulation.method.toUpperCase()}` : '';
  return `${label}${conf}`;
}

export async function render_(root, ctx) {
  const d = await api.get('/today');
  ctx.setUnread(d.unread);
  const cur = d.current;
  const g = d.guidance;
  const log = d.log || {};
  const water = log.water_ml || 0;

  if (!cur) {
    render(root, html`<div class="card"><h2>Let’s get started</h2><p>Log your last period to unlock predictions.</p><a class="btn" href="/calendar">Open calendar</a></div>`);
    return;
  }

  const tomorrow = d.forecast[1];
  render(root, html`
    <section class="card hero">
      <div class="ring-wrap">
        ${ring(cur, d.stats)}
        <div class="ring-center">
          <div class="label">Cycle day</div>
          <div class="big">${cur.cycleDay}</div>
          <div style="margin-top:6px">${phasePill(cur.phase)}</div>
        </div>
      </div>
      <div class="stack">
        <h1>${headline(cur)}</h1>
        <p class="muted">${dates.pretty(d.today)} · Next period ${cur.isLate ? 'was due' : 'expected'} ${dates.short(cur.nextStart)}
          ${cur.nextWindow[0] !== cur.nextWindow[1] ? html`<small>(window ${dates.short(cur.nextWindow[0])}–${dates.short(cur.nextWindow[1])})</small>` : ''}</p>
        <p>${fertilityText(cur, d.profile.goal)}</p>
        <div class="legend">
          <span style="--c:var(--menstrual)">Period</span><span style="--c:var(--follicular)">Follicular</span>
          <span style="--c:var(--ovulatory)">Ovulation</span><span style="--c:var(--luteal)">Luteal</span><span style="--c:var(--primary)">Fertile</span>
        </div>
        <div class="row">
          ${cur.inPeriod
            ? html`<button class="btn btn-soft" data-action="period-end">Period ended today</button>`
            : cur.cycleDay > 10 ? html`<button class="btn" data-action="period-start">🩸 Period started today</button>` : ''}
          <a class="btn btn-ghost" href="/log">${d.log ? 'Edit today’s log' : 'Log how I feel'}</a>
        </div>
        <small class="muted">Prediction confidence: <b>${d.stats.confidence}</b> · ${d.stats.regularity !== 'unknown' ? d.stats.regularity : 'learning your pattern'}</small>
      </div>
    </section>

    ${d.flags.length ? html`<h3 class="section-title">Worth your attention</h3>
      <div class="grid">${d.flags.map((f) => html`<div class="card flag ${f.severity}">
        <div class="row between"><b>${f.title}</b><span class="pill ${f.severity}">${f.severity === 'consult' ? 'Talk to a clinician' : f.severity === 'watch' ? 'Keep an eye on it' : 'FYI'}</span></div>
        <p class="muted" style="margin:.4rem 0 0">${f.detail} ${f.advice}</p></div>`)}</div>` : ''}

    <h3 class="section-title">Your personal forecast</h3>
    <div class="grid grid-3">
      ${d.forecast.map((day, i) => html`<div class="card">
        <div class="row between"><b>${i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : dates.pretty(day.date).split(',')[0]}</b>
          ${day.mood != null ? html`<span title="Typical mood">${MOOD[Math.round(day.mood)]}</span>` : ''}</div>
        ${day.support < 3 ? html`<p class="muted" style="margin-top:.5rem">Keep logging — forecasts appear after a couple of cycles of data.</p>`
          : day.symptoms.length ? html`<ul class="list">${day.symptoms.slice(0, 3).map((s) => html`<li><div class="row between"><span>${s.label}</span><b>${s.probability}%</b></div></li>`)}</ul>`
            : html`<p class="muted" style="margin-top:.5rem">Usually a symptom-light day for you ✨</p>`}
        ${day.energy != null ? html`<small class="muted">Typical energy ${day.energy}/5${day.pain != null ? html` · pain ${day.pain}/10` : ''}</small>` : ''}
      </div>`)}
    </div>
    ${tomorrow?.symptoms?.[0]?.relief ? html`<div class="card card-tint" style="margin-top:12px"><b>Prepare for tomorrow:</b> ${tomorrow.symptoms[0].relief}</div>` : ''}

    <h3 class="section-title">${g.emoji} ${g.name} phase · ${g.season}</h3>
    <div class="card">
      <p><b>What’s happening:</b> ${g.hormones}</p>
      <p class="muted">${g.feel}</p>
      <div class="tabs" id="g-tabs">
        <button type="button" class="on" data-tab="eat">Eat</button>
        <button type="button" data-tab="move">Move</button>
        <button type="button" data-tab="care">Self-care</button>
        <button type="button" data-tab="mind">Mind</button>
      </div>
      <div data-pane="eat">
        <p><b>Focus:</b> ${g.nutrition.focus.join(' · ')}</p>
        <p class="muted">${g.nutrition.why}</p>
        <div class="chips">${g.nutrition.eat.map((x) => html`<span class="chip">${x}</span>`)}</div>
        <p style="margin-top:.75rem"><small><b>Go easy on:</b> ${g.nutrition.limit.join(', ')}</small></p>
      </div>
      <div data-pane="move" class="hidden"><p><b>Intensity:</b> ${g.movement.intensity}</p><ul class="tips">${g.movement.ideas.map((x) => html`<li>${x}</li>`)}</ul></div>
      <div data-pane="care" class="hidden"><ul class="tips">${g.selfCare.map((x) => html`<li>${x}</li>`)}</ul></div>
      <div data-pane="mind" class="hidden"><p>${g.mind}</p></div>
      ${g.goalTips.length || g.conditionTips.length ? html`<hr style="border:0;border-top:1px solid var(--border);margin:14px 0">
        <ul class="tips">${g.goalTips.map((t) => html`<li>${t}</li>`)}${g.conditionTips.map((t) => html`<li><span class="pill info">${t.condition.toUpperCase()}</span> ${t.tip}</li>`)}</ul>` : ''}
    </div>

    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <div class="row between"><h2>💧 Hydration</h2><b id="water-val">${water} / ${d.waterGoal} ml</b></div>
        <div class="bar" style="margin:8px 0 12px"><i id="water-bar" style="width:${Math.min(100, (water / d.waterGoal) * 100)}%"></i></div>
        <div class="row">
          <button class="btn btn-soft btn-sm" data-action="water" data-ml="250">+ Glass (250 ml)</button>
          <button class="btn btn-soft btn-sm" data-action="water" data-ml="500">+ Bottle (500 ml)</button>
          <button class="btn btn-ghost btn-sm" data-action="water" data-ml="-250">− 250</button>
        </div>
      </div>
      <div class="card">
        <div class="row between"><h2>🥗 Phase nutrients today</h2><a href="/nutrition" class="btn btn-ghost btn-sm">Log food</a></div>
        ${d.nutrition.rows.map((r) => html`<div class="nutrient"><span>${r.label}</span><div class="bar focus"><i style="width:${Math.min(100, r.pct)}%"></i></div><span class="val">${r.pct}%</span></div>`)}
      </div>
    </div>

    ${d.meds.length ? html`<div class="card" style="margin-top:16px"><h2>💊 Today’s medications & supplements</h2>
      <ul class="list">${d.meds.map((m) => html`<li class="row between"><span><b>${m.name}</b> ${m.dose ? html`<small>${m.dose}</small>` : ''} <small class="muted">· ${m.time}</small></span>
        <button class="btn btn-sm ${m.taken ? 'btn-ghost' : ''}" data-action="med" data-id="${m.id}" data-taken="${m.taken ? 1 : 0}">${m.taken ? '✓ Taken' : 'Mark taken'}</button></li>`)}</ul></div>` : ''}

    <div class="card card-tint" style="margin-top:16px">
      <div class="row between"><div><b>Upcoming</b><br><small class="muted">Next ${d.predictions.length} predicted periods</small></div>
      <div class="row">${d.predictions.map((p) => html`<span class="pill menstrual">${dates.short(p.start)}</span>`)}</div></div>
    </div>
    <p class="disclaimer">Lunaria provides wellness information, not medical advice. Predictions are estimates and are not contraception.</p>
  `);

  root.querySelector('#g-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    root.querySelectorAll('#g-tabs button').forEach((x) => x.classList.toggle('on', x === b));
    root.querySelectorAll('[data-pane]').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== b.dataset.tab));
  });

  onActions(root, {
    'period-start': async () => {
      await api.put(`/logs/${d.today}`, { ...log, flow: Math.max(log.flow || 0, 3) });
      toast('Period logged — predictions updated 🩸');
      render_(root, ctx);
    },
    'period-end': async () => {
      const { periods } = await api.get('/periods');
      const last = periods[periods.length - 1];
      if (!last) return;
      await api.put(`/periods/${last.id}`, { end_date: d.today });
      toast('Period end saved');
      render_(root, ctx);
    },
    water: async (el) => {
      const r = await api.post(`/logs/${d.today}/water`, { delta: Number(el.dataset.ml) });
      root.querySelector('#water-val').textContent = `${r.water_ml} / ${d.waterGoal} ml`;
      root.querySelector('#water-bar').style.width = `${Math.min(100, (r.water_ml / d.waterGoal) * 100)}%`;
      log.water_ml = r.water_ml;
    },
    med: async (el) => {
      const taken = el.dataset.taken === '1';
      await api.post(`/meds/${el.dataset.id}/taken`, { taken: !taken });
      el.dataset.taken = taken ? '0' : '1';
      el.textContent = taken ? 'Mark taken' : '✓ Taken';
      el.classList.toggle('btn-ghost', !taken);
    },
  });
}

export { render_ as render };
