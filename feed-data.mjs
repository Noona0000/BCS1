export const nutrientFields = [
  { key: 'dm', label: 'วัตถุแห้ง (DM)', unit: '%', group: 'basic' },
  { key: 'cp', label: 'โปรตีนหยาบ (CP)', unit: '% DM', group: 'basic' },
  { key: 'cf', label: 'กากใยหยาบ (CF)', unit: '% DM', group: 'basic' },
  { key: 'ndf', label: 'NDF', unit: '% DM', group: 'basic' },
  { key: 'adf', label: 'ADF', unit: '% DM', group: 'basic' },
  { key: 'tdn', label: 'พลังงาน (TDN)', unit: '% DM', group: 'basic' },
  { key: 'ca', label: 'Ca', unit: '% DM', group: 'macro' },
  { key: 'p', label: 'P', unit: '% DM', group: 'macro' },
  { key: 'mg', label: 'Mg', unit: '% DM', group: 'macro' },
  { key: 'k', label: 'K', unit: '% DM', group: 'macro' },
  { key: 'na', label: 'Na', unit: '% DM', group: 'macro' },
  { key: 's', label: 'S', unit: '% DM', group: 'macro' },
  { key: 'cl', label: 'Cl', unit: '% DM', group: 'macro' },
  { key: 'cu', label: 'Cu', unit: 'mg/kg DM', group: 'micro' },
  { key: 'zn', label: 'Zn', unit: 'mg/kg DM', group: 'micro' },
  { key: 'mn', label: 'Mn', unit: 'mg/kg DM', group: 'micro' },
  { key: 'fe', label: 'Fe', unit: 'mg/kg DM', group: 'micro' },
  { key: 'se', label: 'Se', unit: 'mg/kg DM', group: 'micro' },
  { key: 'co', label: 'Co', unit: 'mg/kg DM', group: 'micro' },
  { key: 'i', label: 'I', unit: 'mg/kg DM', group: 'micro' },
];

export const feedDefinitions = [
  { id: 'grass', label: 'หญ้าสด' },
  { id: 'straw', label: 'ฟาง' },
  { id: 'hay', label: 'หญ้าแห้ง' },
  { id: 'silage', label: 'หญ้าหมัก' },
  { id: 'bran', label: 'รำ' },
  { id: 'corn', label: 'ข้าวโพด' },
  { id: 'cassava', label: 'มันเส้น' },
  { id: 'pellet', label: 'อาหารข้น' },
];

export const mineralTypes = [
  { id: 'complete', label: 'แร่ธาตุรวมสำหรับโคเนื้อ' },
  { id: 'salt', label: 'เกลือแกง (NaCl)' },
  { id: 'dicalcium', label: 'ไดแคลเซียมฟอสเฟต' },
  { id: 'vitamins', label: 'วิตามินรวม' },
  { id: 'highMg', label: 'แร่ธาตุผสมแมกนีเซียมสูง' },
  { id: 'none', label: 'ไม่ได้เสริมแร่ธาตุ' },
];

export const nutrientKeys = nutrientFields.map(({ key }) => key);

export const mineralRequirementStages = [
  { id: 'grower', label: 'ลูกโค / โคกำลังโต' },
  { id: 'maintain', label: 'โคโตเต็มวัย ระยะพัก' },
  { id: 'pregnant', label: 'แม่โคตั้งท้อง' },
  { id: 'lactating', label: 'แม่โคให้นม' },
  { id: 'finishing', label: 'โคขุน' },
];

