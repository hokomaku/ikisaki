import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createClient } from '@supabase/supabase-js'
import Papa from 'papaparse'
import './style.css'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null
const STATUS = ['未撮影', '済み', '再履修']
const RECORD_TYPES = ['定期', '定期外', '消滅']
const WEEKDAYS = ['平日', '土休日']
const TIMES = ['朝', '昼', '夕', '深夜']
const blankTarget = () => ({ company_id: '', format_id: '', category_id: '', destination: '', record_type: '定期', next_station: null, status: '未撮影', comment: '', weekdays: [], time_bands: [] })

function App() {
  const [session, setSession] = useState(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [companies, setCompanies] = useState([])
  const [formats, setFormats] = useState([])
  const [categories, setCategories] = useState([])
  const [targets, setTargets] = useState([])
  const [filters, setFilters] = useState({ company: '', format: '', category: '', destination: '', status: '', record_type: '', next_station: '', weekday: '', time: '' })
  const [page, setPage] = useState('list')
  const [editor, setEditor] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const [newFormat, setNewFormat] = useState({ company_id: '', name: '', has_next_station: false })
  const [newCompany, setNewCompany] = useState('')
  const [newCategory, setNewCategory] = useState('')
  const [newTarget, setNewTarget] = useState(blankTarget())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => { if (session) loadAll() }, [session])

  async function run(promise) {
    const { data, error } = await promise
    if (error) throw error
    return data
  }
  async function loadAll() {
    setLoading(true); setError('')
    try {
      const [c, f, k, t, conditions] = await Promise.all([
        run(supabase.from('companies').select('*').order('name')),
        run(supabase.from('formats').select('*').order('name')),
        run(supabase.from('categories').select('*').order('name')),
        run(supabase.from('targets').select('*').order('created_at', { ascending: false })),
        run(supabase.from('target_conditions').select('*')),
      ])
      const condMap = {}
      for (const item of conditions) {
        condMap[item.target_id] ||= { weekdays: [], time_bands: [] }
        condMap[item.target_id][item.kind === 'weekday' ? 'weekdays' : 'time_bands'].push(item.value)
      }
      setCompanies(c); setFormats(f); setCategories(k)
      setTargets(t.map(x => ({ ...x, ...(condMap[x.id] || { weekdays: [], time_bands: [] }) })))
    } catch (e) { setError(`データ読み込み失敗: ${e.message}`) }
    finally { setLoading(false) }
  }
  async function signIn(e) {
    e.preventDefault(); setError('')
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
    } catch (e) { setError(e.message) }
  }
  async function signOut() { await supabase.auth.signOut(); setSession(null) }
  async function addCompany() {
    if (!newCompany.trim()) return
    try { await run(supabase.from('companies').insert({ name: newCompany.trim() })); setNewCompany(''); await loadAll() }
    catch (e) { setError(e.message) }
  }
  async function addCategory() {
    if (!newCategory.trim()) return
    try { await run(supabase.from('categories').insert({ name: newCategory.trim() })); setNewCategory(''); await loadAll() }
    catch (e) { setError(e.message) }
  }
  async function addFormat() {
    if (!newFormat.company_id || !newFormat.name.trim()) return setError('所属会社と形式名を入力してください。')
    try {
      await run(supabase.from('formats').insert({ company_id: newFormat.company_id, name: newFormat.name.trim(), has_next_station: newFormat.has_next_station }))
      setNewFormat({ company_id: '', name: '', has_next_station: false }); await loadAll()
    } catch (e) { setError(e.message) }
  }
  function formatName(id) { return formats.find(x => x.id === id)?.name || '（形式不明）' }
  function companyName(id) { return companies.find(x => x.id === id)?.name || '（会社不明）' }
  function categoryName(id) { return categories.find(x => x.id === id)?.name || '（種別不明）' }
  function formatForTarget(t) { return formats.find(x => x.id === t.format_id) }
  function targetLabel(t) { return `${formatName(t.format_id)} / ${categoryName(t.category_id)}${t.destination}` + (t.next_station === true ? ' / 次駅あり' : t.next_station === false ? ' / 次駅なし' : '') }
  const visibleTargets = useMemo(() => targets.filter(t => {
    const f = formatForTarget(t)
    return (!filters.company || f?.company_id === filters.company) &&
      (!filters.format || t.format_id === filters.format) &&
      (!filters.category || t.category_id === filters.category) &&
      (!filters.destination || t.destination.toLowerCase().includes(filters.destination.toLowerCase())) &&
      (!filters.status || t.status === filters.status) &&
      (!filters.record_type || t.record_type === filters.record_type) &&
      (!filters.next_station || String(t.next_station) === filters.next_station) &&
      (!filters.weekday || t.weekdays?.includes(filters.weekday)) &&
      (!filters.time || t.time_bands?.includes(filters.time))
  }), [targets, filters, formats, categories])
  const progress = useMemo(() => {
    const list = visibleTargets.filter(t => t.record_type === '定期')
    const done = list.filter(t => ['済み', '再履修'].includes(t.status)).length
    return { done, total: list.length, pct: list.length ? Math.round(done / list.length * 100) : 0 }
  }, [visibleTargets])
  async function saveTarget(t) {
    setError('')
    if (!t.format_id || !t.category_id || !t.destination.trim()) return setError('形式・種別・行先は必須です。')
    const fmt = formats.find(x => x.id === t.format_id)
    if (fmt?.has_next_station && t.next_station === null) return setError('次駅あり／なしを選択してください。')
    if (!fmt?.has_next_station) t.next_station = null
    setBusy(true)
    try {
      const payload = { format_id: t.format_id, category_id: t.category_id, destination: t.destination.trim(), record_type: t.record_type, next_station: t.next_station, status: t.status, comment: t.comment || '' }
      let saved
      if (t.id) saved = await run(supabase.from('targets').update(payload).eq('id', t.id).select().single())
      else saved = await run(supabase.from('targets').insert(payload).select().single())
      await run(supabase.from('target_conditions').delete().eq('target_id', saved.id))
      const cond = [...(t.weekdays || []).map(value => ({ target_id: saved.id, kind: 'weekday', value })), ...(t.time_bands || []).map(value => ({ target_id: saved.id, kind: 'time', value }))]
      if (cond.length) await run(supabase.from('target_conditions').insert(cond))
      setEditor(null); setShowAdd(false); await loadAll()
    } catch (e) { setError(`保存失敗: ${e.message}`) }
    finally { setBusy(false) }
  }
  async function updateStatus(t, status) {
    try { await run(supabase.from('targets').update({ status }).eq('id', t.id)); setTargets(old => old.map(x => x.id === t.id ? { ...x, status } : x)) }
    catch (e) { setError(e.message) }
  }
  async function removeTarget(t) {
    if (!confirm(`「${targetLabel(t)}」を削除しますか？`)) return
    try { await run(supabase.from('targets').delete().eq('id', t.id)); setTargets(old => old.filter(x => x.id !== t.id)) }
    catch (e) { setError(e.message) }
  }
  async function bulkAdd() {
    if (!newTarget.format_id || !bulkText.trim()) return setError('形式と種別行先リストを入力してください。')
    const fmt = formats.find(x => x.id === newTarget.format_id)
    const lines = [...new Set(bulkText.split(/\r?\n/).map(x => x.trim()).filter(Boolean))]
    const sortedCategories = [...categories].sort((a,b) => b.name.length - a.name.length)
    const parsed = lines.map(line => {
      const category = sortedCategories.find(c => line.startsWith(c.name) && line.slice(c.name.length).trim())
      if (!category) throw new Error(`種別を判定できません: 「${line}」。種別マスタの名前で始まる形式にしてください。`)
      return { category_id: category.id, destination: line.slice(category.name.length).trim() }
    })
    const existing = new Set(targets.filter(t => t.format_id === newTarget.format_id && t.record_type === '定期').map(t => `${t.category_id}|${t.destination}`))
    const rows = parsed.filter(x => !existing.has(`${x.category_id}|${x.destination}`)).flatMap(item => {
      const base = { format_id: newTarget.format_id, category_id: item.category_id, destination: item.destination, record_type: '定期', status: '未撮影', comment: '' }
      return fmt?.has_next_station ? [{ ...base, next_station: true }, { ...base, next_station: false }] : [{ ...base, next_station: null }]
    })
    if (!rows.length) return setError('追加できる新規項目がありません（重複している可能性があります）。')
    setBusy(true)
    try { await run(supabase.from('targets').insert(rows)); setBulkText(''); setShowAdd(false); await loadAll() }
    catch (e) { setError(`一括追加失敗: ${e.message}`) }
    finally { setBusy(false) }
  }
  async function addExceptional() {
    const t = { ...newTarget, record_type: newTarget.record_type === '定期' ? '定期外' : newTarget.record_type }
    await saveTarget(t); setNewTarget(blankTarget())
  }
  function exportCsv() {
    const rows = targets.map(t => ({
      id: t.id, format_id: t.format_id, format_name: formatName(t.format_id), company: companyName(formatForTarget(t)?.company_id),
      category_id: t.category_id, category: categoryName(t.category_id), destination: t.destination,
      record_type: t.record_type, next_station: t.next_station === null ? '' : t.next_station ? 'あり' : 'なし',
      status: t.status, comment: t.comment || '', weekdays: (t.weekdays || []).join('|'), time_bands: (t.time_bands || []).join('|')
    }))
    const blob = new Blob(['\ufeff' + Papa.unparse(rows)], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'destination-targets.csv'; a.click(); URL.revokeObjectURL(url)
  }
  async function importCsv(file) {
    Papa.parse(file, { header: true, skipEmptyLines: true, complete: async ({ data, errors }) => {
      if (errors.length) return setError(`CSV解析エラー: ${errors[0].message}`)
      setBusy(true); setError('')
      try {
        // Existing IDs are updated. Rows without IDs are matched by format/category/destination/record type/next station.
        for (const row of data) {
          let fmt = formats.find(x => x.id === row.format_id) || formats.find(x => x.name === row.format_name && companyName(x.company_id) === row.company)
          let cat = categories.find(x => x.id === row.category_id) || categories.find(x => x.name === row.category)
          if (!fmt || !cat || !row.destination || !RECORD_TYPES.includes(row.record_type) || !STATUS.includes(row.status)) throw new Error(`形式・種別・状態を照合できません: ${row.format_name || row.format_id} / ${row.category || row.category_id} / ${row.destination}`)
          const next = row.next_station === '' ? null : row.next_station === 'あり' || row.next_station === 'true' ? true : false
          const payload = { format_id: fmt.id, category_id: cat.id, destination: row.destination, record_type: row.record_type, next_station: fmt.has_next_station ? next : null, status: row.status, comment: row.comment || '' }
          let saved
          if (row.id && targets.some(t => t.id === row.id)) saved = await run(supabase.from('targets').update(payload).eq('id', row.id).select().single())
          else {
            const match = targets.find(t => t.format_id === fmt.id && t.category_id === cat.id && t.destination === row.destination && t.record_type === row.record_type && t.next_station === payload.next_station)
            if (match) saved = await run(supabase.from('targets').update(payload).eq('id', match.id).select().single())
            else saved = await run(supabase.from('targets').insert(payload).select().single())
          }
          await run(supabase.from('target_conditions').delete().eq('target_id', saved.id))
          const cond = [...(row.weekdays || '').split('|').filter(Boolean).map(value => ({ target_id: saved.id, kind: 'weekday', value })), ...(row.time_bands || '').split('|').filter(Boolean).map(value => ({ target_id: saved.id, kind: 'time', value }))]
          if (cond.length) await run(supabase.from('target_conditions').insert(cond))
        }
        await loadAll(); alert(`${data.length}件をインポートしました。`)
      } catch (e) { setError(`インポート失敗: ${e.message}`) }
      finally { setBusy(false) }
    }})
  }

  if (!supabase) return <main className="shell"><header><h1>行先表示 撮影記録</h1></header><section className="panel"><h2>初期設定が必要です</h2><p>リポジトリ直下に <code>.env</code> を作成し、Supabase URL と公開用 anon/publishable key を設定してください。</p><p>セットアップ手順は README.md を参照してください。秘密鍵（service_role）は絶対にブラウザへ設定しないでください。</p></section></main>
  if (!session) return <main className="login shell"><section className="panel"><h1>行先表示 撮影記録</h1><p>許可されたアカウントでログイン</p><form onSubmit={signIn}><label>メールアドレス<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required /></label><label>パスワード<input type="password" value={password} onChange={e=>setPassword(e.target.value)} required /></label><button>ログイン</button></form>{error && <p className="error">{error}</p>}<small>アカウント作成はSupabase管理画面から行う想定です。</small></section></main>

  return <main className="shell">
    <header className="topbar"><div><h1>行先表示 撮影記録</h1><p className="muted">定期行先の残りを、出先で素早く確認</p></div><button className="secondary" onClick={signOut}>ログアウト</button></header>
    {error && <div className="errorbox" role="alert">{error}<button className="secondary" onClick={()=>setError('')}>閉じる</button></div>}
    <section className="progress-panel">
      <div><span className="muted">現在の検索条件（定期のみ）</span><div className="progress-number">{progress.pct}<small>%</small></div><div className="muted">{progress.done} / {progress.total} 件完了（再履修を含む）</div></div>
      <div className="progress-track"><div style={{width:`${progress.pct}%`}} /></div>
    </section>
    <nav className="tabs"><button className={page==='list'?'active':''} onClick={()=>setPage('list')}>撮影リスト</button><button className={page==='manage'?'active':''} onClick={()=>setPage('manage')}>マスタ管理</button><button className={page==='csv'?'active':''} onClick={()=>setPage('csv')}>CSV・バックアップ</button></nav>

    {page === 'list' && <>
      <section className="panel"><div className="section-heading"><h2>検索条件</h2><button className="secondary" onClick={()=>setFilters({company:'',format:'',category:'',destination:'',status:'',record_type:'',next_station:'',weekday:'',time:''})}>条件クリア</button></div>
        <div className="filter-grid">
          <label>所属会社<select value={filters.company} onChange={e=>setFilters({...filters,company:e.target.value,format:''})}><option value="">すべて</option>{companies.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          <label>形式<select value={filters.format} onChange={e=>setFilters({...filters,format:e.target.value})}><option value="">すべて</option>{formats.filter(x=>!filters.company||x.company_id===filters.company).map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          <label>種別<select value={filters.category} onChange={e=>setFilters({...filters,category:e.target.value})}><option value="">すべて</option>{categories.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          <label>行先<input value={filters.destination} onChange={e=>setFilters({...filters,destination:e.target.value})} placeholder="例：横浜" /></label>
          <label>撮影状況<select value={filters.status} onChange={e=>setFilters({...filters,status:e.target.value})}><option value="">すべて</option>{STATUS.map(x=><option key={x}>{x}</option>)}</select></label>
          <label>区分<select value={filters.record_type} onChange={e=>setFilters({...filters,record_type:e.target.value})}><option value="">すべて</option>{RECORD_TYPES.map(x=><option key={x}>{x}</option>)}</select></label>
          <label>次駅<select value={filters.next_station} onChange={e=>setFilters({...filters,next_station:e.target.value})}><option value="">すべて</option><option value="true">あり</option><option value="false">なし</option></select></label>
          <label>曜日<select value={filters.weekday} onChange={e=>setFilters({...filters,weekday:e.target.value})}><option value="">すべて</option>{WEEKDAYS.map(x=><option key={x}>{x}</option>)}</select></label>
          <label>時間帯<select value={filters.time} onChange={e=>setFilters({...filters,time:e.target.value})}><option value="">すべて</option>{TIMES.map(x=><option key={x}>{x}</option>)}</select></label>
        </div>
      </section>
      <div className="section-heading list-heading"><h2>撮影対象 <span className="muted">({visibleTargets.length}件)</span></h2><button onClick={()=>{setNewTarget(blankTarget());setBulkText('');setShowAdd(true)}}>＋ 追加</button></div>
      {showAdd && <section className="panel"><div className="section-heading"><h3>定期行先を一括追加</h3><button className="secondary" onClick={()=>setShowAdd(false)}>閉じる</button></div>
        <p className="muted">1行に「種別行先」を1件。例：快速横浜。既存の定期対象は追加されません。次駅対応形式は「あり／なし」を自動で2件作成します。</p>
        <div className="filter-grid"><label>形式<select value={newTarget.format_id} onChange={e=>setNewTarget({...newTarget,format_id:e.target.value})} required><option value="">選択</option>{formats.map(x=><option key={x.id} value={x.id}>{companyName(x.company_id)} / {x.name}</option>)}</select></label><label>種別<select value={newTarget.category_id} onChange={e=>setNewTarget({...newTarget,category_id:e.target.value})} required><option value="">選択</option>{categories.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label></div>
        <label>種別行先リスト<textarea rows="5" value={bulkText} onChange={e=>setBulkText(e.target.value)} placeholder={'快速横浜\n各駅停車海老名'} /></label><button disabled={busy} onClick={bulkAdd}>一括追加</button>
        <hr/><h3>定期外・消滅を個別追加</h3><div className="filter-grid">
          <label>形式<select value={newTarget.format_id} onChange={e=>setNewTarget({...newTarget,format_id:e.target.value})}><option value="">選択</option>{formats.map(x=><option key={x.id} value={x.id}>{companyName(x.company_id)} / {x.name}</option>)}</select></label>
          <label>種別<select value={newTarget.category_id} onChange={e=>setNewTarget({...newTarget,category_id:e.target.value})}><option value="">選択</option>{categories.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          <label>行先<input value={newTarget.destination} onChange={e=>setNewTarget({...newTarget,destination:e.target.value})} /></label>
          <label>区分<select value={newTarget.record_type} onChange={e=>setNewTarget({...newTarget,record_type:e.target.value})}><option>定期外</option><option>消滅</option></select></label>
        </div>
        {formats.find(x=>x.id===newTarget.format_id)?.has_next_station && <label>次駅<select value={newTarget.next_station===null?'':String(newTarget.next_station)} onChange={e=>setNewTarget({...newTarget,next_station:e.target.value===''?null:e.target.value==='true'})}><option value="">選択</option><option value="true">あり</option><option value="false">なし</option></select></label>}
        <button disabled={busy} onClick={addExceptional}>個別追加</button>
      </section>}
      <section className="target-list">{loading ? <p>読み込み中…</p> : visibleTargets.map(t=><article className="target-card" key={t.id}>
  <div className="target-main">
    {/* 見出し（target-title）に「種別 ＋ 行先」を表示 */}
    <div className="target-title">{categoryName(t.category_id)}{t.destination}</div>
    {/* サブテキスト（target-sub）から種別を除外して「会社 · 形式」のみ表示 */}
    <div className="target-sub">{companyName(formatForTarget(t)?.company_id)} · {formatName(t.format_id)}</div><div className="chips"><span className={`chip ${t.record_type==='定期'?'regular':''}`}>{t.record_type}</span>{t.next_station!==null&&<span className="chip">次駅{t.next_station?'あり':'なし'}</span>}{t.weekdays?.map(x=><span className="chip" key={x}>{x}</span>)}{t.time_bands?.map(x=><span className="chip" key={x}>{x}</span>)}</div>{t.comment&&<p className="comment">{t.comment}</p>}</div>
        <div className="target-actions"><select aria-label="撮影状況" value={t.status} onChange={e=>updateStatus(t,e.target.value)}>{STATUS.map(x=><option key={x}>{x}</option>)}</select><button className="secondary" onClick={()=>setEditor({...t})}>編集</button><button className="danger secondary" onClick={()=>removeTarget(t)}>削除</button></div>
      </article>)}</section>
      {editor && <div className="modal-backdrop"><section className="panel modal"><div className="section-heading"><h2>撮影対象を編集</h2><button className="secondary" onClick={()=>setEditor(null)}>閉じる</button></div><TargetEditor target={editor} setTarget={setEditor} formats={formats} categories={categories} companies={companies} onSave={()=>saveTarget(editor)} busy={busy}/></section></div>}
    </>}

    {page === 'manage' && <div className="manage-grid">
      <section className="panel"><h2>所属会社</h2><p className="muted">自由入力ではなく選択式で管理します。</p><div className="inline-form"><input value={newCompany} onChange={e=>setNewCompany(e.target.value)} placeholder="会社名"/><button onClick={addCompany}>追加</button></div><ul>{companies.map(x=><li key={x.id}>{x.name}</li>)}</ul></section>
      <section className="panel"><h2>種別マスタ</h2><p className="muted">「急行」「東急急行」など、表示の区別に必要な表記を登録します。CSVには含めません。</p><div className="inline-form"><input value={newCategory} onChange={e=>setNewCategory(e.target.value)} placeholder="例：東急急行"/><button onClick={addCategory}>追加</button></div><ul>{categories.map(x=><li key={x.id}>{x.name}</li>)}</ul></section>
      <section className="panel"><h2>形式</h2><div className="filter-grid"><label>所属会社<select value={newFormat.company_id} onChange={e=>setNewFormat({...newFormat,company_id:e.target.value})}><option value="">選択</option>{companies.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label><label>形式名<input value={newFormat.name} onChange={e=>setNewFormat({...newFormat,name:e.target.value})} placeholder="例：20000系"/></label></div><label className="check"><input type="checkbox" checked={newFormat.has_next_station} onChange={e=>setNewFormat({...newFormat,has_next_station:e.target.checked})}/> この形式には次駅表示がある</label><button onClick={addFormat}>形式を追加</button><hr/><div className="format-list">{formats.map(f=><div key={f.id}><b>{companyName(f.company_id)} / {f.name}</b><span className="muted">次駅表示：{f.has_next_station?'あり':'なし'}</span><button className="secondary" onClick={async()=>{const name=prompt('形式名',f.name);if(name===null)return;const co=companies.find(x=>x.id===f.company_id);const company=prompt('所属会社名',co?.name||'');if(company===null)return;try{let companyId=f.company_id;if(company!==co?.name){let found=companies.find(x=>x.name===company);if(!found)found=await run(supabase.from('companies').insert({name:company}).select().single());companyId=found.id}await run(supabase.from('formats').update({name,company_id:companyId}).eq('id',f.id));await loadAll()}catch(e){setError(e.message)}}}>名前・会社を変更</button><button className="secondary" onClick={async()=>{const value=confirm('次駅表示を「あり」に変更しますか？\\nキャンセルは「なし」に変更します。');try{await run(supabase.from('formats').update({has_next_station:value}).eq('id',f.id));if(value){const present=new Set(targets.filter(t=>t.format_id===f.id).map(t=>`${t.category_id}|${t.destination}|${t.record_type}|${t.next_station}`));const rows=[];for(const t of targets.filter(t=>t.format_id===f.id&&t.next_station===null)){for(const n of [true,false])if(!present.has(`${t.category_id}|${t.destination}|${t.record_type}|${n}`))rows.push({format_id:f.id,category_id:t.category_id,destination:t.destination,record_type:t.record_type,next_station:n,status:t.status,comment:t.comment})}if(rows.length)await run(supabase.from('targets').insert(rows))}await loadAll()}catch(e){setError(e.message)}}}>次駅フラグ変更</button></div>)}</div></section>
    </div>}

    {page === 'csv' && <section className="panel"><h2>CSV・バックアップ</h2><p>撮影対象データとコメント、区分、撮影状況、曜日・時間帯条件をCSVに出力します。種別マスタは含みません。</p><button onClick={exportCsv}>CSVを書き出す</button><hr/><h3>CSVを再インポート</h3><p className="muted">書き出したCSVを編集して再インポートすると、IDが一致する行は更新されます。IDのない行は既存対象と照合し、なければ追加します。CSVに存在しない行は削除しません。インポート前に必ず書き出しを保存してください。</p><label className="file-input">CSVファイルを選択<input type="file" accept=".csv,text/csv" onChange={e=>e.target.files?.[0]&&importCsv(e.target.files[0])}/></label>{busy&&<p>処理中…</p>}</section>}
    <footer>個人・家族用 / 写真データは保存しません。<span>読み込み・保存先：設定済みのSupabase</span></footer>
  </main>
}

function TargetEditor({target,setTarget,formats,categories,companies,onSave,busy}) {
  const fmt = formats.find(x=>x.id===target.format_id)
  const toggle = (key,val) => setTarget({...target,[key]:target[key]?.includes(val)?target[key].filter(x=>x!==val):[...(target[key]||[]),val]})
  return <div className="editor-form">
    <label>形式<select value={target.format_id} onChange={e=>setTarget({...target,format_id:e.target.value,next_station:null})}>{formats.map(f=><option key={f.id} value={f.id}>{companies.find(c=>c.id===f.company_id)?.name} / {f.name}</option>)}</select></label>
    <label>種別<select value={target.category_id} onChange={e=>setTarget({...target,category_id:e.target.value})}>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <label>行先<input value={target.destination} onChange={e=>setTarget({...target,destination:e.target.value})}/></label>
    <label>区分<select value={target.record_type} onChange={e=>setTarget({...target,record_type:e.target.value})}>{RECORD_TYPES.map(x=><option key={x}>{x}</option>)}</select></label>
    {fmt?.has_next_station&&<label>次駅<select value={target.next_station===null?'':String(target.next_station)} onChange={e=>setTarget({...target,next_station:e.target.value===''?null:e.target.value==='true'})}><option value="">選択</option><option value="true">あり</option><option value="false">なし</option></select></label>}
    <label>撮影状況<select value={target.status} onChange={e=>setTarget({...target,status:e.target.value})}>{STATUS.map(x=><option key={x}>{x}</option>)}</select></label>
    <fieldset><legend>曜日（複数選択可）</legend>{WEEKDAYS.map(x=><label className="check" key={x}><input type="checkbox" checked={target.weekdays?.includes(x)||false} onChange={()=>toggle('weekdays',x)}/>{x}</label>)}</fieldset>
    <fieldset><legend>時間帯（複数選択可）</legend>{TIMES.map(x=><label className="check" key={x}><input type="checkbox" checked={target.time_bands?.includes(x)||false} onChange={()=>toggle('time_bands',x)}/>{x}</label>)}</fieldset>
    <label>コメント<textarea rows="3" value={target.comment||''} onChange={e=>setTarget({...target,comment:e.target.value})}/></label>
    <button disabled={busy} onClick={onSave}>保存</button>
  </div>
}

createRoot(document.getElementById('root')).render(<App/>)

これのどこを書き換えたらいいのか