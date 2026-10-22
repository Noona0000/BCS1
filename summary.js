import { GOOGLE_SHEETS_WEB_APP_URL } from './google-sheets-config.js';
import { getActiveProfileId } from './user-profile.js';

const profileId = getActiveProfileId();
const localRecords = readLocalRecords();
const status = document.querySelector('#summary-status');
if (GOOGLE_SHEETS_WEB_APP_URL) {
  loadFromSheets().then(records => {
    render(records);
    status.textContent = 'ข้อมูลล่าสุดจาก Google Sheets';
  }).catch(() => {
    render(localRecords);
    status.textContent = 'เชื่อม Google Sheets ไม่สำเร็จ · แสดงข้อมูลสำรองในเครื่อง';
    status.classList.add('error');
  });
} else {
  render(localRecords);
  status.textContent = '';
  status.hidden = true;
}

function readLocalRecords() {
  try {
    const records = JSON.parse(localStorage.getItem(`bms.users.${profileId}.daily-feed-records.v1`) || '[]');
    return Array.isArray(records) ? records : [];
  } catch { return []; }
}

function loadFromSheets() {
  return new Promise((resolve, reject) => {
    const callback = `bmsSheetsCallback${Date.now()}`;
    const script = document.createElement('script');
    const timeout = setTimeout(() => finish(new Error('หมดเวลารอข้อมูล')), 12000);
    function finish(error, records) {
      clearTimeout(timeout);
      delete window[callback];
      script.remove();
      if (error) reject(error); else resolve(records);
    }
    window[callback] = payload => payload?.ok && Array.isArray(payload.records)
      ? finish(null, payload.records)
      : finish(new Error('รูปแบบข้อมูลไม่ถูกต้อง'));
    script.onerror = () => finish(new Error('อ่านข้อมูลจากชีตไม่สำเร็จ'));
    const separator = GOOGLE_SHEETS_WEB_APP_URL.includes('?') ? '&' : '?';
    script.src = `${GOOGLE_SHEETS_WEB_APP_URL}${separator}callback=${callback}&profileId=${encodeURIComponent(profileId)}`;
    document.head.append(script);
  });
}

function render(records) {
  const list = [...records].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  document.querySelector('#record-count').textContent = list.length.toLocaleString('th-TH');
  const totalFreshKg = list.reduce((total, record) => total + (Number(record.freshKg) || (record.feeds || []).reduce((sum, feed) => sum + (Number(feed.freshKg) || 0), 0)), 0);
  document.querySelector('#feed-total').textContent = `${format(totalFreshKg, 1)} กก.`;
  const scores = list.map(record => Number(record.bcs ?? record.cow?.bcs)).filter(Number.isFinite);
  document.querySelector('#bcs-average').textContent = scores.length ? `${format(scores.reduce((sum, value) => sum + value, 0) / scores.length, 1)} / 9` : '—';
  const host = document.querySelector('#summary-content');
  if (!list.length) {
    host.innerHTML = '<p class="summary-empty">ยังไม่มีรายการบันทึก · ไปที่หน้าคำนวณอาหารเพื่อเริ่มบันทึก</p>';
    return;
  }
  const rows = list.slice(0, 50).map(record => {
    const feeds = (record.feeds || []).filter(feed => Number(feed.freshKg) > 0)
      .map(feed => `${escapeHtml(feed.label || feed.id)} ${format(feed.freshKg, 2)} กก.`).join(' · ') || '—';
    return `<tr><td>${escapeHtml(formatDate(record.date))}</td><td>${escapeHtml(record.cowName || 'โคของคุณ')}<small>${record.weight || record.cow?.weight ? `${escapeHtml(record.weight || record.cow.weight)} กก. · ` : ''}BCS ${escapeHtml(record.bcs ?? record.cow?.bcs ?? '—')}/9</small></td><td>${format(record.freshKg ?? (record.feeds || []).reduce((sum, feed) => sum + (Number(feed.freshKg) || 0), 0), 2)} กก.</td><td>${formatOrDash(record.dryMatterKg)} กก.</td><td>${feeds}</td></tr>`;
  }).join('');
  host.innerHTML = `<table class="summary-table"><thead><tr><th>วันที่</th><th>โค</th><th>อาหารสดรวม</th><th>วัตถุแห้ง</th><th>อาหารที่ให้</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function format(value, digits) { return (Number(value) || 0).toLocaleString('th-TH', { maximumFractionDigits: digits }); }
function formatOrDash(value) { return value === null || value === undefined || value === '' ? '—' : format(value, 2); }
function formatDate(value) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.valueOf()) ? String(value || '—') : new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }

