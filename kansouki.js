// 乾燥機（2026-11-22）：各乾燥機の今の状況を見る（読むだけ）
// データはザイコノジステム2（乾燥機投入。入力は樋口さん）→ Edge Function kansouki_status → ここ。
// Access の乾燥機DB 2.41 は使わない。

const KS = { data: null, error: '', sample: false };

// 見本（ダミー）：ザイコ2の本番に乾燥機APIが入るまでの仮。日付は今日から数えて作るので、いつ開いても「乾燥中」が出る。
// 中身は架空（NIDも作り物）。本番に入れば自動で本物に切り替わり、これは使われなくなる。
function ksSample() {
  const t = D.today(), d = n => D.add(t, n);
  const m = (nid, juushu, atsu, haba, nagasa, tougyuu, suuryou) =>
    ({ nid, juushu, atsu, haba, nagasa, tougyuu, suuryou, zaiseki_m3: Math.round(atsu * haba * nagasa * suuryou / 1e6) / 1e3 });
  const b = (id, kansouki, a, z, program, meisai) => ({ kansou_id: id, kansouki, kaishibi: d(a), shuuryoubi: d(z), program, nyuukosha: '見本', bikou: '', meisai });
  const names = ['1号', '3号', '本社除湿', '6号', '7号', '倉庫セカンド', '飛鳥', '飛鳥セカンド', '鮒田セカンド', 'エフバイオス', '配送センター除湿'];
  return {
    generated_at: null, today: t, sample: true,
    kilns: names.map(name => ({ name, koujou: '' })),
    batches: [
      b(9001, '7号', -8, 3, '杉37', [m('A26-1101-301', '杉', 37, 120, 4000, '節', 210), m('A26-1101-302', '杉', 37, 120, 4000, '節', 210), m('A26-1102-305', '杉', 37, 105, 4000, '節', 240), m('A26-1103-301', '杉', 37, 150, 4000, '上小', 160)]),
      b(9002, '6号', -6, 1, '桧構造', [m('A26-1104-311', '桧', 105, 105, 3000, '特一等', 60), m('A26-1104-312', '桧', 105, 105, 3000, '特一等', 60), m('A26-1105-301', '杉', 50, 150, 4000, '節', 90)]),
      b(9003, '飛鳥', -5, 0, '桧薄板', [m('A26-1106-321', '桧', 16, 140, 4000, 'ム・上', 400), m('A26-1106-322', '桧', 16, 175, 4000, 'ム・上', 320), m('A26-1107-301', '桧', 19, 140, 2000, '節', 500)]),
      b(9004, 'エフバイオス', -3, 4, '杉構造', [m('A26-1108-301', '杉', 105, 105, 3000, '特一等', 80), m('A26-1108-302', '杉', 105, 105, 3000, '特一等', 80), m('A26-1108-303', '杉', 120, 120, 4000, '特一等', 50), m('A26-1109-301', '杉', 105, 105, 4000, '特一等', 80), m('A26-1109-302', '杉', 45, 105, 4000, '特一等', 200)]),
      b(9005, '3号', -10, 2, '杉赤', [m('A26-1110-301', '杉', 32, 150, 4000, '赤節', 260), m('A26-1110-302', '杉', 32, 150, 4000, '赤節', 260)]),
      b(9006, '1号', -12, -2, '桧', [m('A26-1031-301', '桧', 30, 120, 3000, '節', 200)]),
      b(9007, '1号', 2, 10, '桧', [m('A26-1111-301', '桧', 30, 120, 3000, '節', 200)]),
      b(9008, '倉庫セカンド', -20, 25, '天乾後', [m('A26-1001-301', '杉', 25, 120, 4000, '節', 300), m('A26-1001-302', '杉', 25, 150, 4000, '節', 260)]),
    ],
  };
}
// 乾燥機の置き場所（ザイコ2が工場名を返さないときの補い。乾燥機計画 config.py の KILN_SITE と同じ）
const KILN_SITE = { '7号': '第2倉庫', '6号': '第2倉庫', '倉庫セカンド': '第2倉庫', '3号': '本社', '1号': '本社', '本社除湿': '本社',
  '飛鳥': '飛鳥工場', '飛鳥セカンド': '飛鳥工場', '鮒田セカンド': '鮒田工場', 'エフバイオス': 'エフバイオス', '配送センター除湿': '配送センター' };
const SITE_ORDER = ['本社', '第2倉庫', '飛鳥工場', '鮒田工場', 'エフバイオス', '配送センター'];

async function ksLoad() {
  const box = $('kansouki-view');
  box.innerHTML = '<div class="block msg">読み込み中…</div>';
  KS.error = '';
  try {
    if (!Store.remote) {
      KS.data = typeof SAMPLE !== 'undefined' && SAMPLE.kansouki ? SAMPLE.kansouki : null;
      if (!KS.data) KS.error = '試作モードの見本がありません';
    } else {
      const { data, error } = await Store.sb.functions.invoke('kansouki_status', { body: { days: 30 } });
      if (error) {
        let m = error.message;
        try { const b = await error.context.json(); if (b && b.error) m = b.error; } catch (e) {}
        throw new Error(m);
      }
      KS.sample = !!data.notReady;
      if (data.notReady) { KS.data = ksSample(); KS.error = data.error; }   // 本番に入るまでは見本を出す
      else KS.data = data;
    }
  } catch (e) { KS.data = null; KS.error = e.message; }
  ksDraw();
}

