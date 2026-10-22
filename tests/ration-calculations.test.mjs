import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDefaultFeedDatabase,
  createDefaultMineralDatabase,
  createDefaultMineralRequirements,
  defaultMineralTargets,
  mineralTypes,
} from '../bms/feed-data.mjs';
import {
  assessMineralIntake,
  assessNutrient,
  calculateMineralTargets,
  calculateProductionTargets,
  calculateRation,
  suggestFeedAddition,
  suggestFeedReduction,
  calculateStockProjection,
  validateCow,
} from '../bms/ration-calculations.mjs';

function knownGrassProfile(dm = 50) {
  return {
    label: 'หญ้าตัวอย่าง',
    dm,
    cp: 10,
    cf: 20,
    ndf: 40,
    adf: 25,
    tdn: 60,
    ca: 1,
    p: 0.5,
    mg: 0.2,
    k: 1.2,
    na: 0.1,
    s: 0.15,
    cl: 0.2,
    cu: 10,
    zn: 30,
    mn: 40,
    fe: 80,
    se: 0.2,
    co: 0.1,
    i: 0.5,
    source: 'ผลวิเคราะห์ตัวอย่าง',
    dataStatus: 'analysis',
  };
}

test('missing ingredient data never generates a ration or nutrient recommendation', () => {
  const cow = { age: 36, weight: 250, bcs: 3, sex: 'female', stage: 'maintain' };
  assert.equal(validateCow(cow), '');
  const result = calculateRation({
    feeds: [{ id: 'grass', freshKg: '' }],
    feedDatabase: createDefaultFeedDatabase(),
    supplement: { type: 'none' },
  });
  assert.equal(result.freshKg, null);
  assert.equal(result.dryMatterKg, null);
  assert.equal(result.nutrients.ca, null);
  assert.equal(result.nutrients.p, null);
  assert.equal(result.nutrients.mg, null);
  assert.equal(assessNutrient(result.nutrients.ca, null), 'ข้อมูลไม่เพียงพอ');
});

test('feed nutrient values without a source and analysis status are not used', () => {
  const feedDatabase = createDefaultFeedDatabase();
  feedDatabase.grass = { ...knownGrassProfile(), source: '', dataStatus: 'missing' };
  const result = calculateRation({
    feeds: [{ id: 'grass', freshKg: 10 }],
    feedDatabase,
    supplement: { type: 'none' },
  });
  assert.equal(result.dryMatterKg, null);
  assert.equal(result.feedNutrients.ca, null);
  assert.equal(result.nutrients.ca, null);
});

test('fresh feed and DM changes alter actual dry matter and nutrient totals', () => {
  const feedDatabase = createDefaultFeedDatabase();
  feedDatabase.grass = knownGrassProfile(50);
  const first = calculateRation({
    feeds: [{ id: 'grass', freshKg: 10 }],
    feedDatabase,
    supplement: { type: 'none' },
  });
  assert.equal(first.freshKg, 10);
  assert.equal(first.dryMatterKg, 5);
  assert.equal(first.nutrients.cp, 0.5);
  assert.equal(first.feeds[0].nutrients.cp, 0.5);
  assert.equal(first.feeds[0].nutrients.tdn, 3);
  assert.equal(first.nutrients.ndf, 2);
  assert.equal(first.nutrients.adf, 1.25);
  assert.equal(first.nutrients.ca, 0.05);
  assert.equal(first.nutrients.cu, 50);
  assert.equal(first.nutrients.cl, 0.01);

  feedDatabase.grass.dm = 60;
  const changed = calculateRation({
    feeds: [{ id: 'grass', freshKg: 12 }],
    feedDatabase,
    supplement: { type: 'none' },
  });
  assert.equal(changed.dryMatterKg, 7.2);
  assert.equal(changed.nutrients.cp, 0.72);
  assert.equal(changed.feeds[0].nutrients.cp, 0.72);
  assert.equal(changed.feeds[0].nutrients.tdn, 4.32);
  assert.equal(changed.nutrients.cu, 72);
  assert.ok(Math.abs(changed.nutrients.cl - 0.0144) < 1e-12);
});

