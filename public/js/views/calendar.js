import { api } from '../api.js';
import { html, render as paint, dates, phasePill, toast, onActions } from '../ui.js';

export async function render(root, ctx) {
  let month = (ctx.params.get('m') || dates.local()).slice(0, 7) + '-01';
  let selected = null;

  async function draw() {
    const first = month;
    const nextMonth = dates.add(first, 32).slice(0, 7) + '-01';
    const gridStart = dates.add(first, -dates.dow(first));
    const gridEnd = dates.add(nextMonth, (6 - dates.dow(dates.add(nextMonth, -1))) - 1);
    const [{ days, today }, { periods, stats }] = await Promise.all([
      api.get(`/cycle/calendar?from=${gridStart}&to=${gridEnd}`),
      api.get('/periods'),
    ]);
    const sel = days.find((d) => d.date === selected);
    paint(root, html`
      <div class="grid" style="grid-template-columns:minmax(0,1fr)">
      <div class="card">
        <div class="row between" style="margin-bottom:12px">
          <button class="btn btn-ghost btn-sm" data-action="prev" aria-label="Previous month">‹</button>
          <h2 style="margin:0">${dates.month(first)}</h2>
          <button class="btn btn-ghost btn-sm" data-action="next" aria-label="Next month">›</button>
        </div>
        <div class="cal">
          ${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d) => html`<div class="dow">${d}</div>`)}
          ${days.map((d) => {
            const cls = ['day'];
            if (d.date.slice(0, 7) !== first.slice(0, 7)) cls.push('out');
            if (d.date === today) cls.push('today');
            if (d.period) cls.push(`period-${d.period}`);
            else if (d.fertile) cls.push('fertile');
            if (d.ovulation) cls.push('ovulation');
            return html`<button type="button" class="${cls.join(' ')}" data-action="pick" data-date="${d.date}" aria-label="${dates.pretty(d.date)}">
              ${Number(d.date.slice(8))}${d.logged || d.spotting ? html`<span class="dots"><i></i></span>` : ''}</button>`;
          })}
        </div>
        <div class="legend" style="margin-top:12px">
          <span style="--c:var(--menstrual)">Period</span><span style="--c:transparent;border:1px dashed var(--menstrual);border-radius:4px;padding:0 4px">Predicted</span>
          <span style="--c:var(--fertile)">Fertile</span><span style="--c:var(--ovulatory)">Ovulation</span><span style="--c:var(--accent)">Logged</span>
        </div>
      </div>

      ${sel ? html`<div class="card">
        <div class="row between"><h2 style="margin:0">${dates.pretty(sel.date)}</h2>${phasePill(sel.phase)}</div>
        <p class="muted" style="margin-top:6px">${sel.cycleDay ? `Cycle day ${sel.cycleDay}` : ''}${sel.predicted ? ' · predicted' : ''}
          ${sel.fertile ? ' · fertile window' : ''}${sel.ovulation ? ` · ${sel.ovulationMethod && sel.ovulationMethod !== 'estimated' ? `ovulation (confirmed by ${sel.ovulationMethod.toUpperCase()})` : 'estimated ovulation'}` : ''}</p>
        <div class="row">
          ${sel.date <= today ? html`<a class="btn btn-sm" href="/log?date=${sel.date}">${sel.logged ? 'Edit log' : 'Log this day'}</a>
            <button class="btn btn-soft btn-sm" data-action="start-here" data-date="${sel.date}">Period started this day</button>` : html`<small class="muted">Future day</small>`}
        </div>
      </div>` : ''}

      <div class="card">
        <h2>Period history</h2>
        <p class="muted"><small>Average cycle ${stats.avgCycle} days · period ${stats.avgPeriod} days · ${stats.cyclesTracked} cycles tracked</small></p>
        <form id="add-period" class="row" style="align-items:flex-end">
          <div style="flex:1;min-width:130px"><label for="ps">Start</label><input id="ps" name="start" type="date" max="${today}" required></div>
          <div style="flex:1;min-width:130px"><label for="pe">End <small>(optional)</small></label><input id="pe" name="end" type="date" max="${today}"></div>
          <button class="btn" type="submit">Add period</button>
        </form>
        <ul class="list" style="margin-top:12px">
          ${[...periods].reverse().map((p) => html`<li class="row between">
            <span>🩸 ${dates.short(p.start_date)}${p.end_date ? ` – ${dates.short(p.end_date)}` : ' (ongoing / no end logged)'} <small class="muted">${p.start_date.slice(0, 4)}</small></span>
            <button class="btn btn-ghost btn-sm" data-action="del" data-id="${p.id}" aria-label="Delete period">Delete</button></li>`)}
        </ul>
      </div>
      </div>`);

    root.querySelector('#add-period').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      try {
        await api.post('/periods', { start_date: f.start.value, end_date: f.end.value || null });
        toast('Period added — predictions updated');
        draw();
      } catch (ex) { toast(ex.message); }
    });
  }

  onActions(root, {
    prev: () => { month = dates.add(month, -1).slice(0, 7) + '-01'; draw(); },
    next: () => { month = dates.add(month, 32).slice(0, 7) + '-01'; draw(); },
    pick: (el) => { selected = el.dataset.date; draw(); },
    'start-here': async (el) => {
      try {
        await api.post('/periods', { start_date: el.dataset.date });
        toast('Period start saved 🩸');
        draw();
      } catch (ex) { toast(ex.message); }
    },
    del: async (el) => {
      if (!confirm('Delete this period? Predictions will be recalculated.')) return;
      await api.del(`/periods/${el.dataset.id}`);
      draw();
    },
  });
  await draw();
}
