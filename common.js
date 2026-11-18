// 専務用の画面（index.html）と閲覧ページ（view.html）で共通に使う部品
// ・日付の計算（すべて日本の暦日。時刻は使わない）
// ・週表（PC・印刷）と日ごとの一覧（スマホ）の組み立て

const WD = '日月火水木金土';

const D = {
  parse(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); },
  fmt(dt) { return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`; },
  add(s, n) { const dt = D.parse(s); dt.setDate(dt.getDate() + n); return D.fmt(dt); },
  diff(a, b) { return Math.round((D.parse(b) - D.parse(a)) / 86400000); },
  monday(s) { const dt = D.parse(s); dt.setDate(dt.getDate() - (dt.getDay() + 6) % 7); return D.fmt(dt); },
  today() { return D.fmt(new Date()); },
  md(s) { const dt = D.parse(s); return `${dt.getMonth() + 1}/${dt.getDate()}`; },
  wd(s) { return WD[D.parse(s).getDay()]; },
  isSun(s) { return D.parse(s).getDay() === 0; },
  isSat(s) { return D.parse(s).getDay() === 6; },
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 樹種の色（nojimoku統一ルール：桧＝ピンク／杉＝水色）。両方・どちらもなし＝色なし
function speciesOf(body) {
  const h = /桧|檜|ヒノキ|ひのき/.test(body), s = /杉|スギ|すぎ/.test(body);
  return h && !s ? 'hinoki' : s && !h ? 'sugi' : '';
}

// 半日（0＝午前・1＝午後）。古いデータに無ければまる1日とみなす
const HALF = ['午前', '午後'];
const fh = e => (e.from_half ?? 0), th = e => (e.to_half ?? 1);
const startKey = e => e.date_from + fh(e), endKey = e => e.date_to + th(e);   // 文字の大小で前後が比べられる

// 1つの段の中で、期間が重なるカードを別の行（トラック）に振り分ける（半日単位）
function packTracks(list) {
  const sorted = [...list].sort((a, b) => startKey(a).localeCompare(startKey(b)) || endKey(b).localeCompare(endKey(a)));
  const ends = [];
  for (const e of sorted) {
    let t = ends.findIndex(end => end < startKey(e));
    if (t < 0) { t = ends.length; ends.push(endKey(e)); } else ends[t] = endKey(e);
    e._track = t;
  }
  return { cards: sorted, tracks: ends.length };
}

// 期間の書き方：まる1日なら何も出さない／半日なら「午前」「午後」／何日かなら「11/17午後〜11/18午前」
function spanText(e) {
  if (e.date_to > e.date_from) return `${D.md(e.date_from)}${fh(e) ? '午後' : ''}〜${D.md(e.date_to)}${th(e) ? '' : '午前'}`;
  if (fh(e) === th(e)) return HALF[fh(e)];
  return '';
}

// 表示する段：使っている段は全部。使っていない段は、その期間にカードがあるときだけ
function visibleLanes(lanes, entries, showAll) {
  const used = new Set(entries.map(e => e.lane_id));
  return lanes.filter(l => l.active || used.has(l.id) || showAll).sort((a, b) => a.sort - b.sort);
}

function dayClass(day, holidays) {
  const c = [];
  if (D.isSun(day) || holidays[day]) c.push('off');
  else if (D.isSat(day)) c.push('sat');
  if (day === D.today()) c.push('today');
  return c.join(' ');
}

function cardInner(e, rangeFrom, rangeTo) {
  const cutL = e.date_from < rangeFrom, cutR = e.date_to > rangeTo;
  const sp = spanText(e), span = sp ? `<span class="c-span">${sp}</span>` : '';
  const st = e.status !== '予定' ? `<span class="c-st">${esc(e.status)}</span>` : '';
  return `${cutL ? '<span class="c-cut">◀</span>' : ''}${st}${span}<div class="c-body">${esc(e.body).replace(/\n/g, '<br>')}</div>${cutR ? '<span class="c-cut r">▶</span>' : ''}`;
}

function cardClass(e) {
  return ['card', speciesOf(e.body), e.status === '済' ? 'done' : '', e.status === '中止' ? 'cancel' : '', e.color ? 'hl' : ''].join(' ');
}

// 週表（段×日）。1日を午前・午後の2マスに分ける。何週でも横に1枚でつなげる
// editable なら空いたマスを押してカードを足せる
function renderWeekGrid({ from, days = 7, lanes, entries, holidays = {}, editable = false, showAll = false }) {
  const to = D.add(from, days - 1);
  const inRange = entries.filter(e => e.date_from <= to && e.date_to >= from);
  const ls = visibleLanes(lanes, inRange, showAll);
  const dayList = Array.from({ length: days }, (_, i) => D.add(from, i));
  const wk = i => (i > 0 && D.parse(dayList[i]).getDay() === 1 ? ' wk' : '');   // 週の変わり目（月曜の左）に太い線
  let html = `<div class="grid" style="--cols:${days * 2}">`;
  html += `<div class="g-corner" style="grid-row:1 / span 2">${D.md(from)}〜${D.md(to)}</div>`;
  dayList.forEach((d, i) => {
    html += `<div class="g-day ${dayClass(d, holidays)}${wk(i)}" style="grid-row:1;grid-column:${i * 2 + 2} / span 2">${D.md(d)}<small>${D.wd(d)}${holidays[d] ? '・' + esc(holidays[d]) : ''}</small></div>`;
    HALF.forEach((h, k) => {
      html += `<div class="g-half ${dayClass(d, holidays)}${k ? ' pm' : wk(i)}" style="grid-row:2;grid-column:${i * 2 + 2 + k}">${h}</div>`;
    });
  });
  let row = 3;
  for (const lane of ls) {
    const { cards, tracks } = packTracks(inRange.filter(e => e.lane_id === lane.id));
    const n = Math.max(1, tracks + (editable ? 1 : 0));
    const empty = !cards.length && lane.kind !== '工場' ? ' empty' : '';   // 空の段（印刷では省く。工場は空でも残す）
    html += `<div class="g-lane k-${esc(lane.kind)}${empty}" style="grid-row:${row} / span ${n}">${esc(lane.name)}</div>`;
    for (let t = 0; t < n; t++) {
      dayList.forEach((d, i) => {
        for (let k = 0; k < 2; k++) {
          html += `<div class="g-cell ${dayClass(d, holidays)}${k ? ' pm' : wk(i)}${t === n - 1 ? ' last' : ''}${empty}${editable && t === n - 1 && n > 1 ? ' spare' : ''}" style="grid-row:${row + t};grid-column:${i * 2 + 2 + k}"` +
            (editable ? ` data-lane="${lane.id}" data-date="${d}" data-half="${k}" title="${D.md(d)} ${HALF[k]}"` : '') + '></div>';
        }
      });
    }
    for (const e of cards) {
      const c1 = Math.max(0, D.diff(from, e.date_from) * 2 + fh(e)) + 2;
      const c2 = Math.min(days * 2 - 1, D.diff(from, e.date_to) * 2 + th(e)) + 3;
      html += `<div class="${cardClass(e)}" data-id="${e.id}" style="grid-row:${row + e._track};grid-column:${c1} / ${c2}">${cardInner(e, from, to)}</div>`;
    }
    row += n;
  }
  html += '</div>';
  return html;
}

// スマホ用：日ごとの一覧
function renderDayList({ from, days, lanes, entries, holidays = {}, editable = false }) {
  const byId = Object.fromEntries(lanes.map(l => [l.id, l]));
  let html = '<div class="daylist">';
  for (let i = 0; i < days; i++) {
    const d = D.add(from, i);
    const todays = entries.filter(e => e.date_from <= d && e.date_to >= d)
      .sort((a, b) => (byId[a.lane_id]?.sort ?? 999) - (byId[b.lane_id]?.sort ?? 999) || startKey(a).localeCompare(startKey(b)));
    html += `<section class="dl-day ${dayClass(d, holidays)}"><h3>${D.md(d)}<small>（${D.wd(d)}）${holidays[d] ? esc(holidays[d]) : ''}</small>` +
      (editable ? `<button class="dl-add" data-date="${d}">＋</button>` : '') + '</h3>';
    if (!todays.length) html += '<p class="dl-none">予定なし</p>';
    let last = null;
    for (const e of todays) {
      const lane = byId[e.lane_id];
      if (lane && lane.id !== last) { html += `<div class="dl-lane k-${esc(lane.kind)}">${esc(lane.name)}</div>`; last = lane.id; }
      html += `<div class="${cardClass(e)}" data-id="${e.id}">${cardInner(e, d, d).replace(/<span class="c-cut[^>]*>.<\/span>/g, '')}</div>`;
    }
    html += '</section>';
  }
  return html + '</div>';
}