export const mineralRequirementFields = [
  { key: 'ca', label: 'แคลเซียม', symbol: 'Ca', unit: '% DM', group: 'macro' },
  { key: 'p', label: 'ฟอสฟอรัส', symbol: 'P', unit: '% DM', group: 'macro' },
  { key: 'mg', label: 'แมกนีเซียม', symbol: 'Mg', unit: '% DM', group: 'macro' },
  { key: 'k', label: 'โพแทสเซียม', symbol: 'K', unit: '% DM', group: 'macro' },
  { key: 'na', label: 'โซเดียม', symbol: 'Na', unit: '% DM', group: 'macro' },
  { key: 's', label: 'กำมะถัน', symbol: 'S', unit: '% DM', group: 'macro' },
  { key: 'cl', label: 'คลอรีน', symbol: 'Cl', unit: '% DM', group: 'macro' },
  { key: 'cu', label: 'ทองแดง', symbol: 'Cu', unit: 'mg/kg DM', group: 'micro' },
  { key: 'zn', label: 'สังกะสี', symbol: 'Zn', unit: 'mg/kg DM', group: 'micro' },
  { key: 'mn', label: 'แมงกานีส', symbol: 'Mn', unit: 'mg/kg DM', group: 'micro' },
  { key: 'fe', label: 'เหล็ก', symbol: 'Fe', unit: 'mg/kg DM', group: 'micro' },
  { key: 'se', label: 'ซีลีเนียม', symbol: 'Se', unit: 'mg/kg DM', group: 'micro' },
  { key: 'co', label: 'โคบอลต์', symbol: 'Co', unit: 'mg/kg DM', group: 'micro' },
  { key: 'i', label: 'ไอโอดีน', symbol: 'I', unit: 'mg/kg DM', group: 'micro' },
];

export const defaultMineralTargets = {
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
};

export function createDefaultMineralRequirements() {
  return Object.fromEntries(mineralRequirementStages.map(({ id }) => [
    id,
    Object.fromEntries(mineralRequirementFields.map(({ key }) => [key, {
      ...defaultMineralTargets[key],
      source: '',
    }])),
  ]));
}

export function emptyNutrientProfile() {
  return Object.fromEntries(nutrientKeys.map(key => [key, null]));
}

export function createDefaultFeedDatabase() {
  const exampleProfiles = {
    // Typical reference samples only. Actual composition varies by maturity and storage.
    grass: { dm: 14.56, cp: 10.25, tdn: 55, source: 'ค่าตัวอย่างหญ้าเนเปียร์ปากช่อง 1 สด (DM/CP); TDN ใช้ค่าอ้างอิงทั่วไป — ควรแทนด้วยผลวิเคราะห์' },
    straw: { dm: 90, cp: 3.5, tdn: 45, source: 'ค่าประมาณฟางข้าว: DM 90%, CP 3–4%, TDN ประมาณ 45% — ควรแทนด้วยผลวิเคราะห์' },
    hay: { dm: 84.35, cp: 6.46, tdn: 55.6, source: 'ตัวอย่างหญ้าแพงโกลาแห้งจากรายงานกรมปศุสัตว์ — ควรแทนด้วยผลวิเคราะห์อาหารจริง' },
    silage: { dm: 17.01, cp: 6.15, tdn: 50.4, source: 'ตัวอย่างหญ้าเนเปียร์ปากช่อง 1 หมักจากรายงานกรมปศุสัตว์ — ควรแทนด้วยผลวิเคราะห์อาหารจริง' },
    bran: { dm: 89, cp: 16.75, tdn: 82, source: 'ตัวอย่างรำละเอียดจากรายงานกรมปศุสัตว์ — ควรแทนด้วยผลวิเคราะห์อาหารจริง' },
    corn: { dm: 87.62, cp: 8.12, tdn: 78.8, source: 'ตัวอย่างข้าวโพดบดจากรายงานกรมปศุสัตว์ — ควรแทนด้วยผลวิเคราะห์อาหารจริง' },
    cassava: { dm: 86.73, cp: 2.29, tdn: 78.5, source: 'ตัวอย่างมันเส้นจากรายงานกรมปศุสัตว์ — ควรแทนด้วยผลวิเคราะห์อาหารจริง' },
  };
  return Object.fromEntries(feedDefinitions.map(({ id, label }) => {
    const profile = exampleProfiles[id];
    return [id, {
      label,
      ...emptyNutrientProfile(),
      ...(profile || {}),
      dataStatus: profile ? 'estimate' : 'missing',
      source: profile?.source || '',
    }];
  }));
}

export function createDefaultMineralDatabase() {
  return Object.fromEntries(mineralTypes
    .filter(({ id }) => id !== 'none')
    .map(({ id, label }) => [id, {
      name: label,
      recommendedIntakeG: null,
      ...emptyNutrientProfile(),
      source: '',
    }]));
}
