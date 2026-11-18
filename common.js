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

// 1つの段の中で、期間が重なるカードを別の行（トラック）に振り分ける（工場は半日単位・ほかの段は1日単位）
function packTracks(list, daily = false) {
  const sk = daily ? (e => e.date_from) : startKey, ek = daily ? (e => e.date_to) : endKey;
  const sorted = [...list].sort((a, b) => sk(a).localeCompare(sk(b)) || ek(b).localeCompare(ek(a)));
  const ends = [];
  for (const e of sorted) {
    let t = ends.findIndex(end => end < sk(e));
    if (t < 0) { t = ends.length; ends.push(ek(e)); } else ends[t] = ek(e);
    e._track = t;
  }
  return { cards: sorted, tracks: ends.length };
}

// 期間の書き方：まる1日なら何も出さない／半日なら「午前」「午後」／何日かなら「11/17午後〜11/18午前」
function spanText(e, daily = false) {
  if (daily) return e.date_to > e.date_from ? `${D.md(e.date_from)}〜${D.md(e.date_to)}` : '';
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

// カードの中身にメリハリ：1行目＝大きく（先頭の樹種はさらに大きく）、2行目から＝小さく
function bodyHtml(body) {
  const lines = String(body ?? '').split(/\r?\n/);
  const first = esc(lines[0]).replace(/^(\s*)(桧|檜|杉|ヒノキ|スギ)/, '$1<span class="c-sp">$2</span>');
  const rest = lines.slice(1).map(esc).join('<br>');
  return `<div class="c-title">${first}</div>${rest ? `<div class="c-rest">${rest}</div>` : ''}`;
}

function cardInner(e, rangeFrom, rangeTo, daily = false) {
  const cutL = e.date_from < rangeFrom, cutR = e.date_to > rangeTo;
  const sp = spanText(e, daily), span = sp ? `<span class="c-span">${sp}</span>` : '';
  const st = e.status !== '予定' ? `<span class="c-st">${esc(e.status)}</span>` : '';
  const auto = e.source === 'queue' ? '<span class="c-auto">自動</span>' : '';
  return `${cutL ? '<span class="c-cut">◀</span>' : ''}${auto}${st}${span}<div class="c-body">${bodyHtml(e.body)}</div>${cutR ? '<span class="c-cut r">▶</span>' : ''}`;
}

function cardClass(e) {
  const stop = e.source === 'queue' && !speciesOf(e.body) ? 'stop' : '';
  return ['card', speciesOf(e.body), stop, e.status === '済' ? 'done' : '', e.status === '中止' ? 'cancel' : '', e.color ? 'hl' : ''].join(' ');
}

// 週表（段×日）。1日を午前・午後の2マスに分ける。何週でも横に1枚でつなげる
// editable なら空いたマスを押してカードを足せる
function renderWeekGrid({ from, days = 7, lanes, entries, holidays = {}, stops = {}, editable = false, showAll = false }) {
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
    const factory = lane.kind === '工場';
    const daily = !factory;   // 工場（飛鳥・本社）だけ午前・午後。ほかの段は1日単位
    const { cards, tracks } = packTracks(inRange.filter(e => e.lane_id === lane.id), daily);
    // どの段も1段。重なるカードがあるときだけ行が増える（空いたマスを押して足す）
    const n = Math.max(1, tracks);
    const empty = !cards.length && !factory ? ' empty' : '';   // 空の段（印刷では省く。工場は空でも残す）
    html += `<div class="g-lane k-${esc(lane.kind)}${empty}" style="grid-row:${row} / span ${n + (factory ? 1 : 0)}">${esc(lane.name)}</div>`;
    if (factory) {
      // 製材機を止める日の行（押すと止める／もう一度押すと戻す）
      dayList.forEach((d, i) => {
        for (let k = 0; k < 2; k++) {
          const lb = stops[`${lane.id}|${d}|${k}`];
          html += `<div class="g-stop${lb ? ' on' : ''}${k ? ' pm' : wk(i)}${isOffDay(d, holidays) ? ' off' : ''}" style="grid-row:${row};grid-column:${i * 2 + 2 + k}"` +
            (editable ? ` data-stop-lane="${lane.id}" data-date="${d}" data-half="${k}" title="${D.md(d)} ${HALF[k]}：${lb ? esc(lb) + '（押すと戻す）' : '押すと製材機を止める'}"` : (lb ? ` title="${esc(lb)}"` : '')) +
            `>${lb ? (k === 0 || !stops[`${lane.id}|${d}|0`] ? esc(lb.slice(0, 6)) : '') : ''}</div>`;
        }
      });
      row += 1;
    }
    for (let t = 0; t < n; t++) {
      if (daily) {   // 1日＝1マス
        dayList.forEach((d, i) => {
          html += `<div class="g-cell ${dayClass(d, holidays)}${wk(i)}${t === n - 1 ? ' last' : ''}${empty}" style="grid-row:${row + t};grid-column:${i * 2 + 2} / span 2"` +
            (editable ? ` data-lane="${lane.id}" data-date="${d}" data-half="0" title="${D.md(d)}"` : '') + '></div>';
        });
        continue;
      }
      dayList.forEach((d, i) => {
        for (let k = 0; k < 2; k++) {
          const stopped = factory && stops[`${lane.id}|${d}|${k}`] ? ' stopped' : '';
          html += `<div class="g-cell ${dayClass(d, holidays)}${k ? ' pm' : wk(i)}${t === n - 1 ? ' last' : ''}${empty}${stopped}" style="grid-row:${row + t};grid-column:${i * 2 + 2 + k}"` +
            (editable ? (factory ? ` data-stop-lane="${lane.id}" data-date="${d}" data-half="${k}" title="${D.md(d)} ${HALF[k]}：押すと製材機を止める／戻す"`
                                 : ` data-lane="${lane.id}" data-date="${d}" data-half="${k}" title="${D.md(d)} ${HALF[k]}"`) : '') + '></div>';
        }
      });
    }
    for (const e of cards) {
      const c1 = Math.max(0, D.diff(from, e.date_from) * 2 + (daily ? 0 : fh(e))) + 2;
      const c2 = Math.min(days * 2 - 1, D.diff(from, e.date_to) * 2 + (daily ? 1 : th(e))) + 3;
      html += `<div class="${cardClass(e)}" data-id="${e.id}" style="grid-row:${row + e._track};grid-column:${c1} / ${c2}">${cardInner(e, from, to, daily)}</div>`;
    }
    row += n;
  }
  html += '</div>';
  return html;
}

