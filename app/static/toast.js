const _T={list:[],expanded:false,hover:false};
const _IC={
  success:'<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clip-rule="evenodd"/></svg>',
  error:'<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd"/></svg>',
  info:'<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clip-rule="evenodd"/></svg>',
  loading:'<span class="sn-sp"></span>'
};
function pauseToast(t){if(t.timer){clearTimeout(t.timer);t.timer=null;t.rem-=Date.now()-t.t0}}
function resumeToast(t){if(!t.gone&&isFinite(t.rem)&&!t.timer){t.t0=Date.now();t.timer=setTimeout(()=>dismissToast(t.id),t.rem)}}
function armToast(t,ms){clearTimeout(t.timer);t.timer=null;t.rem=ms;if(!_T.hover)resumeToast(t)}
function layoutToasts(){
  const L=_T.list.filter(x=>!x.gone),box=$('#toasts');
  if(!L.length){box.style.height='0px';_T.expanded=_T.hover=false;return}
  L.forEach(t=>t.el.style.height='');
  const h=L.map(t=>t.el.offsetHeight),G=14,ex=_T.expanded;
  let y=0;
  L.forEach((t,i)=>{
    const e=t.el;
    e.classList.toggle('back',!ex&&i>0);
    e.classList.toggle('hide',i>=3);
    if(ex){e.style.setProperty('--y',-y+'px');e.style.setProperty('--s','1');y+=h[i]+G}
    else{if(i>0)e.style.height=h[0]+'px';e.style.setProperty('--y',-(i*G)+'px');e.style.setProperty('--s',String(1-i*0.05))}
    e.style.zIndex=100-i;
  });
  box.style.height=(ex?Math.max(0,y-G):h[0])+'px';
}
function dismissToast(id){
  const t=_T.list.find(x=>x.id===id);if(!t||t.gone)return;
  t.gone=true;clearTimeout(t.timer);
  t.el.style.setProperty('--sx','calc(100% + 32px)');
  t.el.classList.add('removed');
  layoutToasts();
  setTimeout(()=>{t.el.remove();_T.list=_T.list.filter(x=>x!==t);layoutToasts()},350);
}
function swipeToast(t){
  const el=t.el;let x0=null,dx=0;
  el.addEventListener('pointerdown',e=>{if(e.target.closest('button'))return;x0=e.clientX;dx=0;el.setPointerCapture(e.pointerId);el.classList.add('drag')});
  el.addEventListener('pointermove',e=>{if(x0===null)return;dx=Math.max(0,e.clientX-x0);el.style.setProperty('--sx',dx+'px')});
  const end=()=>{if(x0===null)return;x0=null;el.classList.remove('drag');if(dx>60)dismissToast(t.id);else el.style.setProperty('--sx','0px')};
  el.addEventListener('pointerup',end);el.addEventListener('pointercancel',end);
}
function toast(msg,o){
  if(typeof o==='string')o={type:o==='err'?'error':'success'};
  o=o||{};
  const box=$('#toasts');
  if(!box._init){
    box._init=true;
    box.addEventListener('mouseenter',()=>{_T.hover=_T.expanded=true;_T.list.forEach(pauseToast);layoutToasts()});
    box.addEventListener('mouseleave',()=>{_T.hover=_T.expanded=false;_T.list.forEach(resumeToast);layoutToasts()});
  }
  if(box.showPopover){
    if(!box.matches(':popover-open'))box.showPopover();
    else if(document.querySelector('dialog[open]')){box.hidePopover();box.showPopover()}
  }
  let t=o.id!=null?_T.list.find(x=>x.id===o.id&&!x.gone):null;
  if(!t){
    const el=document.createElement('div');el.className='sn';
    el.innerHTML='<button class="sn-x" aria-label="Tutup">×</button><span class="sn-i"></span><div class="sn-c"><div class="sn-t"></div><div class="sn-d"></div></div>';
    t={id:o.id!=null?o.id:'t'+Math.random().toString(36).slice(2),el,timer:null,rem:Infinity,t0:0,gone:false};
    el.querySelector('.sn-x').onclick=()=>dismissToast(t.id);
    swipeToast(t);
    box.appendChild(el);_T.list.unshift(t);
    el.getBoundingClientRect();
    requestAnimationFrame(()=>{el.classList.add('mounted');layoutToasts()});
  }
  const type=o.type||'default',el=t.el;
  el.dataset.type=type;
  el.querySelector('.sn-i').innerHTML=_IC[type]||'';
  el.querySelector('.sn-t').textContent=msg;
  el.querySelector('.sn-d').textContent=o.description||'';
  armToast(t,type==='loading'?Infinity:(o.duration??4000));
  if(el.classList.contains('mounted'))layoutToasts();
  return t.id;
}
toast.success=(m,o)=>toast(m,{...o,type:'success'});
toast.error=(m,o)=>toast(m,{...o,type:'error'});
toast.info=(m,o)=>toast(m,{...o,type:'info'});
toast.loading=(m,o)=>toast(m,{...o,type:'loading'});
toast.dismiss=id=>id==null?_T.list.forEach(t=>dismissToast(t.id)):dismissToast(id);
toast.promise=(p,m)=>{
  const id=toast.loading(m.loading);
  p.then(r=>toast.success(typeof m.success==='function'?m.success(r):m.success,{id}),
         e=>toast.error(typeof m.error==='function'?m.error(e):m.error,{id}));
  return p;
};

