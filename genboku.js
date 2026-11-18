// 原木仕入れ（2026-11-18）
// 原木管理マスター（スプシ）の 目安G（1.5ヵ月分の製材量）− 在庫F ＝ 買う原木。
// 「更新」でスプシを読み直す（Supabase の genboku_refresh）。bot専務で中野課長・竹中さんへ送れる。
// 平均単価は Access からこのPCで作って入れる（genboku_shiire\push_app.py）。

const GB = { snap: null, price: {}, all: false, test: false };
const MIN_SHORT = 1.0;   // 1㎥未満の小さな不足は載せない（今までのレポートと同じ）

async function gbLoad() {
  const box = $('genboku-view');
  if (!Store.remote) {
    const s = typeof SAMPLE !== 'undefined' && SAMPLE.genboku;
    GB.snap = s ? s.snap : null; GB.price = s ? s.price : {};
    return gbDraw();
  }
  box.innerHTML = '<div class="block msg">読み込み中…</div>';
  const [sn, pr] = await Promise.all([
    Store.sb.from('genboku_snapshot').select('*').order('taken_at', { ascending: false }).limit(1).maybeSingle(),
    Store.sb.from('genboku_price').select('*'),
  ]);
  if (sn.error) { box.innerHTML = `<div class="block msg">${esc(sn.error.message)}</div>`; return; }
  GB.snap = sn.data;
  GB.price = Object.fromEntries((pr.data || []).map(r => [`${r.species}|${r.length_m}|${r.dia}`, Number(r.price)]));
  gbDraw();
}

const gbShort = r => Math.round((r.g - r.f) * 10) / 10;
const gbWhen = t => new Date(t).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
function gbRows() {
  const rows = (GB.snap && GB.snap.rows) || [];
  return GB.all ? rows : rows.filter(r => gbShort(r) >= MIN_SHORT);
}

// 表（樹種×長さごとのまとまり）。sheet=true は送る画像用（白い紙）
function gbTable(rows, sheet) {
  const groups = [];
  for (const r of rows) {
    const k = `${r.s}${r.L}M`;
    let g = groups.find(x => x.k === k);
    if (!g) { g = { k, s: r.s, rows: [] }; groups.push(g); }
    g.rows.push(r);
  }
  if (!groups.length) return `<div class="gb-none">${GB.all ? '行がありません' : '今は足りない原木はありません'}</div>`;
  return groups.map(g => {
    const sum = g.rows.reduce((a, r) => a + Math.max(0, gbShort(r)), 0);
    return `<div class="gb-group ${g.s === '桧' ? 'h' : 'sg'}"><div class="gb-gh"><span class="c-sp">${esc(g.s)}</span><b>${esc(g.k.slice(1))}</b>` +
      `${sum ? `<span class="gb-gsum">足りない ${sum.toFixed(1)}㎥</span>` : ''}</div>` +
      `<table class="gb-t"><thead><tr><th>径</th><th>目安</th><th>在庫</th><th>${GB.all ? '過不足' : '足りない'}</th><th>平均単価</th></tr></thead><tbody>` +
      g.rows.map(r => {
        const d = gbShort(r);
        const cls = d >= MIN_SHORT ? 'short' : d <= -MIN_SHORT ? 'over' : '';
        const p = GB.price[`${r.s}|${r.L}|${r.D}`];
        return `<tr class="${cls}"><td class="dia">${esc(r.D)}${/^\d+$/.test(r.D) ? '㎝' : ''}</td><td>${r.g}</td><td>${r.f.toFixed(1)}</td>` +
          `<td class="d">${d >= MIN_SHORT ? d.toFixed(1) + '㎥' : GB.all ? (d <= -MIN_SHORT ? '+' + (-d).toFixed(1) : '±') : ''}</td>` +
          `<td class="p">${p ? '¥' + Math.round(p).toLocaleString() : '―'}</td></tr>`;
      }).join('') + '</tbody></table></div>';
  }).join('');
}

