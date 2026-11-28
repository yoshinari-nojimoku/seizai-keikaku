// 乾燥機の予定表（2026-11-28）：乾燥機スケジュール表（スプシ「ガントチャート」）の代わり。
// 行＝乾燥機・列＝日。バーは入庫日〜出庫日の前日（出庫日のマスは次の便の入庫に使う）。
// 書けるのは専務と kiln_writers の人（樋口さん）。表は kiln_plans（supabase/kansouki_plans.sql）。
// 色はスプシと同じ：桧＝オレンジ・杉＝水色・段取り済＝ピンク（別の担当者が段取りした印）・青・白。

const KP_GROUPS = [
  { name: '本社', kilns: ['3号', '除湿右', '除湿左'] },
  { name: '飛鳥工場', kilns: ['飛鳥', '飛鳥 元除湿右'] },
  { name: '第2倉庫', kilns: ['5号', '6号', '7号'] },
  { name: '外', kilns: ['ウッドピア'] },
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
    } else {
      const { data, error } = await Store.sb.from('kiln_plans').select('*').lt('date_from', to).gt('date_to', KP.from).order('date_from');
      if (error) throw new Error(/kiln_plans/.test(error.message) ? '予定表の準備がまだです（DBに表を作る操作が済んでいません）' : error.message);
      KP.plans = data;
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
    h += `<div class="kp-group" style="grid-column: 1 / span ${N + 1};grid-row:${row}">${esc(g.name)}</div>`;
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
          (p.idou_sumi ? `<span class="kp-idou">出後の移動先済</span>` : '') +
          `<span class="kp-out">${D.md(p.date_to)}出</span></button>`;
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
  dlg._warn();
  dlg.showModal();
  setTimeout(() => dlg.querySelector('#kp-body').focus(), 50);
}

async function kpSave() {
  const v = id => document.getElementById(id).value;
  const rec = { kiln: v('kp-kiln'), date_from: v('kp-from'), date_to: v('kp-to'), body: v('kp-body').trim(),
    color: (document.querySelector('#kp-color .kp-c.on') || {}).dataset?.v || '白',
    done: document.getElementById('kp-done').checked, idou_sumi: document.getElementById('kp-idou').checked };
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