const ksDate = s => (s ? D.md(String(s).slice(0, 10)) : '―');
function ksStatus(b, today) {
  const a = String(b.kaishibi).slice(0, 10), z = String(b.shuuryoubi).slice(0, 10);
  if (a > today) return 'これから';
  if (z < today) return '乾燥済';
  return '乾燥中';
}
// 中身のまとめ：樹種・寸法・長さ・等級ごとに ロット数と枚数
function ksSummary(meisai) {
  const g = {};
  for (const m of meisai || []) {
    const k = [m.juushu || '', m.atsu && m.haba ? `${m.atsu}×${m.haba}` : '', m.nagasa ? (m.nagasa / 1000) + 'M' : '', m.tougyuu || ''].join(' ').trim() || (m.hinmei || m.nid || '');
    g[k] = g[k] || { k, sp: m.juushu || '', lots: 0, n: 0, m3: 0 };
    g[k].lots++; g[k].n += Number(m.suuryou || 0); g[k].m3 += Number(m.zaiseki_m3 || 0);
  }
  return Object.values(g).sort((a, b) => b.m3 - a.m3 || b.lots - a.lots);
}

function ksDraw() {
  const box = $('kansouki-view');
  const head = `<div class="ks-head block"><img class="gb-ill" src="${ILLUST.kiln}" alt="乾燥機のイラスト">` +
    `<div class="gb-sum"><div class="gb-title dg">乾燥機</div><div class="gb-meta" id="ks-meta"></div></div>` +
    `<div class="gb-acts"><button class="bigbtn dg" id="ks-reload">読み直す</button></div></div>`;
  if (!KS.data) {
    box.innerHTML = head + '<div id="kp-box"></div>' + `<div class="block msg">${esc(KS.error || 'データがありません')}<br><small>乾燥機の入庫・出庫は、ザイコノジステム2の「乾燥機投入」に入力します（樋口さん）。</small></div>`;
    kpLoad();
    return;
  }
  const today = D.today();
  const kilns = (KS.data.kilns || []).map(k => ({ ...k, site: k.koujou || KILN_SITE[k.name] || 'そのほか' }));
  const byKiln = {};
  for (const b of KS.data.batches || []) {
    const name = b.kansouki;
    if (!kilns.some(k => k.name === name)) kilns.push({ name, site: b.koujou || KILN_SITE[name] || 'そのほか' });
    (byKiln[name] = byKiln[name] || []).push({ ...b, st: ksStatus(b, today) });
  }
  const sites = [...new Set(kilns.map(k => k.site))].sort((a, b) => (SITE_ORDER.indexOf(a) + 99) % 99 - (SITE_ORDER.indexOf(b) + 99) % 99);
  let nNow = 0, nFree = 0;
  const outSoon = [];
  const cards = sites.map(site => {
    const ks = kilns.filter(k => k.site === site);
    return `<div class="ks-site"><div class="ks-site-h dg">${esc(site)}</div><div class="ks-grid">` + ks.map(k => {
      const list = (byKiln[k.name] || []).sort((a, b) => String(b.kaishibi).localeCompare(String(a.kaishibi)));
      const now = list.find(b => b.st === '乾燥中');
      const next = list.filter(b => b.st === 'これから').sort((a, b) => String(a.kaishibi).localeCompare(String(b.kaishibi)))[0];
      const last = list.find(b => b.st === '乾燥済');
      if (now) nNow++; else nFree++;
      let body;
      if (now) {
        const total = Math.max(1, D.diff(String(now.kaishibi).slice(0, 10), String(now.shuuryoubi).slice(0, 10)));
        const done = Math.min(total, Math.max(0, D.diff(String(now.kaishibi).slice(0, 10), today)));
        const left = D.diff(today, String(now.shuuryoubi).slice(0, 10));
        if (left <= 1) outSoon.push(`${k.name}（${left <= 0 ? '今日' : '明日'}）`);
        const sum = ksSummary(now.meisai);
        const lots = (now.meisai || []).length, m3 = sum.reduce((a, x) => a + x.m3, 0);
        body = `<div class="ks-dates"><b>${ksDate(now.kaishibi)}</b> 入れ → <b>${ksDate(now.shuuryoubi)}</b> 出し予定</div>` +
          `<div class="ks-bar"><i style="width:${Math.round(done / total * 100)}%"></i></div>` +
          `<div class="ks-left">${left <= 0 ? '今日出庫' : `あと <b>${left}</b> 日`}<span>${now.program ? 'プログラム ' + esc(now.program) : ''}</span></div>` +
          `<div class="ks-tot">${lots}ロット${m3 ? `・${m3.toFixed(1)}㎥` : ''}</div>` +
          sum.slice(0, 4).map(x => `<div class="ks-line"><span class="c-sp ${x.sp === '桧' ? 'h' : x.sp === '杉' ? 's' : ''}">${esc(x.sp)}</span>${esc(x.k.replace(x.sp, '').trim())}<em>${x.lots}ロット ${x.n}枚</em></div>`).join('') +
          (sum.length > 4 ? `<div class="ks-more">ほか ${sum.length - 4} 種類…</div>` : '');
      } else {
        body = `<div class="ks-empty">空いています</div>`;
      }
      const foot = [next ? `次：${ksDate(next.kaishibi)} 入れ予定` : '', last ? `前回：${ksDate(last.shuuryoubi)} 出庫` : ''].filter(Boolean).join('　');
      const st = now ? (D.diff(today, String(now.shuuryoubi).slice(0, 10)) <= 0 ? 'out' : 'on') : 'free';
      return `<button class="ks-card block ${st}" data-kiln="${esc(k.name)}"><div class="ks-name"><b class="dg">${esc(k.name)}</b>` +
        `<span class="ks-badge ${st}">${st === 'on' ? '乾燥中' : st === 'out' ? '今日出庫' : '空き'}</span></div>${body}` +
        (foot ? `<div class="ks-foot">${foot}</div>` : '') + '</button>';
    }).join('') + '</div></div>';
  }).join('');
  const note = KS.sample ? `<div class="block msg" style="max-width:none;margin:0 0 16px;padding:14px 18px;border:3px dashed #953525">` +
    `これは<b>見本（ダミー）</b>です。中身は作り物です。<br><small>${esc(KS.error || '')}／社長の本番反映が済むと、自動で本物（樋口さんの入力）に切り替わります。</small></div>` : '';
  box.innerHTML = head + '<div id="kp-box"></div>' + note + cards;   // 予定表が上・各乾燥機の今はその下（2026-11-28 専務）
  kpLoad();
  $('ks-meta').innerHTML = `乾燥中 <b>${nNow}</b> 基・空き <b>${nFree}</b> 基` + (outSoon.length ? `<br>もうすぐ出庫：${esc(outSoon.join('・'))}` : '') +
    `<br><small>${KS.sample ? '見本（ダミー）' : 'ザイコノジステム2より'}${KS.data.generated_at ? '／' + new Date(KS.data.generated_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</small>`;
}

