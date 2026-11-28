// 乾燥機の予定表（2026-11-28）：乾燥機スケジュール表（スプシ「ガントチャート」）の代わり。
// 行＝乾燥機・列＝日。バーは入庫日〜出庫日の前日（出庫日のマスは次の便の入庫に使う）。
// 書けるのは専務と kiln_writers の人（樋口さん）。表は kiln_plans（supabase/kansouki_plans.sql）。
// 色はスプシと同じ：桧＝オレンジ・杉＝水色・段取り済＝ピンク（別の担当者が段取りした印）・青・白。

const KP_GROUPS = [
  { name: '本社', kilns: ['3号'] },
  { name: '飛鳥工場', kilns: ['飛鳥'] },
  { name: '第2倉庫', kilns: ['6号', '7号'] },   // 除湿右・左／飛鳥 元除湿右／5号／ウッドピアは使わない（2026-11-28 専務）
  { name: 'セカンド（太陽熱）', kilns: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => (i < 4 ? '飛鳥セカンド' : i < 7 ? '鮒田セカンド' : '倉庫セカンド') + i + '号') },
];
const KP_KILNS = KP_GROUPS.flatMap(g => g.kilns);
const KP_COLORS = { '桧': '#F6B26B', '杉': '#A6DCF5', '段取り済': '#ECA3BD', '青': '#C9DAF8', '白': '#FFFFFF' };
// 新しく入れるときの乾燥日数の目安（入庫日→出庫日）
const KP_DAYS = { '3号': 6, '飛鳥': 6, '6号': 7, '7号': 12 };
const kpDefaultDays = k => KP_DAYS[k] || (k.includes('セカンド') ? 90 : 6);

const KP = { from: D.add(D.monday(D.today()), -7), days: Number(localStorage.getItem('kp-days') || 28), plans: [], mem: null, error: '', edit: null };

async function kpLoad() {
  const box = document.getElementById('kp-box');
  if (!box) return;
  const to = D.add(KP.from, KP.days);
  KP.error = '';
  try {
    if (!Store.remote) {
      if (!KP.mem) KP.mem = kpSample();
      KP.plans = KP.mem.filter(p => p.date_from < to && p.date_to > KP.from);
      KP.hasMeisai = true;
    } else {
      const { data, error } = await Store.sb.from('kiln_plans').select('*').lt('date_from', to).gt('date_to', KP.from).order('date_from');
      if (error) throw new Error(/kiln_plans/.test(error.message) ? '予定表の準備がまだです（DBに表を作る操作が済んでいません）' : error.message);
      KP.plans = data;
      KP.hasMeisai = data.length ? 'meisai' in data[0] : KP.hasMeisai;
    }
  } catch (e) { KP.plans = []; KP.error = e.message; }
  kpDraw();
}

