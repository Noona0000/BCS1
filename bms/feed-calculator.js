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
  suggestFeedAddition,
  suggestFeedReduction,
  calculateStockProjection,
  assessMineralIntake,
  stageAgeRanges,
  validateCow,
} from './ration-calculations.mjs';
const goalDefinitions = [
  { id: 'maintain', label: 'คงน้ำหนัก' },
  { id: 'gain', label: 'เพิ่มน้ำหนัก' },
  { id: 'condition', label: 'ปรับสภาพร่างกายตาม BCS' },
];

const storageKeys = {
  feeds: 'bms.feed-database.v1',
  minerals: 'bms.mineral-database.v1',
  requirements: 'bms.nutrient-requirements.v1',
  stock: 'bms.mineral-stock.v1',
  dailyRecords: 'bms.daily-feed-records.v1',
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
  document.querySelector('#ration-date').value = new Date().toISOString().slice(0, 10);
  document.querySelector('#ration-date').addEventListener('change', () =>
    restoreDailyRecord(dailyRecords, customFeeds, () => `custom-${++customFeedId}`));
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
      for (const keyName of Object.keys(definition)) {
        if (keyName === 'label' || keyName === 'name' || keyName === 'source' || keyName === 'dataStatus') {
          if (typeof saved[keyName] === 'string') definition[keyName] = saved[keyName];
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
      const production = Object.fromEntries(productionNutrients.map(({ key }) => [
        key, { min: null, max: null, source: '' },
      ]));
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
        target.source = typeof savedTarget.source === 'string' ? savedTarget.source.slice(0, 180) : '';
        for (const bound of ['min', 'max']) {
          const value = savedTarget[bound];
          if (value === null || value === undefined || value === '') continue;
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
  if (referenceKind === 'feed') state.dataStatus = state.source ? 'analysis' : 'missing';
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
    dm.textContent = `DM ${displayNumber(database[item.id].dm, 1, '%')}`;
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
    invalidateResults(error, 'กรุณาเลือกวันที่บันทึกอาหาร');
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
  const mineralRequirements = Object.fromEntries(mineralRequirementFields.map(({ key }) => {
    const setting = requirementSettings.minerals[key];
    return [key, setting.source.trim() ? setting : { min: null, max: null, source: '' }];
  }));
  const productionRequirements = Object.fromEntries(productionNutrients.map(({ key }) => {
    const setting = requirementSettings.production[key];
    return [key, setting.source.trim() ? setting : { min: null, max: null, source: '' }];
  }));
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
  document.querySelector('#nutrient-results').innerHTML = renderNutrientResults(ration, cow, productionRequirements);
  document.querySelector('#feeding-recommendation').innerHTML = renderFeedingRecommendation(
    cow,
    ration,
    productionRequirements,
    feedDatabase,
    namedFeeds,
    { dryMatterKg: ration.dryMatterKg, nutrients: ration.nutrients, requirements: mineralRequirements },
  );
  document.querySelector('#mineral-result').innerHTML = renderMineralResults(rationForRender, cow, mineralRequirements, selectedProducts, stock);
  document.querySelector('#result-note-text').textContent = `เป้าหมาย “${document.querySelector('#target').selectedOptions[0].textContent}” และ BCS ${cow.bcs}/9 ใช้ประกอบการประเมิน แต่จะไม่สร้างปริมาณอาหารหรือแร่ธาตุขึ้นเองเมื่อไม่มีข้อมูลอ้างอิง`;
  document.querySelector('#result-status').textContent = ration.feeds.length
    ? 'แสดงเฉพาะข้อมูลอาหารที่มีแหล่งอ้างอิง'
    : 'ยังไม่ได้กรอกปริมาณอาหารจริง';
  document.querySelector('#ratio-label').textContent = 'ปริมาณที่กรอกจริง';
  document.querySelector('#copy-result').disabled = false;
  const record = {
    date: rationDate,
    cowName,
    feeds: [...namedFeeds.map(feed => ({ id: feed.id, label: feed.label, freshKg: feed.freshKg }))],
  };
  const existingIndex = dailyRecords.findIndex(item => item.date === record.date && item.cowName === record.cowName);
  if (existingIndex >= 0) dailyRecords.splice(existingIndex, 1);
  dailyRecords.unshift(record);
  dailyRecords.splice(60);
  saveStructuredState(storageKeys.dailyRecords, dailyRecords, databaseError);
  renderDailyHistory(dailyRecords);
}

function renderFeedBreakdown(feeds) {
  const heading = '<h4>1. อาหารที่โคได้รับในปัจจุบัน</h4>';
  if (!feeds.length) return `${heading}<p>กรอกปริมาณอาหารที่ให้จริงเพื่อแสดงรายการ</p>`;
  const rows = feeds.map(feed => {
    const label = feedDefinitions.find(definition => definition.id === feed.id)?.label || feed.id;
    return `<tr>
      <th scope="row">${escapeHtml(feed.label || label)}</th>
      <td>${displayNumber(feed.freshKg, 2, 'กก.สด/วัน')}</td>
      <td>${displayKnownNumber(feed.dryMatterKg, 2, 'กก./วัน')}</td>
      <td>${displayKnownNumber(feed.nutrients.cp, 3, 'กก./วัน')}</td>
      <td>${displayKnownNumber(feed.nutrients.tdn, 3, 'กก./วัน')}</td>
      <td>${feed.source ? escapeHtml(feed.source) : '—'}</td>
    </tr>`;
  }).join('');
  return `${heading}<div class="result-table-wrap"><table class="result-data-table">
    <thead><tr><th>อาหาร</th><th>ปริมาณสด</th><th>วัตถุแห้ง</th><th>โปรตีนหยาบ</th><th>พลังงาน TDN</th><th>แหล่งข้อมูล</th></tr></thead>
    <tbody>${rows}</tbody></table></div>
    <p class="database-note">ช่องที่แสดง — ยังไม่มีค่าที่อ้างอิงได้จากข้อมูลวัตถุดิบ</p>`;
}

function productionDailyTargets(cow, requirements) {
  return calculateProductionTargets(cow.weight, requirements);
}

function renderNutrientResults(ration, cow, requirements) {
  const targets = productionDailyTargets(cow, requirements);
  const rows = productionNutrients.map(({ key, label, unit }) => {
    const target = targets[key];
    const actual = key === 'dm' ? ration.dryMatterKg : ration.nutrients[key];
    const targetText = target.min === null
      ? 'ยังไม่มีค่าความต้องการพร้อมแหล่งอ้างอิง'
      : `${displayNumber(target.min, 3, `${unit}/วัน`)}${target.max === null ? ' ขึ้นไป' : `–${displayNumber(target.max, 3, `${unit}/วัน`)}`}`;
    const sourceText = target.min === null ? '' : ` · แหล่งอ้างอิง: ${escapeHtml(requirements[key].source)}`;
    const status = target.min === null || !Number.isFinite(actual)
      ? 'ข้อมูลไม่เพียงพอ'
      : actual < target.min ? 'ต่ำกว่าเป้าหมาย'
        : target.max !== null && actual > target.max ? 'สูงกว่าเป้าหมาย' : 'อยู่ในช่วงเป้าหมาย';
    return `<div><span>${label}</span><b>${displayKnownNumber(actual, 3, `${unit}/วัน`)}</b><small>เป้าหมาย ${targetText} · ${status}${sourceText}</small></div>`;
  });
  return `<h4>สารอาหารที่ได้รับเทียบกับความต้องการ</h4><div class="nutrient-result-list">${rows.join('')}</div>`;
}

function renderFeedingRecommendation(cow, ration, requirements, feedDatabase, feeds, mineralSafety) {
  const targets = productionDailyTargets(cow, requirements);
  const targetLabel = document.querySelector('#target').selectedOptions[0].textContent;
  const targetSourceMissing = productionNutrients.filter(({ key }) => targets[key].min === null);
  const actual = {
    dm: ration.dryMatterKg,
    cp: ration.nutrients.cp,
    tdn: ration.nutrients.tdn,
  };
  const completeActuals = productionNutrients.every(({ key }) => Number.isFinite(actual[key]));
  let recommendation = 'ยังไม่สามารถแนะนำชนิดหรือปริมาณอาหารได้จนกว่าจะมีผลวิเคราะห์ของอาหารที่ให้จริงและค่าความต้องการที่มีแหล่งอ้างอิงครบ';
  if (!targetSourceMissing.length && completeActuals) {
    const excessive = productionNutrients.some(({ key }) =>
      targets[key].max !== null && actual[key] > targets[key].max);
    const deficient = productionNutrients.some(({ key }) => actual[key] < targets[key].min);
    if (excessive) {
      const reductions = suggestFeedReduction(feeds, feedDatabase, actual, targets, mineralSafety);
      recommendation = reductions
        ? `ลด ${escapeHtml(reductions.feed.label)} ประมาณ ${displayNumber(reductions.freshKg, 2, 'กก.สด/วัน')} แล้วคำนวณซ้ำเพื่อตรวจสูตรรวม`
        : 'พบสารอาหารเกินช่วงเป้าหมาย แต่ยังไม่มีการลดอาหารชนิดเดียวที่ผ่านการตรวจว่าไม่ทำให้สารอาหารอื่นต่ำกว่าขั้นต่ำ';
    } else if (deficient) {
      const addition = suggestFeedAddition(feedDatabase, feeds, actual, targets, mineralSafety);
      recommendation = addition
        ? `เพิ่ม ${escapeHtml(addition.feed.label)} ประมาณ ${displayNumber(addition.freshKg, 2, 'กก.สด/วัน')} แล้วคำนวณซ้ำเพื่อตรวจสูตรรวม`
        : 'พบสารอาหารต่ำกว่าเป้าหมาย แต่ข้อมูลวัตถุดิบที่มีไม่เพียงพอสำหรับแนะนำชนิดหรือปริมาณที่ปลอดภัย';
    } else {
      recommendation = 'สารอาหารที่มีข้อมูลครบอยู่ในช่วงเป้าหมาย ไม่แนะนำให้เพิ่มหรือลดอาหารจากตัวเลขนี้';
    }
  }
  const missingSourceText = targetSourceMissing.length
    ? `<p>ยังขาดค่าความต้องการอ้างอิง: ${targetSourceMissing.map(item => item.label).join('、')}</p>`
    : '';
  return `<p>เป้าหมาย ${escapeHtml(targetLabel)} · น้ำหนัก ${displayNumber(cow.weight, 1, 'กก.')} · อายุ ${displayNumber(cow.age, 0, 'เดือน')} · ${escapeHtml(stageAgeRanges[cow.stage].label)} · BCS ${cow.bcs}/9</p>
    ${missingSourceText}<p>${recommendation}</p>
    <p class="database-note">คำแนะนำเป็นปริมาณต่อวันต่อตัวและคำนวณจากข้อมูลอ้างอิงที่ตั้งค่าไว้ โปรดคำนวณซ้ำหลังปรับสูตร และให้ผู้เชี่ยวชาญตรวจสอบก่อนใช้จริง</p>`;
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
    const status = assessMineralIntake(totalAmount, target.min, target.max);
    const missingThisProductNutrient = products.some(product =>
      product.rateG === null
      || (product.rateG > 0 && (!product.profile?.source || !Number.isFinite(product.profile[field.key]))));
    const deficit = totalAmount !== null && totalAmount < target.min ? target.min - totalAmount : null;
    return [`<tr>
      <th scope="row">${field.label} (${field.symbol})</th>
      <td>${formatMineralTarget(field, requirements[field.key], target, unit)}<br><small>${escapeHtml(requirements[field.key].source)}</small></td>
      <td>${displayNumber(foodAmount, 3, unit)}</td>
      <td>${displayNumber(productAmount, 3, unit)}</td>
      <td>${displayKnownNumber(deficit, 3, unit)}</td>
      <td>${status}</td>
      <td>${mineralRecommendation(field, totalAmount, target, unit, products, missingThisProductNutrient, ration, requirements)}</td>
    </tr>`];
  }).join('');
  const selectedStage = stageAgeRanges[cow.stage].label;
  const productNames = products.length
    ? products.map(product => `${escapeHtml(product.name || product.type)} (${escapeHtml(product.profile?.source || 'ไม่มีข้อมูลฉลากอ้างอิง')})`).join('、')
    : 'ไม่ได้เลือกผลิตภัณฑ์';
  return `<h4>4. เลือกผลิตภัณฑ์แร่ธาตุที่เหลืออยู่ในฟาร์ม</h4>
    <p class="database-note">โค ${displayNumber(cow.weight, 1, 'กก.')} · อายุ ${displayNumber(cow.age, 0, 'เดือน')} · BCS ${cow.bcs}/9 · ${escapeHtml(selectedStage)} · เป้าหมาย ${escapeHtml(document.querySelector('#target').selectedOptions[0].textContent)} · วัตถุแห้ง ${displayKnownNumber(ration.dryMatterKg, 2, 'กก./วัน')}</p>
    <p class="database-note">คำนวณส่วนที่ขาดจากความต้องการต่อวันลบปริมาณที่ได้รับจากอาหารและผลิตภัณฑ์ที่เลือก · ผลิตภัณฑ์ในฟาร์ม: ${productNames}</p>
    ${tableRows.length
      ? `<div class="mineral-table-wrap"><table class="mineral-table"><thead><tr><th>ชื่อแร่ธาตุ</th><th>ความต้องการต่อวัน</th><th>จากอาหาร</th><th>จากผลิตภัณฑ์</th><th>ส่วนที่ยังขาด</th><th>ผลประเมิน</th><th>คำแนะนำ</th></tr></thead><tbody>${tableRows}</tbody></table></div>`
      : '<p>ยังไม่มีค่าความต้องการแร่ธาตุที่ตั้งค่าพร้อมแหล่งอ้างอิง โปรดเพิ่มข้อมูลใน “ตั้งค่าข้อมูลอ้างอิงสำหรับการคำนวณ”</p>'}
    ${renderStockProjection(products, stock)}
    ${products.length && productDataMissing ? '<p class="mineral-warning">ผลิตภัณฑ์ที่เลือกยังไม่มีข้อมูลฉลากครบ จึงยังไม่นำมาคำนวณหรือแนะนำปริมาณเสริม</p>' : ''}`;
}

function renderStockProjection(products, stock) {
  if (!products.length) return '<p class="database-note">ยังไม่ได้เลือกผลิตภัณฑ์จากสต็อก</p>';
  const headcount = Number(document.querySelector('#herd-headcount').value);
  const days = Number(document.querySelector('#inventory-days').value);
  const entries = products.map(product => {
    const amountKg = product.stockKg ?? stock[product.type];
    if (!Number.isFinite(amountKg)) {
      return `<li>${escapeHtml(product.name || product.type)}: ระบุสต็อกคงเหลือเพื่อคำนวณความเพียงพอ</li>`;
    }

    if (product.rateG === null || !Number.isFinite(headcount) || !Number.isFinite(days)) {
      return `<li>${escapeHtml(product.name || product.type)}: มี ${displayNumber(amountKg, 2, 'กก.')}; ระบุอัตราใช้ต่อวัน จำนวนโค และจำนวนวันเพื่อประเมิน</li>`;
    }
    const projection = calculateStockProjection(amountKg, product.rateG, headcount, days);
    if (!projection) return `<li>${escapeHtml(product.name || product.type)}: ข้อมูลจำนวนโคหรือจำนวนวันไม่ถูกต้อง</li>`;
    const warning = projection.shortageKg > 0
      ? `สต็อกไม่พอ ขาด ${displayNumber(projection.shortageKg, 2, 'กก.')}`
      : projection.lowStock ? 'ใกล้หมดตามแผน' : 'เพียงพอตามแผน';
    return `<li>${escapeHtml(product.name || product.type)}: คงเหลือ ${displayNumber(amountKg, 2, 'กก.')} · ใช้ ${displayNumber(projection.plannedUseKg, 2, 'กก.')} ใน ${days} วัน สำหรับ ${headcount} ตัว · หลังใช้ ${displayNumber(projection.remainingKg, 2, 'กก.')} — ${warning}</li>`;
  });
  return `<div class="stock-projection"><h5>คาดการณ์สต็อก</h5><ul>${entries.join('')}</ul><p class="database-note">คำนวณจากอัตราใช้ปัจจุบันเท่านั้น ไม่ได้หักสต็อกจริง และไม่รวมปริมาณเสริมที่ยังไม่ได้ยืนยัน</p></div>`;
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
  document.querySelector('#feeding-recommendation').replaceChildren();
  document.querySelector('#mineral-result').innerHTML = '<h4>4. เลือกผลิตภัณฑ์แร่ธาตุที่เหลืออยู่ในฟาร์ม</h4><p>แก้ข้อมูลโคแล้วคำนวณใหม่</p>';
  document.querySelector('#result-status').textContent = 'ยังไม่คำนวณ: ตรวจสอบข้อมูล';
  document.querySelector('#ratio-label').textContent = '—';
}

function readNumberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
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
