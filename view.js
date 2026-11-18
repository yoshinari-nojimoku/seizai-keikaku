// 閲覧ページ（竹中さん・渥美さん用）。見るだけ・印刷できる。
// 合言葉は最初の1回だけ入れる（またはリンクの #k=合言葉 で開く）。このスマホに覚えさせる。

const V = { from: D.monday(D.today()), days: 14, key: '' };
const $ = id => document.getElementById(id);
const main = $('main');
const KEY_NAME = 'sk-aikotoba';

function getKey() {
  const m = location.hash.match(/k=([^&]+)/);
  if (m) {
    const k = decodeURIComponent(m[1]);
    try { localStorage.setItem(KEY_NAME, k); } catch (e) {}
    history.replaceState(null, '', location.pathname);   // アドレス欄から合言葉を消す
    return k;
  }
  try { return localStorage.getItem(KEY_NAME) || ''; } catch (e) { return ''; }
}

function askKey(msg) {
  main.innerHTML = `<div class="block msg"><img class="hero" src="${ILLUST.hero}" alt="製材所のイラスト"><p>${msg || '合言葉を入れてください（最初の1回だけ）。'}</p>
    <input id="k" type="password" autocomplete="current-password"><button class="bigbtn dg" id="ok">開く</button></div>`;
  $('ok').onclick = () => { V.key = $('k').value.trim(); try { localStorage.setItem(KEY_NAME, V.key); } catch (e) {} load(); };
  $('k').onkeydown = ev => { if (ev.key === 'Enter') $('ok').click(); };
}

async function load() {
  if (!V.key) return askKey();
  const to = D.add(V.from, V.days - 1);
  $('range').textContent = `${D.md(V.from)}〜${D.md(to)}`;
  let r;
  try {
    r = await fetch(`${VIEW_API}?from=${V.from}&days=${V.days}`, { headers: { 'x-aikotoba': V.key } });
  } catch (e) { main.innerHTML = '<div class="block msg">つながりません。電波を確かめてください。</div>'; return; }
  if (r.status === 401) { try { localStorage.removeItem(KEY_NAME); } catch (e) {} V.key = ''; return askKey('合言葉が違います。もう一度入れてください。'); }
  if (!r.ok) { main.innerHTML = `<div class="block msg">読み込みに失敗しました（${r.status}）。</div>`; return; }
  const data = await r.json();
  const holidays = Object.fromEntries((data.holidays || []).map(h => [h.day, h.label || '休み']));
  const stops = Object.fromEntries((data.stops || []).map(x => [`${x.lane_id}|${x.day}|${x.half}`, x.label]));
  const opts = { from: V.from, days: V.days, lanes: data.lanes, entries: data.entries, holidays, stops, editable: false };
  const upd = data.updated_at ? new Date(data.updated_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  $('upd').textContent = `最終更新 ${upd}`;
  // 印刷のときは各週の上に見出しを付ける
  const weeks = renderWeeks(opts).replace(/<div class="week block">/g, () =>
    `<div class="week block"><div class="print-head"><b>製材計画</b><span>印刷 ${new Date().toLocaleString('ja-JP')}／最終更新 ${upd}</span></div>`);
  V.entries = data.entries; V.lanes = data.lanes;
  main.innerHTML = `<div class="weeks">${weeks}</div>${renderDayList(opts).replace(/class="dl-day /g, 'class="dl-day block ')}`;
}

// ◀ ▶＝1日ずつ／◀◀ ▶▶＝1週ずつ
// 週表のカードを押すと全文をポップアップ（見るだけ）
main.addEventListener('click', ev => {
  const card = ev.target.closest('.weeks .card[data-id]');
  if (!card || !V.entries) return;
  const e = V.entries.find(x => String(x.id) === card.dataset.id);
  if (e) showCardPop(e, card, V.lanes, null);
});
window.addEventListener('resize', () => fitFactoryRows(main));
new MutationObserver(() => fitFactoryRows(main)).observe(main, { childList: true });

$('prev').onclick = () => { V.from = D.add(V.from, -1); load(); };
$('next').onclick = () => { V.from = D.add(V.from, 1); load(); };
$('prevw').onclick = () => { V.from = D.add(V.from, -7); load(); };
$('nextw').onclick = () => { V.from = D.add(V.from, 7); load(); };
$('today').onclick = () => { V.from = D.monday(D.today()); load(); };
$('print').onclick = () => window.print();

V.key = getKey();
load();
