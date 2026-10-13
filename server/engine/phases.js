'use strict';
// Phase-synced guidance. Content is general wellness education, not medical
// advice; the UI surfaces that disclaimer alongside it.

const PHASES = {
  menstrual: {
    name: 'Menstrual',
    emoji: '🌑',
    season: 'Inner winter',
    hormones: 'Estrogen and progesterone are at their lowest. The uterine lining sheds.',
    feel: 'Lower energy, cramps, a pull toward rest and reflection.',
    nutrition: {
      focus: ['Iron', 'Vitamin C', 'Omega-3', 'Magnesium', 'Hydration'],
      why: 'You lose iron with blood. Pair iron-rich foods with vitamin C to boost absorption; omega-3s and magnesium can ease cramps.',
      eat: ['Lentils & spinach dal', 'Salmon or sardines', 'Dark chocolate (70%+)', 'Beetroot', 'Ginger tea', 'Bone broth or miso soup'],
      limit: ['Excess caffeine (can worsen cramps)', 'Very salty foods (bloating)', 'Alcohol'],
    },
    movement: {
      intensity: 'Low',
      ideas: ['Gentle yoga (child’s pose, supine twists)', 'Walking', 'Stretching', 'Rest without guilt'],
    },
    selfCare: ['Heat pack on lower abdomen', 'Prioritise 8+ hours of sleep', 'Journal: what do I want next cycle?'],
    mind: 'Great for evaluation and intuition — review goals, say no to extras.',
  },
  follicular: {
    name: 'Follicular',
    emoji: '🌒',
    season: 'Inner spring',
    hormones: 'Estrogen rises as follicles mature; FSH is active.',
    feel: 'Rising energy, optimism, curiosity and better insulin sensitivity.',
    nutrition: {
      focus: ['Protein', 'Fiber', 'B vitamins', 'Zinc', 'Fermented foods'],
      why: 'Fresh, light foods and fiber support estrogen metabolism; protein fuels harder training.',
      eat: ['Eggs or tofu scramble', 'Sprouted grains', 'Kimchi / sauerkraut / yogurt', 'Pumpkin seeds', 'Citrus & berries', 'Broccoli'],
      limit: ['Ultra-processed snacks'],
    },
    movement: {
      intensity: 'Moderate → high',
      ideas: ['Try a new class', 'Strength training (progressive overload)', 'Cardio intervals', 'Dance'],
    },
    selfCare: ['Plan and start new projects', 'Socialise', 'Learn something new'],
    mind: 'Brainstorming and planning feel easy — schedule creative work now.',
  },
  ovulatory: {
    name: 'Ovulatory',
    emoji: '🌕',
    season: 'Inner summer',
    hormones: 'Estrogen peaks, an LH surge triggers ovulation; testosterone briefly rises.',
    feel: 'Peak energy, confidence and libido; some feel ovulation pain or bloating.',
    nutrition: {
      focus: ['Antioxidants', 'Fiber', 'Glutathione-rich veg', 'Hydration'],
      why: 'Fiber and cruciferous vegetables help your liver clear the estrogen peak; antioxidants support egg quality.',
      eat: ['Quinoa salads', 'Cruciferous veg (kale, cauliflower)', 'Berries', 'Almonds', 'Raw veg & hummus', 'Lots of water'],
      limit: ['Heavy, greasy meals'],
    },
    movement: {
      intensity: 'High',
      ideas: ['HIIT', 'Running', 'Heavy lifts (warm up well — ligaments are laxer)', 'Group sports'],
    },
    selfCare: ['Have important conversations', 'Pitch, present, network'],
    mind: 'Communication and collaboration peak — book the big meeting.',
  },
  luteal: {
    name: 'Luteal',
    emoji: '🌘',
    season: 'Inner autumn',
    hormones: 'Progesterone rises then falls with estrogen if no pregnancy occurs. Metabolism rises slightly.',
    feel: 'Energy winds down; PMS symptoms (bloating, cravings, mood shifts) may appear late in the phase.',
    nutrition: {
      focus: ['Magnesium', 'Vitamin B6', 'Calcium', 'Complex carbs', 'Fiber'],
      why: 'Magnesium, B6 and calcium are linked to fewer PMS symptoms. Your body burns ~100–300 kcal more per day — complex carbs curb cravings.',
      eat: ['Sweet potato', 'Brown rice & chickpeas', 'Dark leafy greens', 'Bananas', 'Pumpkin & sunflower seeds', 'Dark chocolate'],
      limit: ['Salt (water retention)', 'Refined sugar (energy crashes)', 'Caffeine & alcohol (anxiety, sleep)'],
    },
    movement: {
      intensity: 'Moderate → low',
      ideas: ['Pilates', 'Strength at lower volume', 'Swimming', 'Long walks', 'Yin yoga late in phase'],
    },
    selfCare: ['Wrap up projects and admin', 'Protect your sleep', 'Plan restful evenings before your period'],
    mind: 'Detail-oriented focus — great for editing, organising and finishing.',
  },
};

