import './feed-calculator.js';

const scale9 = Array.from({ length: 9 }, (_, index) => index + 1);
function fmt(number, places = 1) {
  return Number(number).toLocaleString('th-TH', { minimumFractionDigits: places, maximumFractionDigits: places });
}

function renderBcsGuide() {
  const container = document.querySelector('#score-cards');
  if (!container) return;
  container.innerHTML = scale9.map(value => {
    const category = value >= 4 && value <= 6 ? 'ideal' : value >= 7 ? 'fat' : 'thin';
    return `<article class="score-card ${category}">
      <b>${value}/9</b>
      <img class="bcs-example-image" src="/images/bcs-score-${value}.png" alt="ภาพตัวอย่างโค BCS ${value} จาก 9" loading="lazy" width="1422" height="768">
    </article>`;
  }).join('');
}

renderBcsGuide();

const photoUrls = { side: null, rear: null };
for (const view of ['side', 'rear']) {
  const input = document.querySelector(`#${view}-photo`);
  if (!input) continue;
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    const preview = document.querySelector(`#${view}-preview`);
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      input.value = '';
      return;
    }
    if (photoUrls[view]) URL.revokeObjectURL(photoUrls[view]);
    photoUrls[view] = URL.createObjectURL(file);
    preview.style.backgroundImage = `url("${photoUrls[view]}")`;
    preview.classList.add('has-image');
    preview.innerHTML = '<span class="preview-check">✓</span>';
  });
}

document.querySelectorAll('.visual-question').forEach(question => {
  question.querySelectorAll('button').forEach(button => button.addEventListener('click', () => {
    question.querySelectorAll('button').forEach(option => {
      option.classList.toggle('selected', option === button);
      option.setAttribute('aria-pressed', String(option === button));
    });
    question.dataset.answer = button.dataset.score;
    question.classList.add('answered');
  }));
});

const estimateButton = document.querySelector('#estimate-bcs');
if (estimateButton) {
  estimateButton.addEventListener('click', () => {
    const error = document.querySelector('#photo-error');
    const result = document.querySelector('#photo-result');
    const questions = [...document.querySelectorAll('.visual-question')];
    const unanswered = questions.filter(question => !question.dataset.answer).length;
    if (!photoUrls.side) {
      error.textContent = 'เพิ่มรูปด้านข้างขวาก่อน รูปนี้ช่วยดูซี่โครงและแนวสันหลัง';
      error.hidden = false;
      return;
    }
    if (unanswered) {
      error.textContent = `เลือกคำตอบจากรูปให้ครบอีก ${unanswered} จุด แล้วกดประเมินอีกครั้ง`;
      error.hidden = false;
      return;
    }
    error.hidden = true;
    const score = questions.reduce((sum, question) => sum + Number(question.dataset.answer), 0) / questions.length;
    const low = Math.max(1, Math.floor(score - 0.8));
    const high = Math.min(9, Math.ceil(score + 0.8));
    const completeness = Math.round((questions.length / 4) * 50 + (photoUrls.side ? 25 : 0) + (photoUrls.rear ? 25 : 0));
    const zone = score < 4 ? 'ค่อนข้างผอม' : score <= 6.5 ? 'ช่วงสมส่วนถึงดี' : 'ค่อนข้างอ้วน';
    result.innerHTML = `<div class="photo-result-top"><span>ผลประเมินเบื้องต้น</span><span class="completeness">ข้อมูลครบ ${completeness}%</span></div><div class="photo-score">BCS ประมาณ <b>${fmt(score, 1)}</b><small> / 9</small></div><div class="photo-range">ช่วงที่เป็นไปได้จากคำตอบ: <b>${low}–${high} / 9</b> · ${zone}</div><div class="completeness-bar"><i style="width:${completeness}%"></i></div><p>ถ่ายได้ ${photoUrls.side && photoUrls.rear ? 'ทั้งด้านข้างและด้านหลัง' : '1 จาก 2 มุมแนะนำ'} · ตอบจุดสังเกตครบ ${questions.length}/4</p><small>ภาพประกอบ BCS เป็นภาพวาด schematic เท่านั้น คะแนนจริงควรประเมินจากรูปร่างและการคลำร่วมกัน</small>`;
    result.hidden = false;
  });
}
