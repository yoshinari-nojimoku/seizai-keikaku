// 生産順：工場ごとに挽く順にカードを並べる → 上から順に予定表へ自動でバーを作る
// 長さ（何日か）は、挽く量と過去の製材記録の速さ（Store.speed）から出す。手で決めることもできる

const Q = {
  data: {},      // 工場の段id → { todo, done, start }
  form: null,    // 製材を足す画面で編集中のカード
  past: [],      // 「前に書いた木取り」の候補
};
const qs = sel => document.querySelector(sel);
const factories = () => Store.lanes.filter(l => l.kind === '工場' && l.active).sort((a, b) => a.sort - b.sort).slice(0, 2);
const laneName = id => (Store.lanes.find(l => l.id === Number(id)) || {}).name || '';

// 今の時刻から「いまの半日」
function nowSlot() {
  const h = new Date().getHours();
  return { day: D.today(), half: h < 12 ? 0 : 1 };
}

async function qLoad(laneId) {
  const [l, st] = await Promise.all([Store.queueList(laneId), Store.queueStart(laneId)]);
  Q.data[laneId] = { ...l, start: st };
}
async function qLoadAll() {
  await Promise.all(factories().map(f => qLoad(f.id)));
  qDraw();
}
function qSched(laneId, todo) {
  const d = Q.data[laneId];
  return scheduleQueue(todo || d.todo, d.start || nowSlot(), laneName(laneId), Store.holidays, Store.speed, Store.stopSet(laneId));
}

// 予定表へ反映（その工場の生産順から作ったバーを全部そろえる）
async function qSync(laneId) {
  const bars = qSched(laneId).map(r => ({
    ref: 'queue:' + r.item.id, date_from: r.from.day, from_half: r.from.half, date_to: r.to.day, to_half: r.to.half, body: queueBody(r.item),
  }));
  await Store.syncBars(laneId, bars);
  if (typeof onQueueSynced === 'function') onQueueSynced();
}

// ---- 一覧を描く ----
function qItemHtml(r, i, laneId) {
  const it = r.item;
  const sp = it.kind === '止め' ? 'stop' : it.species === '桧' ? 'h' : it.species === '杉' ? 's' : '';
  const sel = Q.form && Q.form.id === it.id ? ' sel' : '';
  const head = it.kind === '止め'
    ? `<span class="sp dg">止め</span><span class="d"><b>${esc(queueTitle(it))}</b><span class="m">${esc(it.memo.split(/\r?\n/).slice(1).join('／'))}</span></span>`
    : `<span class="sp dg">${esc(it.species || '―')}<small>${it.length_m ? +it.length_m + 'M' : ''}</small></span>` +
      `<span class="d"><b>${esc([diaText(it), qtyText(it)].filter(Boolean).join('　') || '（量が未入力）')}</b>` +
      `<span class="m">${it.kidori && it.kidori.mode ? `<span class="m-kidori">${esc(kidoriText(it))}</span>　` : ''}${esc(it.memo.replace(/\r?\n/g, '／'))}</span></span>`;
  return `<div class="qi ${sp}${i === 0 ? ' now' : ''}${sel}" data-qid="${it.id}" data-lane="${laneId}">` +
    `<span class="no dg">${i + 1}</span>${head}` +
    `<span class="when">${slotText(r.from)}〜<b>${halvesText(r.halves)}</b>${r.manual ? '<span class="man">手で決めた長さ</span>' : ''}</span>` +
    `<span class="grip"><button data-act="up" title="上へ">▲</button><button data-act="down" title="下へ">▼</button></span></div>` +
    (i === 0 ? `<button class="qdone-btn" data-act="done" data-qid="${it.id}" data-lane="${laneId}">✓ 挽き終わった（済にする）</button>` : '');
}