// 乾燥機を押す → その乾燥機の中身（NIDごと）
function ksPop(name, anchor) {
  const today = D.today();
  const list = (KS.data.batches || []).filter(b => b.kansouki === name).map(b => ({ ...b, st: ksStatus(b, today) }))
    .sort((a, b) => String(b.kaishibi).localeCompare(String(a.kaishibi))).slice(0, 3);
  closeCardPop();
  const pop = document.createElement('div');
  pop.className = 'cardpop block ks-pop';
  pop.innerHTML = `<div class="cp-head"><b>${esc(name)}</b><span>${esc(KILN_SITE[name] || '')}</span><button type="button" class="cp-x">×</button></div>` +
    (list.length ? list.map(b => `<div class="ks-pb"><div class="ks-pbh"><span class="ks-badge ${b.st === '乾燥中' ? 'on' : 'free'}">${b.st}</span> ` +
      `${ksDate(b.kaishibi)} → ${ksDate(b.shuuryoubi)}${b.program ? '／プログラム ' + esc(b.program) : ''}${b.nyuukosha ? '／' + esc(b.nyuukosha) : ''}</div>` +
      `<table class="gb-t"><thead><tr><th>NID</th><th>品名</th><th>枚数</th></tr></thead><tbody>` +
      (b.meisai || []).map(m => `<tr><td class="dia">${esc(m.nid ? m.nid.replace(/^(\w)(\d{2})(\d{4})(\d+)$/, '$1$2-$3-$4') : '')}</td>` +
        `<td style="text-align:left">${esc(m.hinmei || [m.juushu, m.atsu && m.haba ? m.atsu + '×' + m.haba : '', m.nagasa ? m.nagasa / 1000 + 'M' : '', m.tougyuu].filter(Boolean).join(' '))}</td><td>${m.suuryou ?? ''}</td></tr>`).join('') +
      `</tbody></table>${b.bikou ? `<div class="hint">備考：${esc(b.bikou)}</div>` : ''}</div>`).join('') : '<p class="hint">記録がありません</p>');
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.left = Math.min(Math.max(8, r.left), innerWidth - pop.offsetWidth - 8) + 'px';
  pop.style.top = Math.max(8, Math.min(r.bottom + 6, innerHeight - pop.offsetHeight - 8)) + 'px';
  pop.querySelector('.cp-x').onclick = closeCardPop;
}

document.addEventListener('click', ev => {
  if (!ev.target.closest('#kansouki-view')) return;
  if (ev.target.closest('#ks-reload')) return ksLoad();
  const c = ev.target.closest('[data-kiln]');
  if (c && KS.data) { ev.stopPropagation(); ksPop(c.dataset.kiln, c); }
});