test('farm product choices include salt, dicalcium phosphate, and vitamins without assumed compositions', () => {
  const products = createDefaultMineralDatabase();
  assert.ok(mineralTypes.some(({ id, label }) => id === 'salt' && label.includes('เกลือ')));
  assert.ok(mineralTypes.some(({ id, label }) => id === 'dicalcium' && label.includes('ไดแคลเซียม')));
  assert.ok(mineralTypes.some(({ id, label }) => id === 'vitamins' && label.includes('วิตามิน')));
  assert.equal(products.dicalcium.ca, null);
  assert.equal(products.dicalcium.p, null);
  assert.equal(products.vitamins.se, null);
});

test('mineral label intake and composition are included using units from the label', () => {
  const feedDatabase = createDefaultFeedDatabase();
  const grass = knownGrassProfile();
  feedDatabase.grass = grass;
  const result = calculateRation({
    feeds: [{ id: 'grass', freshKg: 10 }],
    feedDatabase,
    supplement: {
      type: 'salt',
      rateG: 100,
      profile: { na: 39.34, source: 'ฉลากตัวอย่าง' },
    },
  });
  assert.ok(Math.abs(result.nutrients.na - 0.04434) < 1e-12);
  assert.equal(result.feedNutrients.na, 0.005);
});

test('an incomplete selected mineral label leaves unknown mineral totals unavailable', () => {
  const feedDatabase = createDefaultFeedDatabase();
  feedDatabase.grass = knownGrassProfile();
  const result = calculateRation({
    feeds: [{ id: 'grass', freshKg: 10 }],
    feedDatabase,
    supplement: { type: 'complete', rateG: 100, profile: { na: 30, source: 'ฉลากตัวอย่าง' } },
  });
  assert.ok(Math.abs(result.nutrients.na - 0.035) < 1e-12);
  assert.equal(result.nutrients.ca, null);
  assert.equal(assessNutrient(result.nutrients.ca, 0.1), 'ข้อมูลไม่เพียงพอ');
});

test('zero DM and no feeds do not cause division by zero', () => {
  const feedDatabase = createDefaultFeedDatabase();
  feedDatabase.grass = knownGrassProfile(0);
  const result = calculateRation({
    feeds: [{ id: 'grass', freshKg: 12 }],
    feedDatabase,
    supplement: { type: 'none' },
  });
  assert.equal(result.dryMatterKg, 0);
  assert.equal(result.nutrients.cp, 0);
  assert.equal(result.nutrients.cu, 0);
});

test('stage and age mismatches and pregnancy for male cattle are rejected', () => {
  assert.match(validateCow({ age: 36, weight: 250, bcs: 3, sex: 'female', stage: 'grower' }), /อายุ/);
  assert.match(validateCow({ age: 36, weight: 250, bcs: 3, sex: 'male', stage: 'pregnant' }), /เฉพาะแม่โค/);
  assert.match(validateCow({ age: 36, weight: 250, bcs: 9, sex: 'female', stage: 'maintain' }), /^$/);
});

test('nutrient status does not claim adequacy without a target', () => {
  assert.equal(assessNutrient(1, null), 'ข้อมูลไม่เพียงพอ');
  assert.equal(assessNutrient(1, 2), 'ขาด');
  assert.equal(assessNutrient(3, 2), 'เกิน');
  assert.equal(assessNutrient(2, 2), 'เพียงพอ');
});

test('mineral daily targets use DM percentage for macro minerals and mg/kg for trace minerals', () => {
  const requirements = createDefaultMineralRequirements().finishing;
  requirements.ca = { min: 0.5, max: 1, source: 'reference' };
  requirements.cl = { min: 0.1, max: 0.2, source: 'reference' };
  requirements.cu = { min: 10, max: 40, source: 'reference' };
  const targets = calculateMineralTargets(5, requirements);
  assert.equal(targets.ca.min, 25);
  assert.equal(targets.ca.max, 50);
  assert.equal(targets.cl.min, 5);
  assert.equal(targets.cu.min, 50);
  assert.equal(targets.cu.max, 200);
  assert.equal(calculateMineralTargets(null, requirements).ca.min, null);
});