function qColHtml(f) {
  const d = Q.data[f.id];
  if (!d) return '';
  const rs = qSched(f.id);
  const start = d.start || nowSlot();
  const end = rs.length ? slotText(rs[rs.length - 1].to) : '―';
  let h = `<div class="qhead"><span class="f dg">${esc(f.name)}</span>` +
    `<span class="st">始まり <b>${slotText(slotWork(start, Store.holidays, Store.stopSet(f.id)))}</b><button data-act="start" data-lane="${f.id}">変える</button><br>終わり <b>${end}</b></span></div>` +
    `<div class="qstart hide" id="qstart-${f.id}">始まり <input type="date" value="${start.day}"><select><option value="0"${start.half ? '' : ' selected'}>午前</option><option value="1"${start.half ? ' selected' : ''}>午後</option></select>` +
    `<button data-act="start-ok" data-lane="${f.id}">決める</button></div>`;
  h += rs.length ? rs.map((r, i) => qItemHtml(r, i, f.id)).join('')
    : `<div class="qempty"><span class="logs" style="background-image:url('${ILLUST.logs}')"></span>まだありません。<br>下の「＋ 製材を足す」から入れてください。</div>`;
  h += `<button class="add" data-act="add" data-lane="${f.id}">＋ 製材を足す</button>`;
  if (d.done.length) h += `<div class="qdone">済（押すと生産順に戻せます）：<br>${d.done.map(x => `<span data-act="undo" data-qid="${x.id}" data-lane="${f.id}">${esc(queueTitle(x))}</span>`).join('')}</div>`;
  return h;
}

function qDraw() {
  const fs = factories();
  qs('#qcol-a').innerHTML = fs[0] ? qColHtml(fs[0]) : '';
  qs('#qcol-b').innerHTML = fs[1] ? qColHtml(fs[1]) : '';
  if (Q.form) qEst();
}

// ---- 製材を足す画面 ----
const LENGTHS = [2, 3, 4, 5, 6];
const STOPS = ['ツイン止め', '刃の交換', '機械の点検', '休み'];