const GOAL_TIPS = {
  conceive: {
    menstrual: ['Start or continue a prenatal with 400–800 µg folic acid.'],
    follicular: ['Begin LH testing a few days before your predicted fertile window.', 'Track cervical mucus — egg-white mucus signals peak fertility.'],
    ovulatory: ['Your most fertile days are the 2 days before and the day of ovulation — intercourse every 1–2 days is ideal.'],
    luteal: ['Wait until the day your period is due for the most accurate pregnancy test.', 'Avoid alcohol and limit caffeine (<200 mg/day) during the two-week wait.'],
  },
  avoid: {
    follicular: ['Your fertile window is approaching. Predictions are estimates — they are not contraception on their own.'],
    ovulatory: ['High fertility days. Use reliable contraception — app predictions are not birth control.'],
  },
  perimenopause: {
    menstrual: ['Heavier or longer periods can occur in perimenopause — track flow so you can share it with a clinician.'],
    luteal: ['Hot flashes and night sweats can worsen premenstrually — cooling bedding and limiting alcohol help.'],
    follicular: ['Prioritise strength training and calcium + vitamin D to protect bone density.'],
  },
};

const CONDITION_TIPS = {
  pcos: ['Pair carbs with protein/fiber to blunt blood-sugar spikes.', 'Strength training improves insulin sensitivity.', 'Inositol and a low-GI diet have evidence for PCOS — discuss with your clinician.'],
  endometriosis: ['Anti-inflammatory foods (omega-3s, colourful veg) may help pain.', 'Log pain location and intensity — it helps clinicians assess endometriosis.'],
  thyroid: ['Take thyroid medication consistently, away from iron & calcium supplements (4 h gap).', 'Selenium (Brazil nuts) and iodine support thyroid function.'],
  anemia: ['Pair iron foods with vitamin C, and keep tea/coffee 1 h away from iron-rich meals.'],
  pmdd: ['Track mood daily — patterns over 2 cycles are needed for a PMDD diagnosis.', 'Calcium (1200 mg/day) and regular aerobic exercise have evidence for reducing PMS/PMDD.'],
};

function guidanceFor(phase, profile) {
  const base = PHASES[phase] || PHASES.follicular;
  const goalTips = (GOAL_TIPS[profile?.goal] || {})[phase] || [];
  const conditions = safeJson(profile?.conditions, []);
  const conditionTips = conditions.flatMap((c) => (CONDITION_TIPS[c] || []).map((t) => ({ condition: c, tip: t })));
  return { phase, ...base, goalTips, conditionTips };
}

function safeJson(s, fallback) {
  if (Array.isArray(s)) return s;
  try { return JSON.parse(s); } catch { return fallback; }
}

module.exports = { PHASES, guidanceFor, safeJson };