// スマホ用：日ごとの一覧
function renderDayList({ from, days, lanes, entries, holidays = {}, stops = {}, editable = false }) {
  const byId = Object.fromEntries(lanes.map(l => [l.id, l]));
  let html = '<div class="daylist">';
  for (let i = 0; i < days; i++) {
    const d = D.add(from, i);
    const todays = entries.filter(e => e.date_from <= d && e.date_to >= d)
      .sort((a, b) => (byId[a.lane_id]?.sort ?? 999) - (byId[b.lane_id]?.sort ?? 999) || startKey(a).localeCompare(startKey(b)));
    html += `<section class="dl-day ${dayClass(d, holidays)}"><h3>${D.md(d)}<small>（${D.wd(d)}）${holidays[d] ? esc(holidays[d]) : ''}</small>` +
      (editable ? `<button class="dl-add" data-date="${d}">＋</button>` : '') + '</h3>';
    const stopNames = lanes.filter(l => l.kind === '工場').map(l => {
      const a = stops[`${l.id}|${d}|0`], p = stops[`${l.id}|${d}|1`];
      return a || p ? `${esc(l.name)}：${esc(a || p)}（${a && p ? '1日' : a ? '午前' : '午後'}）` : '';
    }).filter(Boolean);
    if (stopNames.length) html += `<p class="dl-stop">■ 製材機を止める　${stopNames.join('　')}</p>`;
    if (!todays.length) html += '<p class="dl-none">予定なし</p>';
    let last = null;
    for (const e of todays) {
      const lane = byId[e.lane_id];
      if (lane && lane.id !== last) { html += `<div class="dl-lane k-${esc(lane.kind)}">${esc(lane.name)}</div>`; last = lane.id; }
      html += `<div class="${cardClass(e)}" data-id="${e.id}">${cardInner(e, d, d, !lane || lane.kind !== '工場').replace(/<span class="c-cut[^>]*>.<\/span>/g, '')}</div>`;
    }
    html += '</section>';
  }
  return html + '</div>';
}

