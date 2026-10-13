'use strict';
// Compact nutrient database (approximate USDA FoodData Central values per
// typical serving) and phase-aware analysis.

const NUTRIENTS = [
  { key: 'kcal', label: 'Energy', unit: 'kcal' },
  { key: 'protein', label: 'Protein', unit: 'g' },
  { key: 'fiber', label: 'Fiber', unit: 'g' },
  { key: 'iron', label: 'Iron', unit: 'mg' },
  { key: 'calcium', label: 'Calcium', unit: 'mg' },
  { key: 'magnesium', label: 'Magnesium', unit: 'mg' },
  { key: 'zinc', label: 'Zinc', unit: 'mg' },
  { key: 'b6', label: 'Vitamin B6', unit: 'mg' },
  { key: 'vitc', label: 'Vitamin C', unit: 'mg' },
  { key: 'folate', label: 'Folate', unit: 'µg' },
  { key: 'omega3', label: 'Omega-3', unit: 'g' },
  { key: 'caffeine', label: 'Caffeine', unit: 'mg', limit: true },
];
const KEYS = NUTRIENTS.map((n) => n.key);

// [id, name, serving, diet, category, kcal, protein, fiber, iron, calcium,
//  magnesium, zinc, b6, vitc, folate, omega3, caffeine]
const RAW = [
  ['spinach', 'Spinach, cooked', '1 cup', 'vegan', 'veg', 41, 5.3, 4.3, 6.4, 245, 157, 1.4, 0.44, 17.6, 263, 0.17, 0],
  ['kale', 'Kale, cooked', '1 cup', 'vegan', 'veg', 36, 2.5, 2.6, 1.2, 94, 23, 0.3, 0.18, 53, 17, 0.13, 0],
  ['broccoli', 'Broccoli, cooked', '1 cup', 'vegan', 'veg', 55, 3.7, 5.1, 1, 62, 33, 0.7, 0.31, 101, 168, 0.19, 0],
  ['beetroot', 'Beetroot, cooked', '1 cup', 'vegan', 'veg', 74, 2.8, 3.4, 1.3, 27, 39, 0.6, 0.11, 6, 136, 0, 0],
  ['bell_pepper', 'Red bell pepper', '1 cup', 'vegan', 'veg', 39, 1.5, 3.1, 0.6, 10, 18, 0.4, 0.44, 190, 69, 0, 0],
  ['tomato', 'Tomato', '1 medium', 'vegan', 'veg', 22, 1.1, 1.5, 0.3, 12, 14, 0.2, 0.1, 17, 18, 0, 0],
  ['mushrooms', 'Mushrooms, cooked', '1 cup', 'vegan', 'veg', 44, 3.4, 3.4, 2.7, 9, 19, 1.4, 0.15, 6, 28, 0, 0],
  ['sweet_potato', 'Sweet potato, baked', '1 medium', 'vegan', 'carb', 103, 2.3, 3.8, 0.8, 43, 31, 0.4, 0.33, 22, 7, 0, 0],
  ['potato', 'Potato with skin, baked', '1 medium', 'vegan', 'carb', 161, 4.3, 3.8, 1.9, 26, 48, 0.6, 0.54, 16.6, 48, 0.02, 0],
  ['lentils', 'Lentils, cooked', '1 cup', 'vegan', 'legume', 230, 18, 15.6, 6.6, 38, 71, 2.5, 0.35, 3, 358, 0.07, 0],
  ['chickpeas', 'Chickpeas, cooked', '1 cup', 'vegan', 'legume', 269, 14.5, 12.5, 4.7, 80, 79, 2.5, 0.23, 2.1, 282, 0.07, 0],
  ['black_beans', 'Black beans, cooked', '1 cup', 'vegan', 'legume', 227, 15, 15, 3.6, 46, 120, 1.9, 0.12, 0, 256, 0.18, 0],
  ['kidney_beans', 'Kidney beans, cooked', '1 cup', 'vegan', 'legume', 225, 15.3, 11.3, 3.9, 50, 74, 1.9, 0.21, 2, 230, 0.3, 0],
  ['edamame', 'Edamame', '1 cup', 'vegan', 'legume', 188, 18.4, 8, 3.5, 98, 99, 2.1, 0.2, 9.5, 482, 0.56, 0],
  ['tofu', 'Tofu, firm (calcium-set)', '½ cup', 'vegan', 'protein', 181, 21.8, 2.9, 3.4, 861, 73, 2, 0.12, 0.3, 37, 0.73, 0],
  ['tempeh', 'Tempeh', '100 g', 'vegan', 'protein', 192, 20, 4, 2.7, 111, 81, 1.1, 0.2, 0, 24, 0.1, 0],
  ['hummus', 'Hummus', '¼ cup', 'vegan', 'legume', 102, 4.8, 3.7, 1.5, 24, 44, 1.1, 0.24, 0, 51, 0.04, 0],
  ['salmon', 'Salmon, cooked', '100 g', 'omni', 'protein', 206, 22, 0, 0.3, 15, 30, 0.4, 0.64, 0, 34, 2.2, 0],
  ['sardines', 'Sardines, canned', '100 g', 'omni', 'protein', 208, 24.6, 0, 2.9, 382, 39, 1.3, 0.17, 0, 10, 1.5, 0],
  ['tuna', 'Tuna, canned', '100 g', 'omni', 'protein', 116, 25.5, 0, 1.5, 11, 27, 0.8, 0.32, 0, 4, 0.27, 0],
  ['shrimp', 'Shrimp, cooked', '85 g', 'omni', 'protein', 84, 20, 0, 0.4, 77, 30, 1.4, 0.1, 0, 3, 0.3, 0],
  ['oysters', 'Oysters, cooked', '85 g', 'omni', 'protein', 70, 6, 0, 7.8, 50, 40, 32, 0.05, 3, 13, 0.4, 0],
  ['beef', 'Lean beef', '100 g', 'omni', 'protein', 250, 26, 0, 2.6, 18, 21, 6.3, 0.38, 0, 9, 0.05, 0],
  ['liver', 'Beef liver', '85 g', 'omni', 'protein', 162, 24.6, 0, 5.2, 5, 18, 4.5, 0.87, 1.6, 215, 0.04, 0],
  ['chicken', 'Chicken breast', '100 g', 'omni', 'protein', 165, 31, 0, 1, 15, 29, 1, 0.6, 0, 4, 0.03, 0],
  ['eggs', 'Eggs', '2 large', 'vegetarian', 'protein', 143, 12.6, 0, 1.8, 56, 12, 1.3, 0.17, 0, 47, 0.07, 0],
  ['greek_yogurt', 'Greek yogurt, plain', '170 g', 'vegetarian', 'dairy', 100, 17, 0, 0.1, 187, 19, 0.9, 0.1, 0, 12, 0, 0],
  ['yogurt', 'Yogurt, plain', '1 cup', 'vegetarian', 'dairy', 150, 8.5, 0, 0.1, 296, 28, 1.4, 0.07, 1.2, 17, 0, 0],
  ['milk', 'Milk', '1 cup', 'vegetarian', 'dairy', 122, 8, 0, 0, 293, 27, 1, 0.09, 0, 12, 0, 0],
  ['soy_milk', 'Soy milk, fortified', '1 cup', 'vegan', 'dairy', 105, 6.3, 1.2, 1, 300, 39, 0.6, 0.08, 0, 22, 0, 0],
  ['cheddar', 'Cheddar cheese', '30 g', 'vegetarian', 'dairy', 120, 7, 0, 0.2, 200, 8, 0.9, 0.02, 0, 5, 0, 0],
  ['paneer', 'Paneer', '100 g', 'vegetarian', 'dairy', 265, 18, 0, 0.2, 480, 8, 2.7, 0.05, 0, 9, 0, 0],
  ['almonds', 'Almonds', '28 g', 'vegan', 'nuts', 164, 6, 3.5, 1, 76, 76, 0.9, 0.04, 0, 14, 0, 0],
  ['walnuts', 'Walnuts', '28 g', 'vegan', 'nuts', 185, 4.3, 1.9, 0.8, 28, 45, 0.9, 0.15, 0.4, 28, 2.5, 0],
  ['cashews', 'Cashews', '28 g', 'vegan', 'nuts', 157, 5.2, 0.9, 1.9, 10, 83, 1.6, 0.12, 0.1, 7, 0.02, 0],
  ['brazil_nuts', 'Brazil nuts', '28 g', 'vegan', 'nuts', 187, 4, 2.1, 0.7, 45, 106, 1.2, 0.03, 0.2, 6, 0.01, 0],
  ['pumpkin_seeds', 'Pumpkin seeds', '28 g', 'vegan', 'nuts', 158, 8.6, 1.7, 2.3, 13, 156, 2.2, 0.04, 0.5, 16, 0.03, 0],
  ['sunflower_seeds', 'Sunflower seeds', '28 g', 'vegan', 'nuts', 165, 5.5, 3.1, 1.1, 20, 36, 1.5, 0.38, 0.4, 67, 0.02, 0],
  ['chia', 'Chia seeds', '28 g', 'vegan', 'nuts', 138, 4.7, 9.8, 2.2, 179, 95, 1.3, 0, 0.5, 14, 5, 0],
  ['flax', 'Ground flaxseed', '2 tbsp', 'vegan', 'nuts', 75, 2.6, 3.8, 0.8, 36, 55, 0.6, 0.07, 0.1, 12, 3.2, 0],
  ['tahini', 'Tahini', '1 tbsp', 'vegan', 'nuts', 89, 2.6, 1.4, 1.3, 64, 14, 0.7, 0.02, 0, 15, 0.06, 0],
  ['peanut_butter', 'Peanut butter', '2 tbsp', 'vegan', 'nuts', 190, 7, 1.9, 0.6, 15, 54, 0.9, 0.17, 0, 24, 0.01, 0],
  ['oats', 'Oatmeal, cooked', '1 cup', 'vegan', 'carb', 166, 5.9, 4, 2.1, 21, 63, 2.3, 0.01, 0, 14, 0.03, 0],
  ['quinoa', 'Quinoa, cooked', '1 cup', 'vegan', 'carb', 222, 8.1, 5.2, 2.8, 31, 118, 2, 0.23, 0, 78, 0.1, 0],
  ['brown_rice', 'Brown rice, cooked', '1 cup', 'vegan', 'carb', 218, 4.5, 3.5, 0.8, 20, 86, 1.2, 0.28, 0, 8, 0.03, 0],
  ['white_rice', 'White rice, enriched', '1 cup', 'vegan', 'carb', 205, 4.3, 0.6, 1.9, 16, 19, 0.8, 0.15, 0, 92, 0, 0],
  ['ww_bread', 'Whole-wheat bread', '2 slices', 'vegan', 'carb', 160, 8, 4, 1.7, 60, 46, 1.2, 0.14, 0, 28, 0.04, 0],
  ['ww_pasta', 'Whole-wheat pasta', '1 cup', 'vegan', 'carb', 174, 7.5, 6.3, 1.5, 21, 42, 1.1, 0.11, 0, 7, 0.04, 0],
  ['cereal', 'Fortified breakfast cereal', '1 cup', 'vegan', 'carb', 110, 3, 3, 8, 100, 30, 3.8, 0.5, 6, 200, 0, 0],
  ['avocado', 'Avocado', '½ fruit', 'vegan', 'fruit', 160, 2, 6.7, 0.6, 12, 29, 0.6, 0.26, 10, 81, 0.11, 0],
  ['banana', 'Banana', '1 medium', 'vegan', 'fruit', 105, 1.3, 3.1, 0.3, 6, 32, 0.2, 0.43, 10, 24, 0.03, 0],
  ['orange', 'Orange', '1 medium', 'vegan', 'fruit', 62, 1.2, 3.1, 0.1, 52, 13, 0.1, 0.08, 70, 40, 0, 0],
  ['strawberries', 'Strawberries', '1 cup', 'vegan', 'fruit', 49, 1, 3, 0.6, 24, 20, 0.2, 0.07, 89, 36, 0.1, 0],
  ['blueberries', 'Blueberries', '1 cup', 'vegan', 'fruit', 84, 1.1, 3.6, 0.4, 9, 9, 0.2, 0.08, 14, 9, 0.09, 0],
  ['kiwi', 'Kiwi', '1 fruit', 'vegan', 'fruit', 42, 0.8, 2.1, 0.2, 23, 12, 0.1, 0.05, 64, 17, 0.03, 0],
  ['apple', 'Apple', '1 medium', 'vegan', 'fruit', 95, 0.5, 4.4, 0.2, 11, 9, 0.1, 0.07, 8.4, 5, 0.02, 0],
  ['dates', 'Medjool dates', '2 dates', 'vegan', 'fruit', 133, 0.9, 3.2, 0.4, 31, 26, 0.2, 0.12, 0, 7, 0, 0],
  ['apricots', 'Dried apricots', '¼ cup', 'vegan', 'fruit', 78, 1.1, 2.4, 0.9, 18, 10, 0.1, 0.05, 0.3, 3, 0, 0],
  ['dark_chocolate', 'Dark chocolate 70–85%', '28 g', 'vegan', 'treat', 170, 2.2, 3.1, 3.4, 20, 64, 0.9, 0.01, 0, 0, 0.01, 22],
  ['molasses', 'Blackstrap molasses', '1 tbsp', 'vegan', 'treat', 47, 0, 0, 3.6, 172, 48, 0.2, 0.14, 0, 0, 0, 0],
  ['miso_soup', 'Miso soup', '1 cup', 'vegan', 'soup', 40, 3, 1, 0.8, 30, 25, 0.4, 0.06, 0, 15, 0.05, 0],
  ['bone_broth', 'Bone broth', '1 cup', 'omni', 'soup', 40, 9, 0, 0.5, 10, 5, 0, 0.05, 0, 0, 0, 0],
  ['coffee', 'Coffee', '1 cup', 'vegan', 'drink', 2, 0.3, 0, 0, 5, 7, 0, 0, 0, 5, 0, 95],
  ['green_tea', 'Green tea', '1 cup', 'vegan', 'drink', 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 28],
  ['ginger_tea', 'Ginger tea', '1 cup', 'vegan', 'drink', 2, 0, 0, 0, 2, 2, 0, 0, 0, 0, 0, 0],
  ['soda', 'Cola', '1 can', 'vegan', 'processed', 140, 0, 0, 0, 7, 0, 0, 0, 0, 0, 0, 34],
  ['chips', 'Potato chips', '28 g', 'vegan', 'processed', 150, 2, 1, 0.4, 7, 19, 0.3, 0.2, 5, 13, 0.03, 0],
  ['pizza', 'Pizza', '1 slice', 'vegetarian', 'processed', 285, 12, 2.5, 2.6, 200, 25, 1.5, 0.1, 1, 50, 0.05, 0],
  ['burger', 'Fast-food burger', '1', 'omni', 'processed', 540, 25, 2, 4.5, 100, 40, 4.6, 0.3, 1, 60, 0.1, 0],
  ['croissant', 'Croissant', '1', 'vegetarian', 'processed', 230, 4.7, 1.5, 1.2, 21, 9, 0.4, 0.03, 0, 50, 0.04, 0],
  ['ice_cream', 'Ice cream', '½ cup', 'vegetarian', 'processed', 137, 2.3, 0.5, 0.1, 84, 9, 0.5, 0.03, 0.4, 3, 0.04, 0],
];

