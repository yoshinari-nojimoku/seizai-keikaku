// 専務用の画面：タブ（生産順／予定表）・予定表の表示と手書きカード・起動
// 生産順は queue.js

const S = {
  from: D.monday(D.today()),
  days: Number(localStorage.getItem('sk-days') || 14),
  showAll: false,
  entries: [],
  edit: null,      // 編集中の手書きカード
  tab: 'home',   // 開いたらホームから
};

const $ = id => document.getElementById(id);
const main = $('main');

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

// ---- タブ ----
function setTab(t) {
  S.tab = t;
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  for (const v of ['home', 'queue', 'sched', 'genboku', 'kansouki']) $(v + '-view').classList.toggle('hide', t !== v);
  $('print').classList.toggle('hide', t !== 'sched');
  if (t === 'home') drawHome();
  if (t === 'sched') load();
  if (t === 'genboku') gbLoad();
  if (t === 'kansouki') ksLoad();
  window.scrollTo(0, 0);
}
document.querySelectorAll('.tab').forEach(b => b.onclick = () => setTab(b.dataset.tab));

// ---- ホーム ----
// 部屋（機能）の入口。押すと部屋の名前が一瞬アップで出てから、その部屋に入る
const ROOMS = [
  { tab: 'queue', name: '生産順', sub: '工場ごとに挽く順を並べる。量から日数を自動で出す', img: () => ILLUST.saw },
  { tab: 'sched', name: '予定表', sub: '2週の製材・引き取り・原木市。印刷とWORKSへ送る', img: () => ILLUST.hero },
  { tab: 'genboku', name: '原木仕入れ', sub: '何をどれだけ買うか。更新してWORKSへ送る', img: () => ILLUST.truck },
  { tab: 'kansouki', name: '乾燥機', sub: '各乾燥機の今の中身・出庫予定。ザイコノジステム2から', img: () => ILLUST.kiln },
];
function drawHome() {
  $('home-view').innerHTML = `<div class="home-hello dg">製材計画アプリ</div>` +
    `<div class="home-grid">${ROOMS.map(r => `<button class="room block" data-room="${r.tab}">` +
      `<span class="room-img" style="background-image:url('${r.img()}')"></span>` +
      `<span class="room-name dg">${r.name}</span><span class="room-sub">${r.sub}</span></button>`).join('')}</div>`;
}
function enterRoom(tab) {
  const r = ROOMS.find(x => x.tab === tab);
  const z = $('zoomtitle');
  z.textContent = r ? r.name : '';
  z.classList.remove('hide', 'go');
  void z.offsetWidth;   // アニメーションをはじめからやり直す
  z.classList.add('go');
  setTimeout(() => setTab(tab), 380);
  setTimeout(() => { z.classList.add('hide'); z.classList.remove('go'); }, 900);
}
document.addEventListener('click', ev => {
  const b = ev.target.closest('[data-room]');
  if (b) enterRoom(b.dataset.room);
});
// 生産順を直したら、予定表も読み直す（開いているときだけ）
function onQueueSynced() { if (S.tab === 'sched') load(); }

// ---- 予定表 ----
async function load() {
  const to = D.add(S.from, S.days - 1);
  $('range').textContent = `${D.md(S.from)}〜${D.md(to)}`;
  $('w1').classList.toggle('on', S.days === 7);
  $('w2').classList.toggle('on', S.days === 14);
  $('showall').classList.toggle('on', S.showAll);
  try {
    S.entries = await Store.range(S.from, to);
  } catch (e) { main.innerHTML = `<div class="block msg">${esc(e.message)}</div>`; return; }
  draw();
}

function draw() {
  const opts = { from: S.from, days: S.days, lanes: Store.lanes, entries: S.entries, holidays: Store.holidays, stops: Store.stopMap(), editable: true, showAll: S.showAll };
  main.innerHTML = `<div class="weeks"><div class="week block">${renderWeekGrid(opts)}</div></div>${renderDayList(opts).replace(/class="dl-day /g, 'class="dl-day block ')}`;
  fitFactoryRows(main);
  if (RZ.sel) selectCard(main.querySelector(`.weeks .card[data-id="${RZ.sel}"]`));   // 描き直しても選んだカードはそのまま
}

