'use strict';
// Generates ~7 months of realistic sample data (deterministic) so every
// insight — patterns, forecasts, correlations, BBT confirmation — lights up.
// Used by seed-demo.js (SQLite) and the single-file phone build.
const { addDays } = require('../server/engine/dates');

function generateDemoData(today) {
  let seed = 42;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const pick = (p) => rand() < p;

  const lengths = [29, 27, 28, 30, 27, 28, 29];
  const starts = [];
  let s = addDays(today, -12);
  starts.unshift(s);
  for (const len of lengths) { s = addDays(s, -len); starts.unshift(s); }

  const periods = [];
  const logs = [];
  for (let c = 0; c < starts.length; c++) {
    const start = starts[c];
    const next = starts[c + 1] || addDays(today, 1);
    const len = Math.round((Date.parse(next) - Date.parse(start)) / 86400000);
    const periodLen = c % 3 === 0 ? 6 : 5;
    periods.push({ start_date: start, end_date: addDays(start, periodLen - 1) });
    const ovDay = len - 13; // luteal ~13 days
    for (let day = 1; day <= len; day++) {
      const date = addDays(start, day - 1);
      if (date > today) break;
      if (!pick(0.85) && day > periodLen) continue; // realistic gaps
      const daysBefore = len - day + 1;
      const symptoms = [];
      let flow = 0;
      if (day <= periodLen) flow = [4, 5, 3, 2, 2, 1][day - 1] - (c % 2 && day === 2 ? 1 : 0);
      if (day <= 2 && pick(0.85)) symptoms.push('cramps');
      if (day <= 3 && pick(0.6)) symptoms.push('fatigue');
      if (day <= 2 && pick(0.35)) symptoms.push('dizziness');
      if (daysBefore <= 3 && daysBefore >= 1 && pick(0.7)) symptoms.push('headache');
      if (daysBefore <= 6 && pick(0.6)) symptoms.push('bloating');
      if (daysBefore <= 5 && pick(0.5)) symptoms.push('cravings');
      if (daysBefore <= 4 && pick(0.45)) symptoms.push('irritability');
      if (daysBefore <= 7 && pick(0.35)) symptoms.push('breast_tenderness');
      if (Math.abs(day - ovDay) <= 1 && pick(0.6)) symptoms.push('high_libido');
      if (daysBefore <= 4 && pick(0.4)) symptoms.push('acne');

      const sleep = Math.round((6 + rand() * 2.5) * 2) / 2;
      const water = Math.round((1000 + rand() * 1600) / 250) * 250;
      let pain = day <= 2 ? 5 + Math.round(rand() * 3) : daysBefore <= 2 ? 2 + Math.round(rand() * 2) : Math.round(rand() * 1.5);
      if (sleep < 7 && pain > 0) pain = Math.min(10, pain + 2); // poor sleep → worse pain
      if (water < 1500 && pick(0.5) && !symptoms.includes('headache')) symptoms.push('headache');
      const mood = Math.max(1, Math.min(5, (daysBefore <= 4 ? 2 : day > periodLen && day < ovDay + 3 ? 4 : 3) + (rand() < 0.2 ? 1 : 0) - (sleep < 6.5 ? 1 : 0)));
      const energy = Math.max(1, Math.min(5, day <= 3 ? 2 : Math.abs(day - ovDay) <= 3 ? 5 : daysBefore <= 5 ? 2 : 4));
      const stress = 1 + Math.floor(rand() * 4);
      const exercise = pick(0.5) ? 20 + Math.round(rand() * 40) : 0;
      // BBT: ~36.4 °C before ovulation, ~36.8 °C after.
      const bbt = Math.round(((day <= ovDay ? 36.35 : 36.75) + (rand() - 0.5) * 0.15) * 100) / 100;
      const lh = day === ovDay - 1 ? 'peak' : Math.abs(day - ovDay) <= 3 ? 'negative' : null;
      const mucus = day <= periodLen ? null : day >= ovDay - 2 && day <= ovDay ? 'eggwhite' : day < ovDay - 2 ? (day < ovDay - 6 ? 'dry' : 'creamy') : 'sticky';
      logs.push({
        date, flow, symptoms, mood, energy, pain, stress, sleep_hours: sleep, water_ml: water,
        exercise_min: exercise, bbt, lh, mucus, sex: pick(0.1) ? 'protected' : 'none', notes: null,
      });
    }
  }

  const menus = [
    [['oats', 'breakfast'], ['blueberries', 'breakfast'], ['lentils', 'lunch'], ['spinach', 'lunch'], ['greek_yogurt', 'snack'], ['quinoa', 'dinner'], ['broccoli', 'dinner']],
    [['eggs', 'breakfast'], ['ww_bread', 'breakfast'], ['chickpeas', 'lunch'], ['bell_pepper', 'lunch'], ['almonds', 'snack'], ['tofu', 'dinner'], ['brown_rice', 'dinner']],
    [['cereal', 'breakfast'], ['milk', 'breakfast'], ['pizza', 'lunch'], ['dark_chocolate', 'snack'], ['black_beans', 'dinner'], ['sweet_potato', 'dinner']],
  ];
  const foods = [];
  for (let i = 1; i <= 7; i++) {
    for (const [food_id, meal] of menus[i % menus.length]) foods.push({ date: addDays(today, -i), food_id, servings: 1, meal });
  }
  foods.push({ date: today, food_id: 'oats', servings: 1, meal: 'breakfast' });
  foods.push({ date: today, food_id: 'banana', servings: 1, meal: 'breakfast' });

  return {
    profile: { birth_year: 1994, goal: 'track', conditions: ['anemia'], diet: 'vegetarian' },
    periods,
    logs,
    foods,
    meds: [
      { name: 'Iron + vitamin C', dose: '18 mg', time: '09:00', kind: 'supplement' },
      { name: 'Magnesium glycinate', dose: '200 mg', time: '21:00', kind: 'supplement' },
    ],
  };
}

module.exports = { generateDemoData };