const FOODS = RAW.map(([id, name, serving, diet, category, ...vals]) => {
  const n = {};
  KEYS.forEach((k, i) => { n[k] = vals[i]; });
  return { id, name, serving, diet, category, nutrients: n };
});
const FOOD_BY_ID = new Map(FOODS.map((f) => [f.id, f]));

const PHASE_FOCUS = {
  menstrual: ['iron', 'vitc', 'omega3', 'magnesium'],
  follicular: ['protein', 'fiber', 'zinc', 'b6'],
  ovulatory: ['fiber', 'vitc', 'folate', 'omega3'],
  luteal: ['magnesium', 'b6', 'calcium', 'fiber'],
};

const PESCATARIAN_OK = new Set(['salmon', 'sardines', 'tuna', 'shrimp', 'oysters']);

function dietAllows(diet, foodDiet) {
  if (diet === 'vegan') return foodDiet === 'vegan';
  if (diet === 'vegetarian') return foodDiet !== 'omni';
  return true;
}

function foodAllowed(diet, food) {
  if (diet === 'pescatarian') {
    return food.diet !== 'omni' || PESCATARIAN_OK.has(food.id);
  }
  return dietAllows(diet, food.diet);
}

/** Daily targets for adult women (US DRIs), personalised. */
function targets(profile, phase, { age } = {}) {
  const older = age != null && age >= 51;
  const t = {
    kcal: 2000, protein: 50, fiber: 25,
    iron: older ? 8 : 18, calcium: older ? 1200 : 1000, magnesium: 320,
    zinc: 8, b6: older ? 1.5 : 1.3, vitc: 75, folate: 400, omega3: 1.1, caffeine: 400,
  };
  const diet = profile?.diet;
  if (diet === 'vegetarian' || diet === 'vegan') {
    t.iron = Math.round(t.iron * 1.8); // non-heme iron is less bioavailable
    t.zinc = Math.round(t.zinc * 1.5);
  }
  if (profile?.goal === 'conceive') {
    t.folate = 600;
    t.caffeine = 200;
  }
  if (phase === 'luteal') t.kcal += 200;
  return t;
}

