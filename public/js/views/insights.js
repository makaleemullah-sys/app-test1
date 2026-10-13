import { api } from '../api.js';
import { html, raw, render as paint, dates, lineChart, PHASE_META } from '../ui.js';

function cycleBars(cycles) {
  const done = cycles.filter((c) => c.length);
  if (!done.length) return html`<p class="muted">Log at least two periods to see your cycle history.</p>`;
  const max = Math.max(...done.map((c) => c.length), 35);
  return html`<div class="stack">${done.map((c) => {
    const ovPct = c.ovulation ? ((dates.diff(c.start, c.ovulation) + 1) / max) * 100 : null;
    return html`<div>
      <div class="row between"><small>${dates.short(c.start)}</small><small><b>${c.length} days</b>${c.valid ? '' : ' (outlier)'}${c.lutealLength ? ` · luteal ${c.lutealLength}d` : ''}</small></div>
      <div class="bar" style="height:14px;position:relative;background:var(--surface-2)">
        <i style="width:${(c.length / max) * 100}%;background:linear-gradient(90deg,var(--menstrual) ${(c.periodLength / c.length) * 100}%,var(--follicular) ${(c.periodLength / c.length) * 100}%,var(--luteal))"></i>
        ${ovPct != null ? html`<span title="Ovulation (${c.ovulationMethod})" style="position:absolute;top:-2px;left:calc(${ovPct}% - 5px);width:10px;height:18px;border-radius:4px;background:var(--ovulatory);${c.ovulationMethod === 'estimated' ? 'opacity:.5' : ''}"></span>` : ''}
      </div></div>`;
  })}</div>
  <small class="muted">Yellow marker = ovulation (solid when confirmed by BBT/LH, faded when estimated).</small>`;
}

