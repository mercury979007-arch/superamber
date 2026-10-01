import { useEffect, useRef, useState } from 'react';
import './UserFeedback.css';
type FeedbackItem = { id: string; text: string; status: string; createdAt: string; publicNote: string; images: { url: string }[] };
const labels: Record<string,string> = { new:'已收到', diagnosing:'正在检查', 'needs-info':'需要补充', 'ready-for-review':'修复待验收', released:'已更新', closed:'已处理' };

async function readImage(file: File): Promise<string> {
  if (!['image/png','image/jpeg','image/webp'].includes(file.type)) throw new Error('请选择 PNG、JPG 或 WebP 图片');
  if (file.size > 10 * 1024 * 1024) throw new Error('原图不能超过 10 MB');
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('图片处理失败');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL('image/webp', .88);
    if (data.length * .75 > 2 * 1024 * 1024) throw new Error('图片过大，请裁剪后重试');
    return data;
  } finally { bitmap.close(); }
}
export default function UserFeedback({ screen, classCode, version }: { screen:string; classCode:string; version:string }) {
  const [open,setOpen] = useState(false), [tab,setTab] = useState<'new'|'history'>('new');
  const [text,setText] = useState(''), [images,setImages] = useState<string[]>([]), [busy,setBusy] = useState(false), [imageBusy,setImageBusy] = useState(false);
  const [message,setMessage] = useState(''), [items,setItems] = useState<FeedbackItem[]>([]), [historyBusy,setHistoryBusy] = useState(false);
  const clientId = useRef(crypto.randomUUID());
  const submitting = useRef(false), imageProcessing = useRef(false);
  const previousFocus = useRef<HTMLElement|null>(null), dialog = useRef<HTMLElement>(null);
  const context = useRef({screen,classCode,version,viewport:'',browser:''});
  useEffect(()=>{
    const show = (event: Event) => { const detail = (event as CustomEvent<{screen?:string;classCode?:string}>).detail; previousFocus.current = document.activeElement as HTMLElement; context.current={screen:detail?.screen || screen,classCode:detail?.classCode || classCode,version,viewport:`${innerWidth} × ${innerHeight}`,browser:navigator.userAgent}; setOpen(true); };
    window.addEventListener('superamber:open-feedback',show);
    return ()=>window.removeEventListener('superamber:open-feedback',show);
  },[screen,classCode,version]);
  useEffect(()=>{ if (open) dialog.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus(); },[open]);
  function close() { if (busy) return; setOpen(false); previousFocus.current?.focus(); }
  async function loadHistory() {
    setTab('history'); setHistoryBusy(true); setMessage('');
    try { const response=await fetch('/api/user-feedback',{credentials:'include'}); const data=await response.json(); if(!response.ok) throw new Error(data.error || '读取失败'); setItems(data.items); }
    catch(error) { setMessage(error instanceof Error?error.message:'读取失败'); } finally { setHistoryBusy(false); }
  }
  async function addFiles(files: File[]) {
    if (imageProcessing.current) return;
    if(images.length+files.length>3) { setMessage('最多添加 3 张图片'); return; }
    imageProcessing.current=true; setImageBusy(true); setMessage('');
    try { const added=await Promise.all(files.map(readImage)); setImages(current=>[...current,...added]); clientId.current=crypto.randomUUID(); }
    catch(error) { setMessage(error instanceof Error?error.message:'图片读取失败'); } finally { imageProcessing.current=false; setImageBusy(false); }
  }
  async function submit() {
    if (submitting.current || imageProcessing.current || !text.trim()) return;
    submitting.current=true; setBusy(true); setMessage('');
    try {
      const response=await fetch('/api/user-feedback',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientId:clientId.current,text,images:images.map(dataUrl=>({dataUrl})),context:context.current})});
      const data=await response.json(); if(!response.ok) throw new Error(data.error || '提交失败，请重试');
      setMessage(`已收到你的反馈 ${data.item.id}，可在「我的反馈」查看处理进展。`); setText(''); setImages([]); clientId.current=crypto.randomUUID();
    } catch(error) { setMessage(error instanceof Error?error.message:'网络异常，内容已保留，请重试'); }
    finally { submitting.current=false; setBusy(false); }
  }
  return <>
    {screen!=='welcome' && <button className="feedback-launcher" type="button" onClick={()=>window.dispatchEvent(new Event('superamber:open-feedback'))}>✉ 用户反馈</button>}
    {open && <div className="feedback-backdrop" onClick={close}>
      <section ref={dialog} className="feedback-dialog" role="dialog" aria-modal="true" aria-labelledby="feedback-title" onClick={event=>event.stopPropagation()} onKeyDown={event=>{
        if(event.key==='Escape') close();
        if(event.key==='Tab') { const nodes=dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),textarea,input:not(:disabled),a[href]'); if(!nodes?.length)return; const first=nodes[0],last=nodes[nodes.length-1]; if(event.shiftKey && document.activeElement===first){event.preventDefault();last.focus();} else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first.focus();} }
      }}>
        <header><h2 id="feedback-title">用户反馈</h2><button type="button" aria-label="关闭反馈" disabled={busy} onClick={close}>×</button></header>
        <nav><button type="button" className={tab==='new'?'active':''} onClick={()=>setTab('new')}>提交反馈</button><button type="button" className={tab==='history'?'active':''} onClick={loadHistory}>我的反馈</button></nav>
        {tab==='new' ? <>
          <label className="feedback-text-label" htmlFor="feedback-text">遇到了什么问题，或希望怎样改进？</label>
          <textarea id="feedback-text" value={text} disabled={busy} maxLength={2000} placeholder="例如：在哪个页面、进行了什么操作、希望得到什么结果…" onChange={event=>{setText(event.target.value);clientId.current=crypto.randomUUID();}} onPaste={event=>{const files=Array.from(event.clipboardData.files);if(files.length){event.preventDefault();void addFiles(files);}}}/>
          <div className="feedback-image-actions"><label>添加图片（最多 3 张）<input aria-label="反馈图片" type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={busy||imageBusy} onChange={event=>{void addFiles(Array.from(event.target.files||[]));event.target.value='';}}/></label><span>{imageBusy?'正在处理图片…':'也可直接粘贴截图'}</span></div>
          <div className="feedback-images">{images.map((src,index)=><figure key={src}><img src={src} alt={`反馈截图 ${index+1}`}/><button type="button" aria-label={`移除截图 ${index+1}`} disabled={busy||imageBusy} onClick={()=>{setImages(current=>current.filter((_,i)=>i!==index));clientId.current=crypto.randomUUID();}}>移除</button></figure>)}</div>
          <p className="feedback-help">提交后会记录当前页面和版本，便于复现。我们每天统一检查，处理进展会更新在「我的反馈」。</p>
          <button type="button" className="btn btn-primary feedback-submit" disabled={busy||imageBusy||!text.trim()} onClick={submit}>{busy?'正在提交…':'提交反馈'}</button>
        </> : <div className="feedback-history">{historyBusy?<p>正在读取…</p>:!items.length?<p>暂时没有反馈记录。</p>:items.map(item=><article key={item.id}><header><b>{labels[item.status]||'已收到'}</b><time>{new Date(item.createdAt).toLocaleString('zh-CN')}</time></header><p>{item.text}</p><div className="feedback-images">{item.images.map(image=><a key={image.url} href={image.url} target="_blank" rel="noreferrer"><img src={image.url} alt="已提交的反馈截图"/></a>)}</div>{item.publicNote&&<p className="feedback-reply">{item.publicNote}</p>}<small>{item.id}</small></article>)}</div>}
        {message&&<p className="feedback-message" role="status">{message}</p>}
      </section>
    </div>}
  </>;
}
