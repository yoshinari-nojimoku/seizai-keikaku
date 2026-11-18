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

// 1つの段の中で、期間が重なるカードを別の行（トラック）に振り分ける
function packTracks(list) {
  const sorted = [...list].sort((a, b) => a.date_from.localeCompare(b.date_from) || b.date_to.localeCompare(a.date_to));
  const ends = [];
  for (const e of sorted) {
    let t = ends.findIndex(end => end < e.date_from);
    if (t < 0) { t = ends.length; ends.push(e.date_to); } else ends[t] = e.date_to;
    e._track = t;
  }
  return { cards: sorted, tracks: ends.length };
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
  const span = e.date_to > e.date_from ? `<span class="c-span">${D.md(e.date_from)}〜${D.md(e.date_to)}</span>` : '';
  const st = e.status !== '予定' ? `<span class="c-st">${esc(e.status)}</span>` : '';
  return `${cutL ? '<span class="c-cut">◀</span>' : ''}${st}${span}<div class="c-body">${esc(e.body).replace(/\n/g, '<br>')}</div>${cutR ? '<span class="c-cut r">▶</span>' : ''}`;
}

function cardClass(e) {
  return ['card', speciesOf(e.body), e.status === '済' ? 'done' : '', e.status === '中止' ? 'cancel' : '', e.color ? 'hl' : ''].join(' ');
}

// 1週間分の週表（段×日）。editable なら空いたマスを押してカードを足せる
function renderWeekGrid({ from, days = 7, lanes, entries, holidays = {}, editable = false, showAll = false }) {
  const to = D.add(from, days - 1);
  const inRange = entries.filter(e => e.date_from <= to && e.date_to >= from);
  const ls = visibleLanes(lanes, inRange, showAll);
  const dayList = Array.from({ length: days }, (_, i) => D.add(from, i));
  let html = `<div class="grid" style="--days:${days}">`;
  html += `<div class="g-corner">${D.md(from)}〜${D.md(to)}</div>`;
  dayList.forEach((d, i) => {
    html += `<div class="g-day ${dayClass(d, holidays)}" style="grid-column:${i + 2}">${D.md(d)}<small>${D.wd(d)}${holidays[d] ? '・' + esc(holidays[d]) : ''}</small></div>`;
  });
  let row = 2;
  for (const lane of ls) {
    const { cards, tracks } = packTracks(inRange.filter(e => e.lane_id === lane.id));
    const n = Math.max(1, tracks + (editable ? 1 : 0));
    const empty = !cards.length && lane.kind !== '工場' ? ' empty' : '';   // 空の段（印刷では省く。工場は空でも残す）
    html += `<div class="g-lane k-${esc(lane.kind)}${empty}" style="grid-row:${row} / span ${n}">${esc(lane.name)}</div>`;
    for (let t = 0; t < n; t++) {
      dayList.forEach((d, i) => {
        html += `<div class="g-cell ${dayClass(d, holidays)}${t === n - 1 ? ' last' : ''}${empty}${editable && t === n - 1 && n > 1 ? ' spare' : ''}" style="grid-row:${row + t};grid-column:${i + 2}"` +
          (editable ? ` data-lane="${lane.id}" data-date="${d}"` : '') + '></div>';
      });
    }
    for (const e of cards) {
      const c1 = Math.max(0, D.diff(from, e.date_from)) + 2;
      const c2 = Math.min(days - 1, D.diff(from, e.date_to)) + 3;
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
      .sort((a, b) => (byId[a.lane_id]?.sort ?? 999) - (byId[b.lane_id]?.sort ?? 999) || a.date_from.localeCompare(b.date_from));
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

// 期間を1週ずつに分けた週表を並べる（画面でも印刷でも1週＝1枚）
function renderWeeks(opts) {
  const weeks = Math.ceil(opts.days / 7);
  let html = '';
  for (let w = 0; w < weeks; w++) {
    html += `<div class="week">${renderWeekGrid({ ...opts, from: D.add(opts.from, w * 7), days: 7 })}</div>`;
  }
  return html;
}
