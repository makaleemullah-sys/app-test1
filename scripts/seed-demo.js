'use strict';
// Creates demo@lunaria.app / lunaria-demo with ~7 months of realistic data so
// every insight (patterns, forecasts, correlations, BBT confirmation) lights up.
const path = require('node:path');
const { openDb, tx } = require('../server/db');
const { hashPassword } = require('../server/auth');
const { addDays, todayIn } = require('../server/engine/dates');

const file = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'lunaria.db');
const db = openDb(file);
const EMAIL = 'demo@lunaria.app';
const PASSWORD = 'lunaria-demo';
const TZ = process.env.DEMO_TZ || 'UTC';

let seed = 42;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const pick = (p) => rand() < p;

seedDemo();

function seedDemo() {
  db.prepare('DELETE FROM users WHERE email = ?').run(EMAIL);
  const today = todayIn(TZ);
  tx(db, () => {
    const id = Number(db.prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)').run(EMAIL, 'Maya', hashPassword(PASSWORD)).lastInsertRowid);
    db.prepare(`INSERT INTO profiles (user_id, birth_year, goal, conditions, diet, timezone, onboarded) VALUES (?, 1994, 'track', '["anemia"]', 'vegetarian', ?, 1)`).run(id, TZ);
    db.prepare('INSERT INTO notification_prefs (user_id, bbt_reminder) VALUES (?, 1)').run(id);

    // Cycle starts going back ~7 months.
    const lengths = [29, 27, 28, 30, 27, 28, 29];
    const starts = [];
    let s = addDays(today, -12);
    starts.unshift(s);
    for (const len of lengths) { s = addDays(s, -len); starts.unshift(s); }

    const insPeriod = db.prepare('INSERT INTO periods (user_id, start_date, end_date) VALUES (?, ?, ?)');
    const insLog = db.prepare(`INSERT INTO daily_logs (user_id, date, flow, symptoms, mood, energy, pain, stress, sleep_hours, water_ml, exercise_min, bbt, lh, mucus, sex)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insFood = db.prepare('INSERT INTO food_logs (user_id, date, food_id, servings, meal) VALUES (?, ?, ?, 1, ?)');

    for (let c = 0; c < starts.length; c++) {
      const start = starts[c];
      const next = starts[c + 1] || addDays(today, 1);
      const len = Math.round((Date.parse(next) - Date.parse(start)) / 86400000);
      const periodLen = c % 3 === 0 ? 6 : 5;
      insPeriod.run(id, start, addDays(start, periodLen - 1));
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
        // BBT: ~36.4 before ovulation, ~36.8 after.
        const bbt = Math.round(((day <= ovDay ? 36.35 : 36.75) + (rand() - 0.5) * 0.15) * 100) / 100;
        const lh = day === ovDay - 1 ? 'peak' : Math.abs(day - ovDay) <= 3 ? 'negative' : null;
        const mucus = day <= periodLen ? null : day >= ovDay - 2 && day <= ovDay ? 'eggwhite' : day < ovDay - 2 ? (day < ovDay - 6 ? 'dry' : 'creamy') : 'sticky';
        insLog.run(id, date, flow, JSON.stringify(symptoms), mood, energy, pain, stress, sleep, water, exercise, bbt, lh, mucus, pick(0.1) ? 'protected' : 'none');
      }
    }

    // A week of food logs.
    const days = [
      [['oats', 'breakfast'], ['blueberries', 'breakfast'], ['lentils', 'lunch'], ['spinach', 'lunch'], ['greek_yogurt', 'snack'], ['quinoa', 'dinner'], ['broccoli', 'dinner']],
      [['eggs', 'breakfast'], ['ww_bread', 'breakfast'], ['chickpeas', 'lunch'], ['bell_pepper', 'lunch'], ['almonds', 'snack'], ['tofu', 'dinner'], ['brown_rice', 'dinner']],
      [['cereal', 'breakfast'], ['milk', 'breakfast'], ['pizza', 'lunch'], ['dark_chocolate', 'snack'], ['black_beans', 'dinner'], ['sweet_potato', 'dinner']],
    ];
    for (let i = 1; i <= 7; i++) {
      for (const [food, meal] of days[i % days.length]) insFood.run(id, addDays(today, -i), food, meal);
    }
    insFood.run(id, today, 'oats', 'breakfast');
    insFood.run(id, today, 'banana', 'breakfast');

    db.prepare("INSERT INTO medications (user_id, name, dose, time, kind) VALUES (?, 'Iron + vitamin C', '18 mg', '09:00', 'supplement')").run(id);
    db.prepare("INSERT INTO medications (user_id, name, dose, time, kind) VALUES (?, 'Magnesium glycinate', '200 mg', '21:00', 'supplement')").run(id);
  });
  console.log(`Seeded demo account → ${EMAIL} / ${PASSWORD} (db: ${file})`);
}