test('mineral assessment distinguishes deficiency, safe-range intake, excess, and missing targets', () => {
  assert.equal(assessMineralIntake(4, 5, 10), 'ต่ำกว่าขั้นต่ำ');
  assert.equal(assessMineralIntake(7, 5, 10), 'อยู่ในช่วงเป้าหมาย');
  assert.equal(assessMineralIntake(11, 5, 10), 'สูงกว่าช่วงเป้าหมาย');
  assert.equal(assessMineralIntake(7, 5, null), 'ถึงค่าเป้าหมาย (ไม่มีเกณฑ์ขอบบน)');
  assert.equal(assessMineralIntake(7, null, 10), 'ข้อมูลไม่เพียงพอ');
  assert.equal(assessMineralIntake(null, 5, 10), 'ข้อมูลไม่เพียงพอ');
});

test('default mineral target values are not used until an authoritative source is provided', () => {
  assert.deepEqual(defaultMineralTargets, {
    ca: { min: 0.4, max: 0.6 },
    p: { min: 0.2, max: 0.4 },
    mg: { min: 0.1, max: 0.2 },
    k: { min: 0.6, max: 0.8 },
    na: { min: 0.06, max: 0.1 },
    s: { min: 0.15, max: 0.2 },
    cl: { min: 0.1, max: 0.15 },
    cu: { min: 10, max: null },
    zn: { min: 30, max: null },
    mn: { min: 20, max: 40 },
    fe: { min: 50, max: null },
    se: { min: 0.1, max: null },
    co: { min: 0.15, max: null },
    i: { min: 0.5, max: null },
  });
  const defaults = createDefaultMineralRequirements().finishing;
  const unverified = calculateMineralTargets(5, defaults);
  assert.equal(unverified.ca.min, null);
  defaults.ca.source = 'อ้างอิงที่ตรวจสอบแล้ว';
  defaults.cu.source = 'อ้างอิงที่ตรวจสอบแล้ว';
  const targets = calculateMineralTargets(5, defaults);
  assert.equal(targets.ca.min, 20);
  assert.equal(targets.ca.max, 30);
  assert.equal(targets.cu.min, 50);
  assert.equal(targets.cu.max, null);
});

test('production targets scale by body weight and require a source', () => {
  const requirements = {
    dm: { min: 2.5, max: 3, source: 'reference' },
    cp: { min: 4, max: 6, source: 'reference' },
    tdn: { min: 12, max: null, source: '' },
  };
  const targets = calculateProductionTargets(400, requirements);
  assert.equal(targets.dm.min, 10);
  assert.equal(targets.dm.max, 12);
  assert.equal(targets.cp.min, 1.6);
  assert.ok(Math.abs(targets.cp.max - 2.4) < 1e-12);
  assert.deepEqual(targets.tdn, { min: null, max: null });
});

test('production nutrient intake targets are not inferred from stage or weight alone', () => {
  const targets = calculateProductionTargets(400, {
    dm: { min: 2.5, max: 3, source: '' },
    cp: { min: 4, max: null, source: 'reference' },
    tdn: { min: null, max: null, source: 'reference' },
  });
  assert.deepEqual(targets, {
    dm: { min: null, max: null },
    cp: { min: 1.6, max: null },
    tdn: { min: null, max: null },
  });
});

test('feed additions close known deficits without exceeding configured upper targets', () => {
  const profile = (label, dm, cp, tdn) => ({
    label, dm, cp, tdn, source: 'lab analysis', dataStatus: 'analysis',
  });
  const feeds = { current: profile('current feed', 50, 10, 60), corn: profile('corn', 90, 10, 80) };
  const actual = { dm: 1, cp: 0.1, tdn: 0.6 };
  const targets = {
    dm: { min: 2, max: 3 },
    cp: { min: 0.2, max: 0.3 },
    tdn: { min: 1, max: 1.5 },
  };
  const recommendation = suggestFeedAddition(feeds, [{ id: 'current' }], actual, targets);
  assert.equal(recommendation.feed.id, 'corn');
  assert.ok(recommendation.freshKg > 1.1 && recommendation.freshKg < 1.2);
  targets.tdn.max = 0.8;
  assert.equal(suggestFeedAddition(feeds, [{ id: 'current' }], actual, targets), null);
});

