import { api } from '../api.js';
import { html, render as paint, dates, STANDALONE } from '../ui.js';

const GOAL_LABEL = { track: 'Cycle tracking', conceive: 'Trying to conceive', avoid: 'Avoiding pregnancy', perimenopause: 'Perimenopause' };

export async function render(root) {
  const r = await api.get('/report');
  const s = r.stats;
  paint(root, html`
    <div class="row between no-print" style="margin-bottom:12px">
      <h1 style="margin:0">Doctor report</h1>
      ${STANDALONE ? '' : html`<button class="btn" id="print">🖨️ Print / save PDF</button>`}
    </div>
    <div class="card">
      <h2>Menstrual health summary — ${r.name}</h2>
      <p class="muted">Generated ${dates.pretty(r.generated)} by Lunaria · last 6 months · ${r.daysLogged} days logged${r.age ? ` · age ${r.age}` : ''} · ${GOAL_LABEL[r.goal]}${r.conditions.length ? ` · reported conditions: ${r.conditions.join(', ').toUpperCase()}` : ''}</p>
      <div class="stats" style="margin:12px 0">
        <div class="stat"><div class="v">${s.avgCycle}</div><div class="k">mean cycle (d)</div></div>
        <div class="stat"><div class="v">${s.minCycle ?? '–'}–${s.maxCycle ?? '–'}</div><div class="k">range (d)</div></div>
        <div class="stat"><div class="v">±${s.sdCycle}</div><div class="k">SD (d)</div></div>
        <div class="stat"><div class="v">${s.avgPeriod}</div><div class="k">mean bleeding (d)</div></div>
        <div class="stat"><div class="v">${s.lutealLength}</div><div class="k">luteal (d)${s.lutealPersonalized ? '' : '*'}</div></div>
      </div>
      ${r.current ? html`<p><b>Last menstrual period (LMP):</b> ${dates.pretty(r.current.start)} · cycle day ${r.current.cycleDay}${r.current.isLate ? html` · <b>${r.current.daysLate} days late</b>` : ''}</p>` : ''}

      <h3>Recent cycles</h3>
      <table style="width:100%;border-collapse:collapse;font-size:.9rem">
        <thead><tr style="text-align:left;border-bottom:1px solid var(--border)"><th>Start</th><th>Length</th><th>Bleeding</th><th>Ovulation</th></tr></thead>
        <tbody>${[...r.cycles].reverse().map((c) => html`<tr style="border-bottom:1px solid var(--border)">
          <td>${c.start}</td><td>${c.length ? `${c.length} d` : 'current'}</td><td>${c.periodLength} d</td>
          <td>${c.ovulation ? `${c.ovulation} (${c.ovulationMethod})` : '–'}</td></tr>`)}</tbody>
      </table>

      <h3 style="margin-top:16px">Pain</h3>
      <p>${r.pain ? `Average ${r.pain.avg}/10, max ${r.pain.max}/10, ${r.pain.severeDays} days ≥ 7/10.` : 'No pain scores logged.'}</p>

      <h3>Most frequent symptoms (days logged)</h3>
      <p>${r.symptoms.length ? r.symptoms.slice(0, 12).map((x) => `${x.label} (${x.days})`).join(' · ') : 'None logged.'}</p>

      ${r.patterns.length ? html`<h3>Cyclical patterns</h3><ul class="tips">${r.patterns.map((p) => html`<li>${p.label}: ${p.lift >= 10 ? "10+" : p.lift}× more frequent in ${p.phase} phase${p.when ? `, typically ${p.when}` : ''}</li>`)}</ul>` : ''}

      <h3 style="margin-top:12px">Screening flags</h3>
      ${r.flags.length ? html`<ul class="tips">${r.flags.map((f) => html`<li><b>${f.title}</b> — ${f.detail}</li>`)}</ul>` : html`<p>No flags raised.</p>`}

      ${r.meds.length ? html`<h3>Current medications / supplements</h3><p>${r.meds.map((m) => `${m.name}${m.dose ? ` ${m.dose}` : ''} (${m.kind})`).join(' · ')}</p>` : ''}
      <p class="disclaimer">Self-reported data from the Lunaria app. Ovulation marked “estimated” is calendar-based; “bbt”/“lh” are derived from logged temperatures or LH tests. *Luteal length default when not personalised. Not a diagnosis.</p>
    </div>`);
  root.querySelector('#print')?.addEventListener('click', () => window.print());
}
