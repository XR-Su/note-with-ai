import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowLeft, ArrowRight, BookOpen, Check, ChevronDown, CircleHelp, Clock3, Feather, History, Leaf, LoaderCircle, Menu, MessageCircle, Pencil, Plus, Search, Send, Settings2, ShieldCheck, Sparkles, Sun, Trash2, Upload, X } from 'lucide-react';
import type { AIAction, Entry, Mode, Settings } from './types';
import { createEntry, ENTRIES_KEY, localDate, mergeEntries, persistSettings, readEntries, readSettings, saveEntries } from './journal';
import { providers, requestAI } from './ai';
import SettingsDialog from './components/SettingsDialog';

function loadInitial() {
  try { return { entries: readEntries(localStorage), error: '', blocked: false }; }
  catch (error) { return { entries: [] as Entry[], error: (error as Error).message, blocked: true }; }
}

export default function App() {
  const [initial] = useState(loadInitial);
  const [entries, setEntries] = useState<Entry[]>(initial.entries);
  const entriesRef = useRef(entries);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [settings, setSettings] = useState(() => readSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [query, setQuery] = useState('');
  const search = useDeferredValue(query);
  const [filter, setFilter] = useState<'all' | Mode>('all');
  const [storageError, setStorageError] = useState(initial.error);
  const [aiError, setAIError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const [retry, setRetry] = useState<{ entryId: string; action: AIAction; messageId?: string } | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const active = entries.find(e => e.id === activeId);
  const todaysEntry = entries.find(e => e.mode === 'daily' && e.date === localDate());
  const visibleEntries = entries.filter(e => (filter === 'all' || e.mode === filter) && `${e.title} ${e.date} ${e.summary} ${e.messages.map(m => m.content).join(' ')}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const userCount = active?.messages.filter(m => m.role === 'user').length || 0;
  const pendingAnswer = active?.messages.at(-1)?.role === 'user';
  const untranslated = active?.messages.some(m => m.role === 'user' && !m.english);
  const writeBlocked = useRef(initial.blocked);
  const writeReady = useRef(!navigator.locks);
  const lastSaved = useRef<string | null>(null);

  useEffect(() => {
    try { lastSaved.current = localStorage.getItem(ENTRIES_KEY); } catch { writeBlocked.current = true; }
    if (!navigator.locks || initial.blocked) return;
    let cancelled = false;
    let release: (() => void) | undefined;
    // StrictMode can clean up and rerun this effect before the lock callback runs.
    // Skip a cancelled setup before requesting a lock that the next setup needs.
    void Promise.resolve().then(() => {
      if (cancelled) return;
      return navigator.locks.request('little-days.writer', { ifAvailable: true }, async lock => {
        if (cancelled) return;
        if (!lock) {
          writeBlocked.current = true;
          setStorageError('另一个标签页正在使用日记。本页只读；请关闭另一个标签页后刷新，避免覆盖记录。');
          return;
        }
        try {
          const fresh = readEntries(localStorage);
          lastSaved.current = localStorage.getItem(ENTRIES_KEY);
          entriesRef.current = fresh;
          setEntries(fresh);
        } catch (error) {
          writeBlocked.current = true;
          setStorageError((error as Error).message);
          return;
        }
        writeReady.current = true;
        await new Promise<void>(resolve => { release = resolve; });
        writeReady.current = false;
      });
    }).catch(() => {
      if (cancelled) return;
      writeBlocked.current = true;
      setStorageError('无法获取浏览器写入权限，请刷新重试或导出备份。');
    });
    return () => { cancelled = true; release?.(); };
  }, [initial.blocked]);

  useEffect(() => { bottom.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' }); }, [activeId, active?.messages.length, busy]);
  useEffect(() => {
    if (deleteId) deleteDialog.current?.showModal?.();
    else deleteDialog.current?.close?.();
  }, [deleteId]);
  useEffect(() => () => operation.current?.abort(), []);
  useEffect(() => {
    // Another tab may have newer records; do not silently overwrite them.
    const onStorage = (e: StorageEvent) => {
      if (e.key === ENTRIES_KEY || e.key === null) {
        operation.current?.abort();
        operation.current = null;
        setBusy(false);
        setStorageError('另一标签页更改了日记。请先导出当前页面备份，再刷新以加载最新记录；已暂停本页写入。');
        writeBlocked.current = true;
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  function commit(next: Entry[]) {
    entriesRef.current = next;
    setEntries(next);
    if (writeBlocked.current) return;
    try {
      if (!writeReady.current) throw new Error('正在准备浏览器写入权限，请稍后重试。');
      if (localStorage.getItem(ENTRIES_KEY) !== lastSaved.current) {
        writeBlocked.current = true;
        throw new Error('本地记录已被其他页面更改，已停止写入。请先备份当前内容，再刷新。');
      }
      saveEntries(localStorage, next);
      lastSaved.current = JSON.stringify(next);
      setStorageError('');
    }
    catch (error) { setStorageError((error as Error).message); }
  }

  function updateEntry(id: string, transform: (e: Entry) => Entry) {
    commit(entriesRef.current.map(e => e.id === id ? { ...transform(e), updatedAt: new Date().toISOString() } : e));
  }

  function navigate(id: string | null) {
    operation.current?.abort();
    operation.current = null;
    setBusy(false);
    setAIError('');
    setRetry(null);
    setEditing(null);
    setActiveId(id);
    setSidebarOpen(false);
  }

  function start(mode: Mode) {
    if (writeBlocked.current) { setNotice('本地存储读取异常，请先备份并处理顶部提示。'); return; }
    if (!writeReady.current) { setNotice('正在准备本地存储，请稍后再试。'); return; }
    const entry = createEntry(entriesRef.current, mode);
    if (!entriesRef.current.some(e => e.id === entry.id)) commit([...entriesRef.current, entry]);
    navigate(entry.id);
  }

  async function runAI(entry: Entry, action: AIAction, messageId?: string) {
    if (operation.current) return;
    if (writeBlocked.current || !writeReady.current) { setNotice('本地存储不可写，请先处理保存提示。'); return; }
    if (action === 'archive' && (entry.draft.trim() || editing || !entry.messages.some(m => m.role === 'user') || entry.messages.some(m => m.role === 'user' && !m.english))) {
      setAIError('请先发送或清空草稿，并完成回答的英文表达，再归档。');
      return;
    }
    const key = settings.keys[settings.provider];
    if (!key) { setSettingsOpen(true); return; }
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setAIError('');
    setRetry(null);
    try {
      const context = action === 'correct' ? { ...entry, messages: entry.messages.slice(0, entry.messages.findIndex(m => m.id === messageId) + 1) } : entry;
      const result = await requestAI(context, settings, key, action, controller.signal);
      if (controller.signal.aborted || operation.current !== controller) return;
      updateEntry(entry.id, current => {
        if (action === 'archive') return { ...current, title: result.title, summary: result.summary, archived: true };
        const targetId = messageId || entry.messages.at(-1)?.id;
        const messages = current.messages.map(m => m.id === targetId ? { ...m, english: result.english, explanation: result.explanation, translation: result.translation } : m);
        if (action === 'chat') messages.push({ id: crypto.randomUUID(), role: 'assistant', content: result.question, chinese: result.chinese });
        return { ...current, messages };
      });
    } catch (error) {
      if (operation.current === controller && !controller.signal.aborted) {
        setAIError((error as Error).message);
        setRetry({ entryId: entry.id, action, messageId });
      }
    } finally {
      if (operation.current === controller) { operation.current = null; setBusy(false); }
    }
  }

  function send() {
    if (!active || busy || !active.draft.trim() || active.archived || pendingAnswer || untranslated || editing) return;
    if (!settings.keys[settings.provider]) { setSettingsOpen(true); return; }
    const next = { ...active, draft: '', summary: '', messages: [...active.messages, { id: crypto.randomUUID(), role: 'user' as const, content: active.draft.trim() }] };
    updateEntry(active.id, () => next);
    void runAI(next, 'chat');
  }

  function saveEdit() {
    if (!active || !editing?.text.trim() || busy) return;
    if (!settings.keys[settings.provider]) { setSettingsOpen(true); return; }
    const next = { ...active, archived: false, summary: '', messages: active.messages.map(m => m.id === editing.id ? { ...m, content: editing.text.trim(), english: undefined, explanation: undefined, translation: undefined } : m) };
    const messageId = editing.id;
    updateEntry(active.id, () => next);
    setEditing(null);
    void runAI(next, next.messages.at(-1)?.id === messageId ? 'chat' : 'correct', messageId);
  }

  function exportBackup(raw = false) {
    try {
      const content = raw ? localStorage.getItem(ENTRIES_KEY) || '[]' : JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), entries: entriesRef.current }, null, 2);
      const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url; link.download = `little-days-${localDate()}${raw ? '-raw' : ''}.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setNotice('无法导出，请检查浏览器文件下载及存储权限。'); }
  }

  async function importBackup(file?: File) {
    if (!file) return;
    try {
      if (writeBlocked.current) throw new Error('当前存储读取异常，请先导出原始数据，解决顶部提示后再导入。');
      if (file.size > 20 * 1024 * 1024) throw new Error('备份文件超过 20 MB，请使用更小的备份。');
      const data = JSON.parse(await file.text());
      const merged = mergeEntries(entriesRef.current, Array.isArray(data) ? data : data.entries);
      const count = merged.length - entriesRef.current.length;
      commit(merged);
      setNotice(`已导入 ${count} 篇记录；相同 ID 或同一天的已有日记不会被覆盖。`);
    } catch (error) { setNotice(error instanceof SyntaxError ? '不是有效的 JSON 日记备份。' : (error as Error).message); }
    if (fileInput.current) fileInput.current.value = '';
  }

  function changeSettings(next: Settings) {
    try { persistSettings(localStorage, next); setSettings(next); setSettingsOpen(false); setNotice('AI 设置已更新。'); }
    catch (error) { setNotice((error as Error).message); }
  }

  const sidebar = <>
    <button className="brand" onClick={() => navigate(null)} aria-label="小日子首页"><span className="brand-mark"><Feather size={23} strokeWidth={1.6} /></span><span><strong>Little Days<span className="brand-dot">.</span></strong><small>小日子 · 用英文留住生活</small></span></button>
    <button className="new-entry" onClick={() => start('daily')}><Plus size={18} />记录今天<span>写一页新故事</span></button>
    <nav className="sidebar-nav" aria-label="记录导航"><button className={!activeId ? 'active' : ''} onClick={() => navigate(null)}><BookOpen size={18} />我的小日子</button><button onClick={() => start('memory')}><History size={18} />拾起一段回忆<Plus size={15} className="nav-end" /></button></nav>
    <div className="history-heading"><span>我的记录</span><span>{entries.length}</span></div>
    <div className="search-box"><Search size={15} /><input aria-label="搜索记录" placeholder="寻找某个小日子…" value={query} onChange={e => setQuery(e.target.value)} /></div>
    <div className="history-filters">{([['all', '全部'], ['daily', '日记'], ['memory', '回忆']] as const).map(([value, label]) => <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{label}</button>)}</div>
    <div className="history-list">{visibleEntries.length ? visibleEntries.map(e => <button key={e.id} className={`history-entry ${activeId === e.id ? 'active' : ''}`} onClick={() => navigate(e.id)}><span className={`entry-icon ${e.mode}`}>{e.mode === 'daily' ? <Sun size={16} /> : <History size={16} />}</span><span className="history-text"><strong>{e.title}</strong><small>{e.date.replaceAll('-', '.')}<span className={e.archived ? '' : 'in-progress'}>{e.archived ? '已归档' : '记录中'}</span></small></span></button>) : <div className="history-empty"><BookOpen size={24} strokeWidth={1.2} /><p>{query ? '没有找到这段故事' : '这里会慢慢装满你的故事'}</p><small>{query ? '试试其他关键词' : '从今天的一件小事开始吧'}</small></div>}</div>
    <div className="sidebar-footer"><button aria-label="AI 设置" onClick={() => { setSettingsOpen(true); setSidebarOpen(false); }}><Settings2 size={17} />AI 设置<span className="model-chip">{providers[settings.provider].name}</span></button><div className="backup-buttons"><button onClick={() => exportBackup()}><ArrowDownToLine size={14} />导出备份</button><button disabled={busy} onClick={() => fileInput.current?.click()}><Upload size={14} />导入</button></div><p><ShieldCheck size={13} />只保存在这个浏览器，不自动同步</p></div>
  </>;

  return <div className="app-shell">
    <aside className={`sidebar ${sidebarOpen ? 'is-open' : ''}`} aria-label="日记侧栏"><button className="mobile-close icon-button" aria-label="关闭记录列表" onClick={() => setSidebarOpen(false)}><X size={20} /></button>{sidebar}</aside>
    {sidebarOpen && <button className="sidebar-scrim" aria-label="关闭侧栏" onClick={() => setSidebarOpen(false)} />}
    <main className="main-panel">
      <header className="topbar"><div className="topbar-left"><button className="mobile-menu icon-button" aria-label="打开记录列表" onClick={() => setSidebarOpen(true)}><Menu size={22} /></button><span className="breadcrumb">我的小日子{active && <><span>/</span>{active.mode === 'daily' ? '当天日记' : '回忆'}</>}</span></div><div className="topbar-right"><span className={`save-status ${storageError ? 'error' : ''}`}><span />{storageError ? '保存异常' : '本地保存'}</span><button className="icon-button" aria-label="打开 AI 设置" onClick={() => setSettingsOpen(true)}><Settings2 size={18} /></button></div></header>
      {storageError && <div role="alert" className="storage-alert">{storageError}<button onClick={() => exportBackup()}>导出当前内容</button><button onClick={() => exportBackup(true)}>导出原始存储</button></div>}
      {notice && <div role="status" className="notice">{notice}<button className="icon-button" aria-label="关闭提示" onClick={() => setNotice('')}><X size={15} /></button></div>}
      {!active ? <div className="home-content">
        <div className="date-line"><span className="little-sun"><Sun size={17} /></span>{new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}<span className="date-rule" /></div>
        <section className="welcome"><div className="welcome-copy"><div className="eyebrow">A LITTLE SPACE, JUST FOR YOU</div><h1>Every little day<br />has a <em>story.</em></h1><p className="welcome-subtitle">平凡的日子里，也有值得留下的瞬间。</p><p className="welcome-description">不用完美的英文，也不用特别的故事。<br />和 AI 聊聊今天，或拾起一段回忆，让生活慢慢成为文字。</p></div><div className="journal-illustration" aria-hidden="true"><div className="illustration-orbit" /><div className="floating-leaf leaf-one"><Leaf size={43} strokeWidth={1.2} /></div><div className="floating-leaf leaf-two"><Leaf size={29} strokeWidth={1.2} /></div><div className="paper back-paper" /><div className="paper front-paper"><span className="paper-date">a little note to myself</span><div className="paper-title">Today was<br />a good day.</div><div className="paper-line" /><div className="paper-line short" /><div className="paper-line" /><div className="paper-line shorter" /><span className="paper-flower">✳</span><span className="paper-footer">and that is enough.</span></div><div className="illustration-caption">ordinary moments, extraordinary you</div></div></section>
        <section className="start-section"><div className="section-heading"><h2>今天，想从哪里开始？</h2><span>TAKE A MOMENT FOR YOURSELF</span></div><div className="mode-cards">
          <button className="mode-card daily-card" aria-label="记录今天" onClick={() => start('daily')}><span className="mode-card-top"><span className="mode-icon"><Sun size={26} strokeWidth={1.5} /></span><span className="pill">一天一篇，慢慢记录</span></span><span className="mode-english">A page for today</span><strong>记录今天</strong><span className="mode-description">从一件小事开始，回顾今天的经历与心情。<br />你的 AI 搭子会陪你，一点点写下来。</span><span className="card-action">{todaysEntry ? '回到今天的日记' : '开始今天的日记'}<ArrowRight size={18} /></span></button>
          <button className="mode-card memory-card" aria-label="拾起回忆" onClick={() => start('memory')}><span className="mode-card-top"><span className="mode-icon"><History size={26} strokeWidth={1.5} /></span><span className="pill">有些故事，值得回望</span></span><span className="mode-english">A moment to remember</span><strong>拾起回忆</strong><span className="mode-description">一次旅行，一个人，或一个转折的瞬间。<br />循着记忆，把过去的故事好好收藏。</span><span className="card-action">开启一段回忆<ArrowRight size={18} /></span></button>
        </div></section>
        <section className="how-it-works"><div className="how-label"><Sparkles size={17} /><span>让表达，轻松一点</span></div><div className="how-items"><div><span className="step-number">01</span><div><strong>像聊天一样记录</strong><p>一次一个问题，跟随你的节奏</p></div></div><div><span className="step-number">02</span><div><strong>中文英文，都可以</strong><p>原文下方，呈现自然的英文表达</p></div></div><div><span className="step-number">03</span><div><strong>故事，值得收藏</strong><p>生成英文总结，随时回来接着聊</p></div></div></div></section>
        {!settings.keys[settings.provider] && <button className="setup-banner" onClick={() => setSettingsOpen(true)}><span><CircleHelp size={19} /><span>第一次来？添加你自己的 API 密钥，就能开始和 AI 聊天。</span></span><strong>设置 AI<ArrowRight size={15} /></strong></button>}
        <footer className="home-footer"><Feather size={14} /><span>Not every day is special. But every day is yours.</span><span className="footer-local"><ShieldCheck size={13} />你的故事，只保存在你的浏览器</span></footer>
      </div> : <div className="entry-page">
        <div className="entry-heading"><button className="back-button" onClick={() => navigate(null)}><ArrowLeft size={15} />返回</button><div className="entry-meta"><span className={`entry-tag ${active.mode}`}>{active.mode === 'daily' ? <Sun size={14} /> : <History size={14} />}{active.mode === 'daily' ? '当天日记' : '一段回忆'}</span><span>{active.date.replaceAll('-', '.')}</span><span>{active.archived ? '已归档' : '记录中'}</span></div><div className="entry-title-row"><input aria-label="记录标题" className="entry-title" value={active.title} disabled={busy} maxLength={120} onChange={e => updateEntry(active.id, current => ({ ...current, title: e.target.value }))} /><button className="icon-button delete-button" aria-label="删除整篇记录" disabled={busy} onClick={() => setDeleteId(active.id)}><Trash2 size={18} /></button></div><p className="entry-intro">{active.mode === 'daily' ? '把今天的片刻，说给未来的自己听。' : '让记忆里的那个瞬间，再清晰一点。'}<span><MessageCircle size={13} />{userCount} 次分享</span></p></div>
        {active.archived && <section className="summary-card"><div className="summary-label"><BookOpen size={17} />YOUR STORY, IN ENGLISH<span><Check size={13} />已归档</span></div><h2>{active.title}</h2><p>{active.summary}</p><button className="text-button" onClick={() => updateEntry(active.id, e => ({ ...e, archived: false, summary: '' }))}>继续这段对话<ArrowRight size={16} /></button></section>}
        <div className="conversation" aria-label="日记对话">{active.messages.map(m => m.role === 'assistant' ? <article className="assistant-message" key={m.id}><span className="assistant-avatar"><Sparkles size={17} /></span><div><div className="message-label">LITTLE DAYS<span>你的记录搭子</span></div><p className="assistant-english">{m.content}</p>{m.chinese && <p className="assistant-chinese">{m.chinese}</p>}</div></article> : <article className="user-message" key={m.id}><div className="message-label">你的分享<button disabled={busy || !!editing} className="edit-message" aria-label="修改这条回答" onClick={() => { setEditing({ id: m.id, text: m.content }); setAIError(''); }}><Pencil size={13} />修改</button></div>{editing?.id === m.id ? <div className="edit-form"><textarea aria-label="修改回答" value={editing.text} onChange={e => setEditing({ ...editing, text: e.target.value })} /><p className="small muted">保存后重新生成英文表达，并清除旧总结；后续对话会保留。</p><button className="primary small-button" onClick={saveEdit} disabled={!editing.text.trim()}>保存并重新纠错</button><button className="text-button" onClick={() => setEditing(null)}>取消</button></div> : <><p className="original-text">{m.content}</p>{m.english ? <div className="english-version"><div className="english-label"><Sparkles size={13} />{m.translation ? '用英文这样表达' : '更自然的英文表达'}</div><p>{m.english}</p>{m.explanation && <div className="correction-note"><span>表达小贴士</span>{m.explanation}</div>}</div> : <div className="pending-translation"><Clock3 size={13} />英文表达待生成{!busy && <button className="text-button" onClick={() => void runAI(active, pendingAnswer && m.id === active.messages.at(-1)?.id ? 'chat' : 'correct', m.id)}>生成英文表达</button>}</div>}</>}</article>)}</div>
        {busy && <div className="thinking" role="status"><LoaderCircle size={16} className="spin" />正在认真读你的故事…<button className="text-button" onClick={() => { operation.current?.abort(); operation.current = null; setBusy(false); setAIError('已取消请求，原文已保留。'); }}>取消</button></div>}
        {aiError && <div className="ai-error" role="alert"><p>{aiError}</p>{retry && <button className="text-button" onClick={() => { const e = entriesRef.current.find(e => e.id === retry.entryId); if (e) void runAI(e, retry.action, retry.messageId); }}>重试本次请求</button>}<button className="text-button" onClick={() => setSettingsOpen(true)}>检查 AI 设置</button></div>}
        <div ref={bottom} />
        {!active.archived && <div className="composer-section"><div className="composer"><textarea aria-label="你的回答" placeholder="今天发生了什么？中文、英文都可以…" value={active.draft} disabled={busy || !!editing || !!pendingAnswer || !!untranslated} maxLength={10000} onChange={e => updateEntry(active.id, current => ({ ...current, draft: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} /><div className="composer-bottom"><span><Leaf size={13} />不用完美，真实就好</span><button className="send-button" aria-label="发送回答" disabled={busy || !active.draft.trim() || !!pendingAnswer || !!untranslated || !!editing} onClick={send}>{busy ? <LoaderCircle size={16} className="spin" /> : <Send size={16} />}<span>发送</span></button></div></div><div className="composer-footer"><span><ShieldCheck size={12} />{storageError ? '保存异常，请先备份' : '原文与草稿自动本地保存'}<span className="keyboard-hint"> · Ctrl / ⌘ + Enter 发送</span></span><button className="archive-button" disabled={busy || !userCount || !!untranslated || !!editing || !!active.draft.trim()} title={active.draft.trim() ? '请先发送或清空当前草稿' : '生成英文总结并归档'} onClick={() => void runAI(active, 'archive')}><Check size={14} />结束并归档</button></div><button className="model-selector" onClick={() => setSettingsOpen(true)}><span className="model-dot" />{providers[settings.provider].name}<ChevronDown size={12} /><span>只发送当前这一篇对话</span></button></div>}
      </div>}
    </main>
    <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={e => void importBackup(e.target.files?.[0])} />
    {settingsOpen && <SettingsDialog settings={settings} onSave={changeSettings} onClose={() => setSettingsOpen(false)} />}
    <dialog ref={deleteDialog} className="delete-dialog" open={!!deleteId && !HTMLDialogElement.prototype.showModal} aria-labelledby="delete-title" onCancel={() => setDeleteId(null)}><h2 id="delete-title">删除这段故事？</h2><p>整篇对话和英文总结都会从浏览器中删除，无法撤销。你可以先导出备份。</p><div><button className="secondary" onClick={() => setDeleteId(null)}>再想想</button><button className="danger" onClick={() => { commit(entriesRef.current.filter(e => e.id !== deleteId)); if (activeId === deleteId) navigate(null); setDeleteId(null); }}>确认删除</button></div></dialog>
  </div>;
}