function gbDraw() {
  const box = $('genboku-view');
  const s = GB.snap;
  const shorts = s ? s.rows.filter(r => gbShort(r) >= MIN_SHORT) : [];
  const total = shorts.reduce((a, r) => a + gbShort(r), 0);
  box.innerHTML =
    `<div class="gb-head block"><img class="gb-ill" src="${ILLUST.truck}" alt="原木を積んだトラックのイラスト">` +
    `<div class="gb-sum"><div class="gb-title dg">原木仕入れ</div>` +
    (s ? `<div class="gb-big"><span>買う原木</span><b class="dg">${total.toFixed(1)}</b><span>㎥</span><small>${shorts.length}件</small></div>` +
      `<div class="gb-meta">原木管理マスター ${s.month}月のタブ／更新 ${gbWhen(s.taken_at)}${s.taken_by ? '（' + esc(s.taken_by) + '）' : ''}<br>目安＝1.5ヵ月分の製材量。目安−在庫が1㎥以上の所を載せています</div>`
       : '<div class="gb-meta">まだ読み込んでいません。「更新」を押してください。</div>') +
    `</div><div class="gb-acts">` +
    `<button class="bigbtn dg" id="gb-refresh">更新</button>` +
    `<button class="bigbtn go dg" id="gb-send">${GB.test ? '自分あてに試し送り' : '中野課長・竹中さんへ送る'}</button>` +
    `<label class="gb-chk"><input type="checkbox" id="gb-test"${GB.test ? ' checked' : ''}> ためしに自分あてに送る</label>` +
    `<label class="gb-chk"><input type="checkbox" id="gb-all"${GB.all ? ' checked' : ''}> 足りない所だけでなく全部の行を出す</label>` +
    `<p class="hint" id="gb-msg"></p></div></div>` +
    `<div class="gb-body">${s ? gbTable(gbRows()) : ''}</div>`;
}

async function gbRefresh(btn) {
  const msg = $('gb-msg');
  btn.disabled = true; msg.textContent = 'スプシを読み直しています…';
  try {
    if (!Store.remote) { msg.textContent = '試作モードなので読み直しません'; return; }
    const { data, error } = await Store.sb.functions.invoke('genboku_refresh', { body: {} });
    if (error) {
      let m = error.message;
      try { const b = await error.context.json(); if (b && b.error) m = b.error; } catch (e) {}
      throw new Error(m);
    }
    GB.snap = data.snapshot;
    gbDraw();
    toast('更新しました');
  } catch (e) { msg.textContent = '更新できませんでした：' + e.message; }
  finally { btn.disabled = false; }
}

async function gbSend(btn) {
  const s = GB.snap;
  if (!s) return;
  const shorts = s.rows.filter(r => gbShort(r) >= MIN_SHORT);
  const total = shorts.reduce((a, r) => a + gbShort(r), 0).toFixed(1);
  const targets = GB.test ? ['test'] : ['nakano', 'takenaka'];
  const who = GB.test ? '自分あて（ためし）' : '中野課長・竹中さん';
  if (!confirm(`原木仕入れの明細（足りない ${total}㎥・${shorts.length}件）を画像にして、${who} へ WORKS で送ります。よろしいですか？`)) return;
  const msg = $('gb-msg');
  btn.disabled = true; msg.textContent = '画像を作っています…';
  try {
    const now = gbWhen(s.taken_at);
    const html = `<div class="sheet gb-sheet"><div class="sheet-head"><b>原木の仕入れ 必要明細</b><span>足りない 合計 ${total}㎥（${shorts.length}件）</span>` +
      `<small>原木管理マスター ${s.month}月／更新 ${now}</small></div>` +
      `<div class="gb-body">${gbTable(shorts.slice().sort((a, b) => 0))}</div></div>`;
    const keepAll = GB.all; GB.all = false;
    const png = await sheetPng(html);
    GB.all = keepAll;
    if (!Store.remote) { msg.textContent = '試作モードなので送りません（画像は作れました）'; return; }
    const title = `【原木の仕入れ】足りない分 合計 ${total}㎥（${shorts.length}件）\n原木管理マスター ${s.month}月／更新 ${now}`;
    const sent = [];
    for (const t of targets) {
      msg.textContent = '送っています…';
      const { data, error } = await Store.sb.functions.invoke('works_send', { body: { target: t, title, png } });
      if (error) {
        let m = error.message;
        try { const b = await error.context.json(); if (b && b.error) m = b.error; } catch (e) {}
        throw new Error(m + (sent.length ? `（${sent.join('・')} へは送れています）` : ''));
      }
      sent.push(data.to);
    }
    msg.textContent = `${sent.join('・')} へ送りました`;
    toast(`${sent.join('・')} へ送りました`);
  } catch (e) { msg.textContent = '送れませんでした：' + e.message; }
  finally { btn.disabled = false; }
}

document.addEventListener('click', ev => {
  if (!ev.target.closest('#genboku-view')) return;
  if (ev.target.closest('#gb-refresh')) return gbRefresh(ev.target.closest('#gb-refresh'));
  if (ev.target.closest('#gb-send')) return gbSend(ev.target.closest('#gb-send'));
});
document.addEventListener('change', ev => {
  if (ev.target.id === 'gb-all') { GB.all = ev.target.checked; gbDraw(); }
  if (ev.target.id === 'gb-test') { GB.test = ev.target.checked; gbDraw(); }
});
