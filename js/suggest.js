// Suggests daily targets from a short profile. Runs on the phone, no API call.
// Calories: Mifflin-St Jeor resting burn times an activity factor.
// Protein: 1.0 g/kg, or 1.2 g/kg from 65 (PROT-AGE, Bauer et al. 2013).
// Fat: 30% of calories. Carbs: the rest.
// Sugar: under 10% of calories (WHO). Fibre: 14 g per 1000 kcal (US DGA). Sodium: 2000 mg (WHO).

// Factors follow the Harris-Benedict scale. Step bands follow Tudor-Locke & Bassett (2004).
export const ACTIVITY = {
  sitting: { factor: 1.2, label: 'Mostly sitting: under 5,000 steps a day' },
  walking: { factor: 1.375, label: 'Lightly active: 5,000–10,000 steps, or exercise 1–3 days a week' },
  exercise: { factor: 1.55, label: 'Active: over 10,000 steps, or exercise 3–5 days a week' },
};

export const GOAL_CHOICES = {
  lose: { delta: -500, label: 'Lose weight' },
  keep: { delta: 0, label: 'Keep my weight' },
  gain: { delta: 300, label: 'Gain weight' },
};

const LIMITS = { age: [18, 100], height: [120, 220], weight: [30, 250] };
const FLOOR = { female: 1200, male: 1500 };

const round10 = (n) => Math.round(n / 10) * 10;

// Throws with a plain message when the profile is incomplete or out of range.
export function validateProfile(p) {
  if (!p || !['female', 'male'].includes(p.sex)) throw new Error('Choose male or female.');
  const out = { sex: p.sex };
  for (const [k, [lo, hi]] of Object.entries(LIMITS)) {
    const v = Number(p[k]);
    if (!Number.isFinite(v) || v < lo || v > hi) throw new Error(`Enter ${k} between ${lo} and ${hi}.`);
    out[k] = v;
  }
  if (!ACTIVITY[p.activity]) throw new Error('Choose how active you are.');
  if (!GOAL_CHOICES[p.goal]) throw new Error('Choose a goal.');
  out.activity = p.activity;
  out.goal = p.goal;
  return out;
}

export function bmi(weight, height) {
  return weight / (height / 100) ** 2;
}

// Asian cut-offs used by HPB Singapore: 23 and 27.5.
export function goalHint(weight, height) {
  const b = bmi(weight, height);
  if (b < 18.5) return { goal: 'gain', text: `BMI ${b.toFixed(1)} is under 18.5. Gaining a little may help.` };
  if (b < 23) return { goal: 'keep', text: `BMI ${b.toFixed(1)} is in the healthy range.` };
  if (b < 27.5) return { goal: 'keep', text: `BMI ${b.toFixed(1)} is slightly high. Keeping or losing a little are both fine.` };
  return { goal: 'lose', text: `BMI ${b.toFixed(1)} is high. Losing some weight may help.` };
}

export function suggestTargets(profile) {
  const p = validateProfile(profile);
  const resting = 10 * p.weight + 6.25 * p.height - 5 * p.age + (p.sex === 'male' ? 5 : -161);
  const burn = resting * ACTIVITY[p.activity].factor;
  const kcal = Math.max(FLOOR[p.sex], round10(burn + GOAL_CHOICES[p.goal].delta));
  const perKg = p.age >= 65 ? 1.2 : 1.0;
  const protein = Math.round(perKg * p.weight);
  const fat = Math.round((0.3 * kcal) / 9);
  const carbs = Math.max(0, Math.round((kcal - 4 * protein - 9 * fat) / 4));
  const sugar = Math.round((0.1 * kcal) / 4);
  const fibre = Math.round((14 * kcal) / 1000);
  const sodium = 2000;

  const goalLine = {
    lose: 'Minus 500 kcal a day to lose about 0.5 kg a week.',
    keep: 'No change, to keep your weight steady.',
    gain: 'Plus 300 kcal a day to gain slowly.',
  }[p.goal];
  const reasons = {
    kcal: `Your body burns about ${round10(burn)} kcal a day. ${goalLine}${kcal === FLOOR[p.sex] ? ` Never below ${FLOOR[p.sex]}.` : ''}`,
    protein: `${perKg} g for each kg you weigh${p.age >= 65 ? ', a bit more from age 65 to keep muscle' : ''}.`,
    fat: 'About 30% of your calories.',
    carbs: 'The rest of your calories.',
    sugar: 'Under 10% of your calories.',
    fibre: '14 g for every 1000 kcal.',
    sodium: 'The WHO limit for adults.',
  };
  return { targets: { kcal, protein, carbs, fat, sugar, fibre, sodium }, reasons };
}