test('feed additions respect configured mineral ranges and refuse unknown mineral safety data', () => {
  const feedProfile = (label, dm, cp, tdn, ca) => ({
    label, dm, cp, tdn, ca, source: 'lab analysis', dataStatus: 'analysis',
  });
  const feeds = {
    current: feedProfile('current', 50, 10, 60, 0.5),
    highCa: feedProfile('high Ca', 90, 10, 80, 2),
    balanced: feedProfile('balanced', 90, 10, 80, 0.5),
  };
  const actual = { dm: 1, cp: 0.1, tdn: 0.6 };
  const targets = {
    dm: { min: 2, max: null },
    cp: { min: 0.2, max: null },
    tdn: { min: 1, max: null },
  };
  const mineralSafety = {
    dryMatterKg: 1,
    nutrients: { ca: 0.005 },
    requirements: { ca: { min: 0.4, max: 0.6, source: 'reference' } },
  };
  const recommendation = suggestFeedAddition(feeds, [{ id: 'current' }], actual, targets, mineralSafety);
  assert.equal(recommendation.feed.id, 'balanced');
  mineralSafety.nutrients.ca = null;
  assert.equal(suggestFeedAddition(feeds, [{ id: 'current' }], actual, targets, mineralSafety), null);
});

test('feed reduction only recommends a known single feed when all minimums remain met', () => {
  const feedDatabase = {
    hay: { label: 'hay', dm: 50, cp: 10, tdn: 60, source: 'lab', dataStatus: 'analysis' },
  };
  const feed = { id: 'hay', label: 'hay', freshKg: 10 };
  const targets = {
    dm: { min: 2, max: 4 },
    cp: { min: 0.2, max: 0.4 },
    tdn: { min: 1.5, max: 2.5 },
  };
  const recommendation = suggestFeedReduction([feed], feedDatabase,
    { dm: 5, cp: 0.5, tdn: 3 }, targets);
  assert.equal(recommendation.freshKg, 2);
  targets.tdn.min = 2.5;
  assert.equal(suggestFeedReduction([feed], feedDatabase,
    { dm: 5, cp: 0.5, tdn: 3 }, targets), null);
});

test('inventory projection reports planned use, shortages, and low stock', () => {
  assert.deepEqual(calculateStockProjection(2, 100, 10, 30), {
    plannedUseKg: 30,
    remainingKg: 0,
    shortageKg: 28,
    lowStock: false,
  });
  assert.deepEqual(calculateStockProjection(10, 100, 2, 30), {
    plannedUseKg: 6,
    remainingKg: 4,
    shortageKg: 0,
    lowStock: false,
  });
  assert.equal(calculateStockProjection(null, 100, 2, 30), null);
});

test('farm product nutrient contribution uses selected amount and remains unknown without label data', () => {
  const feedDatabase = createDefaultFeedDatabase();
  feedDatabase.grass = knownGrassProfile();
  const known = calculateRation({
    feeds: [{ id: 'grass', freshKg: 10 }],
    feedDatabase,
    supplement: {
      products: [{
        type: 'salt',
        rateG: 100,
        profile: { na: 39.34, cl: 60.66, source: 'ผลิตภัณฑ์ทดสอบ' },
      }],
    },
  });
  assert.ok(Math.abs(known.productNutrients.na - 0.03934) < 1e-12);
  assert.ok(Math.abs(known.productNutrients.cl - 0.06066) < 1e-12);
  assert.ok(Math.abs(known.nutrients.na - 0.04434) < 1e-12);

  const missingLabel = calculateRation({
    feeds: [{ id: 'grass', freshKg: 10 }],
    feedDatabase,
    supplement: { products: [{ type: 'other', rateG: 100, profile: null }] },
  });
  assert.equal(missingLabel.productNutrients.ca, null);
  assert.equal(missingLabel.nutrients.ca, null);

  const missingCitation = calculateRation({
    feeds: [{ id: 'grass', freshKg: 10 }],
    feedDatabase,
    supplement: { products: [{ type: 'salt', rateG: 100, profile: { na: 39.34 } }] },
  });
  assert.equal(missingCitation.productNutrients.na, null);
  assert.equal(missingCitation.nutrients.na, null);
});