function totalsFor(entries) {
  const totals = Object.fromEntries(KEYS.map((k) => [k, 0]));
  for (const e of entries) {
    const f = FOOD_BY_ID.get(e.food_id);
    if (!f) continue;
    for (const k of KEYS) totals[k] += f.nutrients[k] * (e.servings || 1);
  }
  for (const k of KEYS) totals[k] = Math.round(totals[k] * 10) / 10;
  return totals;
}

function analyzeDay(entries, profile, phase, opts) {
  const tgt = targets(profile, phase, opts);
  const totals = totalsFor(entries);
  const focus = PHASE_FOCUS[phase] || [];
  const rows = NUTRIENTS.map((n) => ({
    ...n,
    value: totals[n.key],
    target: tgt[n.key],
    pct: tgt[n.key] ? Math.round((totals[n.key] / tgt[n.key]) * 100) : 0,
    focus: focus.includes(n.key),
  }));
  const gaps = rows
    .filter((r) => !r.limit && r.key !== 'kcal' && r.pct < 100)
    .sort((a, b) => (b.focus - a.focus) || (a.pct - b.pct));
  const warnings = rows.filter((r) => r.limit && r.value > r.target)
    .map((r) => `${r.label} is above the suggested limit (${r.value} / ${r.target} ${r.unit}).`);
  return { totals, targets: tgt, rows, gaps: gaps.map((g) => g.key), focus, warnings };
}

