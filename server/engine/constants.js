'use strict';

const SYMPTOMS = [
  { id: 'cramps', label: 'Cramps', group: 'pain' },
  { id: 'headache', label: 'Headache', group: 'pain' },
  { id: 'migraine', label: 'Migraine', group: 'pain' },
  { id: 'back_pain', label: 'Back pain', group: 'pain' },
  { id: 'pelvic_pain', label: 'Pelvic pain', group: 'pain' },
  { id: 'breast_tenderness', label: 'Tender breasts', group: 'body' },
  { id: 'joint_pain', label: 'Joint pain', group: 'pain' },
  { id: 'bloating', label: 'Bloating', group: 'digestion' },
  { id: 'nausea', label: 'Nausea', group: 'digestion' },
  { id: 'constipation', label: 'Constipation', group: 'digestion' },
  { id: 'diarrhea', label: 'Diarrhea', group: 'digestion' },
  { id: 'cravings', label: 'Cravings', group: 'digestion' },
  { id: 'acne', label: 'Acne', group: 'body' },
  { id: 'fatigue', label: 'Fatigue', group: 'energy' },
  { id: 'dizziness', label: 'Dizziness', group: 'energy' },
  { id: 'brain_fog', label: 'Brain fog', group: 'energy' },
  { id: 'insomnia', label: 'Insomnia', group: 'energy' },
  { id: 'anxiety', label: 'Anxiety', group: 'mood' },
  { id: 'irritability', label: 'Irritability', group: 'mood' },
  { id: 'low_mood', label: 'Low mood', group: 'mood' },
  { id: 'mood_swings', label: 'Mood swings', group: 'mood' },
  { id: 'high_libido', label: 'High libido', group: 'mood' },
  { id: 'low_libido', label: 'Low libido', group: 'mood' },
  { id: 'hot_flashes', label: 'Hot flashes', group: 'body' },
  { id: 'night_sweats', label: 'Night sweats', group: 'body' },
  { id: 'spotting', label: 'Spotting', group: 'bleeding' },
  { id: 'clots', label: 'Large clots', group: 'bleeding' },
];
const SYMPTOM_IDS = new Set(SYMPTOMS.map((s) => s.id));
const SYMPTOM_LABEL = Object.fromEntries(SYMPTOMS.map((s) => [s.id, s.label]));

const FLOW_LABELS = ['None', 'Spotting', 'Light', 'Medium', 'Heavy', 'Very heavy'];
const LH_VALUES = ['negative', 'positive', 'peak'];
const MUCUS_VALUES = ['dry', 'sticky', 'creamy', 'watery', 'eggwhite'];
const SEX_VALUES = ['none', 'protected', 'unprotected'];
const GOALS = ['track', 'conceive', 'avoid', 'perimenopause'];
const DIETS = ['omnivore', 'pescatarian', 'vegetarian', 'vegan'];
const CONDITIONS = ['pcos', 'endometriosis', 'thyroid', 'anemia', 'pmdd'];

// Self-care relief suggestions surfaced alongside symptom forecasts.
const RELIEF = {
  cramps: 'Heat on the lower belly, gentle movement, magnesium-rich foods and an anti-inflammatory you tolerate.',
  headache: 'Hydrate early, keep meals regular and limit alcohol; estrogen-drop headaches often respond to steady sleep.',
  migraine: 'Keep your rescue medication handy and avoid known triggers; talk to a clinician about menstrual migraine prevention.',
  bloating: 'Cut back on salt, add potassium (banana, avocado) and keep drinking water.',
  breast_tenderness: 'A supportive bra and less caffeine can help.',
  cravings: 'Front-load protein and complex carbs; dark chocolate is a magnesium-rich treat.',
  fatigue: 'Plan lighter commitments, prioritise sleep and check your iron intake.',
  insomnia: 'Cooler bedroom, less late caffeine and a wind-down routine — progesterone shifts can disrupt sleep.',
  anxiety: 'Breathwork (4-7-8), a walk outside and less caffeine.',
  irritability: 'Schedule buffer time; aerobic exercise and calcium have evidence for PMS mood symptoms.',
  low_mood: 'Light exposure, movement and connection help. If low mood is severe, please reach out to a professional.',
  mood_swings: 'Regular meals keep blood sugar steady, which helps mood stability.',
  acne: 'Gentle cleansing, avoid picking; hormonal breakouts often appear in the late luteal phase.',
  back_pain: 'Heat, gentle stretches like cat-cow and child’s pose.',
  nausea: 'Ginger tea and small, frequent meals.',
  dizziness: 'Stand up slowly, hydrate and eat iron-rich foods — let a clinician know if it persists.',
};

module.exports = {
  SYMPTOMS, SYMPTOM_IDS, SYMPTOM_LABEL, FLOW_LABELS, LH_VALUES, MUCUS_VALUES,
  SEX_VALUES, GOALS, DIETS, CONDITIONS, RELIEF,
};
