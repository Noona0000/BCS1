import {
  createDefaultFeedDatabase,
  createDefaultMineralDatabase,
  feedDefinitions,
  mineralRequirementFields,
  mineralTypes,
  nutrientFields,
  mineralRequirementStages,
} from './feed-data.mjs';
import {
  calculateRation,
  calculateMineralTargets,
  calculateProductionTargets,
  suggestFeedAdditions,
  suggestFeedReduction,
  calculateStockProjection,
  stageAgeRanges,
  validateCow,
} from './ration-calculations.mjs';
import { GOOGLE_SHEETS_WEB_APP_URL } from './google-sheets-config.js';
import { getActiveProfileId, getProfileStorageKey } from './user-profile.js';
const goalDefinitions = [
  { id: 'maintain', label: 'คงน้ำหนัก' },
  { id: 'gain', label: 'เพิ่มน้ำหนัก' },
  { id: 'condition', label: 'ปรับสภาพร่างกายตาม BCS' },
];

const storageKeys = {
  feeds: getProfileStorageKey('bms.feed-database.v1'),
  minerals: getProfileStorageKey('bms.mineral-database.v1'),
  requirements: getProfileStorageKey('bms.nutrient-requirements.v1'),
  stock: getProfileStorageKey('bms.mineral-stock.v1'),
  dailyRecords: getProfileStorageKey('bms.daily-feed-records.v1'),
};
const productionNutrients = [
  { key: 'dm', label: 'วัตถุแห้ง (DM)', unit: 'กก.' },
  { key: 'cp', label: 'โปรตีนหยาบ (CP)', unit: 'กก.' },
  { key: 'tdn', label: 'พลังงาน (TDN)', unit: 'กก.' },
];

const feedForm = document.querySelector('#feed-form');
if (feedForm) initializeFeedCalculator();

function initializeFeedCalculator() {
  const databaseError = document.querySelector('#database-error');
  const feedDatabase = loadDatabase(storageKeys.feeds, createDefaultFeedDatabase, databaseError);
  const mineralDatabase = loadDatabase(storageKeys.minerals, createDefaultMineralDatabase, databaseError);
  const requirements = normalizeRequirements(loadStructuredState(storageKeys.requirements, createEmptyRequirements, databaseError), databaseError);
  const savedStock = loadStructuredState(storageKeys.stock, () => ({}), databaseError);
  const validStockIds = new Set([...mineralTypes.filter(({ id }) => id !== 'none').map(({ id }) => id), 'other']);
  const stock = Object.fromEntries(Object.entries(savedStock)
    .filter(([id, amount]) => validStockIds.has(id) && readNumberOrNull(amount) !== null)
    .map(([id, amount]) => [id, readNumberOrNull(amount)]));
  const savedRecords = loadStructuredState(storageKeys.dailyRecords, () => [], databaseError);
  const dailyRecords = savedRecords.filter(record =>
    record && typeof record.date === 'string' && typeof record.cowName === 'string'
    && Array.isArray(record.feeds) && record.feeds.every(feed =>
      feed && typeof feed.label === 'string' && Number.isFinite(feed.freshKg) && feed.freshKg >= 0))
    .slice(0, 60);
  if (dailyRecords.length !== savedRecords.length) {
    showDatabaseError(databaseError, 'มีประวัติอาหารบางรายการที่อ่านไม่ได้ จึงไม่นำรายการที่เสียรูปแบบมาแสดง');
  }
  const customFeeds = [];
  let customFeedId = 0;
  renderFeedInputs(feedDatabase);
  renderFarmMineralInputs(mineralDatabase, stock);
  renderReferenceSettings(feedDatabase, mineralDatabase, requirements);
  renderDailyHistory(dailyRecords);
  if (GOOGLE_SHEETS_WEB_APP_URL) dailyRecords.forEach(syncRecordToGoogleSheets);
  const rationDateInput = document.querySelector('#ration-date');
  const rationDateDisplay = document.querySelector('#ration-date-display');
  rationDateInput.value = getLocalIsoDate();
  rationDateDisplay.value = formatDisplayDate(rationDateInput.value);
  rationDateInput.addEventListener('change', () => {
    rationDateDisplay.value = formatDisplayDate(rationDateInput.value);
    restoreDailyRecord(dailyRecords, customFeeds, () => `custom-${++customFeedId}`);
  });
  rationDateDisplay.addEventListener('input', () => {
    const isoDate = parseDisplayDate(rationDateDisplay.value);
    rationDateInput.value = isoDate || '';
    if (isoDate) rationDateInput.dispatchEvent(new Event('change', { bubbles: true }));
  });
  rationDateDisplay.addEventListener('blur', () => {
    const isoDate = parseDisplayDate(rationDateDisplay.value);
    if (isoDate) rationDateDisplay.value = formatDisplayDate(isoDate);
  });
  restoreDailyRecord(dailyRecords, customFeeds, () => `custom-${++customFeedId}`);
  document.querySelector('#add-custom-feed').addEventListener('click', () => {
    customFeeds.push({ id: `custom-${++customFeedId}`, name: '', amount: '' });
    renderCustomFeedInputs(customFeeds);
  });
  document.querySelector('#stage').addEventListener('change', () =>
    renderReferenceSettings(feedDatabase, mineralDatabase, requirements));
  document.querySelector('#target').addEventListener('change', () =>
    renderReferenceSettings(feedDatabase, mineralDatabase, requirements));
  document.querySelector('#reference-data-settings').addEventListener('change', event => {
    updateReferenceValue(event.target, feedDatabase, mineralDatabase, requirements, databaseError);
    renderFeedInputs(feedDatabase);
  });
  document.querySelector('#farm-mineral-inputs').addEventListener('change', event => {
    const stockInput = event.target.closest('.mineral-stock-amount');
    if (stockInput) {
      stock[stockInput.dataset.product] = readNumberOrNull(stockInput.value);
      saveStructuredState(storageKeys.stock, stock, databaseError);
    }
    const checkbox = event.target.closest('.farm-mineral-toggle');
    if (checkbox) checkbox.closest('.farm-mineral-row').querySelector('.farm-mineral-detail').hidden = !checkbox.checked;
    if (resultState.calculated) calculateAndRender(feedDatabase, mineralDatabase, requirements, stock, dailyRecords, customFeeds);
  });
  for (const input of [document.querySelector('#herd-headcount'), document.querySelector('#inventory-days')]) {
    input.addEventListener('change', () => {
      if (resultState.calculated) calculateAndRender(feedDatabase, mineralDatabase, requirements, stock, dailyRecords, customFeeds);
    });
  }
  document.querySelector('#farm-mineral-inputs').querySelectorAll('.mineral-stock-amount').forEach(input => {
    const amount = stock[input.dataset.product];
    if (amount !== undefined && amount !== null) input.value = String(amount);
  });
  const copyButton = document.querySelector('#copy-result');
  const resultState = { calculated: false };

  renderCustomFeedInputs(customFeeds);
  feedForm.addEventListener('submit', event => {
    event.preventDefault();
    resultState.calculated = true;
    calculateAndRender(feedDatabase, mineralDatabase, requirements, stock, dailyRecords, customFeeds);
  });
  copyButton.addEventListener('click', async () => {
    if (!resultState.calculated) return;
    const text = `${document.querySelector('#result-name').textContent}: ${document.querySelector('#as-fed').textContent} กก.อาหารสดที่กรอก/วัน, วัตถุแห้ง ${document.querySelector('#dm-result').textContent}. ${document.querySelector('#nutrient-results').innerText} ${document.querySelector('#mineral-result').innerText}`;
    try {
      await navigator.clipboard.writeText(text);
      copyButton.textContent = '✓';
    } catch {
      copyButton.textContent = 'คัดลอกไม่ได้';
    }
    setTimeout(() => { copyButton.textContent = '▢'; }, 1400);
  });
  copyButton.disabled = true;
}