// 週表を出す（2週でも横に1枚でつなげる。印刷も1枚）
function renderWeeks(opts) {
  return `<div class="week">${renderWeekGrid(opts)}</div>`;
}

// 印刷：A4横1枚に収まるよう、週表を縮める（はみ出すときだけ）
(function () {
  const PAGE_H = (210 - 14) / 25.4 * 96;   // A4横の高さ−余白（px）
  function fit() {
    document.querySelectorAll('.week').forEach(w => {
      w.style.zoom = '';
      const head = w.querySelector('.print-head');
      const avail = PAGE_H - (head ? head.offsetHeight + 8 : 0) - 4;
      const fits = z => { w.style.zoom = String(z); return w.getBoundingClientRect().height <= avail; };
      if (fits(1)) { w.style.zoom = ''; return; }
      let lo = 0.45, hi = 1;   // 収まるいちばん大きい倍率を探す（縮めると横に広がって行が減るので、割り算では決まらない）
      for (let i = 0; i < 8; i++) { const m = (lo + hi) / 2; if (fits(m)) lo = m; else hi = m; }
      w.style.zoom = String(lo);
    });
  }
  function unfit() { document.querySelectorAll('.week').forEach(w => { w.style.zoom = ''; }); }
  const mq = window.matchMedia('print');
  mq.addEventListener('change', e => (e.matches ? fit() : unfit()));
  window.addEventListener('beforeprint', fit);
  window.addEventListener('afterprint', unfit);
})();
