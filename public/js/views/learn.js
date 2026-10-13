import { html, render as paint } from '../ui.js';

const ARTICLES = [
  {
    tag: 'Basics', title: 'Your cycle is a vital sign',
    body: ['The American College of Obstetricians and Gynecologists calls the menstrual cycle a “vital sign” — changes in it can be an early clue to thyroid problems, PCOS, anaemia, stress or under-eating.',
      'A typical adult cycle is 21–35 days with 2–7 days of bleeding. Variation of up to 7–9 days between cycles is considered normal.'],
  },
  {
    tag: 'Science', title: 'Why the second half of your cycle is the most predictable',
    body: ['The luteal phase (ovulation → next period) is fairly stable for each person, usually 11–17 days. Most variation in cycle length comes from when you ovulate.',
      'That’s why Lunaria confirms ovulation from your BBT (three temperatures above the previous six) or a positive LH test, then predicts your period from your personal luteal length — much more accurate than a calendar average.'],
  },
  {
    tag: 'Fertility', title: 'The fertile window, explained',
    body: ['Sperm can survive up to 5 days; an egg about 12–24 hours. So your fertile window is the 5 days before ovulation plus ovulation day. The 2 days before ovulation have the highest chance of conception.',
      'Egg-white cervical mucus and a positive LH test are the best at-home signs that ovulation is near. App predictions alone should never be used as contraception.'],
  },
  {
    tag: 'Nutrition', title: 'Iron: the nutrient periods take',
    body: ['Women 19–50 need about 18 mg of iron per day (≈32 mg if vegetarian/vegan, because plant iron is absorbed less well). Heavy periods are the most common cause of iron deficiency.',
      'Pair iron foods with vitamin C (citrus, peppers, berries) and keep tea and coffee an hour away from iron-rich meals. Fatigue, breathlessness and dizziness can be signs — ask about a ferritin test.'],
  },
  {
    tag: 'Nutrition', title: 'Magnesium, B6 & calcium for PMS',
    body: ['Clinical studies link magnesium, vitamin B6 and calcium to fewer PMS symptoms such as bloating, mood changes and cramps. Find them in leafy greens, seeds, legumes, bananas, tofu and dairy.',
      'In the luteal phase your resting metabolism rises slightly — about 100–300 kcal a day — so increased appetite is normal. Complex carbs and protein help keep cravings steady.'],
  },
  {
    tag: 'Movement', title: 'Training with your cycle',
    body: ['Rising estrogen in the follicular phase supports strength gains and recovery — a great time to push intensity. Around ovulation, warm up thoroughly; ligaments may be slightly laxer.',
      'In the late luteal and menstrual phases, many people prefer moderate exercise — but movement of any kind can ease cramps and lift mood. Listen to your body; there are no rules.'],
  },
  {
    tag: 'When to see a clinician', title: 'Signs not to ignore',
    body: ['Soaking a pad or tampon every 1–2 hours, clots bigger than a coin, periods lasting more than 7 days, pain that stops you doing daily activities, bleeding between periods or after sex, cycles shorter than 21 or longer than 35 days, or no period for 3 months.',
      'Lunaria’s health screening watches for these patterns and can generate a doctor-ready report from your logs.'],
  },
  {
    tag: 'Conditions', title: 'PCOS, endometriosis & PMDD',
    body: ['PCOS affects about 1 in 10 women and often shows up as long or irregular cycles, acne and excess hair growth. Endometriosis takes on average 7–10 years to diagnose — detailed pain logs help.',
      'PMDD is a severe, cyclical mood disorder that appears in the week before a period and lifts after it starts. Tracking mood daily for two cycles is part of how it’s diagnosed.'],
  },
  {
    tag: 'Life stages', title: 'Perimenopause',
    body: ['Usually starting in your 40s, perimenopause brings changing cycle lengths, heavier or lighter periods, hot flashes, night sweats and sleep disruption.',
      'Strength training, calcium + vitamin D and protein support bone health. Keep logging — a clear record helps clinicians tailor treatment, including hormone therapy if appropriate.'],
  },
];

export async function render(root) {
  paint(root, html`<h1>Learn</h1>
    <p class="muted">Short, evidence-informed reads about your body.</p>
    <div class="grid grid-2">${ARTICLES.map((a) => html`<details class="card article">
      <summary><span class="pill info">${a.tag}</span> ${a.title}</summary>
      ${a.body.map((p) => html`<p>${p}</p>`)}
    </details>`)}</div>
    <p class="disclaimer">Educational content only — not a substitute for professional medical advice.</p>`);
}