function loadDatabase(key, factory, errorElement) {
  try {
    const stored = localStorage.getItem(key);
    if (!stored) return factory();
    const parsed = JSON.parse(stored);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('รูปแบบฐานข้อมูลไม่ถูกต้อง');
    const defaults = factory();
    for (const [id, definition] of Object.entries(defaults)) {
      const saved = parsed[id];
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) continue;
      const savedHasNutrients = nutrientFields.some(({ key: nutrient }) =>
        saved[nutrient] !== null && saved[nutrient] !== undefined && readNumberOrNull(saved[nutrient]) !== null);
      for (const keyName of Object.keys(definition)) {
        if (keyName === 'label' || keyName === 'name' || keyName === 'source' || keyName === 'dataStatus') {
          if (typeof saved[keyName] === 'string'
            && (keyName === 'source'
              ? saved[keyName].trim() || savedHasNutrients || !definition.source
              : keyName !== 'dataStatus' || saved[keyName] !== 'missing' || savedHasNutrients || !definition.source)) {
            definition[keyName] = saved[keyName];
          }
        } else {
          if (saved[keyName] === undefined) continue;
          const value = readNumberOrNull(saved[keyName]);
          if (saved[keyName] !== null && value === null) throw new Error(`ค่า ${keyName} ของ ${id} ไม่ใช่ตัวเลขที่ถูกต้อง`);
          const nutrient = nutrientFields.find(field => field.key === keyName);
          if (nutrient?.unit.startsWith('%') && value !== null && value > 100) {
            throw new Error(`ค่า ${keyName} ของ ${id} ต้องไม่เกิน 100%`);
          }
          definition[keyName] = value;
        }
      }
    }
    return defaults;
  } catch (error) {
    showDatabaseError(errorElement, `อ่านฐานข้อมูลที่บันทึกไว้ไม่ได้: ${error.message} แก้ไข/ล้างข้อมูลฐานในเบราว์เซอร์แล้วลองใหม่`);
    return factory();
  }
}

function createEmptyRequirements() {
  const settings = {};
  for (const { id: stage } of mineralRequirementStages) {
    for (const { id: goal } of goalDefinitions) {
      const minerals = Object.fromEntries(mineralRequirementFields.map(({ key }) => [
        key, { min: null, max: null, source: '' },
      ]));
      const production = Object.fromEntries(productionNutrients.map(({ key }) => {
        const defaults = defaultProductionRequirement(stage, goal)[key];
        return [key, { ...defaults }];
      }));
      settings[`${stage}:${goal}`] = { production, minerals };
    }
  }
  return settings;
}

function normalizeRequirements(saved, errorElement) {
  const normalized = createEmptyRequirements();
  for (const [key, groups] of Object.entries(normalized)) {
    const savedGroups = saved[key];
    if (!savedGroups || typeof savedGroups !== 'object') continue;
    for (const group of ['production', 'minerals']) {
      for (const [nutrient, target] of Object.entries(groups[group])) {
        const savedTarget = savedGroups[group]?.[nutrient];
        if (!savedTarget || typeof savedTarget !== 'object') continue;
        const defaults = group === 'production' ? defaultProductionRequirement(key.split(':')[0], key.split(':')[1])[nutrient] : null;
        const savedHasBounds = ['min', 'max'].some(bound => readNumberOrNull(savedTarget[bound]) !== null);
        target.source = typeof savedTarget.source === 'string'
          ? savedTarget.source.slice(0, 180)
          : (defaults?.source || '');
        if (!target.source && defaults?.source && !savedHasBounds) target.source = defaults.source;
        for (const bound of ['min', 'max']) {
          const value = savedTarget[bound];
          if (value === null || value === undefined || value === '') {
            if (savedHasBounds) target[bound] = null;
            else if (defaults && target[bound] === null) target[bound] = defaults[bound];
            continue;
          }
          const number = readNumberOrNull(value);
          if (number === null) {
            showDatabaseError(errorElement, `ค่า ${nutrient} ในข้อมูลความต้องการต้องเป็นตัวเลขศูนย์หรือมากกว่า`);
          } else {
            target[bound] = number;
          }
        }
        if (target.min !== null && target.max !== null && target.min > target.max) {
          showDatabaseError(errorElement, `ค่าต่ำสุดของ ${nutrient} มากกว่าค่าสูงสุด ข้อมูลช่วงนี้จึงยังไม่นำไปใช้`);
          target.min = null;
          target.max = null;
          target.source = '';
        }
      }
    }
  }
  return normalized;
}

function defaultProductionRequirement(stage, goal) {
  // Planning estimates for a mature, non-lactating cow around BCS 5. The gain
  // setting assumes modest gain (~0.25 kg/day); users can replace these values.
  const supported = stage === 'maintain' && ['maintain', 'gain', 'condition'].includes(goal);
  const values = goal === 'gain'
    ? { dm: [2, 2.5], cp: [1.8, 2.3], tdn: [12.5, 15] }
    : { dm: [1.8, 2.2], cp: [1.6, 2], tdn: [9.5, 11.5] };
  const basis = 'ค่าเริ่มต้นประมาณสำหรับโคโตเต็มวัย BCS ใกล้ 5; เป้าหมายเพิ่มน้ำหนักสมมติประมาณ 0.25 กก./วัน — ปรับตามผลวิเคราะห์/ผู้เชี่ยวชาญ';
  return Object.fromEntries(productionNutrients.map(({ key }) => [key, {
    min: supported ? values[key][0] : null,
    max: supported ? values[key][1] : null,
    source: supported ? `${basis} (ใช้อ้างอิงเพื่อวางแผน ไม่ใช่ผลวิเคราะห์เฉพาะตัว)` : '',
  }]));
}

function loadStructuredState(key, factory, errorElement) {
  try {
    const stored = localStorage.getItem(key);
    if (!stored) return factory();
    const parsed = JSON.parse(stored);
    const fallback = factory();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) !== Array.isArray(fallback)) {
      throw new Error('รูปแบบข้อมูลที่บันทึกไว้ไม่ถูกต้อง');
    }
    return parsed;
  } catch (error) {
    showDatabaseError(errorElement, `อ่านข้อมูลที่บันทึกไว้ไม่ได้: ${error.message}`);
    return factory();
  }
}

function saveStructuredState(key, value, errorElement) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    errorElement.hidden = true;
    return true;
  } catch (error) {
    showDatabaseError(errorElement, `บันทึกข้อมูลไม่ได้: ${error.message} โปรดตรวจพื้นที่จัดเก็บในเบราว์เซอร์`);
    return false;
  }
}