function kpDraw() {
  const box = document.getElementById('kp-box');
  if (!box) return;
  const N = KP.days, today = D.today();
  const days = Array.from({ length: N }, (_, i) => D.add(KP.from, i));
  const off = d => (typeof isOffDay === 'function' ? isOffDay(d, Store.holidays || {}) : D.isSun(d));
  const tools = `<div class="kp-tools"><b class="dg kp-title">乾燥機の予定</b>` +
    `<button class="btn" data-kp="prev">◀ 2週前</button><button class="btn" data-kp="today">今日</button><button class="btn" data-kp="next">2週後 ▶</button>` +
    `<span class="kp-range">${D.md(KP.from)}〜${D.md(D.add(KP.from, N - 1))}</span>` +
    `<button class="btn ${N === 28 ? 'on' : ''}" data-kp="w4">4週</button><button class="btn ${N === 56 ? 'on' : ''}" data-kp="w8">8週</button>` +
    `<span class="kp-hint">空いたマスを押すと予定を足せます。バーを押すと直せます。</span></div>`;
  if (KP.error) { box.innerHTML = tools + `<div class="block msg">${esc(KP.error)}</div>`; return; }
  const cols = `grid-template-columns: 118px repeat(${N}, minmax(30px, 1fr))`;
  let h = `<div class="kp-scroll block"><div class="kp-grid" style="${cols}">`;
  // 見出し：月日・曜日
  h += `<div class="kp-corner" style="grid-row: 1 / span 2">乾燥機</div>`;
  days.forEach((d, i) => {
    const dt = D.parse(d), first = i === 0 || dt.getDate() === 1;
    h += `<div class="kp-dh ${off(d) ? 'off' : ''} ${d === today ? 'today' : ''}" style="grid-column:${i + 2};grid-row:1">${first ? `<small>${dt.getMonth() + 1}月</small>` : ''}${dt.getDate()}</div>` +
      `<div class="kp-wd ${off(d) ? 'off' : ''} ${d === today ? 'today' : ''}" style="grid-column:${i + 2};grid-row:2">${D.wd(d)}</div>`;
  });
  let row = 3;
  for (const g of KP_GROUPS) {
    h += `<div class="kp-group" style="grid-column:1;grid-row:${row}">${esc(g.name)}</div><div class="kp-group-fill" style="grid-column: 2 / span ${N};grid-row:${row}"></div>`;
    row++;
    for (const k of g.kilns) {
      const list = KP.plans.filter(p => p.kiln === k).sort((a, b) => a.date_from.localeCompare(b.date_from));
      // 重なるバーは段を分ける
      const tracks = [];
      for (const p of list) {
        let t = tracks.findIndex(end => end <= p.date_from);
        if (t < 0) { t = tracks.length; tracks.push(''); }
        tracks[t] = p.date_to; p._t = t;
      }
      const nt = Math.max(1, tracks.length), sec = k.includes('セカンド');
      const span = `grid-row:${row} / span ${nt}`;
      h += `<div class="kp-kiln ${sec ? 'sec' : ''}" style="grid-column:1;${span}">${esc(k)}</div>`;
      days.forEach((d, i) => { h += `<div class="kp-cell ${off(d) ? 'off' : ''} ${d === today ? 'today' : ''} ${sec ? 'sec' : ''}" data-kiln="${esc(k)}" data-day="${d}" style="grid-column:${i + 2};${span}"></div>`; });
      for (const p of list) {
        const a = Math.max(0, D.diff(KP.from, p.date_from)), z = Math.min(N, D.diff(KP.from, p.date_to));   // z＝出庫日（含まない）
        if (z <= a) continue;
        const cutL = p.date_from < KP.from, cutR = p.date_to > D.add(KP.from, N);
        const lines = (p.body || '').split('\n');
        h += `<button class="kp-bar ${sec ? 'sec' : ''} ${cutL ? 'cl' : ''} ${cutR ? 'cr' : ''}" data-plan="${esc(p.id)}" title="${esc(p.body)}" ` +
          `style="grid-column:${a + 2} / ${z + 2};grid-row:${row + p._t};background:${KP_COLORS[p.color] || '#fff'}">` +
          `<span class="kp-b1">${esc(lines[0] || '（中身なし）')}${p.done ? ' <i class="kp-done">済</i>' : ''}</span>` +
          (sec ? '' : lines.slice(1, 3).map(l => `<span class="kp-bl">${esc(l)}</span>`).join('')) +
          ((p.meisai || []).length && !sec ? `<span class="kp-lots">${p.meisai.length}ロット</span>` : '') +
          (p.idou_sumi ? `<span class="kp-idou">出後の移動先済</span>` : '') +
          `<span class="kp-out">${D.md(p.date_to)}出</span>${cutR ? '' : '<span class="kp-grip" title="右へ・左へ引いて日数を変える"></span>'}</button>`;
      }
      row += nt;
    }
  }
  h += '</div></div>';
  box.innerHTML = tools + h + (Store.remote ? '' : '<p class="kp-hint" style="color:var(--cream)">試作モード：見本の予定です（保存されません）</p>');
  const t = box.querySelector('.kp-dh.today');
  if (t) box.querySelector('.kp-scroll').scrollLeft = Math.max(0, t.offsetLeft - 160);
}