// 週表を出す（2週でも横に1枚でつなげる。印刷も1枚）
function renderWeeks(opts) {
  return `<div class="week block">${renderWeekGrid(opts)}</div>`;
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

// ===== 生産順 → 予定表のバー =====
// 半日の枠 {day, half}。日曜・社休日は飛ばす
const isOffDay = (day, holidays) => D.isSun(day) || !!holidays[day];
const slotNext = s => (s.half ? { day: D.add(s.day, 1), half: 0 } : { day: s.day, half: 1 });
// stops＝その工場の止める半日（Set of '日|半日'）
function slotWork(s, holidays, stops) {
  let x = { ...s };
  for (let i = 0; i < 400; i++) {
    if (isOffDay(x.day, holidays)) x = { day: D.add(x.day, 1), half: 0 };
    else if (stops && stops.has(`${x.day}|${x.half}`)) x = slotNext(x);
    else break;
  }
  return x;
}
const slotKey = s => s.day + s.half;
const slotText = s => `${D.md(s.day)}${HALF[s.half]}`;

// 径の書き方：24〜26 → 「24-26㎝」、下だけ → 「30㎝↑」、上だけ → 「22㎝↓」
function diaText(it) {
  if (!it.dia_from && !it.dia_to) return '';
  if (it.dia_from && !it.dia_to) return `${it.dia_from}㎝↑`;
  if (!it.dia_from) return `${it.dia_to}㎝↓`;
  if (it.dia_from === it.dia_to) return `${it.dia_from}㎝`;
  return `${it.dia_from}-${it.dia_to}㎝`;
}
const qtyText = it => (it.qty ? `${+it.qty}${it.unit === '㎥' ? '㎥' : '本'}` : '');
// 生産順カードの見出し（予定表のバーの1行目にもなる）
function queueTitle(it) {
  if (it.kind === '止め') return it.memo.split(/\r?\n/)[0] || '止め';
  return [`${it.species || ''}${it.length_m ? +it.length_m + 'M' : ''}`, diaText(it), qtyText(it)].filter(Boolean).join(' ');
}
function queueBody(it) {
  if (it.kind === '止め') return it.memo || '止め';
  return queueTitle(it) + (it.memo ? '\n' + it.memo : '');
}

// 挽く速さ（本/日・㎥/日）を探す：工場×樹種×長さ×径級 → 工場×樹種×長さ → 工場×樹種 → 工場
function findSpeed(speed, factory, it) {
  const rows = speed.filter(r => r.factory === factory);
  const sp = it.species || '*', len = Number(it.length_m || 0);
  const dia = it.dia_from && it.dia_to ? (it.dia_from + it.dia_to) / 2 : (it.dia_from ? it.dia_from + 2 : it.dia_to ? it.dia_to - 2 : 0);
  const exact = rows.filter(r => r.species === sp && Number(r.length_m) === len && r.dia_cm > 0);
  if (dia && exact.length) {
    const best = exact.reduce((a, b) => (Math.abs(b.dia_cm - dia) < Math.abs(a.dia_cm - dia) ? b : a));
    return { ...best, level: `${factory}の${sp}${len}M ${best.dia_cm}㎝` };
  }
  const byLen = rows.find(r => r.species === sp && Number(r.length_m) === len && r.dia_cm === 0);
  if (byLen) return { ...byLen, level: `${factory}の${sp}${len}M（径はまとめ）` };
  const bySp = rows.find(r => r.species === sp && Number(r.length_m) === 0 && r.dia_cm === 0);
  if (bySp) return { ...bySp, level: `${factory}の${sp}（まとめ）` };
  const any = rows.filter(r => r.dia_cm === 0 && Number(r.length_m) === 0);
  if (any.length) return { ...any[0], level: `${factory}（まとめ）` };
  return null;
}

// 1枚のカードにかかる半日の数（手で決めていればそれ）
function estimateHalves(it, factory, speed) {
  if (it.halves_manual) return { halves: it.halves_manual, manual: true };
  if (it.kind === '止め') return { halves: 2, manual: false };
  const s = findSpeed(speed, factory, it);
  if (!s || !it.qty) return { halves: 2, manual: false, speed: s };
  const perDay = it.unit === '㎥' ? Number(s.m3_day) : Number(s.per_day);
  if (!perDay) return { halves: 2, manual: false, speed: s };
  return { halves: Math.max(1, Math.round(Number(it.qty) / perDay * 2)), manual: false, speed: s, perDay };
}
const halvesText = h => (h % 2 ? (h === 1 ? '半日' : `${(h / 2).toFixed(1)}日`) : `${h / 2}日`);

// 生産順を上から並べる。start＝最初のカードが始まる枠
function scheduleQueue(items, start, factory, holidays, speed, stops) {
  let s = slotWork(start, holidays, stops);
  return items.map(it => {
    const est = estimateHalves(it, factory, speed);
    const from = s;
    let to = s;
    for (let k = 1; k < est.halves; k++) to = slotWork(slotNext(to), holidays, stops);
    s = slotWork(slotNext(to), holidays, stops);
    return { item: it, from, to, ...est };
  });
}
