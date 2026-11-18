// データの読み書き
//   config.js に接続先がある → Supabase（Googleでログインした専務だけが読み書きできる）
//   config.js が空           → 試作モード（sample.js のサンプルデータ。保存はこの画面を閉じるまで）
// app.js からは Store の関数だけを使う。

const Store = {
  remote: !!(typeof SUPABASE_URL !== 'undefined' && SUPABASE_URL && SUPABASE_ANON_KEY),
  sb: null,
  user: null,
  lanes: [],
  holidays: {},
  mem: [],   // 試作モードのカード

  // 戻り値：{ ok: true } / ログインが要るときは { needLogin: true }
  async init() {
    if (!this.remote) {
      const s = typeof SAMPLE !== 'undefined' ? SAMPLE : { lanes: [], entries: [], holidays: [] };
      this.lanes = s.lanes;
      this.mem = s.entries.map(e => ({ ...e }));
      this.holidays = Object.fromEntries((s.holidays || []).map(h => [h.day, h.label || '休み']));
      return { ok: true };
    }
    this.sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: { session } } = await this.sb.auth.getSession();
    if (!session) return { needLogin: true };
    this.user = session.user;
    const [l, h] = await Promise.all([
      this.sb.from('lanes').select('*').order('sort'),
      this.sb.from('holidays').select('*'),
    ]);
    if (l.error) throw new Error('段の読み込みに失敗しました：' + l.error.message);
    if (!l.data.length) return { notEditor: true };   // 鍵（RLS）で弾かれると0件になる
    this.lanes = l.data;
    this.holidays = Object.fromEntries((h.data || []).map(x => [x.day, x.label || '休み']));
    return { ok: true };
  },

  login() {
    return this.sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
  },
  async logout() { await this.sb.auth.signOut(); location.reload(); },

  // from〜to に掛かるカード
  async range(from, to) {
    if (!this.remote) return this.mem.filter(e => e.date_from <= to && e.date_to >= from);
    const { data, error } = await this.sb.from('entries').select('*').lte('date_from', to).gte('date_to', from).limit(2000);
    if (error) throw new Error('読み込みに失敗しました：' + error.message);
    return data;
  },

  // 保存（id があれば上書き、なければ新規）。保存後のカードを返す
  async save(e) {
    const row = { lane_id: Number(e.lane_id), date_from: e.date_from, date_to: e.date_to,
      from_half: Number(e.from_half ?? 0), to_half: Number(e.to_half ?? 1), body: e.body.trim(),
      status: e.status || '予定', color: e.color || null };
    if (!row.body) throw new Error('中身が空です');
    if (row.date_to < row.date_from || (row.date_to === row.date_from && row.to_half < row.from_half))
      throw new Error('終わりが始まりより前になっています');
    if (!this.remote) {
      if (e.id) { const i = this.mem.findIndex(x => x.id === e.id); this.mem[i] = { ...this.mem[i], ...row }; return this.mem[i]; }
      const n = { ...row, id: 'local-' + Date.now(), source: 'app' }; this.mem.push(n); return n;
    }
    const q = e.id ? this.sb.from('entries').update(row).eq('id', e.id) : this.sb.from('entries').insert(row);
    const { data, error } = await q.select().single();
    if (error) throw new Error('保存に失敗しました：' + error.message);
    return data;
  },

  async remove(id) {
    if (!this.remote) { this.mem = this.mem.filter(x => x.id !== id); return; }
    const { error } = await this.sb.from('entries').delete().eq('id', id);
    if (error) throw new Error('削除に失敗しました：' + error.message);
  },

  // 過去から呼び出す：似た書き方の過去カード（段で絞れる）
  async searchPast(q, laneId) {
    q = (q || '').trim();
    if (!this.remote) {   // 本番の search_past と同じ探し方（全角半角などのゆれをそろえ、言葉が全部入っているもの）
      const norm = s => s.normalize('NFKC').toLowerCase();
      const toks = norm(q).split(/\s+/).filter(Boolean);
      return this.mem.filter(e => (!laneId || e.lane_id === Number(laneId)) && toks.every(t => norm(e.body).includes(t)))
        .sort((a, b) => b.date_from.localeCompare(a.date_from)).slice(0, 20);
    }
    if (!q) {   // 何も打っていないとき：この段の最近のカード
      let r = this.sb.from('entries').select('id,lane_id,date_from,body').order('date_from', { ascending: false }).limit(20);
      if (laneId) r = r.eq('lane_id', Number(laneId));
      const { data, error } = await r;
      if (error) throw new Error(error.message);
      return data;
    }
    const { data, error } = await this.sb.rpc('search_past', { q, lane: laneId ? Number(laneId) : null, lim: 20 });
    if (error) throw new Error('検索に失敗しました：' + error.message);
    return data;
  },
};