/** Foods that best close today's remaining gaps, weighted to phase focus. */
function suggestFoods(analysis, profile, limit = 6) {
  const remaining = {};
  for (const r of analysis.rows) {
    if (r.limit || r.key === 'kcal') continue;
    remaining[r.key] = Math.max(0, 1 - r.value / r.target);
  }
  const diet = profile?.diet || 'omnivore';
  const scored = FOODS
    .filter((f) => f.category !== 'processed' && f.category !== 'drink' && foodAllowed(diet, f))
    .map((f) => {
      let score = 0;
      const contributions = [];
      for (const key of Object.keys(remaining)) {
        if (!remaining[key]) continue;
        const frac = Math.min(f.nutrients[key] / analysis.targets[key], remaining[key]);
        const w = analysis.focus.includes(key) ? 2 : 1;
        score += frac * w;
        if (frac >= 0.1) contributions.push({ key, pct: Math.round(frac * 100) });
      }
      score /= Math.max(0.5, f.nutrients.kcal / 200); // favour nutrient density
      contributions.sort((a, b) => b.pct - a.pct);
      return { food: f, score, contributions: contributions.slice(0, 3) };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ food, contributions }) => ({
    id: food.id, name: food.name, serving: food.serving, contributions,
  }));
}

const MEALS = [
  { phase: 'menstrual', diet: 'vegan', name: 'Lentil & spinach dal with lemon', foods: ['lentils', 'spinach', 'brown_rice'], note: 'Lemon’s vitamin C boosts iron absorption.' },
  { phase: 'menstrual', diet: 'omni', name: 'Salmon, roasted beetroot & greens', foods: ['salmon', 'beetroot', 'kale'], note: 'Omega-3s may ease cramps.' },
  { phase: 'menstrual', diet: 'vegetarian', name: 'Fortified cereal, strawberries & yogurt', foods: ['cereal', 'strawberries', 'yogurt'], note: 'Quick iron + vitamin C breakfast.' },
  { phase: 'menstrual', diet: 'vegan', name: 'Dark chocolate & pumpkin seed bark', foods: ['dark_chocolate', 'pumpkin_seeds'], note: 'Magnesium-rich craving fix.' },
  { phase: 'follicular', diet: 'vegetarian', name: 'Veggie omelette with whole-wheat toast', foods: ['eggs', 'mushrooms', 'bell_pepper', 'ww_bread'], note: 'Protein for rising energy.' },
  { phase: 'follicular', diet: 'vegan', name: 'Tempeh & broccoli stir-fry over quinoa', foods: ['tempeh', 'broccoli', 'quinoa'], note: 'Zinc and B vitamins for follicle development.' },
  { phase: 'follicular', diet: 'vegetarian', name: 'Greek yogurt bowl with berries & flax', foods: ['greek_yogurt', 'blueberries', 'flax'], note: 'Probiotics + fiber for estrogen balance.' },
  { phase: 'ovulatory', diet: 'vegan', name: 'Quinoa, chickpea & roasted pepper salad', foods: ['quinoa', 'chickpeas', 'bell_pepper', 'tomato'], note: 'Fiber helps clear peak estrogen.' },
  { phase: 'ovulatory', diet: 'omni', name: 'Shrimp & avocado power bowl', foods: ['shrimp', 'avocado', 'brown_rice', 'kale'], note: 'Light, antioxidant-rich and hydrating.' },
  { phase: 'ovulatory', diet: 'vegan', name: 'Kiwi-strawberry chia pudding', foods: ['chia', 'soy_milk', 'kiwi', 'strawberries'], note: 'Vitamin C + omega-3 ALA.' },
  { phase: 'luteal', diet: 'vegan', name: 'Sweet potato & black bean bowl', foods: ['sweet_potato', 'black_beans', 'avocado', 'pumpkin_seeds'], note: 'Complex carbs + magnesium tame cravings.' },
  { phase: 'luteal', diet: 'omni', name: 'Chicken, brown rice & sautéed spinach', foods: ['chicken', 'brown_rice', 'spinach'], note: 'B6 from chicken supports mood.' },
  { phase: 'luteal', diet: 'vegan', name: 'Banana–almond butter oat bowl', foods: ['oats', 'banana', 'almonds', 'soy_milk'], note: 'B6 + magnesium + calcium for PMS.' },
  { phase: 'luteal', diet: 'vegetarian', name: 'Palak paneer with brown rice', foods: ['paneer', 'spinach', 'brown_rice'], note: 'Calcium and magnesium in one bowl.' },
];

function mealIdeas(phase, profile) {
  const diet = profile?.diet || 'omnivore';
  return MEALS
    .filter((m) => m.phase === phase)
    .filter((m) => m.foods.every((id) => foodAllowed(diet, FOOD_BY_ID.get(id))))
    .map((m) => ({ ...m, totals: totalsFor(m.foods.map((id) => ({ food_id: id, servings: 1 }))) }));
}

function searchFoods(q, profile) {
  const s = String(q || '').toLowerCase().trim();
  return FOODS.filter((f) => !s || f.name.toLowerCase().includes(s) || f.id.includes(s))
    .map((f) => ({ ...f, allowed: foodAllowed(profile?.diet || 'omnivore', f) }));
}

module.exports = { NUTRIENTS, FOODS, FOOD_BY_ID, PHASE_FOCUS, targets, totalsFor, analyzeDay, suggestFoods, mealIdeas, searchFoods };
