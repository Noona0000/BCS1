const SHEET_NAME = 'บันทึกอาหาร';
const HEADERS = [
  'รหัสพื้นที่ข้อมูล', 'รหัสรายการ', 'วันที่', 'ชื่อโค', 'น้ำหนัก (กก.)', 'อายุ (เดือน)', 'เพศ', 'ระยะการเลี้ยง',
  'BCS', 'เป้าหมาย', 'อาหารสดรวม (กก./วัน)', 'วัตถุแห้ง DM (กก./วัน)',
  'โปรตีนหยาบ CP (กก./วัน)', 'พลังงาน TDN (กก./วัน)', 'รายการอาหาร (JSON)',
  'ผลิตภัณฑ์เสริม (JSON)', 'อัปเดตเมื่อ',
];

function doGet(event) {
  const callback = String(event.parameter.callback || '');
  const profileId = String(event.parameter.profileId || '').toLowerCase();
  let result;
  if (!/^[a-f0-9]{32}$/.test(profileId)) result = { ok: false, error: 'ต้องระบุรหัสพื้นที่ข้อมูล' };
  else result = { ok: true, records: readRecords_(profileId) };
  const payload = JSON.stringify(result);
  if (!/^[$A-Z_a-z][$\w.]*$/.test(callback)) {
    return ContentService.createTextOutput(JSON.stringify({ ok: true, count: readRecords_(profileId).length }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  return ContentService.createTextOutput(callback + '(' + payload + ');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function doPost(event) {
  try {
    const request = JSON.parse(event.postData.contents || '{}');
    if (request.action !== 'upsert' || !request.record) throw new Error('รูปแบบข้อมูลไม่ถูกต้อง');
    const profileId = String(request.profileId || '').toLowerCase();
    if (!/^[a-f0-9]{32}$/.test(profileId)) throw new Error('รหัสพื้นที่ข้อมูลไม่ถูกต้อง');
    const record = request.record;
    if (!record.recordId || !/^\d{4}-\d{2}-\d{2}$/.test(record.date) || !record.cowName) {
      throw new Error('ข้อมูลรหัสรายการ วันที่ หรือชื่อโคไม่ครบ');
    }
    const sheet = getSheet_();
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    const rows = sheet.getDataRange().getValues();
    const existingRow = rows.findIndex(function(row, index) {
      return index > 0 && String(row[0]) === profileId && String(row[1]) === String(record.recordId);
    });
    const row = recordToRow_(profileId, record);
    try {
      if (existingRow > 0) sheet.getRange(existingRow + 1, 1, 1, HEADERS.length).setValues([row]);
      else sheet.appendRow(row);
    } finally {
      lock.releaseLock();
    }
    return ContentService.createTextOutput(JSON.stringify({ ok: true, recordId: record.recordId }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: error.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function getSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error('ให้สร้าง Apps Script จาก Google Sheet ที่ต้องการใช้');
  let sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  } else if (String(sheet.getRange(1, 1).getValue()) !== HEADERS[0]) {
    sheet.insertColumnBefore(1);
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    if (sheet.getLastRow() > 1) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).setValue('legacy-unassigned');
    }
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function recordToRow_(profileId, record) {
  const cow = record.cow || {};
  const nutrients = record.nutrients || {};
  return [
    profileId, record.recordId, record.date, record.cowName, cow.weight || '', cow.age || '', cow.sex || '',
    cow.stage || '', cow.bcs || '', record.target || '', record.freshKg ?? '',
    record.dryMatterKg ?? '', nutrients.cp ?? '', nutrients.tdn ?? '',
    JSON.stringify(record.feeds || []), JSON.stringify(record.supplements || []), record.updatedAt || new Date().toISOString(),
  ];
}

function readRecords_(profileId) {
  const sheet = getSheet_();
  if (sheet.getLastRow() < 2) return [];
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.length).getValues()
    .filter(function(row) { return String(row[0]) === profileId; });
  return values.reverse().map(function(row) {
    return {
      recordId: String(row[1]), date: formatDate_(row[2]), cowName: String(row[3]),
      weight: numberOrNull_(row[4]), age: numberOrNull_(row[5]), sex: String(row[6]),
      stage: String(row[7]), bcs: numberOrNull_(row[8]), target: String(row[9]),
      freshKg: numberOrNull_(row[10]), dryMatterKg: numberOrNull_(row[11]),
      cp: numberOrNull_(row[12]), tdn: numberOrNull_(row[13]),
      feeds: parseJson_(row[14]), supplements: parseJson_(row[15]), updatedAt: String(row[16]),
    };
  });
}

function formatDate_(value) {
  if (value instanceof Date) return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return String(value);
}

function numberOrNull_(value) {
  return value === '' || value === null ? null : Number(value);
}

function parseJson_(value) {
  try { return JSON.parse(String(value || '[]')); } catch (error) { return []; }
}

