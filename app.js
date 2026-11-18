// 専務用の画面：タブ（生産順／予定表）・予定表の表示と手書きカード・起動
// 生産順は queue.js

const S = {
  from: D.monday(D.today()),
  days: Number(localStorage.getItem('sk-days') || 14),
  showAll: false,
  entries: [],
  edit: null,      // 編集中の手書きカード
  tab: localStorage.getItem('sk-tab') || 'queue',
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
  try { localStorage.setItem('sk-tab', t); } catch (e) {}
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  $('queue-view').classList.toggle('hide', t !== 'queue');
  $('sched-view').classList.toggle('hide', t !== 'sched');
  $('print').classList.toggle('hide', t !== 'sched');
  if (t === 'sched') load();
}
document.querySelectorAll('.tab').forEach(b => b.onclick = () => setTab(b.dataset.tab));
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
}

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
main.addEventListener('click', ev => {
  const card = ev.target.closest('.card[data-id]');
  if (card) {
    const e = S.entries.find(x => String(x.id) === card.dataset.id);
    if (!e) return;
    // 生産順から作ったバー → 生産順の画面でそのカードを開く
    if (e.source === 'queue') {
      const qid = (e.source_ref || '').replace('queue:', '');
      const it = Object.values(Q.data).flatMap(d => d.todo.concat(d.done)).find(x => String(x.id) === qid);
      setTab('queue');
      if (it && it.status !== '済') qOpenForm({ ...it });
      else toast('このバーは済になったカードです（生産順の「済」から戻せます）');
      return;
    }
    openEditor(e); return;
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

$('prev').onclick = () => { S.from = D.add(S.from, -7); load(); };
$('next').onclick = () => { S.from = D.add(S.from, 7); load(); };
$('today').onclick = () => { S.from = D.monday(D.today()); load(); };
$('w1').onclick = () => { S.days = 7; localStorage.setItem('sk-days', 7); load(); };
$('w2').onclick = () => { S.days = 14; localStorage.setItem('sk-days', 14); load(); };
$('showall').onclick = () => { S.showAll = !S.showAll; draw(); $('showall').classList.toggle('on', S.showAll); };
$('print').onclick = () => window.print();

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