function renderReferenceSettings(feeds, products, requirements) {
  const container = document.querySelector('#reference-data-settings');
  const feedEditor = Object.entries(feeds).map(([id, profile]) => `
    <details class="database-record">
      <summary>ผลวิเคราะห์อาหาร: ${escapeHtml(profile.label)}</summary>
      <label class="database-field">แหล่งข้อมูล
        <input type="text" maxlength="180" data-reference-kind="feed" data-record-id="${id}" data-field="source" value="${escapeHtml(profile.source || '')}" placeholder="เช่น ผลวิเคราะห์ห้องปฏิบัติการ">
      </label>
      <div class="database-field-grid">${nutrientFields.map(field => referenceInput('feed', id, field.key, `${field.label} (${field.unit})`, profile[field.key])).join('')}</div>
    </details>`).join('');
  const productEditor = Object.entries(products).map(([id, profile]) => `
    <details class="database-record">
      <summary>ฉลากผลิตภัณฑ์: ${escapeHtml(profile.name || id)}</summary>
      <label class="database-field">แหล่งข้อมูลฉลาก
        <input type="text" maxlength="180" data-reference-kind="product" data-record-id="${id}" data-field="source" value="${escapeHtml(profile.source || '')}" placeholder="ระบุฉลาก/ผู้ผลิต">
      </label>
      <div class="database-field-grid">
        ${referenceInput('product', id, 'recommendedIntakeG', 'อัตราสูงสุดตามฉลาก (กรัม/ตัว/วัน)', profile.recommendedIntakeG)}
        ${nutrientFields.filter(field => field.group !== 'basic' && field.key !== 'dm').map(field => referenceInput('product', id, field.key, `${field.label} (${field.unit})`, profile[field.key])).join('')}
      </div>
    </details>`).join('');
  const stage = document.querySelector('#stage').value;
  const goal = document.querySelector('#target').value;
  const requirementKey = `${stage}:${goal}`;
  const saved = requirements[requirementKey] || createEmptyRequirements()[requirementKey];
  const targetEditor = `
    <div class="reference-subsection">
      <h4>ความต้องการสารอาหารต่อกิโลกรัมน้ำหนักตัว</h4>
      <p class="database-note">กรอกช่วงค่าจากแหล่งอ้างอิงที่เหมาะกับระยะการเลี้ยงและเป้าหมายนี้ ระบบคูณด้วยน้ำหนักตัวเพื่อหาค่าต่อวัน</p>
      <div class="requirement-grid">${productionNutrients.map(field => {
        const unit = field.key === 'dm' ? '% น้ำหนักตัว' : 'กรัม/กก.น้ำหนักตัว/วัน';
        const target = saved.production[field.key];
        return `<div class="requirement-row" data-reference-group="production" data-record-id="${field.key}">
          <b>${field.label} (${unit})</b>
          ${requirementInput(requirementKey, 'production', field.key, 'ต่ำสุด', target.min, 'min')}
          ${requirementInput(requirementKey, 'production', field.key, 'สูงสุด (ไม่บังคับ)', target.max, 'max')}
          <label class="database-field">แหล่งข้อมูล<input type="text" maxlength="180" data-reference-kind="requirement-source" data-record-id="${requirementKey}" data-group="production" data-nutrient="${field.key}" value="${escapeHtml(target.source || '')}" placeholder="ระบุแหล่งอ้างอิง"></label>
        </div>`;
      }).join('')}</div>
      <h4>ความต้องการแร่ธาตุ (% วัตถุแห้ง / มก.ต่อกก.วัตถุแห้ง)</h4>
      <div class="requirement-grid">${mineralRequirementFields.map(field => {
        const target = saved.minerals[field.key];
        return `<div class="requirement-row" data-reference-group="mineral" data-record-id="${field.key}">
          <b>${field.label} (${field.symbol})</b>
          ${requirementInput(requirementKey, 'mineral', field.key, 'ต่ำสุด', target.min, 'min')}
          ${requirementInput(requirementKey, 'mineral', field.key, 'สูงสุด (ไม่บังคับ)', target.max, 'max')}
          <label class="database-field">แหล่งข้อมูล<input type="text" maxlength="180" data-reference-kind="requirement-source" data-record-id="${requirementKey}" data-group="mineral" data-nutrient="${field.key}" value="${escapeHtml(target.source || '')}" placeholder="ระบุแหล่งอ้างอิง"></label>
        </div>`;
      }).join('')}</div>
    </div>`;
  container.innerHTML = `<section class="reference-subsection"><h4>ข้อมูลอาหาร</h4>${feedEditor}</section>
    <section class="reference-subsection"><h4>ข้อมูลฉลากแร่ธาตุ</h4>${productEditor}</section>${targetEditor}`;
}

function referenceInput(kind, recordId, field, label, value) {
  const numericField = field !== 'source';
  return `<label class="database-field">${label}<input ${numericField ? 'type="number" min="0" step="any"' : 'type="text" maxlength="180"'}
    data-reference-kind="${kind}" data-record-id="${recordId}" data-field="${field}"
    value="${numericField ? value ?? '' : escapeHtml(value || '')}" ${numericField ? 'placeholder="ยังไม่ระบุ"' : ''}></label>`;
}

function requirementInput(recordId, group, nutrient, label, value, bound) {
  return `<label class="database-field">${label}<input type="number" min="0" step="any"
    data-reference-kind="requirement-value" data-record-id="${recordId}" data-group="${group}"
    data-nutrient="${nutrient}" data-bound="${bound}" value="${escapeHtml(value ?? '')}" placeholder="ยังไม่ระบุ"></label>`;
}

function updateReferenceValue(input, feeds, products, requirements, errorElement) {
  if (!input.matches('[data-reference-kind]')) return;
  const { referenceKind, recordId, field, group, nutrient, bound } = input.dataset;
  let state;
  if (referenceKind === 'feed') state = feeds[recordId];
  else if (referenceKind === 'product') state = products[recordId];
  else if (referenceKind === 'requirement-value' || referenceKind === 'requirement-source') {
    state = requirements[recordId]?.[group]?.[nutrient];
  } else return;
  if (!state) return;
  const value = input.type === 'number' ? readNumberOrNull(input.value) : input.value.trim();
  if (input.type === 'number' && input.value !== '' && value === null) {
    showDatabaseError(errorElement, 'ค่าตัวเลขในข้อมูลอ้างอิงต้องเป็นศูนย์หรือมากกว่า');
    return;
  }
  if (input.type === 'number' && value !== null && input.closest('.database-record') && nutrientFields.find(item => item.key === field)?.unit.includes('%') && value > 100) {
    showDatabaseError(errorElement, 'ค่าสารอาหารที่ระบุเป็นเปอร์เซ็นต์ต้องไม่เกิน 100');
    return;
  }
  if (referenceKind === 'requirement-value' && value !== null) {
    const otherBound = bound === 'min' ? 'max' : 'min';
    const otherValue = state[otherBound];
    if (otherValue !== null && otherValue !== undefined
      && (bound === 'min' ? value > otherValue : value < otherValue)) {
      showDatabaseError(errorElement, 'ค่าต่ำสุดต้องไม่มากกว่าค่าสูงสุด');
      input.value = state[bound] ?? '';
      return;
    }
  }
  if (referenceKind === 'requirement-value') state[bound] = value;
  else if (referenceKind === 'requirement-source') state.source = value;
  else state[field] = value;
  if (referenceKind === 'feed') state.dataStatus = state.source ? 'estimate' : 'missing';
  const key = referenceKind === 'feed' ? storageKeys.feeds
    : referenceKind === 'product' ? storageKeys.minerals : storageKeys.requirements;
  const data = referenceKind === 'feed' ? feeds
    : referenceKind === 'product' ? products : requirements;
  saveStructuredState(key, data, errorElement);
}

function renderFeedInputs(database) {
  const container = document.querySelector('#actual-feed-inputs');
  const existingAmounts = new Map([...container.querySelectorAll('.feed-amount')]
    .map(input => [input.dataset.feed, input.value]));
  container.replaceChildren();
  for (const item of feedDefinitions) {
    const label = document.createElement('label');
    label.className = 'actual-feed-row';
    const name = document.createElement('span');
    name.textContent = item.label;
    const input = document.createElement('input');
    input.className = 'feed-amount';
    input.dataset.feed = item.id;
    input.type = 'number';
    input.min = '0';
    input.step = '0.01';
    input.inputMode = 'decimal';
    input.placeholder = '0';
    input.value = existingAmounts.get(item.id) || '';
    input.setAttribute('aria-label', `${item.label} กก.สดต่อวัน`);
    const dm = document.createElement('small');
    dm.textContent = database[item.id].source
      ? `DM ${displayNumber(database[item.id].dm, 1, '%')} · ค่าอ้างอิง`
      : 'ไม่มีข้อมูลวิเคราะห์';
    label.append(name, input, dm);
    container.append(label);
  }
}