export async function render(root) {
  const d = await api.get('/insights');
  const s = d.stats;
  const curves = d.curves;
  const hasCurves = curves.some((c) => c.n > 0);
  const avgLen = Math.round(s.avgCycle);
  const ovDay = Math.max(avgLen - Math.round(s.lutealLength), Math.round(s.avgPeriod) + 1);
  const bands = [
    { from: 0, to: Math.round(s.avgPeriod) - 1, color: PHASE_META.menstrual.color },
    { from: ovDay - 2, to: ovDay, color: PHASE_META.ovulatory.color },
    { from: ovDay + 1, to: avgLen - 1, color: PHASE_META.luteal.color },
  ];

  paint(root, html`
    <h1>Insights</h1>
    <p class="muted">Built only from your own data — the more you log, the sharper it gets. ${d.logsCount} days logged so far.</p>

    <div class="grid grid-2">
      <div class="card card-tint">
        <div class="row between"><h2>Cycle health score</h2><span class="score-ring">${d.score.score}</span></div>
        ${d.score.parts.map((p) => html`<div class="nutrient"><span>${p.label}</span><div class="bar"><i style="width:${(p.score / p.max) * 100}%"></i></div><span class="val">${p.score}/${p.max}</span></div>
          <small class="muted" style="display:block;margin:-6px 0 6px 120px">${p.note}</small>`)}
      </div>
      <div class="card">
        <h2>Your numbers</h2>
        <div class="stats">
          <div class="stat"><div class="v">${s.avgCycle}</div><div class="k">avg cycle (days)</div></div>
          <div class="stat"><div class="v">±${s.sdCycle}</div><div class="k">variation</div></div>
          <div class="stat"><div class="v">${s.avgPeriod}</div><div class="k">avg period</div></div>
          <div class="stat"><div class="v">${s.lutealLength}</div><div class="k">luteal phase${s.lutealPersonalized ? ' ✓' : '*'}</div></div>
        </div>
        <p style="margin-top:12px"><b>Regularity:</b> ${s.regularity} · <b>Prediction confidence:</b> ${s.confidence}</p>
        ${!s.lutealPersonalized ? html`<small class="muted">* Default 14 days. Log BBT or LH tests to personalise your luteal phase — it makes period predictions much more precise.</small>` : html`<small class="muted">✓ Personalised from confirmed ovulations.</small>`}
      </div>
    </div>

    ${d.flags.length ? html`<h3 class="section-title">Health screening</h3>
      <div class="grid">${d.flags.map((f) => html`<div class="card flag ${f.severity}">
        <div class="row between"><b>${f.title}</b><span class="pill ${f.severity}">${f.severity === 'consult' ? 'Talk to a clinician' : f.severity === 'watch' ? 'Watch' : 'FYI'}</span></div>
        <p style="margin:.4rem 0">${f.detail}</p><p class="muted" style="margin:0">${f.advice}</p></div>`)}
        <a href="/report" class="btn btn-soft">📄 Create a doctor-ready report</a></div>` : ''}

    <h3 class="section-title">Symptom patterns</h3>
    <div class="card">
      ${d.patterns.length ? html`<ul class="list">${d.patterns.slice(0, 8).map((p) => html`<li>
        <div class="row between"><b>${p.label}</b><span class="pill ${p.phase}">${PHASE_META[p.phase].emoji} ${PHASE_META[p.phase].name}</span></div>
        <small class="muted">${p.cyclical ? `${p.lift >= 10 ? "10×+" : `${p.lift}×`} more likely in your ${p.phase} phase` : 'Appears throughout your cycle'}${p.when ? `, usually ${p.when}` : ''} · logged ${p.total} times</small>
        <div class="row" style="gap:4px;margin-top:6px">${Object.entries(p.byPhase).map(([ph, pct]) => html`<div style="flex:1"><div class="bar" style="height:6px"><i style="width:${pct}%;background:${PHASE_META[ph].color}"></i></div></div>`)}</div>
      </li>`)}</ul>` : html`<p class="empty">Log symptoms for a few weeks and Lunaria will find your patterns — like “headaches 3× more likely 2 days before your period”.</p>`}
    </div>

    <h3 class="section-title">Next 5 days</h3>
    <div class="card">
      ${d.forecast.some((f) => f.support >= 3) ? html`<ul class="list">${d.forecast.map((f) => html`<li>
        <b>${dates.pretty(f.date)}</b>
        ${f.support < 3 ? html` <small class="muted">— not enough history</small>` : f.symptoms.length ? html`<div class="chips" style="margin-top:6px">${f.symptoms.map((x) => html`<span class="chip">${x.label} · ${x.probability}%</span>`)}</div>` : html` <small class="muted">— usually symptom-light</small>`}
      </li>`)}</ul>` : html`<p class="empty">Forecasts unlock after about two cycles of logging.</p>`}
    </div>

    <h3 class="section-title">How you feel across your cycle</h3>
    <div class="card">
      ${hasCurves ? html`${lineChart({
        series: [
          { values: curves.map((c) => c.mood), color: 'var(--primary)', dots: true },
          { values: curves.map((c) => c.energy), color: 'var(--follicular)', dots: true },
          { values: curves.map((c) => (c.pain == null ? null : c.pain / 2)), color: 'var(--menstrual)' },
        ],
        xLabels: curves.map((c) => (c.day === 1 || c.day % 7 === 0 ? c.day : null)),
        yMin: 0, yMax: 5, bands,
      })}
      <div class="legend"><span style="--c:var(--primary)">Mood (1–5)</span><span style="--c:var(--follicular)">Energy (1–5)</span><span style="--c:var(--menstrual)">Pain (0–10, scaled)</span></div>
      <small class="muted">X-axis: cycle day. Shaded: typical period, ovulation and luteal phase.</small>` : html`<p class="empty">Log mood, energy and pain to see your personal cycle curve.</p>`}
    </div>

    <h3 class="section-title">What affects you</h3>
    <div class="card">
      ${d.correlations.length ? html`<ul class="list">${d.correlations.map((c) => html`<li><b>${c.text}</b><br><small class="muted">${c.tip} (based on ${c.n[0]} vs ${c.n[1]} days)</small></li>`)}</ul>`
        : html`<p class="empty">Log sleep, water, exercise and stress alongside symptoms — Lunaria will discover which habits move the needle for <i>you</i>.</p>`}
    </div>

    ${d.bbt.length ? html`<h3 class="section-title">Temperature chart (this cycle)</h3>
    <div class="card">${bbtChart(d)}</div>` : ''}

    <h3 class="section-title">Cycle history</h3>
    <div class="card">${cycleBars(d.cycles)}</div>
    <div class="row" style="margin-top:16px"><a class="btn btn-soft" href="/report">📄 Doctor report</a><a class="btn btn-ghost" href="/learn">📚 Learn about your cycle</a></div>
  `);
}

function bbtChart(d) {
  const days = Math.max(...d.bbt.map((b) => b.day), 28);
  const values = Array.from({ length: days }, (_, i) => d.bbt.find((b) => b.day === i + 1)?.bbt ?? null);
  const temps = d.bbt.map((b) => b.bbt);
  const lo = Math.floor((Math.min(...temps) - 0.2) * 10) / 10;
  const hi = Math.ceil((Math.max(...temps) + 0.2) * 10) / 10;
  const ov = d.current?.ovulation;
  const ovDay = ov ? dates.diff(d.current.start, ov.date) + 1 : null;
  return html`${lineChart({
    series: [{ values, color: 'var(--accent)', dots: true }],
    xLabels: values.map((_, i) => (i === 0 || (i + 1) % 7 === 0 ? i + 1 : null)),
    yMin: lo, yMax: hi,
    bands: ovDay ? [{ from: ovDay - 1, to: ovDay - 1 + 0.01, color: 'var(--ovulatory)' }, { from: ovDay - 1, to: values.length - 1, color: 'var(--luteal)' }] : [],
  })}
  <small class="muted">${ov?.confirmed ? raw(`Ovulation <b>confirmed</b> by ${ov.method.toUpperCase()} on ${dates.short(ov.date)} — your next period prediction is locked to your luteal phase.`) : 'Lunaria looks for a sustained rise of ≥0.2°C over the previous six days (“three-over-six” rule) to confirm ovulation.'}</small>`;
}