// ---- 予定の窓（足す・直す） ----
function kpDialog() {
  let dlg = document.getElementById('kpdlg');
  if (dlg) return dlg;
  dlg = document.createElement('dialog');
  dlg.id = 'kpdlg';
  dlg.innerHTML = `<form method="dialog" class="dlg-one block kp-dlg">
    <h2 id="kp-title">乾燥機の予定</h2>
    <label>乾燥機</label><select id="kp-kiln">${KP_GROUPS.map(g => `<optgroup label="${esc(g.name)}">${g.kilns.map(k => `<option>${esc(k)}</option>`).join('')}</optgroup>`).join('')}</select>
    <div class="row2"><div><label>入庫日</label><input type="date" id="kp-from" required></div><div><label>出庫日</label><input type="date" id="kp-to" required></div></div>
    <p class="hint" id="kp-warn"></p>
    <label>中身</label><textarea id="kp-body" placeholder="例）桧　13〜19㎜系&#10;16山（12/7出）"></textarea>
    <label>色</label><div class="seg" id="kp-color">${Object.keys(KP_COLORS).map(c => `<button type="button" class="dbtn kp-c" data-v="${c}" style="--c:${KP_COLORS[c]}">${c}</button>`).join('')}</div>
    <div class="kp-checks"><label><input type="checkbox" id="kp-done"> 済</label><label><input type="checkbox" id="kp-idou"> 出後の移動先済</label></div>
    <div id="kp-nidbox">
      <label>中身（NID）　<span class="kp-sum" id="kp-sum"></span></label>
      <div class="kp-nidin"><textarea id="kp-nidtext" placeholder="NIDを貼る・打つ（改行・空白・カンマ区切り。A26-1029-303 でも A261029303 でも可）"></textarea>
        <button type="button" class="dbtn primary" id="kp-nidadd">足す</button></div>
      <div class="kp-allto">移動先をまとめて：<select id="kp-allto"><option value="">―</option>${KP_IDOUSAKI.map(x => `<option>${x}</option>`).join('')}</select></div>
      <div class="kp-mtab" id="kp-mtab"></div>
      <p class="hint" id="kp-kijun"></p>
    </div>
    <div class="acts"><button type="button" class="dbtn primary" id="kp-save">保存</button><span class="spacer"></span>
      <button type="button" class="dbtn danger" id="kp-del">削除</button><button type="button" class="dbtn" id="kp-close">閉じる</button></div>
    <p class="hint" id="kp-meta"></p></form>`;
  document.body.appendChild(dlg);
  const warn = () => {
    const w = [];
    for (const [id, name] of [['kp-from', '入庫日'], ['kp-to', '出庫日']]) {
      const v = document.getElementById(id).value;
      if (v && (D.isSun(v) || (Store.holidays || {})[v])) w.push(`${name}（${D.md(v)}）は休みの日です`);
    }
    const f = document.getElementById('kp-from').value, t = document.getElementById('kp-to').value;
    if (f && t) w.push(`乾燥 ${D.diff(f, t)} 日`);
    document.getElementById('kp-warn').textContent = w.join('／');
  };
  dlg.querySelector('#kp-from').onchange = () => {
    const f = dlg.querySelector('#kp-from'), t = dlg.querySelector('#kp-to');
    if (!t.value || t.value <= f.value) t.value = D.add(f.value, kpDefaultDays(dlg.querySelector('#kp-kiln').value));
    warn();
  };
  dlg.querySelector('#kp-to').onchange = warn;
  dlg.querySelector('#kp-color').onclick = ev => { const b = ev.target.closest('.kp-c'); if (b) kpSetColor(b.dataset.v); };
  dlg.querySelector('#kp-save').onclick = kpSave;
  dlg.querySelector('#kp-del').onclick = kpDelete;
  dlg.querySelector('#kp-close').onclick = () => dlg.close();
  dlg.querySelector('#kp-nidadd').onclick = kpNidAdd;
  dlg.querySelector('#kp-allto').onchange = ev => { if (!ev.target.value) return; KP.meisai.forEach(m => { m.idousaki = ev.target.value; }); ev.target.value = ''; kpMeisaiDraw(); };
  dlg.querySelector('#kp-mtab').addEventListener('change', ev => { const t = ev.target.closest('select[data-i]'); if (t) KP.meisai[Number(t.dataset.i)].idousaki = t.value; });
  dlg.querySelector('#kp-mtab').addEventListener('click', ev => { const b = ev.target.closest('[data-del]'); if (b) { KP.meisai.splice(Number(b.dataset.del), 1); kpMeisaiDraw(); } });
  dlg._warn = warn;
  return dlg;
}
function kpSetColor(v) { document.querySelectorAll('#kp-color .kp-c').forEach(b => b.classList.toggle('on', b.dataset.v === v)); }