// ---- 予定表：カードの右端を引いて、終わりを延ばす・縮める（2026-11-27 専務） ----
// カードを押すと選ばれて右端に「つまみ」が出る。左右に引くと、工場の段は半日ずつ・ほかの段は1日ずつ動く。
// 生産順から作ったバー（自動）は、その長さを「手で決めた長さ」にして生産順を並べ直す（後ろのカードも押される）
const RZ = { sel: null, drag: null };
const queueItemOf = e => Object.values(Q.data).flatMap(d => d.todo.concat(d.done))
  .find(x => 'queue:' + x.id === e.source_ref);

function selectCard(card) {
  main.querySelectorAll('.weeks .card.sel').forEach(c => { c.classList.remove('sel'); c.querySelector('.c-grip')?.remove(); });
  RZ.sel = null;
  if (!card) return;
  const e = S.entries.find(x => String(x.id) === card.dataset.id);
  if (!e || card.querySelector('.c-cut.r')) return;   // 右が表の外に出ているカードは、見えている所まで戻ってから
  if (e.source === 'queue') { const it = queueItemOf(e); if (!it || it.status === '済') return; }
  card.classList.add('sel');
  card.insertAdjacentHTML('beforeend', '<span class="c-grip" title="左右に引いて、終わりを延ばす・縮める"></span>');
  RZ.sel = card.dataset.id;
}

// 表の半日マス（見出しの午前・午後）を左から順に {day, half, left, right}
function slotCells() {
  return [...main.querySelectorAll('.weeks .g-half')].map((el, i) => {
    const r = el.getBoundingClientRect();
    return { day: D.add(S.from, Math.floor(i / 2)), half: i % 2, left: r.left, right: r.right, idx: i };
  });
}

function rzMove(ev) {
  const d = RZ.drag;
  if (!d) return;
  let i = d.cells.findIndex(c => ev.clientX < c.right);
  if (i < 0) i = d.cells.length - 1;
  if (d.daily) i = Math.floor(i / 2) * 2 + 1;   // 工場以外の段は1日単位（その日の午後まで）
  i = Math.max(i, d.min);
  const c = d.cells[i];
  d.end = { day: c.day, half: c.half };
  d.card.style.gridColumnEnd = String(i + 3);
  d.tip.textContent = `${D.md(c.day)}（${D.wd(c.day)}）${d.daily ? '' : HALF[c.half]}まで`;
  d.tip.style.left = Math.min(ev.clientX + 14, window.innerWidth - 170) + 'px';
  d.tip.style.top = (ev.clientY - 40) + 'px';
}

async function rzEnd() {
  const d = RZ.drag;
  if (!d) return;
  RZ.drag = null;
  d.tip.remove();
  document.body.classList.remove('rz-on');
  const e = d.e, end = d.end;
  if (!end || (end.day === e.date_to && end.half === th(e))) { d.card.style.gridColumnEnd = ''; return; }
  try {
    if (e.source === 'queue') {
      // 始まりから、引いた所までに入る「挽く半日」の数（日曜・社休日・止める日は数えない）
      const lane = Number(e.lane_id), stops = Store.stopSet(lane);
      let s = slotWork({ day: e.date_from, half: fh(e) }, Store.holidays, stops), n = 1;
      for (;;) {
        const nx = slotWork(slotNext(s), Store.holidays, stops);
        if (slotKey(nx) > end.day + end.half) break;
        s = nx; n++;
      }
      await Store.queueSave({ ...queueItemOf(e), halves_manual: n });
      await qLoad(lane);
      await qSync(lane);   // 予定表も読み直される
      qDraw();
      toast(`${slotText(s)}までにしました（${halvesText(n)}・手で決めた長さ）。後ろの予定もずらしました`);
    } else {
      await Store.save({ ...e, date_to: end.day, to_half: d.daily ? 1 : end.half });
      await load();
      toast(`${D.md(end.day)}${d.daily ? '' : HALF[end.half]}までにしました`);
    }
  } catch (err) { alert(err.message); await load(); }
}

