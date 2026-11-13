import { useEffect, useRef, useState } from 'react';
import { Check, ExternalLink, KeyRound, ShieldCheck, X } from 'lucide-react';
import { providers } from '../ai';
import type { Settings } from '../types';

export default function SettingsDialog({ settings, onSave, onClose }: { settings: Settings; onSave: (settings: Settings) => void; onClose: () => void }) {
  const [value, setValue] = useState<Settings>({ ...settings, keys: { ...settings.keys } });
  const ref = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<'keys' | 'compare'>('keys');
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal?.();
    return () => dialog?.close?.();
  }, []);
  return <dialog ref={ref} open={!HTMLDialogElement.prototype.showModal} className="settings-dialog" aria-labelledby="settings-title" onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="dialog-content">
      <div className="dialog-heading"><span className="eyebrow">YOUR WRITING COMPANION</span><button className="icon-button" autoFocus aria-label="关闭设置" onClick={onClose}><X size={20} /></button></div>
      <h2 id="settings-title">给小日子，找一位搭子</h2><p className="muted">选择你喜欢的 AI，让记录更轻松一点。</p>
      <div className="tabs"><button className={tab === 'keys' ? 'selected' : ''} onClick={() => setTab('keys')}>模型与密钥</button><button className={tab === 'compare' ? 'selected' : ''} onClick={() => setTab('compare')}>价格与效果</button></div>
      {tab === 'keys' ? <>
        <div className="provider-options">{(['deepseek', 'minimax'] as const).map(p => <button key={p} className={`provider-option ${value.provider === p ? 'selected' : ''}`} onClick={() => setValue({ ...value, provider: p })}><span className="provider-letter">{p === 'deepseek' ? 'D' : 'M'}</span><span><strong>{providers[p].name}</strong><small>{providers[p].model}</small></span>{value.provider === p && <Check size={18} />}</button>)}</div>
        {(['deepseek', 'minimax'] as const).map(p => <div className="key-field" key={p}><label htmlFor={`key-${p}`}>{providers[p].name} API 密钥</label><div className="key-input"><KeyRound size={16} /><input id={`key-${p}`} type="password" autoComplete="off" placeholder="填写你自己的 API Key" value={value.keys[p]} onChange={e => setValue({ ...value, keys: { ...value.keys, [p]: e.target.value } })} /></div><a href={providers[p].console} target="_blank" rel="noreferrer">到官方平台获取密钥 <ExternalLink size={12} /></a></div>)}
        <label className="checkbox-row"><input type="checkbox" checked={value.rememberKeys} onChange={e => setValue({ ...value, rememberKeys: e.target.checked })} /><span>在此浏览器记住 API 密钥</span></label>
        <p className="small muted">默认仅保留在当前页面内存中，刷新后需重新填写。勾选后密钥将以明文保存在浏览器本地，请勿在共享设备上使用。</p>
        <div className="privacy-note"><ShieldCheck size={19} /><p>日记只保存在你的浏览器。调用 AI 时，仅向所选模型发送当前这一篇的对话，不发送其他历史记录。</p></div>
      </> : <div className="comparison">
        <p className="small muted">官方人民币定价 · 核查于 2026-11-13 · 每百万 tokens</p>
        <div className="table-wrap"><table><thead><tr><th>模型</th><th>输入 / 输出</th><th>适合此场景的设置</th></tr></thead><tbody><tr><td>DeepSeek Flash</td><td>空闲 ¥1 / ¥4<br />高峰 ¥2 / ¥8</td><td>关闭思考<br />官方 JSON 模式</td></tr><tr><td>MiniMax M3.1 Flash</td><td>¥1 / ¥4</td><td>低思考档位<br />思考无法关闭</td></tr></tbody></table></div>
        <p className="small">DeepSeek 高峰为北京时间工作日（不含法定节假日）9–12 点、14–18 点。缓存命中输入更便宜：DeepSeek ¥0.02–0.04，MiniMax ¥0.10。</p>
        <h3>一千次回复，大约多少钱？</h3><p className="small">按每次 2,000 输入、300 输出 tokens 估算：DeepSeek ¥3.2–6.4，MiniMax ¥3.2。未计额外思考 tokens、归档和纠错调用；长对话重复发送上下文，实际费用会增长。</p>
        <h3>哪个更适合写日记？</h3><p className="small">默认 DeepSeek：短追问、纠错和翻译无需复杂推理，关闭思考更合适。MiniMax 可作为措辞风格的备选，但强制思考可能增加耗时和费用。</p><p className="comparison-caveat">尚未使用真实密钥做质量对比，以上是接口能力判断，不是效果排名。建议用相同的中英文内容分别测试忠实度、纠错准确性、追问自然度和耗时。</p>
        <div className="source-links"><a href="https://api-docs.deepseek.com/zh-cn/quick_start/pricing" target="_blank" rel="noreferrer">DeepSeek 官方定价 <ExternalLink size={12} /></a><a href="https://platform.minimaxi.com/docs/guides/pricing-paygo" target="_blank" rel="noreferrer">MiniMax 官方定价 <ExternalLink size={12} /></a></div>
      </div>}
      <button className="primary full" onClick={() => onSave({ ...value, keys: { deepseek: value.keys.deepseek.trim(), minimax: value.keys.minimax.trim() } })}>保存设置 <Check size={16} /></button>
    </div>
  </dialog>;
}