function kpOpen(p) {
  const dlg = kpDialog();
  KP.edit = p.id ? p : null;
  dlg.querySelector('#kp-title').textContent = p.id ? '乾燥機の予定を直す' : '乾燥機の予定を足す';
  dlg.querySelector('#kp-kiln').value = p.kiln;
  dlg.querySelector('#kp-from').value = p.date_from;
  dlg.querySelector('#kp-to').value = p.date_to;
  dlg.querySelector('#kp-body').value = p.body || '';
  dlg.querySelector('#kp-done').checked = !!p.done;
  dlg.querySelector('#kp-idou').checked = !!p.idou_sumi;
  kpSetColor(p.color || '白');
  dlg.querySelector('#kp-del').classList.toggle('hide', !p.id);
  dlg.querySelector('#kp-meta').textContent = p.id && p.updated_at
    ? `最後に直した人：${p.updated_by || (p.source === 'sheet' ? 'スプシから移した' : '')}（${new Date(p.updated_at).toLocaleString('ja-JP')}）` : '';
  KP.meisai = (p.meisai || []).map(m => ({ ...m }));
  dlg.querySelector('#kp-nidtext').value = '';
  dlg.querySelector('#kp-nidbox').classList.toggle('hide', !KP.hasMeisai);
  kpMeisaiDraw();
  kpLookup(KP.meisai.map(m => m.nid));
  dlg._warn();
  dlg.showModal();
  setTimeout(() => dlg.querySelector('#kp-body').focus(), 50);
}

async function kpSave() {
  const v = id => document.getElementById(id).value;
  const rec = { kiln: v('kp-kiln'), date_from: v('kp-from'), date_to: v('kp-to'), body: v('kp-body').trim(),
    color: (document.querySelector('#kp-color .kp-c.on') || {}).dataset?.v || '白',
    done: document.getElementById('kp-done').checked, idou_sumi: document.getElementById('kp-idou').checked };
  if (KP.hasMeisai) rec.meisai = KP.meisai.map(m => ({ nid: m.nid, idousaki: m.idousaki || '' }));
  if (!rec.date_from || !rec.date_to || rec.date_to <= rec.date_from) return toast('出庫日は入庫日より後にしてください');
  try {
    if (!Store.remote) {
      if (KP.edit) Object.assign(KP.mem.find(p => p.id === KP.edit.id), rec);
      else KP.mem.push({ ...rec, id: 'm' + Date.now() });
    } else if (KP.edit) {
      const { error } = await Store.sb.from('kiln_plans').update(rec).eq('id', KP.edit.id);
      if (error) throw error;
    } else {
      const { error } = await Store.sb.from('kiln_plans').insert(rec);
      if (error) throw error;
    }
  } catch (e) { return toast('保存できませんでした：' + e.message); }
  document.getElementById('kpdlg').close();
  toast('保存しました');
  kpLoad();
}