main.addEventListener('pointerdown', ev => {
  const grip = ev.target.closest('.c-grip');
  if (!grip) return;
  ev.preventDefault(); ev.stopPropagation();
  closeCardPop();
  const card = grip.closest('.card');
  const e = S.entries.find(x => String(x.id) === card.dataset.id);
  const lane = Store.lanes.find(l => l.id === Number(e.lane_id));
  const daily = !lane || lane.kind !== '工場';
  const cells = slotCells();
  // 始まりより前には縮められない（始まりが表より前なら、表の左端まで）
  const startIdx = D.diff(S.from, e.date_from) * 2 + (daily ? 1 : fh(e));
  const tip = document.createElement('div');
  tip.className = 'rz-tip';
  document.body.appendChild(tip);
  document.body.classList.add('rz-on');
  RZ.drag = { e, card, daily, cells, min: Math.max(daily ? 1 : 0, startIdx), end: null, tip };
  grip.setPointerCapture(ev.pointerId);
  rzMove(ev);
});
main.addEventListener('pointermove', rzMove);
main.addEventListener('pointerup', rzEnd);
main.addEventListener('pointercancel', () => { if (RZ.drag) { RZ.drag.card.style.gridColumnEnd = ''; RZ.drag.tip.remove(); RZ.drag = null; document.body.classList.remove('rz-on'); } });
window.addEventListener('resize', () => { if (S.tab === 'sched') fitFactoryRows(main); });

// ---- 手書きカードの窓 ----
function openEditor(e) {
  S.edit = { status: '予定', ...e };
  $('dlg-title').textContent = e.id ? 'カードを直す' : 'カードを足す';
  $('f-lane').innerHTML = Store.lanes.filter(l => l.active || l.id === Number(e.lane_id))
    .map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
  $('f-lane').value = e.lane_id;
  halfVisible();
  $('f-from').value = e.date_from;
  $('f-to').value = e.date_to;
  $('f-fromh').value = String(e.from_half ?? 0);
  $('f-toh').value = String(e.to_half ?? 1);
  $('f-body').value = e.body || '';
  setStatus(S.edit.status);
  $('f-hl').classList.toggle('on', !!S.edit.color);
  $('f-del').style.display = e.id ? '' : 'none';
  $('f-copy').style.display = e.id ? '' : 'none';
  $('f-meta').textContent = e.id
    ? `最後に直した人：${e.updated_by || '—'}　${e.updated_at ? new Date(e.updated_at).toLocaleString('ja-JP') : ''}${e.source && e.source.startsWith('excel') ? '（エクセルから取り込み）' : ''}`
    : '';
  $('p-q').value = '';
  $('dlg').showModal();
  if (!e.id) $('f-body').focus();
  searchPast();
}

