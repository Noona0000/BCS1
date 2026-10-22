import { createDefaultFeedDatabase, mineralRequirementFields } from './feed-data.mjs';

export const stageAgeRanges = {
  grower: { min: 6, max: 18, label: 'ลูกโค / โคกำลังโต' },
  maintain: { min: 18, max: 36, label: 'โคโตเต็มวัย ระยะพัก' },
  pregnant: { min: 24, max: 60, label: 'แม่โคตั้งท้อง' },
  lactating: { min: 24, max: 60, label: 'แม่โคให้นม' },
  finishing: { min: 18, max: 36, label: 'โคขุน' },
};

export function validateCow({ age, weight, bcs, sex, stage }) {
  if (!Number.isFinite(age) || age < 0 || age > 360) return 'กรุณากรอกอายุระหว่าง 0–360 เดือน';
  if (!Number.isFinite(weight) || weight < 20 || weight > 2000) return 'กรุณากรอกน้ำหนักระหว่าง 20–2,000 กก.';
  if (!Number.isInteger(bcs) || bcs < 1 || bcs > 9) return 'กรุณาเลือก BCS ระหว่าง 1–9';
  if (!stageAgeRanges[stage]) return 'กรุณาเลือกระยะการเลี้ยง';
  const range = stageAgeRanges[stage];
  if (age < range.min || age > range.max) return `อายุ ${range.label} ควรอยู่ในช่วง ${range.min}–${range.max} เดือน โปรดตรวจข้อมูล`;
  if ((stage === 'pregnant' || stage === 'lactating') && sex !== 'female') return 'ระยะตั้งท้องหรือให้นมเลือกได้เฉพาะแม่โค';
  return '';
}