async function kpDelete() {
  if (!KP.edit || !confirm('この予定を消しますか？（履歴には残ります）')) return;
  try {
    if (!Store.remote) KP.mem = KP.mem.filter(p => p.id !== KP.edit.id);
    else { const { error } = await Store.sb.from('kiln_plans').delete().eq('id', KP.edit.id); if (error) throw error; }
  } catch (e) { return toast('消せませんでした：' + e.message); }
  document.getElementById('kpdlg').close();
  toast('消しました');
  kpLoad();
}

document.addEventListener('click', ev => {
  if (!ev.target.closest('#kp-box')) return;
  const t = ev.target.closest('[data-kp]');
  if (t) {
    const a = t.dataset.kp;
    if (a === 'prev') KP.from = D.add(KP.from, -14);
    if (a === 'next') KP.from = D.add(KP.from, 14);
    if (a === 'today') KP.from = D.add(D.monday(D.today()), -7);
    if (a === 'w4' || a === 'w8') { KP.days = a === 'w4' ? 28 : 56; try { localStorage.setItem('kp-days', KP.days); } catch (e) {} }
    return kpLoad();
  }
  const bar = ev.target.closest('[data-plan]');
  if (bar && KP.justDragged) { KP.justDragged = false; return; }   // 引いた直後のクリックは窓を開かない
  if (bar) { ev.stopPropagation(); const p = KP.plans.find(x => String(x.id) === bar.dataset.plan); if (p) kpOpen(p); return; }
  const cell = ev.target.closest('.kp-cell');
  if (cell) {
    const k = cell.dataset.kiln, d = cell.dataset.day;
    kpOpen({ kiln: k, date_from: d, date_to: D.add(d, kpDefaultDays(k)), color: k.includes('セカンド') ? '白' : '白' });
  }
});

// 試作モードの見本
function kpSample() {
  const t = D.monday(D.today()), d = n => D.add(t, n);
  const p = (kiln, a, z, body, color, done = false, idou_sumi = false) => ({ id: 'm' + kiln + a, kiln, date_from: d(a), date_to: d(z), body, color, done, idou_sumi });
  return [
    p('3号', -7, -1, '桧　13〜19㎜系\n16山', '段取り済', true, true), p('3号', 0, 6, '桧　13〜19㎜系\n14山', '桧'),
    p('飛鳥', -5, 1, '杉　13〜20㎜系\n16山', '段取り済', true), p('飛鳥', 7, 13, '杉　13〜20㎜系\n12山', '杉'),
    p('6号', -3, 4, '桧角\n桧角のプログラムにて', '段取り済'), p('7号', -6, 6, '杉　32㎜ 37㎜系\n14山', '段取り済', true, true),
    p('飛鳥セカンド0号', -40, 50, '10/19入庫　杉4・桧3\n6山　3ヶ月', '段取り済'),
  ];
}

