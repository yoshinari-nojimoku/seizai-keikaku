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
  speed: [],     // 挽く速さ（工場×樹種×長さ×径級）
  stops: [],     // 製材機を止める半日 [{lane_id, day, half, label}]
  qmem: [],      // 試作モードの生産順
  smem: {},      // 試作モードの生産順の始まり

  // 戻り値：{ ok: true } / ログインが要るときは { needLogin: true }
  async init() {
    if (!this.remote) {
      const s = typeof SAMPLE !== 'undefined' ? SAMPLE : { lanes: [], entries: [], holidays: [] };
      this.lanes = s.lanes;
      this.mem = s.entries.map(e => ({ ...e }));
      this.holidays = Object.fromEntries((s.holidays || []).map(h => [h.day, h.label || '休み']));
      this.speed = s.speed || [];
      this.stops = (s.stops || []).map(x => ({ ...x }));
      this.qmem = (s.queue || []).map(q => ({ ...q }));
      this.smem = { ...(s.queue_start || {}) };
      return { ok: true };
    }
    this.sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: { session } } = await this.sb.auth.getSession();
    if (!session) return { needLogin: true };
    this.user = session.user;
    const [l, h, sp, st] = await Promise.all([
      this.sb.from('lanes').select('*').order('sort'),
      this.sb.from('holidays').select('*'),
      this.sb.from('speed').select('*'),
      this.sb.from('stops').select('*').gte('day', D.add(D.today(), -120)),
    ]);
    this.stops = st.data || [];
    this.speed = (sp.data || []).map(r => ({ ...r, length_m: Number(r.length_m), per_day: Number(r.per_day), m3_day: Number(r.m3_day) }));
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

  // ===== 製材機を止める日 =====
  stopMap() { return Object.fromEntries(this.stops.map(x => [`${x.lane_id}|${x.day}|${x.half}`, x.label])); },
  stopSet(laneId) { return new Set(this.stops.filter(x => x.lane_id === Number(laneId)).map(x => `${x.day}|${x.half}`)); },
  // 押すたびに止める／戻す
  async toggleStop(laneId, day, half, label = 'ツイン止め') {
    laneId = Number(laneId); half = Number(half);
    const i = this.stops.findIndex(x => x.lane_id === laneId && x.day === day && x.half === half);
    if (i >= 0) {
      if (this.remote) {
        const { error } = await this.sb.from('stops').delete().match({ lane_id: laneId, day, half });
        if (error) throw new Error('戻せませんでした：' + error.message);
      }
      this.stops.splice(i, 1);
      return false;
    }
    if (this.remote) {
      const { error } = await this.sb.from('stops').insert({ lane_id: laneId, day, half, label });
      if (error) throw new Error('止める日の保存に失敗しました：' + error.message);
    }
    this.stops.push({ lane_id: laneId, day, half, label });
    return true;
  },

  // ===== 生産順 =====
  // 工場ごとの生産順（予定と、最近の済10件）
  async queueList(laneId) {
    if (!this.remote) {
      const all = this.qmem.filter(q => q.lane_id === laneId);
      return { todo: all.filter(q => q.status === '予定').sort((a, b) => a.seq - b.seq),
               done: all.filter(q => q.status === '済').sort((a, b) => String(b.done_at).localeCompare(String(a.done_at))).slice(0, 10) };
    }
    const [t, d] = await Promise.all([
      this.sb.from('queue').select('*').eq('lane_id', laneId).eq('status', '予定').order('seq'),
      this.sb.from('queue').select('*').eq('lane_id', laneId).eq('status', '済').order('done_at', { ascending: false }).limit(10),
    ]);
    if (t.error || d.error) throw new Error('生産順の読み込みに失敗しました：' + (t.error || d.error).message);
    return { todo: t.data, done: d.data };
  },

  async queueStart(laneId) {
    if (!this.remote) return this.smem[laneId] || null;
    const { data, error } = await this.sb.from('queue_start').select('*').eq('lane_id', laneId).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? { day: data.day, half: data.half } : null;
  },

  async setQueueStart(laneId, slot) {
    if (!this.remote) { this.smem[laneId] = { ...slot }; return; }
    const { error } = await this.sb.from('queue_start').upsert({ lane_id: laneId, day: slot.day, half: slot.half });
    if (error) throw new Error('始まりの保存に失敗しました：' + error.message);
  },

  // 生産順のカードを保存（id があれば上書き）
  async queueSave(it) {
    const row = { lane_id: Number(it.lane_id), seq: Number(it.seq || 0), kind: it.kind, species: it.species || null,
      length_m: it.length_m ? Number(it.length_m) : null, dia_from: it.dia_from ? Number(it.dia_from) : null,
      dia_to: it.dia_to ? Number(it.dia_to) : null, qty: it.qty ? Number(it.qty) : null, unit: it.unit || '本',
      halves_manual: it.halves_manual ? Number(it.halves_manual) : null, memo: (it.memo || '').trim(),
      status: it.status || '予定', done_at: it.done_at || null };
    if (!this.remote) {
      if (it.id) { const i = this.qmem.findIndex(x => x.id === it.id); this.qmem[i] = { ...this.qmem[i], ...row }; return this.qmem[i]; }
      const n = { ...row, id: 'q-' + Date.now() + Math.random().toString(36).slice(2, 6) }; this.qmem.push(n); return n;
    }
    const q = it.id ? this.sb.from('queue').update(row).eq('id', it.id) : this.sb.from('queue').insert(row);
    const { data, error } = await q.select().single();
    if (error) throw new Error('保存に失敗しました：' + error.message);
    return data;
  },

  async queueRemove(id) {
    if (!this.remote) { this.qmem = this.qmem.filter(x => x.id !== id); return; }
    const { error } = await this.sb.from('queue').delete().eq('id', id);
    if (error) throw new Error('削除に失敗しました：' + error.message);
  },

  // 並び順をまとめて書く [{id, seq}]
  async queueReorder(list) {
    if (!this.remote) { list.forEach(({ id, seq }) => { const x = this.qmem.find(q => q.id === id); if (x) x.seq = seq; }); return; }
    for (const { id, seq } of list) {
      const { error } = await this.sb.from('queue').update({ seq }).eq('id', id);
      if (error) throw new Error('並べ替えに失敗しました：' + error.message);
    }
  },

  // 生産順から作ったバーを予定表へ反映
  async syncBars(laneId, bars) {
    if (!this.remote) {
      const keep = new Set(this.qmem.filter(q => q.status === '済').map(q => 'queue:' + q.id));
      this.mem = this.mem.filter(e => !(e.lane_id === laneId && e.source === 'queue' && !keep.has(e.source_ref)));
      bars.forEach(b => this.mem.push({ id: 'b-' + b.ref, lane_id: laneId, status: '予定', source: 'queue', source_ref: b.ref, ...b }));
      return;
    }
    const { error } = await this.sb.rpc('sync_queue_bars', { p_lane: laneId, p_bars: bars });
    if (error) throw new Error('予定表への反映に失敗しました：' + error.message);
  },
};
