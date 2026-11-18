// 印刷・WORKSで送る（2026-11-18）
//   全体   … 2週分（全部の段）→ 竹中さん
//   飛鳥   … 2週分の飛鳥の製材スケジュール → 渥美課長
//   本社   … 2週分の本社の製材スケジュール → 本社製材予定（グループ）
// 送るときは画面を高い解像度の白黒の画像（PNG）にして、Supabase の works_send から bot専務で送る（2026-11-18 専務）

const SEND = { monday: null, test: false };
const DAYS = 14;   // 送る・印刷する分（2週）
const SHEETS = [
  { key: 'all', name: '全体 2週', note: '全部の段', to: '竹中さん' },
  { key: 'asuka', name: '飛鳥 2週', note: '飛鳥の製材スケジュール', to: '渥美課長', lane: '飛鳥' },
  { key: 'honsha', name: '本社 2週', note: '本社の製材スケジュール', to: '本社製材予定（グループ）', lane: '本社' },
];

// 表示の始まり以降の最初の月曜（金曜に翌週を組むので、金曜から見ていれば翌週になる）
const nextMonday = d => (D.parse(d).getDay() === 1 ? d : D.add(D.monday(d), 7));
const wdText = d => `${D.md(d)}（${D.wd(d)}）`;

function openSendDlg() {
  SEND.monday = SEND.monday || nextMonday(S.from);
  drawSendDlg();
  $('senddlg').showModal();
}
function drawSendDlg() {
  const to = D.add(SEND.monday, DAYS - 1);
  $('send-body').innerHTML =
    `<h2>印刷・WORKSで送る</h2>` +
    `<div class="sd-week">送る2週：<button type="button" class="dbtn" data-sw="-7">◀</button><b>${wdText(SEND.monday)}〜${wdText(to)}</b><button type="button" class="dbtn" data-sw="7">▶</button></div>` +
    SHEETS.map(s => `<div class="sd-row"><div class="sd-name"><b class="dg">${s.name}</b><small>${s.note}</small></div>` +
      `<button type="button" class="dbtn" data-print="${s.key}">印刷</button>` +
      `<button type="button" class="dbtn primary" data-send="${s.key}">${SEND.test ? '自分あてに試し送り' : esc(s.to) + 'へ送る'}</button></div>`).join('') +
    `<label class="sd-test"><input type="checkbox" id="sd-test"${SEND.test ? ' checked' : ''}> ためしに自分あてに送る（宛先を全部「自分」にする）</label>` +
    `<p class="hint" id="sd-msg"></p>` +
    `<div class="acts"><span class="spacer"></span><button type="button" class="dbtn" id="sd-close">閉じる</button></div>`;
}

// 送る・印刷する1枚を作る（白い紙の見た目）
async function buildSheet(key) {
  const now = new Date().toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const from = SEND.monday, to = D.add(from, DAYS - 1);
  const sheet = SHEETS.find(x => x.key === key);
  const all = await Store.range(from, to);
  const range = `${wdText(from)}〜${wdText(to)}`;
  if (key === 'all') {
    const opts = { from, days: DAYS, lanes: Store.lanes, entries: all, holidays: Store.holidays, stops: Store.stopMap(), editable: false, showAll: false };
    return { title: `製材計画 ${range}`,
      html: `<div class="sheet"><div class="sheet-head"><b>製材計画</b><span>${range}</span><small>作成 ${now}</small></div>${renderWeekGrid(opts)}</div>` };
  }
  const lane = Store.lanes.find(l => l.name === sheet.lane);
  const opts = { from, days: DAYS, lanes: [lane], entries: all.filter(e => e.lane_id === lane.id), holidays: Store.holidays, stops: Store.stopMap(), editable: false, showAll: true };
  return { title: `${sheet.lane} 製材スケジュール ${range}`,
    html: `<div class="sheet one"><div class="sheet-head"><b>${sheet.lane} 製材スケジュール</b><span>${range}</span><small>作成 ${now}</small></div>${renderWeekGrid(opts)}</div>` };
}

async function printSheet(key) {
  const { html } = await buildSheet(key);
  $('printarea').innerHTML = `<div class="week">${html}</div>`;
  document.body.classList.add('print-sheet');
  $('senddlg').close();
  setTimeout(() => { window.print(); }, 50);
}
window.addEventListener('afterprint', () => { document.body.classList.remove('print-sheet'); $('printarea').innerHTML = ''; });

// 画面を画像（PNG）にする
async function sheetPng(html) {
  const box = document.createElement('div');
  box.className = 'shot';
  box.innerHTML = html;
  document.body.appendChild(box);
  try {
    await document.fonts.ready;
    // 印刷しても文字がぼけない解像度（横およそ4800px）
    const canvas = await html2canvas(box, { backgroundColor: '#ffffff', scale: 3, useCORS: true, logging: false });
    // 白黒にする（明るさだけ残す。薄い色は白に寄せて、文字をくっきり）
    const ctx = canvas.getContext('2d');
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const px = img.data;
    for (let i = 0; i < px.length; i += 4) {
      let y = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      y = y > 200 ? 255 - (255 - y) * 0.6 : y * 0.92;   // 地は明るく、文字・線は濃く
      px[i] = px[i + 1] = px[i + 2] = y;
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL('image/png').split(',')[1];
  } finally { box.remove(); }
}

async function sendSheet(key, btn) {
  const sheet = SHEETS.find(s => s.key === key);
  const target = SEND.test ? 'test' : key;
  const who = SEND.test ? '自分あて（ためし）' : sheet.to;
  if (!confirm(`「${sheet.name}」を画像にして、${who} へ WORKS で送ります。よろしいですか？`)) return;
  const msg = $('sd-msg');
  btn.disabled = true; msg.textContent = '画像を作っています…';
  try {
    const { title, html } = await buildSheet(key);
    const png = await sheetPng(html);
    msg.textContent = '送っています…';
    if (!Store.remote) { msg.textContent = '試作モードなので送りません（画像は作れました）'; return; }
    const { data, error } = await Store.sb.functions.invoke('works_send', { body: { target, title, png } });
    if (error) {
      let m = error.message;
      try { const b = await error.context.json(); if (b && b.error) m = b.error; } catch (e) {}
      throw new Error(m);
    }
    msg.textContent = `${data.to} へ送りました`;
    toast(`${data.to} へ送りました`);
  } catch (e) { msg.textContent = '送れませんでした：' + e.message; }
  finally { btn.disabled = false; }
}

document.addEventListener('click', ev => {
  if (!ev.target.closest('#senddlg')) return;
  const sw = ev.target.closest('[data-sw]');
  if (sw) { SEND.monday = D.add(SEND.monday, Number(sw.dataset.sw)); drawSendDlg(); return; }
  const p = ev.target.closest('[data-print]');
  if (p) { printSheet(p.dataset.print); return; }
  const s = ev.target.closest('[data-send]');
  if (s) { sendSheet(s.dataset.send, s); return; }
  if (ev.target.closest('#sd-close')) $('senddlg').close();
});
document.addEventListener('change', ev => {
  if (ev.target.id === 'sd-test') { SEND.test = ev.target.checked; drawSendDlg(); }
});