function renderCustomFeedInputs(customFeeds) {
  const container = document.querySelector('#custom-feed-inputs');
  container.innerHTML = customFeeds.map(feed => `
    <div class="custom-feed-row" data-custom-feed="${feed.id}">
      <label class="database-field">อาหารเพิ่มเติม
        <input class="custom-feed-name" type="text" maxlength="80" value="${escapeHtml(feed.name)}" placeholder="เช่น หญ้าฟางสด" aria-label="ชื่ออาหารเพิ่มเติม">
      </label>
      <label class="database-field">ปริมาณ (กก.สด/วัน)
        <input class="custom-feed-amount" type="number" min="0" step="0.01" value="${escapeHtml(feed.amount)}" placeholder="0" aria-label="ปริมาณอาหารเพิ่มเติม กก.สดต่อวัน">
      </label>
      <button class="icon-button remove-custom-feed" type="button" aria-label="ลบรายการอาหาร ${escapeHtml(feed.name || '')}">×</button>
    </div>`).join('');
  container.querySelectorAll('.custom-feed-name').forEach(input => input.addEventListener('input', () => {
    const feed = customFeeds.find(item => item.id === input.closest('.custom-feed-row').dataset.customFeed);
    if (feed) feed.name = input.value;
  }));
  container.querySelectorAll('.custom-feed-amount').forEach(input => input.addEventListener('input', () => {
    const feed = customFeeds.find(item => item.id === input.closest('.custom-feed-row').dataset.customFeed);
    if (feed) feed.amount = input.value;
  }));
  container.querySelectorAll('.remove-custom-feed').forEach(button => button.addEventListener('click', () => {
    const id = button.closest('.custom-feed-row').dataset.customFeed;
    const index = customFeeds.findIndex(item => item.id === id);
    if (index >= 0) customFeeds.splice(index, 1);
    renderCustomFeedInputs(customFeeds);
  }));
}

function renderFarmMineralInputs(database, stock) {
  const container = document.querySelector('#farm-mineral-inputs');
  container.replaceChildren();
  const products = [
    ...mineralTypes.filter(({ id }) => id !== 'none'),
    { id: 'other', label: 'ผลิตภัณฑ์แร่ธาตุอื่น' },
  ];
  for (const product of products) {
    const row = document.createElement('div');
    row.className = 'farm-mineral-row';
    const toggleLabel = document.createElement('label');
    toggleLabel.className = 'farm-mineral-choice';
    const toggle = document.createElement('input');
    toggle.className = 'farm-mineral-toggle';
    toggle.type = 'checkbox';
    toggle.value = product.id;
    toggleLabel.append(toggle, document.createTextNode(product.label));
    const detail = document.createElement('div');
    detail.className = 'farm-mineral-detail';
    detail.hidden = true;
    const defaultName = product.id === 'other'
      ? ''
      : database[product.id].name || product.label;
    const nameField = document.createElement('label');
    nameField.className = 'database-field';
    nameField.textContent = 'ชื่อผลิตภัณฑ์';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.maxLength = 80;
    nameInput.placeholder = 'ระบุชื่อผลิตภัณฑ์';
    nameInput.value = defaultName;
    nameInput.className = 'farm-mineral-name';
    nameInput.dataset.product = product.id;
    nameField.append(nameInput);
    const amountField = document.createElement('label');
    amountField.className = 'database-field';
    amountField.textContent = 'ปริมาณที่ให้ (กรัม/ตัว/วัน)';
    const amountInput = document.createElement('input');
    amountInput.type = 'number';
    amountInput.min = '0';
    amountInput.step = 'any';
    amountInput.inputMode = 'decimal';
    amountInput.placeholder = 'ระบุปริมาณ';
    amountInput.className = 'farm-mineral-amount';
    amountInput.dataset.product = product.id;
    amountField.append(amountInput);
    const stockField = document.createElement('label');
    stockField.className = 'database-field';
    stockField.textContent = 'สต็อกคงเหลือ (กก.)';
    const stockInput = document.createElement('input');
    stockInput.type = 'number';
    stockInput.min = '0';
    stockInput.step = 'any';
    stockInput.inputMode = 'decimal';
    stockInput.placeholder = 'ระบุถ้าต้องการตรวจสต็อก';
    stockInput.className = 'mineral-stock-amount';
    stockInput.dataset.product = product.id;
    if (stock[product.id] !== undefined && stock[product.id] !== null) stockInput.value = String(stock[product.id]);
    stockField.append(stockInput);
    detail.append(nameField, amountField, stockField);
    const labelStatus = document.createElement('small');
    labelStatus.className = 'farm-mineral-label-status';
    labelStatus.textContent = product.id === 'other' || !database[product.id].source
      ? 'ยังไม่มีข้อมูลฉลากองค์ประกอบแร่ธาตุ — ปริมาณแร่ธาตุจากผลิตภัณฑ์จะยังประเมินไม่ได้'
      : `ข้อมูลฉลากที่บันทึกไว้: ${database[product.id].source}`;
    detail.append(labelStatus);
    row.append(toggleLabel, detail);
    container.append(row);
  }
}