function setStatus(v) {
  S.edit.status = v;
  document.querySelectorAll('#f-status [data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === v));
}

// 工場（飛鳥・本社）だけ午前・午後を選べる。ほかの段は1日単位
const isFactoryLane = id => (Store.lanes.find(l => l.id === Number(id)) || {}).kind === '工場';
function halfVisible() {
  const show = isFactoryLane($('f-lane').value);
  $('f-fromh').classList.toggle('hide', !show);
  $('f-toh').classList.toggle('hide', !show);
}
function formValue() {
  const f = isFactoryLane($('f-lane').value);
  return { ...S.edit, lane_id: $('f-lane').value, date_from: $('f-from').value, date_to: $('f-to').value,
    from_half: f ? Number($('f-fromh').value) : 0, to_half: f ? Number($('f-toh').value) : 1, body: $('f-body').value };
}

let pastTimer = null;
async function searchPast() {
  clearTimeout(pastTimer);
  pastTimer = setTimeout(async () => {
    const list = $('p-list');
    try {
      // 検索欄が空なら、中身の1行目で探す（打ちながら似た過去カードが出る）
      const typed = $('p-q').value.trim();
      const first = ($('f-body').value.split(/\r?\n/)[0] || '').trim();
      const q = typed || (first.length >= 2 ? first : '');
      const rows = await Store.searchPast(q, typed ? '' : $('f-lane').value);
      const byId = Object.fromEntries(Store.lanes.map(l => [l.id, l.name]));
      list.innerHTML = rows.length
        ? rows.filter(r => r.id !== S.edit.id).map(r =>
            `<div class="past-item" data-body="${esc(r.body)}"><b>${r.date_from.replace(/-/g, '/')}（${D.wd(r.date_from)}）${esc(byId[r.lane_id] || '')}</b>${esc(r.body).replace(/\n/g, '<br>')}</div>`).join('')
        : '<p class="hint">見つかりませんでした。</p>';
    } catch (e) { list.innerHTML = `<p class="hint">${esc(e.message)}</p>`; }
  }, 250);
}

async function save() {
  const v = formValue();
  $('f-save').disabled = true;
  try {
    await Store.save(v);
    $('dlg').close();
    toast('保存しました');
    await load();
  } catch (e) { alert(e.message); } finally { $('f-save').disabled = false; }
}

async function del() {
  if (!S.edit.id || !confirm('このカードを削除しますか？（履歴には残ります）')) return;
  try { await Store.remove(S.edit.id); $('dlg').close(); toast('削除しました'); await load(); }
  catch (e) { alert(e.message); }
}

function copyCard() {
  const v = formValue();
  const len = D.diff(v.date_from, v.date_to);
  const nf = D.add(v.date_to, 1);
  openEditor({ lane_id: v.lane_id, date_from: nf, date_to: D.add(nf, len), from_half: v.from_half, to_half: v.to_half, body: v.body, status: '予定', color: v.color });
  toast('複製しました。日付を直して保存してください');
}

// ---- 予定表の操作 ----
// カードを開く（直す）。週表ではまずポップアップで全文を見せ、「直す」で開く
function openCard(e) {
  {
    // 生産順から作ったバー → 生産順の画面でそのカードを開く
    if (e.source === 'queue') {
      const qid = (e.source_ref || '').replace('queue:', '');
      const it = Object.values(Q.data).flatMap(d => d.todo.concat(d.done)).find(x => String(x.id) === qid);
      setTab('queue');
      if (it && it.status !== '済') qOpenForm({ ...it });
      else toast('このバーは済になったカードです（生産順の「済」から戻せます）');
      return;
    }
    openEditor(e);
  }
}
main.addEventListener('click', ev => {
  if (ev.target.closest('.c-grip')) return;   // つまみを引いた後のクリックは無視
  const card = ev.target.closest('.card[data-id]');
  if (!card) selectCard(null);
  if (card) {
    const e = S.entries.find(x => String(x.id) === card.dataset.id);
    if (!e) return;
    if (card.closest('.weeks')) selectCard(card);
    if (card.closest('.weeks')) showCardPop(e, card, Store.lanes, () => openCard(e));
    else openCard(e);   // スマホの日ごとの一覧は全文が出ているので、そのまま開く
    return;
  }
  // 工場の段：押した半日の製材機を止める／戻す → 生産順のバーが並び直る
  const st = ev.target.closest('[data-stop-lane]');
  if (st) {
    const { stopLane, date, half } = st.dataset;
    (async () => {
      try {
        const on = await Store.toggleStop(stopLane, date, half);
        await qSync(Number(stopLane)); qDraw(); await load();
        toast(`${D.md(date)} ${HALF[half]}：${on ? '製材機を止めます' : '止めるのをやめました'}`);
      } catch (e) { alert(e.message); }
    })();
    return;
  }
  const cell = ev.target.closest('.g-cell[data-lane]');
  // 午前のマス＝その日まる1日、午後のマス＝その日の午後だけ、で開く（窓の中で直せる）
  if (cell) { openEditor({ lane_id: cell.dataset.lane, date_from: cell.dataset.date, date_to: cell.dataset.date, from_half: Number(cell.dataset.half || 0), to_half: 1, body: '' }); return; }
  const add = ev.target.closest('.dl-add');
  if (add) {
    const first = Store.lanes.find(l => l.active && l.kind !== '工場') || Store.lanes[0];
    openEditor({ lane_id: first.id, date_from: add.dataset.date, date_to: add.dataset.date, body: '' });
  }
});

// ◀ ▶＝1日ずつ（金曜に翌週を組むので、金曜から見られるように）／◀◀ ▶▶＝1週ずつ
$('prev').onclick = () => { S.from = D.add(S.from, -1); load(); };
$('next').onclick = () => { S.from = D.add(S.from, 1); load(); };
$('prevw').onclick = () => { S.from = D.add(S.from, -7); load(); };
$('nextw').onclick = () => { S.from = D.add(S.from, 7); load(); };
$('today').onclick = () => { S.from = D.monday(D.today()); load(); };
$('w1').onclick = () => { S.days = 7; localStorage.setItem('sk-days', 7); load(); };
$('w2').onclick = () => { S.days = 14; localStorage.setItem('sk-days', 14); load(); };
$('showall').onclick = () => { S.showAll = !S.showAll; draw(); $('showall').classList.toggle('on', S.showAll); };
$('print').onclick = () => openSendDlg();   // send.js

$('form').addEventListener('submit', ev => ev.preventDefault());   // Enterで窓が閉じないように
document.querySelectorAll('#f-status [data-v]').forEach(b => b.onclick = () => setStatus(b.dataset.v));
$('f-hl').onclick = () => { S.edit.color = S.edit.color ? null : 'yellow'; $('f-hl').classList.toggle('on', !!S.edit.color); };
$('f-save').onclick = save;
$('f-del').onclick = del;
$('f-copy').onclick = copyCard;
$('f-close').onclick = () => $('dlg').close();
// 終わりが始まりより前にならないようにそろえる
function fixRange() {
  if ($('f-to').value < $('f-from').value) $('f-to').value = $('f-from').value;
  if ($('f-to').value === $('f-from').value && $('f-toh').value < $('f-fromh').value) $('f-toh').value = $('f-fromh').value;
}
$('f-from').onchange = fixRange;
$('f-fromh').onchange = fixRange;
$('f-lane').onchange = () => { halfVisible(); searchPast(); };
$('p-q').oninput = searchPast;
$('f-body').addEventListener('input', () => { if (!$('p-q').value.trim()) searchPast(); });
$('p-list').addEventListener('click', ev => {
  const it = ev.target.closest('.past-item');
  if (!it) return;
  $('f-body').value = it.dataset.body;
  $('f-body').focus();
  toast('中身を写しました');
});
document.addEventListener('keydown', ev => {
  if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter' && $('dlg').open) { ev.preventDefault(); save(); }
});

// ---- 起動 ----
(async () => {
  if (window.innerWidth < 760 && !localStorage.getItem('sk-days')) S.days = 7;
  const gate = $('gate');
  let r;
  try { r = await Store.init(); } catch (e) { gate.innerHTML = `<div class="block msg">${esc(e.message)}</div>`; return; }
  if (r.needLogin) {
    const err = new URLSearchParams(location.search).get('error_description');
    const errHtml = err ? '<p style="color:var(--maroon)">ログインできませんでした（' + esc(err) + '）。<br>数分おいて、もう一度押してください。</p>' : '';
    if (err) history.replaceState(null, '', location.pathname);
    gate.innerHTML = '<div class="block msg"><img class="hero" src="' + ILLUST.hero + '" alt="製材所のイラスト">' + errHtml + '<p>製材計画を直すには、Googleアカウントでログインしてください。</p><button class="bigbtn dg" id="login">Googleでログイン</button></div>';
    $('login').onclick = () => Store.login();
    return;
  }
  if (r.notEditor) {
    gate.innerHTML = `<div class="block msg"><p>${esc(Store.user.email)} には書き込みの許可がありません。</p><button class="bigbtn" id="logout">ログアウト</button></div>`;
    $('logout').onclick = () => Store.logout();
    return;
  }
  gate.classList.add('hide');
  $('who').innerHTML = Store.remote ? `${esc(Store.user.email)} <a href="#" id="logout">ログアウト</a>` : '試作モード（保存されません）';
  if ($('logout')) $('logout').onclick = ev => { ev.preventDefault(); Store.logout(); };
  try {
    await qLoadAll();
    // 開いたときに、生産順から作るバーを予定表とそろえる（社休日が増えた時などのため。変わった所だけ書く）
    for (const f of factories()) await qSync(f.id);
  } catch (e) { toast(e.message); }
  setTab(S.tab);
})();
