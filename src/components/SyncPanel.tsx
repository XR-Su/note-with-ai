import { useEffect, useRef, useState } from 'react';
import { Camera, Check, Copy, Download, RefreshCw, X } from 'lucide-react';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import type { DiarySync, SyncView } from '../sync';
import { SYNC_ENDPOINT } from '../sync-config';
import { TOKEN_PATTERN } from '../sync-format';
import type { Entry } from '../types';

function download(entries: Entry[], date: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, exportedAt: date, entries }, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = `little-days-before-sync-${date.slice(0, 10)}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function SyncPanel({ controller, view }: { controller: DiarySync | null; view: SyncView }) {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [show, setShow] = useState(false);
  const [qr, setQR] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const scanTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const stopped = useRef(false);
  const [copied, setCopied] = useState(false);
  const stopCamera = () => { stopped.current = true; stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; clearInterval(scanTimer.current); setScanning(false); };
  useEffect(() => () => { stopped.current = true; stream.current?.getTracks().forEach(t => t.stop()); clearInterval(scanTimer.current); }, []);
  useEffect(() => {
    if (!show || !view.token) { setQR(''); return; }
    let cancelled = false;
    void QRCode.toDataURL(view.token, { width: 220, margin: 2, errorCorrectionLevel: 'M' }).then(value => { if (!cancelled) setQR(value); }).catch(() => setError('二维码生成失败，请复制口令。'));
    return () => { cancelled = true; };
  }, [show, view.token]);
  async function action(callback: () => Promise<void> | void) {
    setWorking(true); setError('');
    try { await callback(); } catch (e) { setError((e as Error).message); }
    finally { setWorking(false); }
  }
  function decode(source: CanvasImageSource, width: number, height: number): boolean {
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1200 / Math.max(width, height));
    canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('此浏览器无法读取二维码，请粘贴口令。');
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const data = context.getImageData(0, 0, canvas.width, canvas.height);
    const result = jsQR(data.data, data.width, data.height);
    if (!result || !TOKEN_PATTERN.test(result.data)) return false;
    setToken(result.data); stopCamera(); setError(''); return true;
  }
  async function startCamera() {
    stopped.current = false; setError('');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('此浏览器无法调用相机，请读取二维码图片或粘贴口令。');
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      if (stopped.current) { media.getTracks().forEach(t => t.stop()); return; }
      stream.current = media; setScanning(true);
      // The video stays mounted so the stream can be assigned immediately.
      video.current!.srcObject = media; await video.current!.play();
      scanTimer.current = setInterval(() => {
        if (video.current?.videoWidth) {
          try { decode(video.current, video.current.videoWidth, video.current.videoHeight); }
          catch { stopCamera(); setError('无法识别二维码，请粘贴口令。'); }
        }
      }, 400);
    } catch (e) { stopCamera(); setError((e as Error).message); }
  }
  const disabled = working || view.status === 'syncing' || !SYNC_ENDPOINT;
  return <section className="sync-panel" aria-label="云端同步设置">
    <p className="small">无需账号。创建一个同步空间，在其他设备粘贴或扫描同一口令，就能自动同步完整日记。</p>
    <div role="status" className={`sync-detail ${view.status}`}><strong>{view.message}</strong>{view.lastSyncedAt && <p>上次成功同步：{new Date(view.lastSyncedAt).toLocaleString('zh-CN')}</p>}</div>
    {!SYNC_ENDPOINT && <p className="small">云同步已暂停，日记继续本地保存。已有口令和备份仍保留。</p>}
    {view.token ? <>
      <div className="sync-actions"><button className="secondary" onClick={() => setShow(!show)}>{show ? '隐藏口令与二维码' : '查看口令与二维码'}</button><button className="secondary" onClick={() => void action(() => controller?.sync())} disabled={disabled}><RefreshCw size={15} />立即同步</button></div>
      {show && <div className="sync-passphrase"><label htmlFor="sync-token">系统生成的固定同步口令</label><textarea id="sync-token" readOnly value={view.token} autoComplete="off" spellCheck={false} /><button className="text-button" onClick={() => void action(async () => { await navigator.clipboard.writeText(view.token); setCopied(true); })}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? '已复制' : '复制口令'}</button>{qr && <img src={qr} width="220" height="220" alt="连接此同步空间的二维码" />}</div>}
      <p className="small muted">口令保存在此浏览器，不支持自定义或修改。持有口令的人可以读写日记，请自行妥善保存；没有邮箱找回功能。</p>
    </> : <>
      <button className="primary" disabled={disabled || !controller || !SYNC_ENDPOINT} onClick={() => void action(() => controller!.create())}>创建同步空间</button>
      <div className="key-field"><label htmlFor="existing-sync-token">连接已有空间</label><div className="key-input"><input id="existing-sync-token" type="password" placeholder="粘贴已有设备的同步口令" value={token} autoComplete="off" onChange={e => setToken(e.target.value.trim())} /></div></div>
      <div className="sync-actions"><button className="secondary" disabled={disabled || !controller || !SYNC_ENDPOINT || !TOKEN_PATTERN.test(token)} onClick={() => void action(() => controller!.connect(token))}>连接并下载</button><button className="text-button" disabled={scanning} onClick={() => void startCamera()}><Camera size={15} />扫描二维码</button><label className="text-button scan-file">读取二维码图片<input type="file" accept="image/*" onChange={e => {
        const file = e.target.files?.[0]; if (!file) return;
        void action(async () => {
          if (file.size > 10 * 1024 * 1024) throw new Error('二维码图片超过 10 MB。');
          const url = URL.createObjectURL(file);
          try { const image = new Image(); image.src = url; await image.decode(); if (!decode(image, image.naturalWidth, image.naturalHeight)) throw new Error('未识别到有效同步口令，请重新选择图片。'); }
          finally { URL.revokeObjectURL(url); }
        }); e.target.value = '';
      }} /></label></div>
      <video ref={video} className={scanning ? 'sync-camera' : 'sync-camera hidden-camera'} muted playsInline />{scanning && <button className="text-button" onClick={stopCamera}><X size={14} />停止扫描</button>}
      <p className="small muted">连接会用云端日记替换本地；替换前自动保留本地备份。二维码只在本机识别，不上传图片。</p>
    </>}
    {error && <p role="alert" className="sync-error">{error}</p>}
    <h3>覆盖前备份 · 最近 5 份</h3>
    {view.backups.length === 0 ? <p className="small muted">尚无覆盖前备份。</p> : <ul className="sync-backups">{view.backups.map(b => <li key={b.id}><span>{new Date(b.date).toLocaleString('zh-CN')} · {b.entries.length} 篇</span><div><button className="text-button" onClick={() => setPreview(preview === b.id ? null : b.id)}>查看</button><button className="text-button" onClick={() => download(b.entries, b.date)}><Download size={13} />导出</button><button className="text-button" disabled={disabled} onClick={() => { if (window.confirm('恢复这份备份将替换当前日记，并按同步规则上传。当前内容会先备份，是否恢复？')) void action(() => controller?.restore(b.id)); }}>恢复</button></div>{preview === b.id && <div className="backup-preview">{b.entries.map(e => <article key={e.id}><strong>{e.date} · {e.title}</strong><p>{e.summary || e.messages.filter(m => m.role === 'user').map(m => m.content).join('\n') || e.draft || '暂无正文'}</p></article>)}</div>}</li>)}</ul>}
  </section>;
}