function numericValue(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function sumKnown(values) {
  return values.every(value => value !== null) ? values.reduce((sum, value) => sum + value, 0) : null;
}

export function calculateRation({ feeds, feedDatabase, supplement = null }) {
  const database = feedDatabase || createDefaultFeedDatabase();
  const included = feeds
    .map(({ id, freshKg }) => ({ id, freshKg: numericValue(freshKg), profile: database[id] }))
    .filter(feed => feed.freshKg !== null && feed.freshKg > 0);

  const freshKg = included.length
    ? included.reduce((sum, feed) => sum + feed.freshKg, 0)
    : null;
  const dms = included.map(feed => {
    if (!feed.profile?.source?.trim() || feed.profile.dataStatus === 'missing') return null;
    const dmPct = numericValue(feed.profile?.dm);
    return dmPct === null ? null : feed.freshKg * dmPct / 100;
  });
  const dryMatterKg = included.length ? sumKnown(dms) : null;

  const fields = ['cp', 'cf', 'ndf', 'adf', 'tdn', 'ca', 'p', 'mg', 'k', 'na', 's', 'cl', 'cu', 'zn', 'mn', 'fe', 'se', 'co', 'i'];
  const feedNutrients = Object.fromEntries(fields.map(key => {
    const isTraceMineral = ['cu', 'zn', 'mn', 'fe', 'se', 'co', 'i'].includes(key);
    const intakePerFeed = included.map((feed, index) => {
      if (!feed.profile?.source?.trim() || feed.profile.dataStatus === 'missing') return null;
      const concentration = numericValue(feed.profile?.[key]);
      const dm = dms[index];
      return concentration === null || dm === null
        ? null
        : isTraceMineral ? dm * concentration : dm * concentration / 100;
    });
    return [key, included.length ? sumKnown(intakePerFeed) : null];
  }));
  const products = supplement?.products
    || (supplement?.type && supplement.type !== 'none' ? [supplement] : []);
  const productNutrients = Object.fromEntries(mineralRequirementFields.map(({ key }) => {
    const isTraceMineral = ['cu', 'zn', 'mn', 'fe', 'se', 'co', 'i'].includes(key);
    const amounts = products.map(product => {
      const rateG = numericValue(product.rateG);
      if (rateG === null) return null;
      if (rateG === 0) return 0;
      if (!product.profile?.source?.trim()) return null;
      const concentration = numericValue(product.profile?.[key]);
      if (concentration === null) return null;
      return isTraceMineral
        ? (rateG / 1000) * concentration
        : (rateG / 1000) * concentration / 100;
    });
    return [key, products.length ? sumKnown(amounts) : 0];
  }));
  const nutrients = {};
  for (const key of fields) {
    const mineralKey = mineralRequirementFields.some(field => field.key === key);
    const supplementTotal = mineralKey ? productNutrients[key] : 0;
    nutrients[key] = feedNutrients[key] === null || supplementTotal === null
      ? null
      : feedNutrients[key] + supplementTotal;
  }

  return {
    freshKg,
    dryMatterKg,
    feedNutrients,
    productNutrients,
    nutrients,
    feeds: included.map((feed, index) => ({
      id: feed.id,
      label: feed.profile?.label || feed.id,
      freshKg: feed.freshKg,
      dryMatterKg: dms[index],
      nutrients: Object.fromEntries(['cp', 'tdn'].map(key => {
        if (!feed.profile?.source?.trim() || feed.profile.dataStatus === 'missing' || dms[index] === null) {
          return [key, null];
        }
        const concentration = numericValue(feed.profile[key]);
        return [key, concentration === null ? null : dms[index] * concentration / 100];
      })),
      dataStatus: feed.profile?.dataStatus || 'missing',
      source: feed.profile?.source || '',
    })),
  };
}

export function calculateMineralTargets(dryMatterKg, requirements) {
  if (!Number.isFinite(dryMatterKg) || dryMatterKg < 0) {
    return Object.fromEntries(mineralRequirementFields.map(({ key }) => [key, { min: null, max: null }]));
  }
  return Object.fromEntries(mineralRequirementFields.map(({ key, group }) => {
    const profile = requirements?.[key];
    if (!profile?.source?.trim()) return [key, { min: null, max: null }];
    const convert = value => {
      const concentration = numericValue(value);
      if (concentration === null) return null;
      return group === 'macro'
        ? dryMatterKg * concentration / 100 * 1000
        : dryMatterKg * concentration;
    };
    return [key, { min: convert(profile?.min), max: convert(profile?.max) }];
  }));
}

export function calculateProductionTargets(weightKg, requirements) {
  if (!Number.isFinite(weightKg) || weightKg <= 0) {
    return { dm: { min: null, max: null }, cp: { min: null, max: null }, tdn: { min: null, max: null } };
  }
  return Object.fromEntries(['dm', 'cp', 'tdn'].map(key => {
    const target = requirements?.[key];
    if (!target?.source?.trim() || numericValue(target.min) === null) {
      return [key, { min: null, max: null }];
    }
    const factor = key === 'dm' ? weightKg / 100 : weightKg / 1000;
    const min = numericValue(target.min) * factor;
    const maxValue = numericValue(target.max);
    return [key, { min, max: maxValue === null ? null : maxValue * factor }];
  }));
}

function freshFeedNutrientRate(profile, key) {
  const dm = numericValue(profile?.dm);
  const concentration = key === 'dm' ? 100 : numericValue(profile?.[key]);
  if (!profile?.source?.trim() || profile.dataStatus === 'missing'
    || dm === null || concentration === null) return null;
  return dm / 100 * concentration / 100;
}

export function suggestFeedAddition(feedDatabase, currentFeeds, actual, targets, mineralSafety = null) {
  const currentIds = new Set(currentFeeds.map(feed => feed.id));
  const candidates = Object.entries(feedDatabase)
    .map(([id, profile]) => ({ ...profile, id }))
    .filter(profile => ['dm', 'cp', 'tdn'].every(key => freshFeedNutrientRate(profile, key) > 0))
    .map(profile => {
      const freshKg = Math.max(...['dm', 'cp', 'tdn'].map(key =>
        Math.max(0, targets[key].min - actual[key]) / freshFeedNutrientRate(profile, key)));
      const safe = ['dm', 'cp', 'tdn'].every(key => {
        const projected = actual[key] + freshKg * freshFeedNutrientRate(profile, key);
        return targets[key].max === null || projected <= targets[key].max;
      });
      return { feed: profile, freshKg, safe: safe && isMinerallySafe(profile, freshKg, mineralSafety, 'add') };
    })
    .filter(candidate => candidate.safe && Number.isFinite(candidate.freshKg) && candidate.freshKg > 0)
    .sort((left, right) => left.freshKg - right.freshKg
      || Number(currentIds.has(right.feed.id)) - Number(currentIds.has(left.feed.id)));
  return candidates[0] || null;
}

export function suggestFeedReduction(feeds, feedDatabase, actual, targets, mineralSafety = null) {
  const candidates = feeds.flatMap(feed => {
    const profile = feedDatabase[feed.id];
    const rates = Object.fromEntries(['dm', 'cp', 'tdn'].map(key => [key, freshFeedNutrientRate(profile, key)]));
    if (Object.values(rates).some(value => !Number.isFinite(value) || value <= 0)) return [];
    const freshKg = Math.max(...['dm', 'cp', 'tdn'].map(key =>
      targets[key].max === null ? 0 : Math.max(0, actual[key] - targets[key].max) / rates[key]));
    if (freshKg <= 0 || freshKg > feed.freshKg) return [];
    const safe = ['dm', 'cp', 'tdn'].every(key => actual[key] - freshKg * rates[key] >= targets[key].min)
      && isMinerallySafe(profile, freshKg, mineralSafety, 'remove');
    return safe ? [{ feed, freshKg }] : [];
  });
  return candidates.sort((left, right) => left.freshKg - right.freshKg)[0] || null;
}

function isMinerallySafe(profile, freshKg, safety, operation) {
  if (!safety) return true;
  const dmRate = freshFeedNutrientRate(profile, 'dm');
  const projectedDm = safety.dryMatterKg + (operation === 'add' ? 1 : -1) * freshKg * dmRate;
  if (!Number.isFinite(projectedDm) || projectedDm <= 0) return false;
  return mineralRequirementFields.every(field => {
    const target = safety.requirements?.[field.key];
    if (!target?.source?.trim() || (target.min === null && target.max === null)) return true;
    const current = safety.nutrients?.[field.key];
    const rate = mineralFreshRate(profile, field);
    if (!Number.isFinite(current) || rate === null) return false;
    const projected = current + (operation === 'add' ? 1 : -1) * freshKg * rate;
    if (projected < 0) return false;
    const factor = field.group === 'macro' ? projectedDm / 100 : projectedDm;
    const minimum = numericValue(target.min);
    const maximum = numericValue(target.max);
    return (minimum === null || projected >= factor * minimum)
      && (maximum === null || projected <= factor * maximum);
  });
}

function mineralFreshRate(profile, field) {
  const dm = numericValue(profile?.dm);
  const concentration = numericValue(profile?.[field.key]);
  if (!profile?.source?.trim() || profile.dataStatus === 'missing' || dm === null || concentration === null) return null;
  return field.group === 'macro' ? dm / 100 * concentration / 100 : dm / 100 * concentration;
}

export function calculateStockProjection(stockKg, rateGPerAnimalDaily, headcount, days) {
  if (![stockKg, rateGPerAnimalDaily, headcount, days].every(Number.isFinite)
    || stockKg < 0 || rateGPerAnimalDaily < 0 || headcount <= 0 || days <= 0) return null;
  const plannedUseKg = rateGPerAnimalDaily * headcount * days / 1000;
  const remainingKg = stockKg - plannedUseKg;
  return {
    plannedUseKg,
    remainingKg: Math.max(0, remainingKg),
    shortageKg: Math.max(0, -remainingKg),
    lowStock: remainingKg >= 0 && remainingKg <= stockKg * 0.2,
  };
}

export function assessMineralIntake(actual, minimum, maximum) {
  const actualValue = numericValue(actual);
  const minimumValue = numericValue(minimum);
  const maximumValue = numericValue(maximum);
  if (actualValue === null || minimumValue === null) return 'ข้อมูลไม่เพียงพอ';
  if (actualValue < minimumValue) return 'ต่ำกว่าขั้นต่ำ';
  if (maximumValue !== null && actualValue > maximumValue) return 'สูงกว่าช่วงเป้าหมาย';
  if (maximumValue === null) return 'ถึงค่าเป้าหมาย (ไม่มีเกณฑ์ขอบบน)';
  return 'อยู่ในช่วงเป้าหมาย';
}

export function assessNutrient(actual, target) {
  const actualValue = numericValue(actual);
  const targetValue = numericValue(target);
  if (actualValue === null || targetValue === null || targetValue === 0) return 'ข้อมูลไม่เพียงพอ';
  if (actualValue < targetValue) return 'ขาด';
  if (actualValue > targetValue) return 'เกิน';
  return 'เพียงพอ';
}