// ---- バーを引いて動かす（2026-11-28 専務）----
// バーの真ん中を引く＝日程ごと動かす（上下に引けば別の乾燥機へ）。右端（つまみ）を引く＝出庫日を変える（日数が変わる）。
// 1日単位。5px より動かさなければ、ふつうのクリック（窓が開く）。
function kpDayIndexAt(x) {
  const hs = [...document.querySelectorAll('#kp-box .kp-dh')];
  for (let i = 0; i < hs.length; i++) { if (x < hs[i].getBoundingClientRect().right) return i; }
  return hs.length - 1;
}
document.addEventListener('pointerdown', ev => {
  const bar = ev.target.closest('#kp-box .kp-bar');
  if (!bar || ev.button !== 0) return;
  const p = KP.plans.find(x => String(x.id) === bar.dataset.plan);
  if (!p) return;
  const resize = !!ev.target.closest('.kp-grip');
  KP.drag = { p, bar, resize, x0: ev.clientX, y0: ev.clientY, i0: kpDayIndexAt(ev.clientX), moved: false,
    from: p.date_from, to: p.date_to, kiln: p.kiln, col0: bar.style.gridColumn };
  bar.setPointerCapture(ev.pointerId);
});
document.addEventListener('pointermove', ev => {
  const g = KP.drag;
  if (!g) return;
  if (!g.moved && Math.abs(ev.clientX - g.x0) < 5 && Math.abs(ev.clientY - g.y0) < 5) return;
  if (!g.moved) {
    g.moved = true; g.bar.classList.add('dragging');
    g.tip = document.createElement('div'); g.tip.className = 'kp-tip'; document.body.appendChild(g.tip);
  }
  const dd = kpDayIndexAt(ev.clientX) - g.i0;
  if (g.resize) {
    g.from = g.p.date_from;
    g.to = D.add(g.p.date_to, dd);
    if (g.to <= g.from) g.to = D.add(g.from, 1);
  } else {
    g.from = D.add(g.p.date_from, dd); g.to = D.add(g.p.date_to, dd);
    g.bar.style.pointerEvents = 'none';   // 下のマスを拾うため
    const cell = document.elementsFromPoint(ev.clientX, ev.clientY).find(el => el.classList && el.classList.contains('kp-cell'));
    g.bar.style.pointerEvents = '';
    if (cell) g.kiln = cell.dataset.kiln;
  }
  const a = Math.max(0, D.diff(KP.from, g.from)), z = Math.min(KP.days, D.diff(KP.from, g.to));
  if (z > a) g.bar.style.gridColumn = `${a + 2} / ${z + 2}`;
  const off = d => D.isSun(d) || (Store.holidays || {})[d];
  const w = [off(g.from) ? '入庫日が休み' : '', off(g.to) ? '出庫日が休み' : ''].filter(Boolean).join('・');
  g.tip.innerHTML = `${g.kiln !== g.p.kiln ? `<b>${esc(g.kiln)}</b>へ　` : ''}${D.md(g.from)}（${D.wd(g.from)}）入れ → ${D.md(g.to)}（${D.wd(g.to)}）出　${D.diff(g.from, g.to)}日` +
    (w ? `<br><span style="color:#C00000">${w}</span>` : '');
  g.tip.style.left = Math.min(ev.clientX + 14, innerWidth - 260) + 'px';
  g.tip.style.top = (ev.clientY - 52) + 'px';
});
document.addEventListener('pointerup', async ev => {
  const g = KP.drag;
  if (!g) return;
  KP.drag = null;
  if (!g.moved) return;
  KP.justDragged = true; setTimeout(() => { KP.justDragged = false; }, 300);
  g.tip && g.tip.remove();
  g.bar.classList.remove('dragging');
  const rec = { date_from: g.from, date_to: g.to, kiln: g.kiln };
  if (rec.date_from === g.p.date_from && rec.date_to === g.p.date_to && rec.kiln === g.p.kiln) { g.bar.style.gridColumn = g.col0; return; }
  try {
    if (!Store.remote) Object.assign(KP.mem.find(x => x.id === g.p.id), rec);
    else { const { error } = await Store.sb.from('kiln_plans').update(rec).eq('id', g.p.id); if (error) throw error; }
    toast(`${rec.kiln}　${D.md(rec.date_from)}入れ → ${D.md(rec.date_to)}出 にしました`);
  } catch (e) { toast('変えられませんでした：' + e.message); }
  kpLoad();
});

// ---- 中身（NID）：貼る → 在庫から樹種・寸法・等級・枚数を引いて表示。移動先は1つずつ／まとめて ----
const KP_IDOUSAKI = ['本社', '第3土場', '小阪土場', '鮒田工場', '飛鳥工場', '配送センター', '第2倉庫'];
KP.info = {};      // NID → 在庫の中身（スプシ「在庫サマリー」から。毎日11時台の在庫）
KP.meisai = [];
const kpNorm = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const kpNidText = n => String(n).replace(/^([A-Z])(\d{2})(\d{4})(\d+)$/, '$1$2-$3-$4');