function qOpenForm(item) {
  Q.form = { kind: '製材', species: '桧', length_m: 4, unit: '本', memo: '', ...item };
  qs('#qwrap').classList.remove('noform');
  qs('#qform').classList.remove('hide');
  qFormDraw();
  qDraw();
  qLoadPast();
  if (window.innerWidth < 1100) qs('#qform').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function qCloseForm() {
  Q.form = null;
  qs('#qform').classList.add('hide');
  qs('#qwrap').classList.add('noform');
  qDraw();
}

function chips(name, list, cur, cls = '') {
  return `<div class="seg">${list.map(([v, label, extra]) =>
    `<button type="button" class="chip ${cls} ${extra || ''}${String(cur) === String(v) ? ' on' : ''}" data-set="${name}" data-v="${esc(v)}">${esc(label)}</button>`).join('')}</div>`;
}

function qFormDraw() {
  const f = Q.form;
  const fs = factories();
  const stop = f.kind === '止め';
  let h = `<h3 class="dg">${f.id ? '直す' : '足す'}：${esc(laneName(f.lane_id))}<button type="button" class="x" data-act="close">閉じる</button></h3>`;
  h += `<div class="lbl">工場</div>` + chips('lane_id', fs.map(x => [x.id, x.name]), f.lane_id, 'sm');
  h += `<div class="lbl">樹種</div>` + chips('kind_sp', stop ? [['桧', '桧', 'h'], ['杉', '杉', 's'], ['止め', '止め']] : [['桧', '桧', 'h'], ['杉', '杉', 's']], stop ? '止め' : f.species);
  if (!stop) {
    h += `<div class="lbl">長さ</div>` + chips('length_m', LENGTHS.map(n => [n, n + 'M']), f.length_m ? +f.length_m : '', 'sm');
    h += `<div class="lbl">直径（末口㎝）　上だけなら右を空に</div><div class="row">` +
      `<input class="num" inputmode="numeric" data-in="dia_from" value="${f.dia_from ?? ''}" placeholder="20"><span class="unit">〜</span>` +
      `<input class="num" inputmode="numeric" data-in="dia_to" value="${f.dia_to ?? ''}" placeholder="22"><span class="unit">㎝</span></div>`;
    h += `<div class="lbl">量</div><div class="row"><input class="num" inputmode="decimal" data-in="qty" value="${f.qty ?? ''}" placeholder="500">` +
      `<div class="seg" style="flex:0 0 auto">${['本', '㎥'].map(u => `<button type="button" class="chip sm${f.unit === u ? ' on' : ''}" data-set="unit" data-v="${u}">${u}</button>`).join('')}</div></div>`;
    h += kidoriFormHtml(f);
    h += `<div class="lbl">メモ（自由に）</div><textarea class="txt" data-in="memo" placeholder="例）125バチ　節19㎜／ム・上16㎜">${esc(f.memo)}</textarea>`;
    h += `<div class="past" id="qpast"></div>`;
  } else {
    h += `<div class="lbl">何の止め？</div><div class="past">${STOPS.map(s => `<span class="p" data-stop="${esc(s)}">${esc(s)}</span>`).join('')}</div>`;
    h += `<textarea class="txt" data-in="memo" style="margin-top:6px" placeholder="例）ツイン止め　刃の交換・点検">${esc(f.memo)}</textarea>`;
    h += `<div class="lbl">長さ</div>` + chips('halves_manual', [1, 2, 3, 4, 6, 10].map(n => [n, halvesText(n)]), f.halves_manual || 2, 'sm');
  }
  h += `<div class="est" id="qest"></div>`;
  if (!stop) {
    h += `<div class="manual">日数を手で決める：<select data-in="halves_manual"><option value="">自動（記録から）</option>` +
      Array.from({ length: 12 }, (_, i) => i + 1).map(n => `<option value="${n}"${Number(f.halves_manual) === n ? ' selected' : ''}>${halvesText(n)}</option>`).join('') + '</select></div>';
  }
  h += `<button type="button" class="save" data-act="save">${f.id ? 'これで直す' : '生産順に入れる'}</button>`;
  if (f.id) h += `<div class="acts2"><button type="button" data-act="dup">複製</button><button type="button" class="danger" data-act="del">削除</button></div>`;
  qs('#qform').innerHTML = h;
  qEst();
  qPastDraw();
}

// ---- タイコ後木取り ----
const TAIKO = [210, 175, 145, 140, 130, 125];
// この径でよく挽く構造材（過去の記録から。無ければ目安の表）
function kozaiCandidates(f) {
  const dia = f.dia_from && f.dia_to ? (Number(f.dia_from) + Number(f.dia_to)) / 2 : Number(f.dia_from || f.dia_to || 0);
  const rows = Store.kozai.filter(r => r.species === f.species && Number(r.length_m) === Number(f.length_m || 0));
  if (dia && rows.length) {
    const ds = [...new Set(rows.map(r => r.dia_cm))];
    const near = ds.reduce((a, b) => (Math.abs(b - dia) < Math.abs(a - dia) ? b : a));
    return rows.filter(r => r.dia_cm === near).sort((a, b) => a.rank - b.rank).map(r => r.size).slice(0, 8);
  }
  const d = dia || 20;
  if (d < 16) return ['90角', '105角'];
  if (d < 18) return ['105角', '120角'];
  if (d < 20) return ['120角', '105×150'];
  if (d < 24) return ['105×180', '120×150', '120角'];
  if (d < 28) return ['105×210', '105×240', '120×210'];
  if (d < 32) return ['120×240', '120×270', '150角'];
  return ['120×300', '150×300'];
}
function kidoriFormHtml(f) {
  const k = f.kidori || {};
  let h = `<div class="kidori"><div class="lbl big">タイコ後木取り</div>` +
    `<div class="seg">${[['タイコ', 'タイコ挽き（板）'], ['構造材', '構造材（角・梁桁）']].map(([v, l]) =>
      `<button type="button" class="chip sm${k.mode === v ? ' on' : ''}" data-kset="mode" data-v="${v}">${l}</button>`).join('')}</div>`;
  if (k.mode === 'タイコ') {
    const other = k.taiko && !TAIKO.includes(Number(k.taiko));
    h += `<img class="kd-illust" src="${ILLUST.taiko}" alt="丸太→タイコ→板のイラスト"><p class="kd-cap">丸太の左右を落としてタイコにし、そこから板を挽く</p>`;
    h += `<div class="lbl">タイコ挽寸</div><div class="seg">` +
      TAIKO.map(n => `<button type="button" class="chip sm${Number(k.taiko) === n && !k.otherOpen ? ' on' : ''}" data-kset="taiko" data-v="${n}">${n}</button>`).join('') +
      `<button type="button" class="chip sm${other || k.otherOpen ? ' on' : ''}" data-kset="taiko" data-v="other">その他</button></div>`;
    if (other || k.otherOpen) h += `<div class="row" style="margin-top:8px"><input class="num" inputmode="numeric" data-kin="taiko" value="${other ? k.taiko : ''}" placeholder="160"><span class="unit">㎜</span></div>`;
    h += `<div class="lbl">等級ごとに挽く厚さ</div><div class="grades">` +
      GRADES.map(g => `<label class="grade"><span class="gname">${g}</span><input class="num" inputmode="decimal" data-kin="grade:${g}" value="${(k.grades || {})[g] ?? ''}" placeholder="―"><span class="unit">㎜</span></label>`).join('') +
      '</div>';
  } else if (k.mode === '構造材') {
    const cand = kozaiCandidates(f);
    const sel = k.sizes || [];
    const all = [...new Set([...cand, ...sel])];
    h += `<img class="kd-illust" src="${ILLUST.kozai}" alt="丸太→角材のイラスト"><p class="kd-cap">丸太の芯から角・平角を取る（まわりは背板）</p>`;
    h += `<div class="lbl">この径でよく挽く構造材（押して選ぶ・いくつでも）</div><div class="seg">` +
      all.map(s => `<button type="button" class="chip sm${sel.includes(s) ? ' on' : ''}" data-kset="size" data-v="${esc(s)}">${esc(s)}</button>`).join('') + '</div>' +
      `<div class="row" style="margin-top:8px"><input class="txt" data-kin="size_add" placeholder="ほかの寸法（例：105×300）を入れてEnter"></div>`;
  }
  return h + '</div>';
}

// 目安（何日・いつからいつまで）
function qEst() {
  const box = qs('#qest');
  if (!box || !Q.form) return;
  const f = Q.form, laneId = Number(f.lane_id);
  const d = Q.data[laneId] || { todo: [] };
  // この並びに置いたときの予定（新しいものは最後）
  const todo = f.id && d.todo.some(x => x.id === f.id) ? d.todo.map(x => (x.id === f.id ? { ...x, ...f } : x)) : [...d.todo, { ...f, id: '__new' }];
  const rs = Q.data[laneId] ? qSched(laneId, todo) : [];
  const r = rs.find(x => x.item.id === (f.id && d.todo.some(y => y.id === f.id) ? f.id : '__new'));
  if (!r) { box.innerHTML = ''; return; }
  let why;
  if (r.manual) why = '手で決めた長さです';
  else if (f.kind === '止め') why = '止めの長さ';
  else if (!f.qty) why = '量を入れると、過去の記録から日数を出します（今は仮に1日）';
  else if (r.speed && r.perDay) why = `${esc(r.speed.level)}は<br>過去の記録で 約${Math.round(r.perDay * 10) / 10}${f.unit === '㎥' ? '㎥' : '本'}/日`;
  else why = '記録が見つからないので仮に1日';
  box.innerHTML = `<span class="big dg">${halvesText(r.halves)}</span><span class="t">${why}<br>→ ${slotText(r.from)}〜${slotText(r.to)}</span>`;
}

// 前に書いた木取り：過去の予定表（8年分）から、同じ樹種・長さの2行目以降
async function qLoadPast() {
  const f = Q.form;
  if (!f || f.kind === '止め' || !f.species) { Q.past = []; qPastDraw(); return; }
  try {
    const rows = await Store.searchPast(`${f.species}${f.length_m ? +f.length_m + 'M' : ''}`, f.lane_id);
    const seen = new Set();
    Q.past = [];
    for (const r of rows) {
      const memo = r.body.split(/\r?\n/).slice(1).map(x => x.trim()).filter(Boolean).join('／');
      if (memo && !seen.has(memo) && memo.length <= 60) { seen.add(memo); Q.past.push(memo); }
      if (Q.past.length >= 6) break;
    }
  } catch (e) { Q.past = []; }
  qPastDraw();
}
function qPastDraw() {
  const box = qs('#qpast');
  if (!box) return;
  box.innerHTML = Q.past.length ? '<span class="hint">前に書いた木取りから選ぶ：</span><br>' + Q.past.map(m => `<span class="p" data-memo="${esc(m)}">${esc(m)}</span>`).join('') : '';
}

async function qSave() {
  const f = Q.form;
  if (f.kind === '製材' && !f.species) return toast('樹種を選んでください');
  if (f.kind === '止め' && !f.memo.trim()) f.memo = '止め';
  const laneId = Number(f.lane_id);
  const d = Q.data[laneId];
  const old = f.id ? Object.values(Q.data).flatMap(x => x.todo).find(x => x.id === f.id) : null;
  if (!f.id || (old && old.lane_id !== laneId)) f.seq = (d.todo.length ? Math.max(...d.todo.map(x => x.seq)) : 0) + 1;
  const btn = qs('#qform .save'); if (btn) btn.disabled = true;
  try {
    const saved = await Store.queueSave(f);
    const lanes = new Set([laneId, old ? old.lane_id : laneId]);
    for (const l of lanes) { await qLoad(l); await qSync(l); }
    toast(f.id ? '直しました' : '生産順に入れました');
    if (f.id) qCloseForm();
    else {   // 続けて入れやすいように、工場・樹種・長さは残す
      Q.form = { lane_id: laneId, kind: f.kind, species: f.species, length_m: f.length_m, unit: f.unit, memo: '' };
      qFormDraw(); qDraw();
    }
    return saved;
  } catch (e) { alert(e.message); } finally { if (btn) btn.disabled = false; }
}

async function qDelete() {
  const f = Q.form;
  if (!f.id || !confirm(`「${queueTitle(f)}」を生産順から消しますか？（予定表のバーも消えます）`)) return;
  try { await Store.queueRemove(f.id); await qLoad(f.lane_id); await qSync(f.lane_id); qCloseForm(); toast('消しました'); }
  catch (e) { alert(e.message); }
}

async function qMove(laneId, id, dir) {
  const todo = Q.data[laneId].todo;
  const i = todo.findIndex(x => x.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= todo.length) return;
  const a = todo[i], b = todo[j];
  [todo[i], todo[j]] = [b, a];
  todo.forEach((x, k) => { x.seq = k + 1; });
  qDraw();
  try { await Store.queueReorder(todo.map(x => ({ id: x.id, seq: x.seq }))); await qSync(laneId); }
  catch (e) { alert(e.message); await qLoad(laneId); qDraw(); }
}

// いちばん上が挽き終わった：済にして、次の始まりをその終わりの次の半日にする
async function qDone(laneId, id) {
  const rs = qSched(laneId);
  const r = rs.find(x => x.item.id === id);
  const nx = slotWork(slotNext(r.to), Store.holidays, Store.stopSet(laneId));
  if (!r || !confirm(`「${queueTitle(r.item)}」を挽き終わった（済）にしますか？\n次のカードは ${slotText(nx)} から始まります。`)) return;
  try {
    await Store.queueSave({ ...r.item, status: '済', done_at: new Date().toISOString() });
    await Store.setQueueStart(laneId, nx);
    await qLoad(laneId); await qSync(laneId); qDraw();
    toast('済にしました');
  } catch (e) { alert(e.message); }
}

async function qUndo(laneId, id) {
  const it = Q.data[laneId].done.find(x => x.id === id);
  if (!it || !confirm(`「${queueTitle(it)}」を生産順のいちばん上に戻しますか？`)) return;
  const top = Q.data[laneId].todo.length ? Math.min(...Q.data[laneId].todo.map(x => x.seq)) : 1;
  try {
    await Store.queueSave({ ...it, status: '予定', done_at: null, seq: top - 1 });
    await qLoad(laneId); await qSync(laneId); qDraw();
  } catch (e) { alert(e.message); }
}

// ---- 操作 ----
document.addEventListener('click', ev => {
  const wrap = ev.target.closest('#qwrap');
  if (!wrap) return;
  const a = ev.target.closest('[data-act]');
  const act = a && a.dataset.act;
  const lane = a && Number(a.dataset.lane);
  if (act === 'up' || act === 'down') { const qi = a.closest('.qi'); return qMove(Number(qi.dataset.lane), qi.dataset.qid, act === 'up' ? -1 : 1); }
  if (act === 'done') return qDone(lane, a.dataset.qid);
  if (act === 'undo') return qUndo(lane, a.dataset.qid);
  if (act === 'add') return qOpenForm({ lane_id: lane, species: '桧', length_m: 4 });
  if (act === 'start') { qs('#qstart-' + lane).classList.toggle('hide'); return; }
  if (act === 'start-ok') {
    const box = qs('#qstart-' + lane);
    const slot = { day: box.querySelector('input').value, half: Number(box.querySelector('select').value) };
    if (!slot.day) return;
    return (async () => { try { await Store.setQueueStart(lane, slot); Q.data[lane].start = slot; await qSync(lane); qDraw(); toast('始まりを変えました'); } catch (e) { alert(e.message); } })();
  }
  if (act === 'close') return qCloseForm();
  if (act === 'save') return qSave();
  if (act === 'del') return qDelete();
  if (act === 'dup') { const { id, seq, status, done_at, ...rest } = Q.form; return qOpenForm(rest); }
  const qi = ev.target.closest('.qi');
  if (qi) { const it = Q.data[qi.dataset.lane].todo.find(x => x.id === qi.dataset.qid); if (it) qOpenForm({ ...it }); return; }
  // 製材を足す画面のボタン
  const set = ev.target.closest('[data-set]');
  if (set && Q.form) {
    const k = set.dataset.set, v = set.dataset.v;
    if (k === 'kind_sp') {
      if (v === '止め') Object.assign(Q.form, { kind: '止め', species: null, halves_manual: Q.form.halves_manual || 2 });
      else Object.assign(Q.form, { kind: '製材', species: v, halves_manual: Q.form.kind === '止め' ? null : Q.form.halves_manual });
      qFormDraw(); qLoadPast(); return;
    }
    Q.form[k] = k === 'lane_id' || k === 'length_m' || k === 'halves_manual' ? Number(v) : v;
    if (k === 'lane_id' || k === 'length_m') { qFormDraw(); qLoadPast(); return; }
    qs('#qform').querySelectorAll(`[data-set="${k}"]`).forEach(b => b.classList.toggle('on', b.dataset.v === v));
    qEst(); return;
  }
  const ks = ev.target.closest('[data-kset]');
  if (ks && Q.form) {
    const k = Q.form.kidori = { ...(Q.form.kidori || {}) };
    const v = ks.dataset.v;
    if (ks.dataset.kset === 'mode') { if (k.mode === v) Q.form.kidori = null; else { k.mode = v; k.grades = k.grades || {}; k.sizes = k.sizes || []; } }
    if (ks.dataset.kset === 'taiko') { if (v === 'other') { k.otherOpen = true; } else { k.taiko = Number(v); k.otherOpen = false; } }
    if (ks.dataset.kset === 'size') { k.sizes = (k.sizes || []).includes(v) ? k.sizes.filter(x => x !== v) : [...(k.sizes || []), v]; }
    const y = window.scrollY; qFormDraw(); window.scrollTo(0, y); return;
  }
  const memo = ev.target.closest('[data-memo]');
  if (memo && Q.form) { Q.form.memo = memo.dataset.memo.replace(/／/g, '\n'); qs('#qform [data-in="memo"]').value = Q.form.memo; return; }
  const stopName = ev.target.closest('[data-stop]');
  if (stopName && Q.form) { Q.form.memo = stopName.dataset.stop; qs('#qform [data-in="memo"]').value = Q.form.memo; qEst(); }
});
document.addEventListener('input', ev => {
  const kin = ev.target.closest('#qform [data-kin]');
  if (kin && Q.form) {
    const k = Q.form.kidori = { ...(Q.form.kidori || {}) };
    const key = kin.dataset.kin, val = kin.value.normalize('NFKC').trim();
    if (key === 'taiko') k.taiko = val ? Number(val) : null;
    if (key.startsWith('grade:')) k.grades = { ...(k.grades || {}), [key.slice(6)]: val ? Number(val) : null };
    return;
  }
  const el = ev.target.closest('#qform [data-in]');
  if (!el || !Q.form) return;
  const k = el.dataset.in;
  Q.form[k] = k === 'memo' ? el.value : (el.value === '' ? null : Number(el.value.normalize('NFKC')));
  qEst();
});
document.addEventListener('change', ev => {
  const el = ev.target.closest('#qform select[data-in]');
  if (el && Q.form) { Q.form[el.dataset.in] = el.value ? Number(el.value) : null; qEst(); }
});

document.addEventListener('keydown', ev => {
  const el = ev.target.closest('#qform [data-kin="size_add"]');
  if (!el || ev.key !== 'Enter' || !Q.form) return;
  ev.preventDefault();
  const v = el.value.normalize('NFKC').replace(/[xX*]/g, '×').trim();
  if (!v) return;
  const k = Q.form.kidori = { ...(Q.form.kidori || {}), mode: '構造材' };
  k.sizes = [...new Set([...(k.sizes || []), v])];
  qFormDraw();
});