function calculateAndRender(feedDatabase, mineralDatabase, requirements, stock, dailyRecords, customFeeds) {
  const error = document.querySelector('#form-error');
  const databaseError = document.querySelector('#database-error');
  const cow = {
    age: Number(document.querySelector('#age').value),
    weight: Number(document.querySelector('#weight').value),
    bcs: Number(document.querySelector('#bcs').value),
    sex: document.querySelector('#sex').value,
    stage: document.querySelector('#stage').value,
  };
  const validationError = validateCow(cow);
  if (validationError) {
    invalidateResults(error, validationError);
    return;
  }
  const feeds = [...document.querySelectorAll('.feed-amount')].map(input => ({
    id: input.dataset.feed,
    freshKg: input.value,
  }));
  const activeCustomFeeds = customFeeds.filter(feed => feed.name.trim() && feed.amount !== '')
    .map(feed => ({ id: feed.id, freshKg: feed.amount }));
  for (const feed of customFeeds) {
    if (feed.amount !== '' && (!Number.isFinite(Number(feed.amount)) || Number(feed.amount) < 0)) {
      invalidateResults(error, 'ปริมาณอาหารเพิ่มเติมต้องเป็นตัวเลขศูนย์หรือมากกว่า');
      return;
    }
    if (feed.amount !== '' && !feed.name.trim()) {
      invalidateResults(error, 'กรุณาระบุชื่ออาหารเพิ่มเติม');
      return;
    }
  }
  if (feeds.some(feed => feed.freshKg !== '' && (!Number.isFinite(Number(feed.freshKg)) || Number(feed.freshKg) < 0))) {
    invalidateResults(error, 'ปริมาณอาหารต้องเป็นตัวเลขศูนย์หรือมากกว่า');
    return;
  }
  const rationDate = document.querySelector('#ration-date').value;
  if (!rationDate) {
    invalidateResults(error, 'กรุณากรอกวันที่ในรูปแบบ วัน/เดือน/ปี ให้ถูกต้อง');
    return;
  }
  error.hidden = true;
  const selectedProducts = [...document.querySelectorAll('.farm-mineral-toggle:checked')].map(toggle => {
    const row = toggle.closest('.farm-mineral-row');
    const type = toggle.value;
    return {
      type,
      name: row.querySelector('.farm-mineral-name').value.trim(),
      rateG: readNumberOrNull(row.querySelector('.farm-mineral-amount').value),
      stockKg: readNumberOrNull(row.querySelector('.mineral-stock-amount').value),
      profile: type === 'other' ? null : mineralDatabase[type],
    };
  });
  const customFeedLabels = Object.fromEntries(customFeeds.map(feed => [feed.id, feed.name.trim() || 'อาหารเพิ่มเติม']));
  const rationFeedDatabase = {
    ...feedDatabase,
    ...Object.fromEntries(customFeeds.map(feed => [feed.id, {
      label: customFeedLabels[feed.id],
      dataStatus: 'missing',
      source: '',
    }])),
  };
  const ration = calculateRation({
    feeds: [...feeds, ...activeCustomFeeds],
    feedDatabase: rationFeedDatabase,
    supplement: { products: selectedProducts },
  });
  const requirementKey = `${cow.stage}:${document.querySelector('#target').value}`;
  const requirementSettings = requirements[requirementKey] || createEmptyRequirements()[requirementKey];
  const mineralRequirements = requirementSettings.minerals;
  const productionRequirements = requirementSettings.production;
  const cowName = document.querySelector('#cow-name').value.trim() || 'โคของคุณ';
  const namedFeeds = ration.feeds.map(feed => ({
    ...feed,
    label: customFeedLabels[feed.id] || feedDefinitions.find(definition => definition.id === feed.id)?.label || feed.label,
  }));
  const rationForRender = { ...ration, feeds: namedFeeds };
  document.querySelector('#result-name').textContent = `${cowName} · ${cow.weight} กก. · ${cow.age} เดือน · ${cow.sex === 'female' ? 'แม่โค' : 'โคผู้'} · ${stageAgeRanges[cow.stage].label} · BCS ${cow.bcs}/9`;
  document.querySelector('#as-fed').textContent = displayNumber(ration.freshKg, 2);
  document.querySelector('#dm-result').textContent = displayKnownNumber(ration.dryMatterKg, 2, 'กก./วัน');
  document.querySelector('#crude-protein-result').textContent = displayKnownNumber(ration.nutrients.cp, 3, 'กก./วัน');
  document.querySelector('#feed-breakdown').innerHTML = renderFeedBreakdown(namedFeeds);
  const nutrientResults = document.querySelector('#nutrient-results');
  nutrientResults.innerHTML = renderNutrientResults(ration, cow, productionRequirements);
  nutrientResults.hidden = !nutrientResults.innerHTML;
  const feedingRecommendation = document.querySelector('#feeding-recommendation');
  feedingRecommendation.innerHTML = renderFeedingRecommendation(
    cow,
    ration,
    productionRequirements,
    feedDatabase,
    namedFeeds,
    { dryMatterKg: ration.dryMatterKg, nutrients: ration.nutrients, requirements: mineralRequirements },
  );
  document.querySelector('#feeding-advice-summary').hidden = !feedingRecommendation.innerHTML;
  const mineralResults = document.querySelector('#mineral-result');
  mineralResults.innerHTML = renderMineralResults(rationForRender, cow, mineralRequirements, selectedProducts, stock);
  mineralResults.hidden = !mineralResults.innerHTML;
  document.querySelector('#result-note-text').textContent = 'ผลคำนวณใช้ค่าองค์ประกอบอาหารตัวอย่างจากแหล่งอ้างอิงและเป้าหมายประมาณสำหรับโคโตเต็มวัย โปรดแทนค่าด้วยผลวิเคราะห์อาหารจริงก่อนปรับสูตร';
  document.querySelector('#result-status').textContent = ration.feeds.length
    ? 'คำนวณจากค่าองค์ประกอบอาหารอ้างอิง; ใช้ผลแล็บเพื่อความแม่นยำ'
    : 'ยังไม่ได้กรอกปริมาณอาหารจริง';
  document.querySelector('#ratio-label').textContent = 'ปริมาณที่กรอกจริง';
  document.querySelector('#copy-result').disabled = false;
  const record = {
    recordId: `${rationDate}:${cowName}`,
    date: rationDate,
    cowName,
    cow,
    target: document.querySelector('#target').value,
    freshKg: ration.freshKg,
    dryMatterKg: ration.dryMatterKg,
    nutrients: ration.nutrients,
    feeds: [...namedFeeds.map(feed => ({ id: feed.id, label: feed.label, freshKg: feed.freshKg }))],
    supplements: selectedProducts.map(product => ({ type: product.type, name: product.name, rateG: product.rateG })),
    updatedAt: new Date().toISOString(),
  };
  const existingIndex = dailyRecords.findIndex(item => item.date === record.date && item.cowName === record.cowName);
  if (existingIndex >= 0) dailyRecords.splice(existingIndex, 1);
  dailyRecords.unshift(record);
  dailyRecords.splice(60);
  saveStructuredState(storageKeys.dailyRecords, dailyRecords, databaseError);
  renderDailyHistory(dailyRecords);
  syncRecordToGoogleSheets(record);
}

function syncRecordToGoogleSheets(record) {
  if (!GOOGLE_SHEETS_WEB_APP_URL) return;
  const savedRecord = {
    ...record,
    recordId: record.recordId || `${record.date}:${record.cowName}`,
    cow: record.cow || {},
    feeds: Array.isArray(record.feeds) ? record.feeds : [],
    supplements: Array.isArray(record.supplements) ? record.supplements : [],
  };
  fetch(GOOGLE_SHEETS_WEB_APP_URL, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'upsert', profileId: getActiveProfileId(), record: savedRecord }),
  }).then(() => {
    const status = document.querySelector('#sheets-sync-status');
    if (status) status.textContent = 'ส่งข้อมูลไป Google Sheets แล้ว';
  }).catch(() => {
    const status = document.querySelector('#sheets-sync-status');
    if (status) status.textContent = 'ส่งข้อมูลไม่สำเร็จ — ยังเก็บข้อมูลไว้ในเบราว์เซอร์';
  });
}