async function kpLookup(nids) {
  const want = nids.filter(n => !KP.info[n]);
  if (!want.length) return kpMeisaiDraw();
  try {
    if (!Store.remote) {   // 試作モード：作り物
      want.forEach((n, i) => { KP.info[n] = { nid: n, juushu: i % 2 ? '桧' : '杉', nagasa: 4000, haba: 145, atsu: 20, tougyuu: 'ム・上', suuryou: 180, zaiseki_m3: 2.088, basho: '飛鳥工場', joutai: 'G材' }; });
      KP.kijun = '試作モード（作り物）';
    } else {
      const { data, error } = await Store.sb.functions.invoke('gzai_lookup', { body: { nids: want } });
      if (error) { let m = error.message; try { const b = await error.context.json(); if (b && b.error) m = b.error; } catch (e) {} throw new Error(m); }
      for (const it of data.items || []) KP.info[it.nid] = it;
      KP.kijun = data.kijun ? `在庫は ${data.kijun} 時点（ザイコノジステム2から毎日11時台に写したもの）` : '';
    }
  } catch (e) { KP.kijun = 'NIDの中身を調べられませんでした：' + e.message; }
  kpMeisaiDraw();
}

function kpNidAdd() {
  const ta = document.getElementById('kp-nidtext');
  const list = (ta.value.match(/[A-Za-z]\s*-?\s*\d{2}\s*-?\s*\d{4}\s*-?\s*\d{3}/g) || []).map(kpNorm);
  if (!list.length) return toast('NIDが見つかりません（例 A26-1029-303）');
  const have = new Set(KP.meisai.map(m => m.nid));
  let dup = 0;
  for (const n of list) { if (have.has(n)) { dup++; continue; } have.add(n); KP.meisai.push({ nid: n, idousaki: '' }); }
  ta.value = '';
  if (dup) toast(`${dup}件は入っているので飛ばしました`);
  kpLookup(list);
}

function kpMeisaiDraw() {
  const tab = document.getElementById('kp-mtab');
  if (!tab) return;
  let m3 = 0, nai = 0;
  const rows = KP.meisai.map((m, i) => {
    const x = KP.info[m.nid];
    if (x && x.zaiseki_m3) m3 += Number(x.zaiseki_m3);
    const none = x && x.joutai === 'なし';
    if (none) nai++;
    const cells = !x ? '<td colspan="8" class="kp-wait">調べています…</td>' : none ? '<td colspan="8" class="kp-none">在庫に見つかりません（NIDの打ち間違い・出荷済み・今日の入庫など）</td>' :
      `<td><span class="c-sp ${x.juushu === '桧' ? 'h' : x.juushu === '杉' ? 's' : ''}">${esc(x.juushu)}</span></td><td>${x.nagasa}</td><td>${x.haba}</td><td>${x.atsu}</td>` +
      `<td>${esc(x.tougyuu)}</td><td>${x.suuryou}</td><td>${Number(x.zaiseki_m3).toFixed(3)}</td><td class="kp-basho">${esc(x.joutai === '乾燥機内' ? '乾燥機 ' + x.basho : x.basho)}</td>`;
    return `<tr class="${none ? 'none' : ''}"><td class="kp-nid">${kpNidText(m.nid)}</td>${cells}` +
      `<td><select data-i="${i}"><option value="">―</option>${KP_IDOUSAKI.map(o => `<option ${o === m.idousaki ? 'selected' : ''}>${o}</option>`).join('')}</select></td>` +
      `<td><button type="button" class="kp-x" data-del="${i}" title="外す">×</button></td></tr>`;
  }).join('');
  tab.innerHTML = KP.meisai.length ? `<table><thead><tr><th>NID</th><th>樹種</th><th>長さ</th><th>幅</th><th>厚</th><th>等級</th><th>枚数</th><th>材積</th><th>今の場所</th><th>移動先</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
    : '<p class="hint">まだ入っていません。上の欄にNIDを貼って「足す」を押してください。</p>';
  document.getElementById('kp-sum').textContent = KP.meisai.length ? `${KP.meisai.length}ロット・${m3.toFixed(3)}㎥${nai ? `（見つからない ${nai}件）` : ''}` : '';
  document.getElementById('kp-kijun').textContent = KP.kijun || '';
}
