// 専務用の画面：週表で見る・足す・直す・過去から呼び出す

const S = {
  from: D.monday(D.today()),
  days: Number(localStorage.getItem('sk-days') || 14),
  showAll: false,
  entries: [],
  edit: null,      // 編集中のカード
};

const $ = id => document.getElementById(id);
const main = $('main');

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

async function load() {
  const to = D.add(S.from, S.days - 1);
  $('range').textContent = `${D.md(S.from)}〜${D.md(to)}`;
  $('w1').classList.toggle('on', S.days === 7);
  $('w2').classList.toggle('on', S.days === 14);
  $('showall').classList.toggle('on', S.showAll);
  try {
    S.entries = await Store.range(S.from, to);
  } catch (e) { main.innerHTML = `<div class="msg">${esc(e.message)}</div>`; return; }
  draw();
}

function draw() {
  const opts = { from: S.from, days: S.days, lanes: Store.lanes, entries: S.entries, holidays: Store.holidays, editable: true, showAll: S.showAll };
  main.innerHTML = `<div class="weeks">${renderWeeks(opts)}</div>${renderDayList(opts)}`;
}

// ---- 編集の窓 ----
function openEditor(e) {
  S.edit = { status: '予定', ...e };
  $('dlg-title').textContent = e.id ? '計画カードを直す' : '計画カードを足す';
  $('f-lane').innerHTML = Store.lanes.filter(l => l.active || l.id === Number(e.lane_id))
    .map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
  $('f-lane').value = e.lane_id;
  $('f-from').value = e.date_from;
  $('f-to').value = e.date_to;
  $('f-body').value = e.body || '';
  setStatus(S.edit.status);
  $('f-hl').classList.toggle('on', !!S.edit.color);
  $('f-del').style.display = e.id ? '' : 'none';
  $('f-copy').style.display = e.id ? '' : 'none';
  $('f-meta').textContent = e.id
    ? `最後に直した人：${e.updated_by || '—'}　${e.updated_at ? new Date(e.updated_at).toLocaleString('ja-JP') : ''}${e.source && e.source !== 'app' ? '（エクセルから取り込み）' : ''}`
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

function formValue() {
  return { ...S.edit, lane_id: $('f-lane').value, date_from: $('f-from').value, date_to: $('f-to').value, body: $('f-body').value };
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
  openEditor({ lane_id: v.lane_id, date_from: nf, date_to: D.add(nf, len), body: v.body, status: '予定', color: v.color });
  toast('複製しました。日付を直して保存してください');
}

// ---- 操作 ----
main.addEventListener('click', ev => {
  const card = ev.target.closest('.card[data-id]');
  if (card) { const e = S.entries.find(x => String(x.id) === card.dataset.id); if (e) openEditor(e); return; }
  const cell = ev.target.closest('.g-cell[data-lane]');
  if (cell) { openEditor({ lane_id: cell.dataset.lane, date_from: cell.dataset.date, date_to: cell.dataset.date, body: '' }); return; }
  const add = ev.target.closest('.dl-add');
  if (add) {
    const first = Store.lanes.find(l => l.active);
    openEditor({ lane_id: first ? first.id : Store.lanes[0].id, date_from: add.dataset.date, date_to: add.dataset.date, body: '' });
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
$('f-from').onchange = () => { if ($('f-to').value < $('f-from').value) $('f-to').value = $('f-from').value; };
$('f-lane').onchange = searchPast;
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
  let r;
  try { r = await Store.init(); } catch (e) { main.innerHTML = `<div class="msg">${esc(e.message)}</div>`; return; }
  if (r.needLogin) {
    main.innerHTML = '<div class="msg"><p>製材計画を直すには、Googleアカウントでログインしてください。</p><button class="btn primary" id="login">Googleでログイン</button></div>';
    $('login').onclick = () => Store.login();
    return;
  }
  if (r.notEditor) {
    main.innerHTML = `<div class="msg"><p>${esc(Store.user.email)} には書き込みの許可がありません。</p><button class="btn" id="logout">ログアウト</button></div>`;
    $('logout').onclick = () => Store.logout();
    return;
  }
  $('who').innerHTML = Store.remote ? `${esc(Store.user.email)} <a href="#" id="logout">ログアウト</a>` : '試作モード（保存されません）';
  if ($('logout')) $('logout').onclick = ev => { ev.preventDefault(); Store.logout(); };
  load();
})();