function renderFeedBreakdown(feeds) {
  const heading = '<h4>อาหารที่ได้รับจริงต่อวัน</h4>';
  if (!feeds.length) return `${heading}<p>กรอกปริมาณอาหารที่ให้จริงเพื่อแสดงรายการ</p>`;
  const columns = [
    { key: 'feed', label: 'อาหาร', always: true, value: feed => escapeHtml(feed.label || feedDefinitions.find(item => item.id === feed.id)?.label || feed.id) },
    { key: 'fresh', label: 'ปริมาณสด', always: true, value: feed => displayNumber(feed.freshKg, 2, 'กก.สด/วัน') },
    { key: 'dm', label: 'วัตถุแห้ง', available: feed => Number.isFinite(feed.dryMatterKg), value: feed => displayNumber(feed.dryMatterKg, 2, 'กก./วัน') },
    { key: 'cp', label: 'โปรตีนหยาบ', available: feed => Number.isFinite(feed.nutrients.cp), value: feed => displayNumber(feed.nutrients.cp, 3, 'กก./วัน') },
  ].filter(column => column.always || feeds.some(column.available));
  const rows = feeds.map(feed => `<tr>${columns.map(column => column.key === 'feed'
    ? `<th class="col-${column.key}" scope="row">${column.value(feed)}</th>`
    : `<td class="col-${column.key}">${column.value(feed)}</td>`).join('')}</tr>`).join('');
  return `${heading}<div class="result-table-wrap"><table class="result-data-table">
    <thead><tr>${columns.map(column => `<th class="col-${column.key}">${column.label}</th>`).join('')}</tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

function productionDailyTargets(cow, requirements) {
  return calculateProductionTargets(cow.weight, requirements);
}

function renderNutrientResults(ration, cow, requirements) {
  const targets = productionDailyTargets(cow, requirements);
  const rows = productionNutrients.flatMap(({ key, label, unit }) => {
    const target = targets[key];
    const actual = key === 'dm' ? ration.dryMatterKg : ration.nutrients[key];
    if (target.min === null || !Number.isFinite(actual)) return [];
    const targetText = target.min === null
      ? 'ยังไม่มีค่าความต้องการพร้อมแหล่งอ้างอิง'
      : `${displayNumber(target.min, 3, `${unit}/วัน`)}${target.max === null ? ' ขึ้นไป' : `–${displayNumber(target.max, 3, `${unit}/วัน`)}`}`;
    const status = target.min === null || !Number.isFinite(actual)
      ? 'ข้อมูลไม่เพียงพอ'
      : actual < target.min ? 'ต่ำกว่าเป้าหมาย'
        : target.max !== null && actual > target.max ? 'สูงกว่าเป้าหมาย' : 'อยู่ในช่วงเป้าหมาย';
    const sourceText = requirements[key].source?.trim()
      ? `<small>${escapeHtml(requirements[key].source)}</small>`
      : '';
    return [`<tr><th scope="row" data-label="สารอาหาร">${label}</th><td data-label="ได้รับต่อวัน">${displayKnownNumber(actual, 3, `${unit}/วัน`)}</td><td data-label="เป้าหมายต่อวัน">${targetText}${sourceText}</td><td data-label="ผลประเมิน"><span class="nutrient-status ${status === 'อยู่ในช่วงเป้าหมาย' ? 'is-ok' : 'is-alert'}">${status}</span></td></tr>`];
  });
  if (!rows.length) return '';
  return `<h4>สารอาหารที่ได้รับเทียบกับความต้องการ</h4><div class="nutrient-table-wrap"><table class="nutrient-comparison-table"><thead><tr><th>รายการ</th><th>ได้รับต่อวัน</th><th>เป้าหมายต่อวัน</th><th>ผลประเมิน</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

function renderFeedingRecommendation(cow, ration, requirements, feedDatabase, feeds, mineralSafety) {
  const targets = productionDailyTargets(cow, requirements);
  const targetValueMissing = productionNutrients.filter(({ key }) => targets[key].min === null);
  const actual = {
    dm: ration.dryMatterKg,
    cp: ration.nutrients.cp,
    tdn: ration.nutrients.tdn,
  };
  const completeActuals = productionNutrients.every(({ key }) => Number.isFinite(actual[key]));
  if (targetValueMissing.length || !completeActuals) return '';
  let recommendationMarkup;
  {
    const excessive = productionNutrients.some(({ key }) =>
      targets[key].max !== null && actual[key] > targets[key].max);
    const deficient = productionNutrients.some(({ key }) => actual[key] < targets[key].min);
    if (excessive) {
      const reductions = suggestFeedReduction(feeds, feedDatabase, actual, targets, mineralSafety);
      if (reductions) {
        const rows = feeds.filter(feed => Number.isFinite(feed.freshKg) && feed.freshKg > 0).map(feed => {
          const reduceKg = feed.id === reductions.feed.id ? reductions.freshKg : 0;
          const remainingKg = Math.max(0, feed.freshKg - reduceKg);
          return `<tr><th scope="row">${escapeHtml(feed.label)}</th><td>${reduceKg > 0 ? `− ${displayNumber(reduceKg, 2, 'กก.สด')}` : 'คงเดิม'}</td><td>${displayNumber(remainingKg, 2, 'กก.สด')}</td></tr>`;
        }).join('');
        recommendationMarkup = `<table class="feeding-recommendation-table"><thead><tr><th>อาหารที่ให้จริง</th><th>ปรับต่อวัน</th><th>ปริมาณหลังปรับ</th></tr></thead><tbody>${rows}</tbody></table><p class="database-note">ระบบเลือกปรับ ${escapeHtml(reductions.feed.label)} ชนิดเดียวที่คำนวณแล้วเข้าเป้าหมายได้ อาหารชนิดอื่นคงปริมาณเดิม</p>`;
      } else {
        recommendationMarkup = renderProportionalReduction(feeds, actual, targets);
      }
    } else if (deficient) {
      const additions = suggestFeedAdditions(feedDatabase, feeds, actual, targets, mineralSafety);
      recommendationMarkup = additions.length
        ? `<table class="feeding-recommendation-table"><thead><tr><th>อาหารที่มีอยู่</th><th>เพิ่มต่อวัน</th></tr></thead><tbody>${additions.map(({ feed, freshKg }) => `<tr><th scope="row">${escapeHtml(feed.label)}</th><td>+ ${displayNumber(freshKg, 2, 'กก.สด')}</td></tr>`).join('')}</tbody></table>`
        : '<p class="recommendation-missing">ยังไม่มีอาหารที่มีข้อมูลครบและคำนวณปริมาณเพิ่มได้</p>';
    } else {
      recommendationMarkup = '<p>ไม่พบความจำเป็นต้องเพิ่มอาหารจากข้อมูลที่มี</p>';
    }
  }
  return recommendationMarkup;
}

function renderProportionalReduction(feeds, actual, targets) {
  const dmMaximum = targets.dm.max;
  if (!Number.isFinite(actual.dm) || !Number.isFinite(dmMaximum) || actual.dm <= dmMaximum) {
    return '<p class="recommendation-missing">อาหารที่ให้เกินเป้าหมาย แต่ข้อมูลยังไม่พอคำนวณปริมาณปรับเป็นกิโลกรัมได้</p>';
  }
  const scale = dmMaximum / actual.dm;
  const rows = feeds.filter(feed => Number.isFinite(feed.freshKg) && feed.freshKg > 0).map(feed => {
    const reduceKg = feed.freshKg * (1 - scale);
    const remainingKg = feed.freshKg - reduceKg;
    return `<tr><th scope="row">${escapeHtml(feed.label)}</th><td>− ${displayNumber(reduceKg, 2, 'กก.สด')}</td><td>${displayNumber(remainingKg, 2, 'กก.สด')}</td></tr>`;
  }).join('');
  const projected = Object.fromEntries(['cp', 'tdn'].map(key => [key, actual[key] * scale]));
  const remainingTargets = ['cp', 'tdn'].filter(key => projected[key] < targets[key].min)
    .map(key => `${key.toUpperCase()} หลังลดเหลือประมาณ ${displayNumber(projected[key], 3, 'กก./วัน')} ต่ำกว่าขั้นต่ำ ${displayNumber(targets[key].min, 3, 'กก./วัน')}`);
  const note = remainingTargets.length
    ? `ลดตามสัดส่วนเพื่อให้ DM ไม่เกิน ${displayNumber(dmMaximum, 2, 'กก./วัน')} ก่อน แต่สูตรยังไม่สมดุล: ${remainingTargets.join(' · ')} จึงไม่ควรเพิ่ม/ลดตามตารางนี้เป็นสูตรสุดท้าย ต้องปรับสัดส่วนวัตถุดิบและวิเคราะห์อาหารจริง`
    : `ลดตามสัดส่วนเพื่อให้ DM อยู่ในช่วงเป้าหมายประมาณ ${displayNumber(targets.dm.min, 2)}–${displayNumber(dmMaximum, 2, 'กก./วัน')}`;
  return `<table class="feeding-recommendation-table"><thead><tr><th>อาหารที่ให้จริง</th><th>ลดต่อวัน</th><th>เหลือประมาณ</th></tr></thead><tbody>${rows}</tbody></table><p class="database-note">${note}</p>`;
}

function renderMineralResults(ration, cow, requirements, products, stock) {
  const targets = calculateMineralTargets(ration.dryMatterKg, requirements);
  const productDataMissing = products.some(product =>
    product.rateG === null || (product.rateG > 0 && !product.profile?.source));
  const tableRows = mineralRequirementFields.flatMap(field => {
    const target = targets[field.key];
    const foodAmount = mineralAmountInTargetUnits(ration.feedNutrients[field.key], field);
    const productAmount = mineralAmountInTargetUnits(ration.productNutrients[field.key], field);
    const totalAmount = mineralAmountInTargetUnits(ration.nutrients[field.key], field);
    if (target.min === null) return [];
    const unit = field.group === 'macro' ? 'กรัม/วัน' : 'มก./วัน';
    const missingThisProductNutrient = products.some(product =>
      product.rateG === null
      || (product.rateG > 0 && (!product.profile?.source || !Number.isFinite(product.profile[field.key]))));
    const deficit = totalAmount !== null && totalAmount < target.min ? target.min - totalAmount : null;
    return [`<tr>
      <th scope="row" data-label="แร่ธาตุ">${field.label} (${field.symbol})</th>
      <td data-label="เป้าหมายต่อวัน">${formatMineralTarget(field, requirements[field.key], target, unit)}${requirements[field.key].source?.trim() ? `<small>${escapeHtml(requirements[field.key].source)}</small>` : ''}</td>
      <td data-label="ได้รับจากอาหาร">${displayNumber(foodAmount, 3, unit)}</td>
      <td data-label="ได้รับจากผลิตภัณฑ์">${displayNumber(productAmount, 3, unit)}</td>
      <td data-label="ยังขาด">${displayKnownNumber(deficit, 3, unit)}</td>
      <td data-label="ควรทำอย่างไร">${mineralRecommendation(field, totalAmount, target, unit, products, missingThisProductNutrient, ration, requirements)}</td>
    </tr>`];
  }).join('');
  if (!tableRows.length && !products.length) return '';
  const selectedStage = stageAgeRanges[cow.stage].label;
  const productNames = products.length
    ? products.map(product => `${escapeHtml(product.name || product.type)} (${escapeHtml(product.profile?.source || 'ไม่มีข้อมูลฉลากอ้างอิง')})`).join('、')
    : 'ไม่ได้เลือกผลิตภัณฑ์';
  return `<h4>แร่ธาตุที่ได้รับและส่วนที่ยังขาด</h4>
    <p class="database-note">โค ${displayNumber(cow.weight, 1, 'กก.')} · อายุ ${displayNumber(cow.age, 0, 'เดือน')} · BCS ${cow.bcs}/9 · ${escapeHtml(selectedStage)} · เป้าหมาย ${escapeHtml(document.querySelector('#target').selectedOptions[0].textContent)} · วัตถุแห้ง ${displayKnownNumber(ration.dryMatterKg, 2, 'กก./วัน')}</p>
    <p class="database-note">เทียบปริมาณแร่ธาตุเป้าหมายกับที่ได้รับจากอาหารและผลิตภัณฑ์ที่เลือก: ${productNames}</p>
    ${tableRows.length
      ? `<div class="mineral-table-wrap"><table class="mineral-table"><thead><tr><th>แร่ธาตุ</th><th>เป้าหมายต่อวัน</th><th>ได้รับจากอาหาร</th><th>ได้รับจากผลิตภัณฑ์</th><th>ยังขาด</th><th>ควรทำอย่างไร</th></tr></thead><tbody>${tableRows}</tbody></table></div>`
      : ''}
    ${renderStockProjection(products, stock)}
    ${products.length && productDataMissing ? '<p class="mineral-warning">ผลิตภัณฑ์ที่เลือกยังไม่มีข้อมูลฉลากครบ จึงยังไม่นำมาคำนวณหรือแนะนำปริมาณเสริม</p>' : ''}`;
}

function renderStockProjection(products, stock) {
  if (!products.length) return '';
  const headcount = Number(document.querySelector('#herd-headcount').value);
  const days = Number(document.querySelector('#inventory-days').value);
  const rows = products.map(product => {
    const name = escapeHtml(product.name || product.type);
    const amountKg = product.stockKg ?? stock[product.type];
    if (!Number.isFinite(amountKg)) {
      return `<tr><th scope="row" data-label="ผลิตภัณฑ์">${name}</th><td data-label="สต็อกปัจจุบัน">ยังไม่ได้ระบุ</td><td data-label="คาดว่าจะใช้">—</td><td data-label="คงเหลือหลังใช้">—</td><td data-label="สถานะ">กรอกสต็อกคงเหลือ</td></tr>`;
    }

    if (product.rateG === null || !Number.isFinite(headcount) || !Number.isFinite(days)) {
      return `<tr><th scope="row" data-label="ผลิตภัณฑ์">${name}</th><td data-label="สต็อกปัจจุบัน">${displayNumber(amountKg, 2, 'กก.')}</td><td data-label="คาดว่าจะใช้">—</td><td data-label="คงเหลือหลังใช้">—</td><td data-label="สถานะ">กรอกอัตราใช้ จำนวนโค และจำนวนวัน</td></tr>`;
    }
    const projection = calculateStockProjection(amountKg, product.rateG, headcount, days);
    if (!projection) return `<tr><th scope="row" data-label="ผลิตภัณฑ์">${name}</th><td data-label="สต็อกปัจจุบัน">${displayNumber(amountKg, 2, 'กก.')}</td><td data-label="คาดว่าจะใช้">—</td><td data-label="คงเหลือหลังใช้">—</td><td data-label="สถานะ">ตรวจจำนวนโคและจำนวนวัน</td></tr>`;
    const status = projection.shortageKg > 0
      ? `ขาด ${displayNumber(projection.shortageKg, 2, 'กก.')}`
      : projection.lowStock ? 'ใกล้หมดตามแผน' : 'เพียงพอตามแผน';
    return `<tr><th scope="row" data-label="ผลิตภัณฑ์">${name}</th><td data-label="สต็อกปัจจุบัน">${displayNumber(amountKg, 2, 'กก.')}</td><td data-label="คาดว่าจะใช้">${displayNumber(projection.plannedUseKg, 2, 'กก.')}</td><td data-label="คงเหลือหลังใช้">${displayNumber(projection.remainingKg, 2, 'กก.')}</td><td data-label="สถานะ">${status}</td></tr>`;
  });
  return `<div class="stock-projection"><h5>คาดการณ์สต็อก</h5><div class="mineral-table-wrap"><table class="mineral-table stock-projection-table"><thead><tr><th>ผลิตภัณฑ์</th><th>สต็อกปัจจุบัน</th><th>คาดว่าจะใช้</th><th>คงเหลือหลังใช้</th><th>สถานะ</th></tr></thead><tbody>${rows.join('')}</tbody></table></div><p class="database-note">คำนวณตามอัตราใช้ ${days} วัน สำหรับโค ${headcount} ตัว ไม่ได้หักสต็อกจริง และไม่รวมปริมาณเสริมที่ยังไม่ได้ยืนยัน</p></div>`;
}

function renderDailyHistory(records) {
  const container = document.querySelector('#daily-feed-history');
  if (!records.length) {
    container.innerHTML = '<h4>ประวัติอาหารที่บันทึก</h4><p>ยังไม่มีรายการบันทึก</p>';
    return;
  }
  const rows = records.slice(0, 10).map(record => {
    const feeds = record.feeds.map(feed =>
      `${escapeHtml(feed.label)} ${displayNumber(feed.freshKg, 2, 'กก.')}`).join(' · ');
    return `<li><b>${escapeHtml(record.date)}</b> · ${escapeHtml(record.cowName)}<br><span>${feeds || 'ไม่ได้บันทึกปริมาณอาหาร'}</span></li>`;
  }).join('');
  container.innerHTML = `<h4>ประวัติอาหารที่บันทึก (ล่าสุด 10 รายการ)</h4><ol>${rows}</ol>`;
}

function restoreDailyRecord(records, customFeeds, createCustomId) {
  const date = document.querySelector('#ration-date').value;
  const cowName = document.querySelector('#cow-name').value.trim() || 'โคของคุณ';
  const record = records.find(item => item.date === date && item.cowName === cowName);
  const amounts = new Map((record?.feeds || []).map(feed => [feed.id || feed.label, feed]));
  for (const input of document.querySelectorAll('.feed-amount')) {
    const label = feedDefinitions.find(item => item.id === input.dataset.feed)?.label;
    const saved = amounts.get(input.dataset.feed) || amounts.get(label);
    input.value = saved?.freshKg ?? '';
    amounts.delete(input.dataset.feed);
    amounts.delete(label);
  }
  customFeeds.splice(0, customFeeds.length);
  for (const saved of amounts.values()) {
    customFeeds.push({ id: createCustomId(), name: saved.label, amount: String(saved.freshKg) });
  }
  renderCustomFeedInputs(customFeeds);
}

function formatMineralTarget(field, concentration, daily, unit) {
  const concentrationText = field.group === 'macro'
    ? concentration.max === null ? `${concentration.min}% DM` : `${concentration.min}–${concentration.max}% DM`
    : concentration.max === null ? `${concentration.min} mg/kg DM` : `${concentration.min}–${concentration.max} mg/kg DM`;
  const dailyText = daily.max === null
    ? `${displayNumber(daily.min, 3, unit)} (ค่าเป้าหมาย)`
    : `${displayNumber(daily.min, 3, unit)}–${displayNumber(daily.max, 3, unit)}`;
  return `${concentrationText}<br><small>${dailyText}</small>`;
}

function mineralRecommendation(field, actual, target, unit, products, productDataMissing, ration, requirements) {
  if (actual === null || target.min === null || productDataMissing) {
    return 'ยังประเมินไม่ได้ — ตรวจผลวิเคราะห์อาหารและฉลากผลิตภัณฑ์';
  }
  if (actual < target.min) {
    const deficit = target.min - actual;
    const dose = suggestProductDose(field, deficit, ration, products, requirements);
    if (dose) {
      return `ต่ำกว่าเป้าหมาย ${displayNumber(deficit, 3, unit)}; เพิ่ม ${displayNumber(dose.additionalG, 2, 'กรัม/วัน')} ของ ${escapeHtml(dose.product.name || dose.product.type)} (รวม ${displayNumber(dose.totalG, 2, 'กรัม/วัน')}) โดยไม่เกินอัตราฉลาก; ให้ตรวจสูตรรวมก่อนใช้`;
    }
    const knownProduct = products.find(product =>
      Number.isFinite(product.profile?.[field.key]) && product.profile[field.key] > 0);
    const suggestion = knownProduct
      ? `พิจารณา ${escapeHtml(knownProduct.name || knownProduct.type)} ตามฉลาก`
      : `เลือกผลิตภัณฑ์ที่ระบุ ${field.symbol} บนฉลาก`;
    return `ต่ำกว่าเป้าหมายอย่างน้อย ${displayNumber(deficit, 3, unit)}; ${suggestion} ยังระบุปริมาณใช้ไม่ได้`;
  }
  if (target.max !== null && actual > target.max) return 'สูงกว่าช่วงเป้าหมาย ไม่ควรเสริมซ้ำ';
  if (target.max === null) return 'ถึงค่าเป้าหมาย แต่ไม่มีเกณฑ์ขอบบนให้ประเมินความปลอดภัย';
  return 'อยู่ในเป้าหมาย ไม่แนะนำให้เสริมซ้ำ';
}

function suggestProductDose(field, deficit, ration, products, requirements) {
  if (mineralRequirementFields.some(item => !Number.isFinite(ration.nutrients[item.key]))) return null;
  for (const product of products) {
    const profile = product.profile;
    const labelRate = profile?.recommendedIntakeG;
    const concentration = profile?.[field.key];
    if (
      product.rateG === null
      || !profile.source
      || !Number.isFinite(labelRate)
      || labelRate <= 0
      || !Number.isFinite(concentration)
      || concentration <= 0
      || mineralRequirementFields.some(item => !Number.isFinite(profile[item.key]))
    ) continue;
    const amountPerGram = field.group === 'macro' ? concentration / 100 : concentration / 1000;
    const additionalG = deficit / amountPerGram;
    const totalG = product.rateG + additionalG;
    if (totalG > labelRate) continue;
    const exceedsRange = mineralRequirementFields.some(item => {
      const max = calculateMineralTargets(ration.dryMatterKg, requirements)[item.key].max;
      if (max === null) return false;
      const added = item.group === 'macro'
        ? additionalG * profile[item.key] / 100
        : additionalG * profile[item.key] / 1000;
      const current = mineralAmountInTargetUnits(ration.nutrients[item.key], item);
      const projected = current + added;
      return projected > max;
    });
    if (!exceedsRange) return { product, additionalG, totalG };
  }
  return null;
}

function mineralAmountInTargetUnits(amount, field) {
  if (!Number.isFinite(amount)) return null;
  return field.group === 'macro' ? amount * 1000 : amount;
}

function invalidateResults(errorElement, message) {
  errorElement.textContent = message;
  errorElement.hidden = false;
  document.querySelector('#copy-result').disabled = true;
  document.querySelector('#as-fed').textContent = '—';
  document.querySelector('#dm-result').textContent = '—';
  document.querySelector('#crude-protein-result').textContent = '—';
  document.querySelector('#feed-breakdown').innerHTML = '<p>ผลเดิมถูกล้าง โปรดแก้ข้อมูลแล้วคำนวณใหม่</p>';
  document.querySelector('#nutrient-results').replaceChildren();
  document.querySelector('#nutrient-results').hidden = true;
  document.querySelector('#feeding-recommendation').replaceChildren();
  document.querySelector('#feeding-advice-summary').hidden = true;
  document.querySelector('#mineral-result').replaceChildren();
  document.querySelector('#mineral-result').hidden = true;
  document.querySelector('#result-status').textContent = 'ยังไม่คำนวณ: ตรวจสอบข้อมูล';
  document.querySelector('#ratio-label').textContent = '—';
}

function readNumberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function getLocalIsoDate(date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatDisplayDate(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate || '');
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
}

function parseDisplayDate(value) {
  const match = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(value.trim());
  if (!match) return '';
  const [, dayText, monthText, yearText] = match;
  const day = Number(dayText);
  const month = Number(monthText);
  const year = Number(yearText);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return '';
  return getLocalIsoDate(date);
}

function displayNumber(value, places = 1, suffix = '') {
  if (!Number.isFinite(value)) return 'ยังประเมินไม่ได้';
  return `${Number(value).toLocaleString('th-TH', { maximumFractionDigits: places, minimumFractionDigits: 0 })}${suffix ? ` ${suffix}` : ''}`;
}

function displayKnownNumber(value, places = 1, suffix = '') {
  return Number.isFinite(value) ? displayNumber(value, places, suffix) : '—';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function showDatabaseError(element, message) {
  if (!element) return;
  element.textContent = message;
  element.hidden = !message;
}
