const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));

const norm=s=>String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const jget=async u=>(await fetch(u)).json();
const fmt=n=>Number(n||0).toLocaleString('id-ID');
const csvq=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
let COMPS=[],STATS={items:0,pns:0,companies:0},LASTDUP=[],CURRENT_USER=null;

function skeletonHtml(cols=5, rows=6){
  return Array.from({length: rows}).map(()=>`
    <tr class="skeleton-tr">
      <td><span class="sk-bar w-long"></span></td>
      ${Array.from({length: Math.max(1, cols - 1)}).map((_, idx)=>`
        <td><span class="sk-bar ${idx%2===0 ? 'w-med' : 'w-short'}"></span></td>
      `).join('')}
    </tr>
  `).join('');
}

function copyText(t, el, msg='Disalin'){
  if(!t)return;
  const done=()=>{
    toast.success(msg,{description:t});
    if(el){
      el.classList.add('copied');
      setTimeout(()=>el.classList.remove('copied'), 650);
    }
  };
  const fallback=()=>{
    const a=document.createElement('textarea');a.value=t;a.style.cssText='position:fixed;opacity:0';
    document.body.appendChild(a);a.select();
    try{document.execCommand('copy');done()}catch(e){toast.error('Gagal menyalin')}
    a.remove();
  };
  if(navigator.clipboard&&window.isSecureContext){
    navigator.clipboard.writeText(t).then(done).catch(fallback);
  }else{
    fallback();
  }
}
document.addEventListener('click',e=>{const p=e.target.closest('.pn');if(p)copyText(p.dataset.pn, p)});

function cell(list,q,approved,approvedAt){
  if(!list||!list.length)return '<span class="mu">–</span>';
  const qn=norm(q);
  let apTip='';
  if(approved){
    if(approvedAt){
      try{
        const d=new Date(approvedAt);
        if(!isNaN(d.getTime())) apTip = `Disetujui oleh ${approved} • ${d.toLocaleString('id-ID')}`;
      }catch(e){}
    }
    if(!apTip) apTip = `Disetujui oleh ${approved}`;
  }
  return list.map(p=>{
    const hit=qn&&norm(p.pn).includes(qn)?' hit':'';
    const chk = approved ? `<span class="ap-chk" title="${esc(apTip)}">✓</span>` : '';
    return p.seq===0
      ?`<span class="pnwrap"><button type="button" class="pn main${hit}" data-pn="${esc(p.pn)}" title="Klik untuk salin" aria-label="Salin PN ${esc(p.pn)}">${esc(p.pn)}</button>${chk}</span>`
      :`<span class="pnwrap"><button type="button" class="pn rep${hit}" data-pn="${esc(p.pn)}" title="Pengganti ${p.seq} · klik untuk salin" aria-label="Salin PN pengganti ${esc(p.pn)}">↳ ${esc(p.pn)}</button>${chk}</span>`;
  }).join('');
}
let CURRENT_SORT = 'name_asc';
const headHtml=()=>{
  const showAuthor = !!CURRENT_USER;
  let sortBadge = '';
  if(CURRENT_SORT === 'name_asc') sortBadge = ' <span class="sort-icon">A-Z</span>';
  else if(CURRENT_SORT === 'name_desc') sortBadge = ' <span class="sort-icon">Z-A</span>';
  return '<tr><th class="sortable-th" id="thBarang" title="Klik untuk mengurutkan Nama A-Z / Z-A">Barang' + sortBadge + '</th>' +
    COMPS.map(c=>`<th>${esc(c)}</th>`).join('') +
    (showAuthor ? '<th class="author-th">Diupdate Oleh</th>' : '') +
    '<th class="act-th">Aksi</th>' +
    '</tr>';
};
function rowCells(i,q,no){
  const m={};i.pns.forEach(p=>(m[p.company]=m[p.company]||[]).push(p));
  const nm=i.name?esc(i.name):'<span class="mu">(tanpa nama)</span>';
  const who = i.updated_by || i.created_by;
  const author = who
    ?`<span class="badge-user" title="Diupdate oleh ${esc(who)}">${esc(who)}</span>`
    :'<span class="mu">–</span>';
  const canEdit = CURRENT_USER && ((i.user_id == null) || (i.user_id == CURRENT_USER.id) || CURRENT_USER.is_admin);
  const isApproved = !!i.approved_by_name;
  const showAuthor = !!CURRENT_USER;
  const apprName = isApproved ? i.approved_by_name : '';
  const rowMenuBtn = `<button type="button" class="btn sm row-act-trigger"
         data-item-id="${i.id}"
         data-item-name="${esc(i.name || '')}"
         data-can-edit="${canEdit ? '1' : '0'}"
         data-is-approved="${isApproved ? '1' : '0'}"
         data-approved-by="${esc(i.approved_by_name || '')}"
         data-approved-at="${esc(i.approved_at || '')}"
         aria-haspopup="true"
         aria-expanded="false"
         title="Buka menu aksi barang ini">
         <span>Aksi</span>
         <span class="menu-arrow">▾</span>
       </button>`;
  const actCol = `<td class="act-col">${rowMenuBtn}</td>`;
  const nmCell = nm;
  return `<td class="nm">${no?`<span class="no">${no}</span>`:''}${nmCell}</td>`
    +COMPS.map(c=>`<td>${cell(m[c],q,apprName,i.approved_at)}</td>`).join('')
    +(showAuthor?`<td class="author-col">${author}</td>`:'')
    +actCol;
}

async function loadAuth(){
  try{
    const r=await jget('/api/auth/me');
    CURRENT_USER=r.user||null;
  }catch(e){
    CURRENT_USER=null;
  }
  renderNavAuth();
}

function renderNavAuth(){
  const el=$('#navAuth');
  if(!el)return;
  const adminBtn = (CURRENT_USER && CURRENT_USER.is_admin) 
    ? '<button class="btn sm" id="bAdmin" title="Buka Admin Panel &amp; Log">Admin</button>' 
    : '';
  const helpBtn = '<button class="btn sm" id="bHelp" title="Pintasan Keyboard (?)" style="padding:0 8px;font-weight:700">?</button>';
  if(CURRENT_USER){
    el.innerHTML=`${adminBtn}<span class="user-pill" title="Login sebagai ${esc(CURRENT_USER.username)}"><b>${esc(CURRENT_USER.username)}</b>${CURRENT_USER.is_admin?' <span class="badge-admin">Admin</span>':''}</span><button class="btn sm" id="bLogout">Keluar</button>${helpBtn}`;
    const bLo=$('#bLogout');
    if(bLo)bLo.onclick=async()=>{
      await fetch('/api/auth/logout',{method:'POST'});
      CURRENT_USER=null;
      renderNavAuth();
      toast.info('Berhasil keluar');
      await changed();
    };
  }else{
    el.innerHTML=`<button class="btn sm" id="bLogin">Masuk</button>${helpBtn}`;
    const bLi=$('#bLogin');
    if(bLi)bLi.onclick=()=>openAuth();
  }
  const ba=$('#bAdmin');
  if(ba)ba.onclick=()=>openAdmin();
  const bh=$('#bHelp');
  if(bh)bh.onclick=()=>$('#dHelp').showModal();
}

let authMode='login';
function setAuthMode(mode){
  authMode=mode;
  const title=$('#authTitle'),sub=$('#authSubmit'),sw=$('#authSwitch'),msg=$('#authMsg');
  if(title)title.textContent=mode==='login'?'Masuk':'Daftar Akun';
  if(sub)sub.textContent=mode==='login'?'Masuk':'Daftar & Masuk';
  if(sw)sw.innerHTML=mode==='login'
    ?'Belum punya akun? <a id="authSwitchLink">Daftar akun baru</a>'
    :'Sudah punya akun? <a id="authSwitchLink">Masuk</a>';
  const link=$('#authSwitchLink');
  if(link)link.onclick=()=>setAuthMode(mode==='login'?'register':'login');
  if(msg){msg.textContent='';msg.className='msg';}
}

function openAuth(msg,mode='login'){
  const u=$('#authU'),p=$('#authP'),d=$('#dAuth');
  if(u)u.value='';
  if(p)p.value='';
  setAuthMode(mode);
  const m=$('#authMsg');
  if(m&&msg){m.className='msg';m.textContent=msg;}
  if(d)d.showModal();
  if(u)u.focus();
}

async function loadMeta(){
  COMPS=await jget('/api/companies');
  STATS=await jget('/api/stats');
  $('#stats').textContent=`${fmt(STATS.items)} barang · ${fmt(STATS.pns)} PN · ${STATS.companies} company`;
  $('#cl').innerHTML=COMPS.map(c=>`<option value="${esc(c)}">`).join('');
}
const changed=async()=>{await loadMeta();document.dispatchEvent(new Event('data-changed'))};

function showRes(r){
  LASTDUP=r.duplicates||[];
  let h=`<div class="stats"><div class="st ok"><b>${fmt(r.pn_added)}</b><span>PN masuk</span></div>
    <div class="st ${r.pn_duplicate_skipped?'warn':''}"><b>${fmt(r.pn_duplicate_skipped)}</b><span>PN dobel dilewati</span></div></div>`;
  if(LASTDUP.length){
    const rows=LASTDUP.map(x=>`<tr><td>${x.row}</td><td>${esc(x.company)}</td><td><b>${esc(x.pn)}</b></td>
      <td>${x.source==='file'?'dobel di file ini':'sudah ada di database'}</td>
      <td>${x.existing_name?esc(x.existing_name):'<span class="mu">-</span>'}</td>
      <td>${(x.existing_pns||[]).map(p=>`<span class="mu">${esc(p.company)}:</span> ${esc(p.pn)}`).join('<br>')}</td></tr>`).join('');
    h+=`<div class="hint">Baris = nomor baris di file. ${r.duplicates_truncated?'Menampilkan 2000 pertama. ':''}
      <button class="btn sm" id="iCsv">Download daftar dobel (CSV)</button></div>
      <div class="tw dup"><table><thead><tr><th>Baris</th><th>Company</th><th>PN</th><th>Sumber</th><th>Barang yang sudah ada</th><th>PN barang tsb</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  $('#iRes').innerHTML=h;
  const b=$('#iCsv');
  if(b)b.onclick=()=>{
    const lines=[['baris','company','pn','sumber','nama_barang_existing','pn_existing'].map(csvq).join(',')]
      .concat(LASTDUP.map(x=>[x.row,x.company,x.pn,x.source==='file'?'dobel di file':'database',x.existing_name||'',
        (x.existing_pns||[]).map(p=>p.company+': '+p.pn).join(' | ')].map(csvq).join(',')));
    const a=document.createElement('a');
    a.href=URL.createObjectURL(new Blob(['\ufeff'+lines.join('\r\n')],{type:'text/csv'}));
    a.download='pn-dobel.csv';a.click();
  };
}

function applyTheme(t){
  document.body.classList.remove('dark','theme-sakura','theme-bamboo','theme-cyberpunk','theme-mingyu','theme-ocean','theme-retrolight');
  if(t) document.body.classList.add(t);
  try{localStorage.setItem('cmp-theme',t||'');}catch(e){}
}

function confirmDialog({
  title = 'Konfirmasi',
  message = 'Apakah Anda yakin?',
  confirmText = 'Lanjutkan',
  cancelText = 'Batal',
  type = 'warning'
} = {}){
  return new Promise(resolve=>{
    let d = $('#dConfirm');
    if(!d){
      document.body.insertAdjacentHTML('beforeend', `
        <dialog id="dConfirm" class="confirm-dialog">
          <div class="conf-box">
            <div class="conf-icon" id="confIcon"></div>
            <h3 id="confTitle"></h3>
            <p id="confMsg"></p>
            <div class="conf-act">
              <button class="btn" id="confCancel" type="button"></button>
              <button class="btn pri" id="confOk" type="button"></button>
            </div>
          </div>
        </dialog>
      `);
      d = $('#dConfirm');
    }
    const iconEl = $('#confIcon');
    const icons = {
      warning: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
      danger: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
      success: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
    };
    iconEl.className = 'conf-icon ' + type;
    iconEl.innerHTML = icons[type] || icons.warning;
    iconEl.style.animation = 'none';
    void iconEl.offsetHeight;
    iconEl.style.animation = '';
    $('#confTitle').textContent = title;
    $('#confMsg').textContent = message;
    const okBtn = $('#confOk');
    okBtn.textContent = confirmText;
    okBtn.className = 'btn pri ' + (type === 'danger' ? 'btn-danger' : (type === 'warning' ? 'btn-warn' : 'btn-success'));
    const cancelBtn = $('#confCancel');
    cancelBtn.textContent = cancelText;

    let resolved = false;
    const finish = val => {
      if(resolved) return;
      resolved = true;
      d.close();
      resolve(val);
    };
    cancelBtn.onclick = () => finish(false);
    okBtn.onclick = () => finish(true);
    d.oncancel = () => finish(false);
    d.onclick = e => {
      if(e.target === d) finish(false);
    };
    d.showModal();
    okBtn.focus();
  });
}

function renderImportPreview(file){
  const container = $('#iDrop');
  let prev = $('#iPreviewBox');
  if(!prev){
    prev = document.createElement('div');
    prev.id = 'iPreviewBox';
    prev.className = 'import-preview-box';
    container.parentNode.insertBefore(prev, $('#iMsg'));
  }
  const isXlsx = file.name.toLowerCase().endsWith('.xlsx');
  const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
  if(isXlsx){
    prev.innerHTML = `
      <div class="import-preview-header">
        <span>Format: <b>Excel (.xlsx)</b> (${sizeMb} MB)</span>
        <span class="badge" style="font-size:11px">Siap diupload</span>
      </div>
      <div class="mu" style="font-size:12px">Kolom company akan dideteksi otomatis dari baris 1 saat diupload. Pastikan kolom PN diformat Text.</div>
    `;
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const text = e.target.result || '';
      const lines = text.split(/\r\n|\n|\r/).filter(l => l.trim().length > 0);
      if(!lines.length){
        prev.innerHTML = '<div class="msg err">File CSV tampak kosong</div>';
        return;
      }
      const parseCsvLine = l => {
        const res = [];
        let cur = '', inQ = false;
        for(let i=0; i<l.length; i++){
          const c = l[i];
          if(c === '"'){ inQ = !inQ; }
          else if(c === ',' && !inQ){ res.push(cur.trim()); cur = ''; }
          else cur += c;
        }
        res.push(cur.trim());
        return res;
      };
      const header = parseCsvLine(lines[0]);
      const hasName = header[0] && ['name', 'nama', 'nama barang', 'nama_barang', 'item', 'item_name'].includes(header[0].toLowerCase().trim());
      const comps = hasName ? header.slice(1) : header;
      const previewRows = lines.slice(1, 4).map(l => parseCsvLine(l));
      
      let tableRows = previewRows.map((r, idx) => `
        <tr>
          <td>${idx + 1}</td>
          ${header.map((_, colIdx) => `<td>${esc(r[colIdx] || '')}</td>`).join('')}
        </tr>
      `).join('');

      prev.innerHTML = `
        <div class="import-preview-header">
          <span>Format: <b>CSV</b> (${sizeMb} MB)</span>
          <span class="badge" style="font-size:11px">${comps.length} Company Terdeteksi</span>
        </div>
        <div class="comp-badges-wrap">
          ${hasName ? '<span class="badge-user" style="font-size:11px">Nama Barang: Ada</span>' : '<span class="mu" style="font-size:11px">Nama Barang: Tidak ada</span>'}
          ${comps.map(c => `<span class="comp-badge">${esc(c)}</span>`).join('')}
        </div>
        <div class="mu" style="font-size:11px;margin-top:4px">Pratinjau baris data awal:</div>
        <div style="overflow-x:auto">
          <table class="preview-mini-table">
            <thead>
              <tr><th>#</th>${header.map(h => `<th>${esc(h)}</th>`).join('')}</tr>
            </thead>
            <tbody>${tableRows}</tbody>
          </table>
        </div>
      `;
    } catch(err){
      prev.innerHTML = `<div class="mu">File CSV: ${esc(file.name)} (${sizeMb} MB)</div>`;
    }
  };
  reader.readAsText(file.slice(0, 16384));
}

// --- ADMIN PANEL LOGIC ---
let adminLogPage = 1, adminLogPages = 1;

async function refreshAdminStats(){
  try{
    const s = await jget('/api/admin/stats');
    if(s.error) return;
    const ku = $('#kpiUsers'), ks = $('#kpiSessions'), ka = $('#kpiActive15m'), kl = $('#kpiLogsToday'), kt = $('#kpiLogsTotal'), ki = $('#kpiItems'), kp = $('#kpiPns');
    if(ku) ku.textContent = fmt(s.total_users);
    if(ks) ks.textContent = fmt(s.active_sessions);
    if(ka) ka.textContent = `${fmt(s.active_users_15m)} aktif 15 mnt terakhir`;
    if(kl) kl.textContent = fmt(s.logs_today);
    if(kt) kt.textContent = `${fmt(s.total_logs)} total log`;
    if(ki) ki.textContent = fmt(STATS.items);
    if(kp) kp.textContent = `${fmt(STATS.pns)} PN tersimpan`;
    const tcu = $('#tabCountUsers'); if(tcu) tcu.textContent = fmt(s.total_users);
    const tcs = $('#tabCountSessions'); if(tcs) tcs.textContent = fmt(s.active_sessions);
    const tcl = $('#tabCountLogs'); if(tcl) tcl.textContent = fmt(s.total_logs);
  }catch(e){}
}

async function loadAdminUsers(){
  const tb = $('#adminUsersTbody');
  if(!tb) return;
  tb.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:20px"><span class="mu">Memuat data pengguna…</span></td></tr>';
  try{
    const list = await jget('/api/admin/users');
    if(!list.length){
      tb.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:20px" class="mu">Belum ada pengguna</td></tr>';
      return;
    }
    tb.innerHTML = list.map(u => {
      const isOnline = u.active_sessions > 0;
      let lastAct = '<span class="mu">–</span>';
      if(u.last_active){
        try{ const d = new Date(u.last_active); if(!isNaN(d.getTime())) lastAct = d.toLocaleString('id-ID'); }catch(e){}
      }
      let createdDate = '<span class="mu">–</span>';
      if(u.created_at){
        try{ const d = new Date(u.created_at); if(!isNaN(d.getTime())) createdDate = d.toLocaleDateString('id-ID'); }catch(e){}
      }
      const isSelf = CURRENT_USER && (CURRENT_USER.id === u.id);
      const toggleBtn = isSelf 
        ? '<span class="mu" style="font-size:11px">(Akun Anda)</span>' 
        : `<button class="btn sm" data-toggle-admin="${u.id}" data-current="${u.is_admin ? '1':'0'}">${u.is_admin ? 'Jadikan Member' : 'Jadikan Admin'}</button>`;
      return `
        <tr>
          <td>${u.id}</td>
          <td><b>${esc(u.username)}</b></td>
          <td><span class="${u.is_admin ? 'badge-admin' : 'badge-member'}">${u.is_admin ? 'Admin' : 'Member'}</span></td>
          <td>${createdDate}</td>
          <td>${fmt(u.items_created)}</td>
          <td>${fmt(u.items_updated)}</td>
          <td>${isOnline ? `<span class="badge-online"><span class="status-dot online"></span>${u.active_sessions} sesi aktif</span>` : '<span class="badge-offline"><span class="status-dot offline"></span>Offline</span>'}</td>
          <td>${lastAct}</td>
          <td>${toggleBtn}</td>
        </tr>
      `;
    }).join('');
  }catch(e){
    tb.innerHTML = '<tr><td colspan="9" class="mu" style="text-align:center">Gagal memuat pengguna</td></tr>';
  }
}

async function loadAdminSessions(){
  const tb = $('#adminSessionsTbody');
  if(!tb) return;
  tb.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px"><span class="mu">Memuat sesi aktif…</span></td></tr>';
  try{
    const list = await jget('/api/admin/sessions');
    if(!list.length){
      tb.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px" class="mu">Tidak ada sesi aktif</td></tr>';
      return;
    }
    tb.innerHTML = list.map(s => {
      let created = '<span class="mu">–</span>';
      if(s.created_at){
        try{ const d = new Date(s.created_at); if(!isNaN(d.getTime())) created = d.toLocaleString('id-ID'); }catch(e){}
      }
      let lastAct = '<span class="mu">–</span>';
      if(s.last_active){
        try{ const d = new Date(s.last_active); if(!isNaN(d.getTime())) lastAct = d.toLocaleString('id-ID'); }catch(e){}
      }
      const actBtn = s.is_current 
        ? '<span class="badge-online" style="font-size:11px">Sesi Saat Ini</span>' 
        : `<button class="btn sm danger" data-revoke-token="${esc(s.token_full || '')}">Putuskan</button>`;
      return `
        <tr>
          <td><b>${esc(s.username)}</b>${s.is_admin?' <span class="badge-admin" style="font-size:10px">Admin</span>':''}</td>
          <td><code>${esc(s.ip_address)}</code></td>
          <td style="max-width:260px;font-size:11px" class="mu" title="${esc(s.user_agent)}">${esc(s.user_agent)}</td>
          <td>${created}</td>
          <td>${lastAct}</td>
          <td><span class="badge-online">Aktif</span></td>
          <td>${actBtn}</td>
        </tr>
      `;
    }).join('');
  }catch(e){
    tb.innerHTML = '<tr><td colspan="7" class="mu" style="text-align:center">Gagal memuat sesi</td></tr>';
  }
}

async function loadAdminLogs(p = 1){
  adminLogPage = Math.max(1, p);
  const tb = $('#adminLogsTbody');
  if(!tb) return;
  tb.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px"><span class="mu">Memuat log aktivitas…</span></td></tr>';
  const q = ($('#adminLogQ')?.value || '').trim();
  const act = $('#adminLogAction')?.value || '';
  try{
    const r = await jget(`/api/admin/logs?page=${adminLogPage}&size=50&q=${encodeURIComponent(q)}&action=${encodeURIComponent(act)}`);
    adminLogPages = Math.max(1, Math.ceil(r.total / r.size));
    const info = $('#adminLogInfo');
    if(info) info.textContent = `${fmt(r.total)} log`;
    const pd = $('#adminLogPageDisp');
    if(pd) pd.textContent = `Hal ${adminLogPage} / ${adminLogPages}`;
    const pb = $('#adminLogPrev'); if(pb) pb.disabled = adminLogPage <= 1;
    const nb = $('#adminLogNext'); if(nb) nb.disabled = adminLogPage >= adminLogPages;
    if(!r.logs.length){
      tb.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px" class="mu">Tidak ada log aktivitas</td></tr>';
      return;
    }
    tb.innerHTML = r.logs.map(l => {
      let t = '<span class="mu">–</span>';
      if(l.created_at){
        try{ const d = new Date(l.created_at); if(!isNaN(d.getTime())) t = d.toLocaleString('id-ID'); }catch(e){}
      }
      const actClass = (l.action || '').toLowerCase();
      return `
        <tr>
          <td style="white-space:nowrap;font-size:12px">${t}</td>
          <td><b>${esc(l.username)}</b></td>
          <td><span class="log-badge ${esc(actClass)}">${esc(l.action)}</span></td>
          <td style="font-size:12px">${esc(l.details || '')}</td>
          <td><code>${esc(l.ip_address || '–')}</code></td>
        </tr>
      `;
    }).join('');
  }catch(e){
    tb.innerHTML = '<tr><td colspan="5" class="mu" style="text-align:center">Gagal memuat log</td></tr>';
  }
}

// --- RIWAYAT PERUBAHAN BARANG ---
async function openItemHistory(itemId){
  const d = $('#dHistory');
  const cnt = $('#histContent');
  const title = $('#histTitle');
  if(!d || !cnt) return;
  cnt.innerHTML = '<div style="text-align:center;padding:24px" class="mu">Memuat riwayat perubahan…</div>';
  d.showModal();
  try{
    const r = await jget(`/api/items/${itemId}/history`);
    if(r.error){
      cnt.innerHTML = `<div class="msg err">${esc(r.error)}</div>`;
      return;
    }
    title.textContent = `Riwayat: ${r.item_name || 'Barang #' + itemId}`;
    if(!r.history || !r.history.length){
      cnt.innerHTML = '<div class="mu" style="text-align:center;padding:24px">Belum ada catatan riwayat untuk barang ini.</div>';
      return;
    }
    cnt.innerHTML = `
      <div class="timeline">
        ${r.history.map(h => {
          let t = '–';
          if(h.created_at){
            try{ const dt = new Date(h.created_at); if(!isNaN(dt.getTime())) t = dt.toLocaleString('id-ID'); }catch(e){}
          }
          const actClass = (h.action || '').toLowerCase();
          let bodyHtml = '';
          if(h.action === 'CREATED'){
            bodyHtml = `<div>Barang dibuat pertama kali oleh <b>${esc(h.username || 'Sistem')}</b>.</div>`;
          }else if(h.action === 'UPDATED'){
            let nameDiff = '';
            if(h.name_before !== h.name_after){
              nameDiff = `<div class="diff-name-change">Perubahan nama: <s>${esc(h.name_before || '(tanpa nama)')}</s> &rarr; <b>${esc(h.name_after || '(tanpa nama)')}</b></div>`;
            }
            bodyHtml = nameDiff || '<div>Data part number diperbarui.</div>';
          }else if(h.action === 'APPROVED'){
            bodyHtml = `<div>Status approval disetujui (kroscek selesai) oleh <b>${esc(h.username || 'Admin')}</b>.</div>`;
          }else if(h.action === 'UNAPPROVED'){
            bodyHtml = `<div>Status persetujuan dibatalkan oleh <b>${esc(h.username || 'Admin')}</b>.</div>`;
          }

          let snapHtml = '';
          if(h.snapshot && Array.isArray(h.snapshot) && h.snapshot.length > 0){
            snapHtml = `<div class="diff-tags-container">
              ${h.snapshot.map(s => `<span class="diff-tag"><span class="company-badge">${esc(s.company)}:</span> ${esc(s.pn)}</span>`).join('')}
            </div>`;
          }

          return `
            <div class="timeline-item ${esc(actClass)}">
              <div class="timeline-point"></div>
              <div class="timeline-meta">
                <span class="timeline-user">${esc(h.username || 'Anonim')}</span>
                <span class="timeline-action ${esc(actClass)}">${esc(h.action)}</span>
                <span>${t}</span>
              </div>
              <div class="timeline-body">
                <div class="timeline-diff">
                  ${bodyHtml}
                  ${snapHtml}
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }catch(e){
    cnt.innerHTML = '<div class="msg err">Gagal memuat data riwayat perubahan barang.</div>';
  }
}

// --- KLONING BARANG ---
async function cloneItem(itemId){
  if(!CURRENT_USER){
    openAuth('Silakan masuk terlebih dahulu untuk mengkloning data barang.');
    return;
  }
  try{
    const r = await jget(`/api/items/${itemId}`);
    if(r.error){
      toast.error('Gagal memuat data barang', { description: r.error });
      return;
    }
    const dAdd = $('#dAdd');
    if(!dAdd) return;
    const origName = r.name || '';
    $('#aNm').value = origName ? `(Duplikat) ${origName}` : '(Duplikat)';
    $('#aMsg').textContent = '';
    $('#aRows').innerHTML = '';

    const entryMap = {};
    (r.entries || []).forEach(e => {
      entryMap[e.company] = e.pns;
    });

    const addRow = (c, fixed, val = '') => {
      const d = document.createElement('div');
      d.className = 'r';
      if(fixed){
        d.dataset.c = c;
        d.innerHTML = `<span class="cn" title="${esc(c)}">${esc(c)}</span><input class="p" placeholder="PN" autocomplete="off" value="${esc(val)}"><span></span>`;
      } else {
        d.innerHTML = `<input class="c" list="cl" placeholder="Nama company" autocomplete="off" value="${esc(c)}"><input class="p" placeholder="PN" autocomplete="off" value="${esc(val)}"><button class="x" title="Hapus baris">×</button>`;
      }
      $('#aRows').appendChild(d);
    };

    COMPS.forEach(c => {
      addRow(c, true, entryMap[c] || '');
    });

    Object.keys(entryMap).forEach(c => {
      if(!COMPS.includes(c)){
        addRow(c, false, entryMap[c]);
      }
    });

    if(!$('#aRows').children.length){
      addRow('', false);
      addRow('', false);
    }

    dAdd.showModal();
    $('#aNm').focus();
    toast.info('Data barang disalin ke form tambah. Silakan sesuaikan lalu simpan.');
  }catch(e){
    toast.error('Gagal mengambil data untuk dikloning');
  }
}

// --- MANAJEMEN PERUSAHAAN (COMPANIES) ---
let ADMIN_COMPANIES_CACHE = [];
async function loadAdminCompanies(){
  const tb = $('#adminCompaniesTbody');
  if(!tb) return;
  tb.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px" class="mu">Memuat data perusahaan…</td></tr>';
  try{
    const r = await jget('/api/admin/companies');
    if(r.error){
      tb.innerHTML = `<tr><td colspan="5" class="mu" style="text-align:center">${esc(r.error)}</td></tr>`;
      return;
    }
    ADMIN_COMPANIES_CACHE = r.companies || [];
    const countEl = $('#tabCountCompanies');
    if(countEl) countEl.textContent = fmt(ADMIN_COMPANIES_CACHE.length);
    renderAdminCompanies();
  }catch(e){
    tb.innerHTML = '<tr><td colspan="5" class="mu" style="text-align:center">Gagal memuat perusahaan</td></tr>';
  }
}

function renderAdminCompanies(){
  const tb = $('#adminCompaniesTbody');
  if(!tb) return;
  const q = ($('#adminCompQ')?.value || '').toLowerCase().trim();
  const filtered = ADMIN_COMPANIES_CACHE.filter(c => !q || c.name.toLowerCase().includes(q));
  if(!filtered.length){
    tb.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px" class="mu">Tidak ada perusahaan yang cocok</td></tr>';
    return;
  }
  tb.innerHTML = filtered.map(c => {
    const canDelete = c.pn_count === 0;
    const deleteBtn = `<button class="btn sm danger" data-comp-del="${c.id}" data-comp-name="${esc(c.name)}" ${canDelete ? '' : 'disabled title="Masih ada PN terkait, gabungkan atau hapus PN terlebih dahulu"'}>Hapus</button>`;
    const renameBtn = `<button class="btn sm" data-comp-ren="${c.id}" data-comp-name="${esc(c.name)}">Ubah Nama</button>`;
    return `
      <tr>
        <td><code>#${c.id}</code></td>
        <td><b>${esc(c.name)}</b></td>
        <td>${fmt(c.pn_count)} PN</td>
        <td>${fmt(c.item_count)} barang</td>
        <td style="display:flex;gap:6px">${renameBtn}${deleteBtn}</td>
      </tr>
    `;
  }).join('');
}

function openMergeCompaniesDialog(){
  const d = $('#dMergeComp');
  const src = $('#mergeSrcComp');
  const tgt = $('#mergeTgtComp');
  const msg = $('#mergeMsg');
  if(!d || !src || !tgt) return;
  msg.textContent = '';
  msg.className = 'msg';
  const opts = ADMIN_COMPANIES_CACHE.map(c => `<option value="${c.id}">${esc(c.name)} (${c.pn_count} PN)</option>`).join('');
  src.innerHTML = opts;
  tgt.innerHTML = opts;
  if(src.options.length > 1){
    tgt.selectedIndex = 1;
  }
  d.showModal();
}

// --- DETEKSI DUPLIKAT ---
async function loadAdminDuplicates(){
  const cnt = $('#adminDuplicatesContainer');
  if(!cnt) return;
  cnt.innerHTML = '<div style="text-align:center;padding:20px" class="mu">Menganalisis potensi duplikat…</div>';
  try{
    const r = await jget('/api/admin/duplicates');
    if(r.error){
      cnt.innerHTML = `<div class="msg err">${esc(r.error)}</div>`;
      return;
    }
    const dupNames = r.duplicate_names || [];
    const dupPns = r.duplicate_pns || [];
    const countEl = $('#tabCountDuplicates');
    if(countEl) countEl.textContent = fmt(dupNames.length + dupPns.length);

    if(!dupNames.length && !dupPns.length){
      cnt.innerHTML = '<div class="msg ok" style="text-align:center;padding:24px">Tidak ditemukan duplikasi nama barang atau part number pada database. Data bersih!</div>';
      return;
    }

    let namesHtml = '';
    if(dupNames.length){
      namesHtml = `
        <h4 style="margin:8px 0 4px;font-size:15px;color:var(--tx)">Nama Barang Duplikat (${dupNames.length} kelompok terdeteksi)</h4>
        ${dupNames.map(d => `
          <div class="dup-card">
            <div class="dup-header">
              <span class="dup-title">"${esc(d.norm_name)}"</span>
              <span class="dup-badge">${d.count} barang</span>
            </div>
            <div class="dup-items-grid">
              ${(d.items || []).map(it => `
                <a class="dup-item-chip" href="/list?q=${encodeURIComponent(it.name || '')}" target="_blank" title="Buka di tab baru">
                  <span>#${it.id}</span> <b>${esc(it.name || '(tanpa nama)')}</b>
                </a>
              `).join('')}
            </div>
          </div>
        `).join('')}
      `;
    }

    let pnsHtml = '';
    if(dupPns.length){
      pnsHtml = `
        <h4 style="margin:16px 0 4px;font-size:15px;color:var(--tx)">Part Number Sama Antar-Barang (${dupPns.length} terdeteksi)</h4>
        ${dupPns.map(p => `
          <div class="dup-card">
            <div class="dup-header">
              <span class="dup-title">${esc(p.company)} &bull; <code>${esc(p.pn_norm)}</code></span>
              <span class="dup-badge">${p.item_count} barang terhubung</span>
            </div>
            <div class="dup-items-grid">
              ${(p.occurrences || []).map(oc => `
                <a class="dup-item-chip" href="/list?q=${encodeURIComponent(oc.pn || '')}" target="_blank" title="Buka pencarian PN">
                  <span>#${oc.item_id}</span> <b>${esc(oc.item_name || '(tanpa nama)')}</b> (PN: ${esc(oc.pn)})
                </a>
              `).join('')}
            </div>
          </div>
        `).join('')}
      `;
    }

    cnt.innerHTML = namesHtml + pnsHtml;
  }catch(e){
    cnt.innerHTML = '<div class="msg err">Gagal menganalisis data duplikat.</div>';
  }
}

// --- RESTORE DATA ---
async function runAdminRestore(){
  const inp = $('#adminRestoreFile');
  const file = inp?.files?.[0];
  if(!file){
    toast.error('Pilih berkas JSON cadangan terlebih dahulu');
    return;
  }
  const ok = await confirmDialog({
    title: 'Pulihkan Data Database?',
    message: `Berkas "${file.name}" akan diimpor ke database. Data yang belum ada akan ditambahkan dan disinkronkan. Lanjutkan?`,
    confirmText: 'Ya, Pulihkan Data',
    cancelText: 'Batal',
    type: 'warning'
  });
  if(!ok) return;

  const fd = new FormData();
  fd.append('file', file);
  const tid = toast.loading('Memulihkan data database…', { description: file.name });
  try{
    const r = await fetch('/api/admin/restore', { method: 'POST', body: fd }).then(x => x.json());
    if(r.error){
      toast.error('Pemulihan gagal', { id: tid, description: r.error });
      return;
    }
    toast.success('Pemulihan berhasil', {
      id: tid,
      description: `${r.companies_restored} company, ${r.items_restored} barang, ${r.part_numbers_restored} PN dipulihkan`
    });
    inp.value = '';
    await refreshAdminStats();
    await loadAdminCompanies();
    await loadMeta();
    await changed();
  }catch(e){
    toast.error('Gagal mengirim berkas pemulihan', { id: tid });
  }
}

async function openAdmin(){
  if(!CURRENT_USER || !CURRENT_USER.is_admin){
    toast.error('Akses khusus administrator');
    return;
  }
  $('#dAdmin').showModal();
  await refreshAdminStats();
  await loadAdminUsers();
  await loadAdminSessions();
  await loadAdminLogs(1);
  await loadAdminCompanies();
}

function chrome(){
  const pg=document.body.dataset.page;
  let cur='';try{cur=localStorage.getItem('cmp-theme')||'';}catch(e){}
  applyTheme(cur);
  const themes=[['','Light'],['dark','Dark'],['theme-sakura','Sakura'],['theme-bamboo','Bamboo'],['theme-cyberpunk','Cyberpunk'],['theme-mingyu','Mingyu'],['theme-ocean','Ocean'],['theme-retrolight','Retrolight']];
  $('#nav').innerHTML='<a class="brand" href="/"><span class="logo">PN</span><span class="t">Compare PN</span></a>'+
    '<nav><a href="/" class="'+(pg==='search'?'on':'')+'">Cari</a><a href="/list" class="'+(pg==='list'?'on':'')+'">Daftar</a></nav>'+
    '<span class="sp"></span><span class="mu" id="stats"></span>'+
    '<span id="navAuth" style="display:inline-flex;align-items:center;gap:8px"></span>'+
    '<select class="btn sm" id="thm" style="min-width:110px">'+themes.map(([v,l])=>'<option value="'+v+'" '+(cur===v?'selected':'')+'>'+l+'</option>').join('')+'</select>'+
    '<button class="btn sm" id="bNeko" title="Toggle pet kucing Neko">Neko</button>'+
    '<button class="btn sm" id="bImp">Import</button><button class="btn sm pri" id="bAdd">+ Tambah</button>';
  renderNavAuth();
  const th=$('#thm');
  if(th){
    th.value=cur;
    th.addEventListener('change',e=>{
      const v=e.target.value||'';
      applyTheme(v);
    });
  }

  const NEKO_BEHAVIORS = {
    'Chase Mouse': 'Mengejar Kursor',
    'Run Away From Mouse': 'Menghindar dari Kursor',
    'Run Around Randomly': 'Lari Acak',
    'Pace Around Screen': 'Keliling Sudut Layar',
    'Run Around': 'Bermain Bola Pantul'
  };
  window.onNekoBehaviorChange = function(name) {
    const lbl = NEKO_BEHAVIORS[name] || name;
    if (window.toast) toast.info(`Perilaku Neko: ${lbl}`);
  };

  const applyNekoState = (enabled, notify = false) => {
    const btn = $('#bNeko');
    if (btn) {
      btn.classList.toggle('active', enabled);
      btn.title = enabled ? 'Neko: Aktif (klik untuk matikan)' : 'Neko: Nonaktif (klik untuk aktifkan)';
    }
    if (enabled) {
      if (!window.nekoInstance && typeof window.createNeko === 'function') {
        window.nekoInstance = window.createNeko({
          speed: 24,
          fps: 120,
          allowBehaviorChange: true
        });
      }
    } else {
      if (window.nekoInstance) {
        window.nekoInstance.destroy();
        window.nekoInstance = null;
      }
    }
    if (notify) {
      if (enabled) toast.success('Neko diaktifkan. Klik kucing untuk mengubah aksinya.');
      else toast.info('Neko dimatikan.');
    }
  };

  const bNeko = $('#bNeko');
  if (bNeko) {
    bNeko.onclick = () => {
      let curNeko = true;
      try { curNeko = localStorage.getItem('pn_neko_enabled') !== '0'; } catch(e){}
      const nextNeko = !curNeko;
      try { localStorage.setItem('pn_neko_enabled', nextNeko ? '1' : '0'); } catch(e){}
      applyNekoState(nextNeko, true);
    };
  }
  let nekoInit = true;
  try { nekoInit = localStorage.getItem('pn_neko_enabled') !== '0'; } catch(e){}
  applyNekoState(nekoInit, false);

  document.body.insertAdjacentHTML('beforeend',`
  <datalist id="cl"></datalist><div id="toasts" popover="manual"></div>
  <div id="rowActionMenu" class="menu-dropdown row-action-popup" hidden>
    <button class="menu-item" id="rowActApprove" type="button">
      <span class="menu-item-label" id="rowActApproveLabel">Approve</span>
      <span class="menu-item-desc" id="rowActApproveDesc">Tandai kroscek selesai</span>
    </button>
    <button class="menu-item" id="rowActEdit" type="button">
      <span class="menu-item-label" id="rowActEditLabel">Edit Barang</span>
      <span class="menu-item-desc" id="rowActEditDesc">Ubah nama atau part number</span>
    </button>
    <button class="menu-item" id="rowActClone" type="button">
      <span class="menu-item-label" id="rowActCloneLabel">Kloning Item</span>
      <span class="menu-item-desc" id="rowActCloneDesc">Duplikasi data sebagai barang baru</span>
    </button>
    <button class="menu-item" id="rowActHistory" type="button">
      <span class="menu-item-label" id="rowActHistoryLabel">Riwayat Perubahan</span>
      <span class="menu-item-desc" id="rowActHistoryDesc">Lihat catatan versi &amp; revisi</span>
    </button>
    <div class="menu-sep" id="rowActSepDelete"></div>
    <button class="menu-item menu-item-danger" id="rowActDelete" type="button">
      <span class="menu-item-label" id="rowActDeleteLabel">Hapus Barang</span>
      <span class="menu-item-desc" id="rowActDeleteDesc">Hapus permanen barang ini</span>
    </button>
  </div>
  <dialog id="dHelp">
    <div class="dh"><h3>Pintasan Keyboard</h3><button class="x" id="helpX" aria-label="Tutup">×</button></div>
    <table class="ks-table">
      <tbody>
        <tr><td><kbd>/</kbd></td><td>Fokus cepat ke kotak pencarian PN / barang</td></tr>
        <tr><td><kbd>Esc</kbd></td><td>Bersihkan filter pencarian / tutup modal aktif</td></tr>
        <tr><td><kbd>Enter</kbd></td><td>Pindah ke input berikutnya / submit formulir</td></tr>
        <tr><td><kbd>Ctrl</kbd> + <kbd>Enter</kbd></td><td>Simpan cepat data barang yang sedang diisi</td></tr>
        <tr><td><kbd>?</kbd></td><td>Tampilkan panduan pintasan keyboard ini</td></tr>
      </tbody>
    </table>
    <div class="act"><button class="btn pri" id="helpClose">Mengerti</button></div>
  </dialog>
  <dialog id="dAdmin">
    <div class="dh">
      <div class="admin-header-title">
        <span>Admin Dashboard &amp; Monitor</span>
        <span class="live-indicator"><span class="live-dot"></span> Live</span>
      </div>
      <button class="x" id="adminX" aria-label="Tutup">×</button>
    </div>
    <div class="admin-content">
      <div class="admin-kpi-grid">
        <div class="kpi-card">
          <span class="kpi-label">Total Pengguna</span>
          <span class="kpi-value" id="kpiUsers">0</span>
          <span class="kpi-sub">Akun terdaftar</span>
        </div>
        <div class="kpi-card">
          <span class="kpi-label">Sesi Aktif</span>
          <span class="kpi-value" id="kpiSessions">0</span>
          <span class="kpi-sub" id="kpiActive15m">0 aktif 15 mnt terakhir</span>
        </div>
        <div class="kpi-card">
          <span class="kpi-label">Aktivitas Hari Ini</span>
          <span class="kpi-value" id="kpiLogsToday">0</span>
          <span class="kpi-sub" id="kpiLogsTotal">0 total log</span>
        </div>
        <div class="kpi-card">
          <span class="kpi-label">Total Barang &amp; PN</span>
          <span class="kpi-value" id="kpiItems">0</span>
          <span class="kpi-sub" id="kpiPns">0 PN tersimpan</span>
        </div>
      </div>

      <div class="admin-tabs">
        <button class="admin-tab-btn active" data-admin-tab="users">Pengguna (<span id="tabCountUsers">0</span>)</button>
        <button class="admin-tab-btn" data-admin-tab="sessions">Sesi Aktif (<span id="tabCountSessions">0</span>)</button>
        <button class="admin-tab-btn" data-admin-tab="logs">Log Aktivitas (<span id="tabCountLogs">0</span>)</button>
        <button class="admin-tab-btn" data-admin-tab="companies">Perusahaan (<span id="tabCountCompanies">0</span>)</button>
        <button class="admin-tab-btn" data-admin-tab="duplicates">Deteksi Duplikat (<span id="tabCountDuplicates">0</span>)</button>
        <button class="admin-tab-btn" data-admin-tab="backup">Backup &amp; Restore</button>
      </div>

      <!-- Tab 1: Users -->
      <div class="admin-panel-tab active" id="tabUsers">
        <div class="tw">
          <table>
            <thead>
              <tr>
                <th>ID</th><th>Username</th><th>Role</th><th>Dibuat</th><th>Barang Dibuat</th><th>Barang Diedit</th><th>Sesi Aktif</th><th>Terakhir Aktif</th><th>Aksi</th>
              </tr>
            </thead>
            <tbody id="adminUsersTbody"></tbody>
          </table>
        </div>
      </div>

      <!-- Tab 2: Sessions -->
      <div class="admin-panel-tab" id="tabSessions">
        <div class="tw">
          <table>
            <thead>
              <tr>
                <th>User</th><th>IP Address</th><th>Perangkat / Browser</th><th>Waktu Login</th><th>Terakhir Aktif</th><th>Status</th><th>Aksi</th>
              </tr>
            </thead>
            <tbody id="adminSessionsTbody"></tbody>
          </table>
        </div>
      </div>

      <!-- Tab 3: Logs -->
      <div class="admin-panel-tab" id="tabLogs">
        <div class="bar" style="margin:0;gap:8px;flex-wrap:wrap">
          <input id="adminLogQ" placeholder="Cari log (user, detail, IP)..." style="flex:1;min-width:180px">
          <select id="adminLogAction" style="max-width:160px">
            <option value="">Semua Aksi</option>
            <option value="LOGIN">LOGIN</option>
            <option value="LOGOUT">LOGOUT</option>
            <option value="REGISTER">REGISTER</option>
            <option value="CREATE_ITEM">CREATE_ITEM</option>
            <option value="UPDATE_ITEM">UPDATE_ITEM</option>
            <option value="DELETE_ITEM">DELETE_ITEM</option>
            <option value="APPROVE_ITEM">APPROVE_ITEM</option>
            <option value="UNAPPROVE_ITEM">UNAPPROVE_ITEM</option>
            <option value="IMPORT_FILE">IMPORT_FILE</option>
          </select>
          <button class="btn sm" id="bExportLogs">Export CSV</button>
          <button class="btn sm" id="bRefreshLogs">Refresh</button>
        </div>
        <div class="tw" style="max-height:360px">
          <table>
            <thead>
              <tr>
                <th>Waktu</th><th>User</th><th>Aksi</th><th>Keterangan / Detail</th><th>IP Address</th>
              </tr>
            </thead>
            <tbody id="adminLogsTbody"></tbody>
          </table>
        </div>
        <div class="pager" style="margin:0">
          <span class="mu" id="adminLogInfo"></span><span class="sp"></span>
          <button class="btn sm" id="adminLogPrev">&lsaquo; Prev</button>
          <span id="adminLogPageDisp">Hal 1</span>
          <button class="btn sm" id="adminLogNext">Next &rsaquo;</button>
        </div>
      </div>

      <!-- Tab 4: Companies -->
      <div class="admin-panel-tab" id="tabCompanies">
        <div class="bar admin-subbar" style="margin:0">
          <input id="adminCompQ" placeholder="Cari nama perusahaan..." style="flex:1;min-width:180px">
          <button class="btn sm pri" id="bMergeComp">Gabung Perusahaan</button>
          <button class="btn sm" id="bRefreshComp">Refresh</button>
        </div>
        <div class="tw" style="max-height:360px">
          <table>
            <thead>
              <tr><th>ID</th><th>Nama Perusahaan</th><th>Total PN</th><th>Total Barang</th><th>Aksi</th></tr>
            </thead>
            <tbody id="adminCompaniesTbody"></tbody>
          </table>
        </div>
      </div>

      <!-- Tab 5: Duplicates -->
      <div class="admin-panel-tab" id="tabDuplicates">
        <div class="bar admin-subbar" style="margin:0">
          <span class="mu" style="font-size:13px">Mendeteksi potensi nama barang atau part number yang terduplikasi di database.</span>
          <span class="sp"></span>
          <button class="btn sm" id="bRefreshDups">Periksa Ulang</button>
        </div>
        <div id="adminDuplicatesContainer" class="dup-container" style="max-height:380px;overflow-y:auto;padding-right:4px"></div>
      </div>

      <!-- Tab 6: Backup & Restore -->
      <div class="admin-panel-tab" id="tabBackup">
        <div class="backup-grid">
          <div class="backup-card">
            <div>
              <h4>Cadangkan Database (Backup JSON)</h4>
              <p>Ekspor seluruh tabel database (items, part numbers, companies, users, item_history, activity_logs) ke format berkas JSON terstruktur.</p>
            </div>
            <div class="backup-card-actions">
              <a class="btn pri sm" href="/api/admin/backup" download id="bDownloadBackup">Unduh Cadangan Lengkap</a>
            </div>
          </div>
          <div class="backup-card">
            <div>
              <h4>Pulihkan Database (Restore JSON)</h4>
              <p>Unggah berkas cadangan JSON yang sebelumnya diunduh. Data barang dan PN yang belum ada akan ditambahkan dan disinkronkan.</p>
            </div>
            <div class="backup-card-actions">
              <input type="file" id="adminRestoreFile" accept=".json" style="font-size:12px;max-width:210px">
              <button class="btn sm" id="bRunRestore">Pulihkan Data</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </dialog>
  <dialog id="dHistory">
    <div class="dh">
      <h3 id="histTitle">Riwayat Perubahan Barang</h3>
      <button class="x" id="histX" aria-label="Tutup">×</button>
    </div>
    <div id="histContent" style="padding:16px;max-height:480px;overflow-y:auto"></div>
    <div class="act"><button class="btn pri" id="histClose">Tutup</button></div>
  </dialog>
  <dialog id="dMergeComp">
    <div class="dh">
      <h3>Gabung Dua Perusahaan (Merge)</h3>
      <button class="x" id="mergeCompX" aria-label="Tutup">×</button>
    </div>
    <div style="padding:14px 0" class="merge-box">
      <p class="mu" style="font-size:13px;margin:0 0 10px">
        Pindahkan semua PN dari <b>Perusahaan Asal</b> ke <b>Perusahaan Tujuan</b>. Perusahaan Asal akan dihapus setelah semua datanya dipindahkan.
      </p>
      <div class="lb">Perusahaan Asal (Yang akan dilebur / dihapus)</div>
      <select id="mergeSrcComp" style="width:100%"></select>
      <div class="lb" style="margin-top:10px">Perusahaan Tujuan (Target)</div>
      <select id="mergeTgtComp" style="width:100%"></select>
      <div id="mergeMsg" class="msg"></div>
    </div>
    <div class="act">
      <button class="btn" id="mergeCompCancel">Batal</button>
      <button class="btn pri btn-danger" id="mergeCompSubmit">Gabungkan</button>
    </div>
  </dialog>
  <dialog id="dAuth">
    <div class="dh"><h3 id="authTitle">Masuk</h3><button class="x" id="authX" aria-label="Tutup">×</button></div>
    <div class="lb">Username</div>
    <input id="authU" autocomplete="username" placeholder="Masukkan username">
    <div class="lb">Password</div>
    <input id="authP" type="password" autocomplete="current-password" placeholder="Minimal 8 karakter">
    <div id="authMsg" class="msg"></div>
    <div class="act">
      <button class="btn" id="authCancel" type="button">Batal</button>
      <button class="btn pri" id="authSubmit" type="button">Masuk</button>
    </div>
    <div class="auth-switch" id="authSwitch">Belum punya akun? <a id="authSwitchLink">Daftar akun baru</a></div>
  </dialog>
  <dialog id="dAdd">
    <div class="dh"><h3>Tambah barang</h3><button class="x" id="aX" aria-label="Tutup">×</button></div>
    <div class="lb">Nama barang (opsional)</div><input id="aNm" autocomplete="off">
    <div class="lb">PN per company</div>
    <div id="aRows"></div>
    <button class="btn sm" id="aMore">+ company lain</button>
    <div class="hint">Pengganti: pisah pakai <code>;</code>, contoh <code>002;002A;002B</code> (pertama = utama). Kosongkan company yang tidak punya PN.</div>
    <div id="aMsg" class="msg"></div>
    <div class="act"><button class="btn" id="aSave">Simpan</button><button class="btn pri" id="aSave2">Simpan &amp; lanjut</button></div>
  </dialog>
  <dialog id="dEdit">
    <div class="dh"><h3>Edit barang</h3><button class="x" id="eX" aria-label="Tutup">×</button></div>
    <div class="lb">Nama barang (opsional)</div><input id="eNm" autocomplete="off">
    <div class="lb">PN per company</div>
    <div id="eRows"></div>
    <button class="btn sm" id="eMore">+ company lain</button>
    <div class="hint">Pengganti: pisah pakai <code>;</code>, contoh <code>002;002A;002B</code> (pertama = utama). Kosongkan baris company yang tidak dipakai.</div>
    <div id="eMsg" class="msg"></div>
    <div class="act"><button class="btn" id="eSave">Simpan</button><button class="btn pri" id="eSave2">Simpan &amp; tutup</button></div>
  </dialog>
  <dialog id="dImp">
    <div class="dh"><h3>Import CSV / Excel</h3><button class="x" id="iX" aria-label="Tutup">×</button></div>
    <label class="drop" id="iDrop"><input type="file" id="iFile" accept=".csv,.xlsx">
      <b>Klik atau seret file ke sini</b><br><span id="iName">.csv atau .xlsx</span></label>
    <details class="fmt"><summary>Format file</summary>
      Header baris 1: Kolom <b>A1</b> = <code>nama barang</code> (atau <code>name</code>), Kolom <b>B1</b>, <b>C1</b>, dst. = nama company (contoh <code>unico</code>, <code>matric</code>).
      Beberapa PN dalam 1 cell pisah pakai <code>;</code>, contoh <code>002;002A;002B</code>.
      Kolom PN di Excel gunakan format <b>Text</b> supaya angka nol di depan tidak hilang.
      <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
        <a class="btn sm pri" href="/api/template/excel" download="template-compare-pn.xlsx">Download Template Excel (.xlsx)</a>
        <a class="btn sm" href="/api/template/csv" download="template-compare-pn.csv">Download Template CSV (.csv)</a>
      </div>
    </details>
    <div id="iMsg" class="msg"></div><div id="iRes"></div>
    <div class="act"><button class="btn" id="iClose">Tutup</button><button class="btn pri" id="iGo">Upload</button></div>
  </dialog>`);

  // help dialog
  $('#helpX').onclick = $('#helpClose').onclick = ()=>$('#dHelp').close();
  $('#dHelp').addEventListener('click', e => {
    if(e.target === $('#dHelp')) $('#dHelp').close();
  });

  // admin dialog listeners
  $('#adminX').onclick = ()=>$('#dAdmin').close();
  $('#dAdmin').addEventListener('click', e => {
    if(e.target === $('#dAdmin')) $('#dAdmin').close();
  });
  $$('.admin-tab-btn').forEach(btn => {
    btn.onclick = () => {
      $$('.admin-tab-btn').forEach(b => b.classList.remove('active'));
      $$('.admin-panel-tab').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const target = btn.dataset.adminTab;
      if(target === 'users') $('#tabUsers').classList.add('active');
      else if(target === 'sessions') $('#tabSessions').classList.add('active');
      else if(target === 'logs') $('#tabLogs').classList.add('active');
      else if(target === 'companies'){ $('#tabCompanies').classList.add('active'); loadAdminCompanies(); }
      else if(target === 'duplicates'){ $('#tabDuplicates').classList.add('active'); loadAdminDuplicates(); }
      else if(target === 'backup'){ $('#tabBackup').classList.add('active'); }
    };
  });

  $('#adminLogPrev').onclick = () => loadAdminLogs(adminLogPage - 1);
  $('#adminLogNext').onclick = () => loadAdminLogs(adminLogPage + 1);
  $('#bRefreshLogs').onclick = () => { refreshAdminStats(); loadAdminLogs(adminLogPage); };
  let logDebounce;
  $('#adminLogQ').oninput = () => {
    clearTimeout(logDebounce);
    logDebounce = setTimeout(()=>loadAdminLogs(1), 300);
  };
  $('#adminLogAction').onchange = () => loadAdminLogs(1);
  $('#bExportLogs').onclick = () => {
    const q = ($('#adminLogQ')?.value || '').trim();
    const act = $('#adminLogAction')?.value || '';
    window.location.href = `/api/admin/logs/export?q=${encodeURIComponent(q)}&action=${encodeURIComponent(act)}`;
  };

  // Company management listeners
  $('#bRefreshComp').onclick = () => loadAdminCompanies();
  $('#adminCompQ').oninput = () => renderAdminCompanies();
  $('#bMergeComp').onclick = () => openMergeCompaniesDialog();
  $('#adminCompaniesTbody').addEventListener('click', async e => {
    const ren = e.target.closest('[data-comp-ren]');
    if(ren){
      const cid = ren.dataset.compRen;
      const oldName = ren.dataset.compName;
      const newName = prompt(`Ubah nama perusahaan "${oldName}":`, oldName);
      if(!newName || newName.trim() === oldName) return;
      try{
        const r = await fetch(`/api/admin/companies/${cid}`, {
          method: 'PUT',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ name: newName.trim() })
        }).then(x => x.json());
        if(r.error){ toast.error(r.error); return; }
        toast.success(`Perusahaan diubah menjadi "${r.name}"`);
        await loadAdminCompanies();
        await loadMeta();
        await changed();
      }catch(err){ toast.error('Gagal mengubah nama perusahaan'); }
      return;
    }
    const del = e.target.closest('[data-comp-del]');
    if(del){
      if(del.disabled) return;
      const cid = del.dataset.compDel;
      const name = del.dataset.compName;
      const ok = await confirmDialog({
        title: 'Hapus Perusahaan?',
        message: `Perusahaan "${name}" yang kosong akan dihapus permanen. Lanjutkan?`,
        confirmText: 'Ya, Hapus',
        cancelText: 'Batal',
        type: 'danger'
      });
      if(!ok) return;
      try{
        const r = await fetch(`/api/admin/companies/${cid}`, { method: 'DELETE' }).then(x => x.json());
        if(r.error){ toast.error(r.error); return; }
        toast.success(`Perusahaan "${name}" dihapus`);
        await loadAdminCompanies();
        await loadMeta();
        await changed();
      }catch(err){ toast.error('Gagal menghapus perusahaan'); }
      return;
    }
  });

  // Duplicates listener
  $('#bRefreshDups').onclick = () => loadAdminDuplicates();

  // Restore listener
  $('#bRunRestore').onclick = () => runAdminRestore();

  // Merge modal listeners
  $('#mergeCompX').onclick = $('#mergeCompCancel').onclick = () => $('#dMergeComp').close();
  $('#dMergeComp').addEventListener('click', e => {
    if(e.target === $('#dMergeComp')) $('#dMergeComp').close();
  });
  $('#mergeCompSubmit').onclick = async () => {
    const srcId = parseInt($('#mergeSrcComp').value, 10);
    const tgtId = parseInt($('#mergeTgtComp').value, 10);
    const msg = $('#mergeMsg');
    if(!srcId || !tgtId || srcId === tgtId){
      msg.className = 'msg err';
      msg.textContent = 'Pilih dua perusahaan yang berbeda untuk digabungkan.';
      return;
    }
    const srcText = $('#mergeSrcComp').options[$('#mergeSrcComp').selectedIndex].text;
    const tgtText = $('#mergeTgtComp').options[$('#mergeTgtComp').selectedIndex].text;
    const ok = await confirmDialog({
      title: 'Gabungkan Perusahaan?',
      message: `Semua data part number dari "${srcText}" akan dipindahkan ke "${tgtText}". Perusahaan asal akan dihapus. Lanjutkan?`,
      confirmText: 'Ya, Gabungkan',
      cancelText: 'Batal',
      type: 'danger'
    });
    if(!ok) return;
    try{
      const r = await fetch('/api/admin/companies/merge', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ source_id: srcId, target_id: tgtId })
      }).then(x => x.json());
      if(r.error){
        msg.className = 'msg err';
        msg.textContent = r.error;
        return;
      }
      $('#dMergeComp').close();
      toast.success('Penggabungan perusahaan berhasil');
      await loadAdminCompanies();
      await loadMeta();
      await changed();
    }catch(err){
      msg.className = 'msg err';
      msg.textContent = 'Gagal menggabungkan perusahaan';
    }
  };

  // History dialog listeners
  $('#histX').onclick = $('#histClose').onclick = () => $('#dHistory').close();
  $('#dHistory').addEventListener('click', e => {
    if(e.target === $('#dHistory')) $('#dHistory').close();
  });

  // auth dialog event listeners
  const submitAuth=async()=>{
    const u=$('#authU').value.trim();
    const p=$('#authP').value;
    if(!u){$('#authMsg').className='msg err';$('#authMsg').textContent='Username harus diisi';return}
    if(!p){$('#authMsg').className='msg err';$('#authMsg').textContent='Password harus diisi';return}
    $('#authSubmit').disabled=true;
    try{
      const endpoint=authMode==='login'?'/api/auth/login':'/api/auth/register';
      const res=await (await fetch(endpoint,{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({username:u,password:p})
      })).json();
      if(res.error){
        $('#authMsg').className='msg err';
        $('#authMsg').textContent=res.error;
        toast.error(res.error);
      }else{
        CURRENT_USER=res.user;
        renderNavAuth();
        $('#dAuth').close();
        toast.success(authMode==='login'?'Berhasil masuk':'Akun berhasil dibuat & masuk',{description:`Selamat datang, ${CURRENT_USER.username}`});
        await changed();
      }
    }catch(e){
      $('#authMsg').className='msg err';
      $('#authMsg').textContent='Terjadi gangguan koneksi';
    }
    $('#authSubmit').disabled=false;
  };
  $('#authSubmit').onclick=submitAuth;
  $('#authX').onclick=()=>$('#dAuth').close();
  $('#authCancel').onclick=()=>$('#dAuth').close();
  $('#dAuth').addEventListener('keydown',e=>{
    if(e.key==='Enter'&&e.target.tagName==='INPUT'){e.preventDefault();submitAuth()}
  });

  // kepadatan tabel
  const dn=$('#dn');
  if(dn){
    const set=v=>{
      document.body.classList.toggle('compact',v);
      const lbl=dn.querySelector('.menu-item-label');
      if(lbl){
        lbl.textContent=v?'Kerapatan: Nyaman':'Kerapatan: Rapat';
      }else{
        dn.textContent=v?'Nyaman':'Rapat';
      }
      dn.classList.toggle('active',v);
      dn.title=v?'Tampilan baris saat ini rapat (klik untuk beralih ke nyaman)':'Tampilan baris saat ini nyaman (klik untuk beralih ke rapat)';
      try{localStorage.setItem('cmpDense',v?'1':'0')}catch(e){}
    };
    let v=false;try{v=localStorage.getItem('cmpDense')==='1'}catch(e){}
    set(v);dn.onclick=()=>set(!document.body.classList.contains('compact'));
  }

  // menu aksi dropdown handler
  let activeRowTrigger = null;
  const closeAllMenus = () => {
    document.querySelectorAll('.menu-dropdown').forEach(m => {
      m.hidden = true;
      const tr = m.closest('.menu-wrap')?.querySelector('.menu-trigger');
      if (tr) tr.setAttribute('aria-expanded', 'false');
    });
    if (activeRowTrigger) {
      activeRowTrigger.setAttribute('aria-expanded', 'false');
      activeRowTrigger = null;
    }
  };

  const positionRowMenu = (trigger) => {
    const menu = $('#rowActionMenu');
    if (!menu) return;

    const itemId = trigger.dataset.itemId;
    const canEdit = trigger.dataset.canEdit === '1';
    const isApproved = trigger.dataset.isApproved === '1';
    const approvedBy = trigger.dataset.approvedBy || '';

    // Approve button
    const bAppr = $('#rowActApprove');
    const lAppr = $('#rowActApproveLabel');
    const dAppr = $('#rowActApproveDesc');
    if (bAppr) {
      bAppr.dataset.approve = itemId;
      bAppr.dataset.appr = isApproved ? '0' : '1';
      bAppr.disabled = false;
      if (isApproved) {
        lAppr.textContent = 'Batal Approve';
        dAppr.textContent = approvedBy ? `Disetujui oleh ${approvedBy}` : 'Cabut status persetujuan';
        bAppr.title = 'Cabut status persetujuan barang ini';
      } else {
        lAppr.textContent = 'Approve';
        dAppr.textContent = 'Tandai kroscek selesai';
        bAppr.title = 'Setujui barang ini';
      }
    }

    // Edit button
    const bEdit = $('#rowActEdit');
    const dEdit = $('#rowActEditDesc');
    if (bEdit) {
      bEdit.dataset.edit = itemId;
      if (CURRENT_USER && !canEdit) {
        bEdit.disabled = true;
        dEdit.textContent = 'Hanya pembuat atau admin';
        bEdit.title = 'Hanya pembuat atau admin yang dapat mengedit';
      } else if (isApproved) {
        bEdit.disabled = true;
        dEdit.textContent = 'Batalkan approve untuk edit';
        bEdit.title = 'Barang sudah disetujui. Batal approve terlebih dahulu';
      } else {
        bEdit.disabled = false;
        dEdit.textContent = 'Ubah nama atau part number';
        bEdit.title = 'Edit data barang';
      }
    }

    // Clone button
    const bClone = $('#rowActClone');
    if (bClone) {
      bClone.dataset.clone = itemId;
      bClone.disabled = false;
      bClone.title = 'Duplikasi data barang sebagai entri baru';
    }

    // History button
    const bHist = $('#rowActHistory');
    if (bHist) {
      bHist.dataset.history = itemId;
      bHist.disabled = false;
      bHist.title = 'Lihat log riwayat perubahan barang ini';
    }

    // Delete button
    const bDel = $('#rowActDelete');
    const dDel = $('#rowActDeleteDesc');
    if (bDel) {
      bDel.dataset.delete = itemId;
      if (CURRENT_USER && !canEdit) {
        bDel.disabled = true;
        dDel.textContent = 'Hanya pembuat atau admin';
        bDel.title = 'Hanya pembuat atau admin yang dapat menghapus';
      } else if (isApproved) {
        bDel.disabled = true;
        dDel.textContent = 'Batalkan approve untuk hapus';
        bDel.title = 'Barang sudah disetujui. Batal approve terlebih dahulu';
      } else {
        bDel.disabled = false;
        dDel.textContent = 'Hapus permanen barang ini';
        bDel.title = 'Hapus permanen barang ini';
      }
    }

    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    activeRowTrigger = trigger;

    const rect = trigger.getBoundingClientRect();
    const menuWidth = menu.offsetWidth || 230;
    const menuHeight = menu.offsetHeight || 250;

    let left = rect.right - menuWidth;
    if (left < 10) left = Math.max(10, rect.left);
    if (left + menuWidth > window.innerWidth - 10) {
      left = window.innerWidth - menuWidth - 10;
    }

    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    let top;
    if (spaceBelow < menuHeight + 10 && spaceAbove > spaceBelow) {
      top = Math.max(10, rect.top - menuHeight - 6);
    } else {
      top = rect.bottom + 6;
    }

    menu.style.position = 'fixed';
    menu.style.top = `${Math.round(top)}px`;
    menu.style.left = `${Math.round(left)}px`;
  };

  document.addEventListener('click', e => {
    const rowTrigger = e.target.closest('.row-act-trigger');
    if (rowTrigger) {
      e.stopPropagation();
      if (activeRowTrigger === rowTrigger) {
        closeAllMenus();
        return;
      }
      closeAllMenus();
      positionRowMenu(rowTrigger);
      return;
    }

    const trigger = e.target.closest('.menu-trigger');
    if (trigger) {
      e.stopPropagation();
      const wrap = trigger.closest('.menu-wrap');
      const menu = wrap ? wrap.querySelector('.menu-dropdown') : null;
      if (menu) {
        const isHidden = menu.hidden;
        closeAllMenus();
        menu.hidden = !isHidden;
        trigger.setAttribute('aria-expanded', String(isHidden));
      }
      return;
    }

    if (!e.target.closest('.menu-dropdown')) {
      closeAllMenus();
    } else {
      const item = e.target.closest('.menu-item');
      if (item && item.id !== 'dn') {
        setTimeout(closeAllMenus, 80);
      }
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeAllMenus();
  });

  window.addEventListener('resize', closeAllMenus);
  window.addEventListener('scroll', closeAllMenus, true);

  // --- edit dialog
  let editId=null;
  const openEdit=async(id)=>{
    if(!CURRENT_USER){
      openAuth('Silakan masuk atau daftar terlebih dahulu untuk mengedit data PN.');
      return;
    }
    editId=id;
    $('#eNm').value='';$('#eMsg').textContent='';$('#eRows').innerHTML='';
    try{
      const r=await fetch('/api/items/'+id).then(x=>x.json());
      if(r.error){toast.error(r.error);return;}
      $('#eNm').value=r.name||'';
      if(r.entries && r.entries.length){
        r.entries.forEach(en=>addEditRow(en.company,true,en.pns||''));
      }else{
        COMPS.forEach(c=>addEditRow(c,true,''));if(!COMPS.length){addEditRow('',false,'');addEditRow('',false,'');}
      }
      $('#dEdit').showModal();($('#eRows .p')||$('#eNm')).focus();
    }catch(e){toast.error('Gagal memuat data')}
  };
  const addEditRow=(c,fixed,vals='')=>{
    const d=document.createElement('div');d.className='r';
    if(fixed){
      d.dataset.c=c||'';
      d.innerHTML=`<span class="cn" title="${esc(c||'')}">${esc(c||'')}</span><input class="p" placeholder="PN" autocomplete="off"><span></span>`;
    }else{
      d.innerHTML=`<input class="c" list="cl" placeholder="Nama company" autocomplete="off"><input class="p" placeholder="PN" autocomplete="off"><button class="x" title="Hapus baris">×</button>`;
    }
    $('#eRows').appendChild(d);
    const p=d.querySelector('.p');
    if(p)p.value = vals==null?'':String(vals);
    const cc=d.querySelector('.c');
    if(cc && !fixed) cc.value = c==null?'':String(c);
  };
  const saveEdit=async keep=>{
    const entries=$$('#eRows .r').map(r=>({company:r.dataset.c||r.querySelector('.c').value,pns:r.querySelector('.p').value}));
    const r=await (await fetch('/api/items/'+editId,{method:'PUT',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({name:$('#eNm').value,entries})})).json();
    if(r.error){$('#eMsg').className='msg err';$('#eMsg').textContent=r.error;toast.error('Gagal menyimpan',{description:r.error});return}
    toast.success('Tersimpan',{description:`${r.pn_added} PN diperbarui`});
    await changed();
    if(keep){
      $('#eMsg').className='msg ok';$('#eMsg').textContent=`Tersimpan (${r.pn_added} PN).`;
    }else{ $('#eMsg').textContent=''; $('#dEdit').close(); }
  };

  document.addEventListener('click',async e=>{
    // toggle admin role
    const tbAdmin = e.target.closest('[data-toggle-admin]');
    if(tbAdmin){
      e.preventDefault();
      const uid = tbAdmin.dataset.toggleAdmin;
      const isAdm = tbAdmin.dataset.current === '1';
      const ok = await confirmDialog({
        title: isAdm ? 'Cabut Akses Admin?' : 'Jadikan Admin?',
        message: isAdm ? 'User ini tidak akan lagi memiliki hak akses Admin.' : 'User ini akan mendapatkan hak penuh Admin Dashboard dan pengelolaan sistem.',
        confirmText: isAdm ? 'Cabut Akses' : 'Ya, Berikan Akses',
        type: isAdm ? 'warning' : 'success'
      });
      if(!ok) return;
      tbAdmin.disabled = true;
      try{
        const r = await fetch(`/api/admin/users/${uid}/toggle-admin`, {method: 'POST'}).then(x=>x.json());
        if(r.error) toast.error(r.error);
        else {
          toast.success('Role user berhasil diubah');
          await loadAdminUsers();
        }
      }catch(err){ toast.error('Gagal mengubah role'); }
      tbAdmin.disabled = false;
      return;
    }

    // revoke session
    const revBtn = e.target.closest('[data-revoke-token]');
    if(revBtn){
      e.preventDefault();
      const tok = revBtn.dataset.revokeToken;
      if(!tok) return;
      const ok = await confirmDialog({
        title: 'Putuskan Sesi Ini?',
        message: 'Pengguna pada perangkat ini akan langsung keluar dari sistem.',
        confirmText: 'Putuskan Sesi',
        type: 'danger'
      });
      if(!ok) return;
      revBtn.disabled = true;
      try{
        const r = await fetch('/api/admin/sessions/revoke', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({token: tok})
        }).then(x=>x.json());
        if(r.error) toast.error(r.error);
        else {
          toast.success('Sesi berhasil diputuskan');
          await refreshAdminStats();
          await loadAdminSessions();
        }
      }catch(err){ toast.error('Gagal memutuskan sesi'); }
      revBtn.disabled = false;
      return;
    }

    const thb=e.target.closest('#thBarang');
    if(thb){
      e.preventDefault();
      CURRENT_SORT = (CURRENT_SORT === 'name_asc') ? 'name_desc' : 'name_asc';
      const srt = $('#srt');
      if(srt) srt.value = CURRENT_SORT;
      try{localStorage.setItem('cmp_list_srt', CURRENT_SORT);}catch(err){}
      if(typeof go === 'function') go(1);
      return;
    }

    const eb=e.target.closest('[data-edit]');
    if(eb){
      e.preventDefault();
      if(eb.disabled)return;
      openEdit(eb.dataset.edit);
      return;
    }
    const cb=e.target.closest('[data-clone]');
    if(cb){
      e.preventDefault();
      if(cb.disabled)return;
      if(!CURRENT_USER){openAuth('Silakan masuk atau daftar terlebih dahulu untuk kloning data PN.');return;}
      cloneItem(cb.dataset.clone);
      return;
    }
    const hb=e.target.closest('[data-history]');
    if(hb){
      e.preventDefault();
      if(hb.disabled)return;
      openItemHistory(hb.dataset.history);
      return;
    }
    const ab=e.target.closest('[data-approve]');
    if(ab){
      e.preventDefault();
      if(!CURRENT_USER){openAuth('Silakan masuk untuk approve data PN.');return;}
      const id=ab.dataset.approve;
      const appr=ab.dataset.appr==='1';
      const ok = await confirmDialog({
        title: appr ? 'Approve Item Ini?' : 'Batal Approve Item Ini?',
        message: appr 
          ? 'Item ini akan ditandai sudah disetujui (kroscek selesai).' 
          : 'Status persetujuan item ini akan dicabut dan data dapat diedit kembali.',
        confirmText: appr ? 'Ya, Approve' : 'Ya, Batal Approve',
        cancelText: 'Kembali',
        type: appr ? 'success' : 'warning'
      });
      if(!ok)return;
      ab.disabled=true;
      try{
        const r=await fetch('/api/items/'+id+'/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({approve:appr})}).then(x=>x.json());
        if(r.error){toast.error(r.error);ab.disabled=false;return;}
        toast.success(appr?'Disetujui':'Approval dibatalkan');
        await changed();
      }catch(err){toast.error('Gagal memproses approval');ab.disabled=false;}
      return;
    }
    const db=e.target.closest('[data-delete]');
    if(db){
      e.preventDefault();
      if(db.disabled)return;
      if(!CURRENT_USER){openAuth('Silakan masuk untuk menghapus data PN.');return;}
      const id=db.dataset.delete;
      const ok = await confirmDialog({
        title: 'Hapus Barang Ini?',
        message: 'Barang beserta seluruh PN yang terkait akan dihapus permanen. Tindakan ini tidak dapat dibatalkan.',
        confirmText: 'Hapus Permanen',
        cancelText: 'Batal',
        type: 'danger'
      });
      if(!ok)return;
      db.disabled=true;
      try{
        const r=await fetch('/api/items/'+id,{method:'DELETE'}).then(x=>x.json());
        if(r.error){toast.error(r.error);db.disabled=false;return;}
        toast.success('Barang berhasil dihapus');
        await changed();
      }catch(err){toast.error('Gagal menghapus');db.disabled=false;}
      return;
    }
  });
  $('#eX').onclick=()=>$('#dEdit').close();
  $('#eSave').onclick=()=>saveEdit(true);
  $('#eSave2').onclick=()=>saveEdit(false);
  $('#eMore').onclick=()=>{addEditRow('',false,'');$$('#eRows .c').pop().focus()};
  $('#eRows').addEventListener('click',e=>{if(e.target.classList.contains('x'))e.target.closest('.r').remove()});
  $('#dEdit').addEventListener('keydown',e=>{
    if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();saveEdit(true);return}
    if(e.key==='Enter'&&e.target.classList.contains('p')){
      e.preventDefault();
      const ps=$$('#eRows .p'),n=ps.indexOf(e.target);
      n<ps.length-1?ps[n+1].focus():saveEdit(true);
    }
  });

  // --- tambah manual
  const addRow=(c,fixed)=>{
    const d=document.createElement('div');d.className='r';
    if(fixed){d.dataset.c=c;d.innerHTML=`<span class="cn" title="${esc(c)}">${esc(c)}</span><input class="p" placeholder="PN" autocomplete="off"><span></span>`}
    else d.innerHTML=`<input class="c" list="cl" placeholder="Nama company" autocomplete="off"><input class="p" placeholder="PN" autocomplete="off"><button class="x" title="Hapus baris">×</button>`;
    $('#aRows').appendChild(d);
  };
  const openAdd=()=>{
    if(!CURRENT_USER){
      openAuth('Silakan masuk atau daftar terlebih dahulu untuk menambah data PN.');
      return;
    }
    $('#aNm').value='';$('#aMsg').textContent='';$('#aRows').innerHTML='';
    COMPS.forEach(c=>addRow(c,true));if(!COMPS.length){addRow('',false);addRow('',false)}
    $('#dAdd').showModal();($('#aRows .p')||$('#aNm')).focus();
  };
  const save=async keep=>{
    const entries=$$('#aRows .r').map(r=>({company:r.dataset.c||r.querySelector('.c').value,pns:r.querySelector('.p').value}));
    const r=await (await fetch('/api/items',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({name:$('#aNm').value,entries})})).json();
    if(r.error){$('#aMsg').className='msg err';$('#aMsg').textContent=r.error;toast.error('Gagal menyimpan',{description:r.error});return}
    toast.success('Tersimpan',{description:`${r.pn_added} PN ditambahkan`});
    await changed();
    if(keep){
      $('#aMsg').className='msg ok';$('#aMsg').textContent=`Tersimpan (${r.pn_added} PN). Lanjut input berikutnya.`;
      $('#aNm').value='';
      const rows=$$('#aRows .r');rows.filter(x=>!x.dataset.c&&!x.querySelector('.c').value).forEach(x=>x.remove());
      COMPS.filter(c=>!$$('#aRows .r').some(x=>x.dataset.c===c)).forEach(c=>addRow(c,true));
      $$('#aRows .p').forEach(i=>i.value='');
      ($('#aRows .p')||$('#aNm')).focus();
    }else $('#dAdd').close();
  };
  setTimeout(()=>{
    const ba=$('#bAdd'); if(ba){ba.onclick=openAdd;}
    const bi=$('#bImp'); if(bi){bi.onclick=()=>{
      if(!CURRENT_USER){
        openAuth('Silakan masuk atau daftar terlebih dahulu untuk import file PN.');
        return;
      }
      $('#iMsg').textContent='';$('#iRes').innerHTML='';$('#iFile').value='';setFile();
      const pbox = $('#iPreviewBox'); if(pbox) pbox.remove();
      $('#dImp').showModal();
    };}
  },0);
  $('#aX').onclick=()=>$('#dAdd').close();
  $('#aSave').onclick=()=>save(false);$('#aSave2').onclick=()=>save(true);
  $('#aMore').onclick=()=>{addRow('',false);$$('#aRows .c').pop().focus()};
  $('#aRows').addEventListener('click',e=>{if(e.target.classList.contains('x'))e.target.closest('.r').remove()});
  $('#dAdd').addEventListener('keydown',e=>{
    if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();save(true);return}
    if(e.key==='Enter'&&e.target.classList.contains('p')){
      e.preventDefault();
      const ps=$$('#aRows .p'),n=ps.indexOf(e.target);
      n<ps.length-1?ps[n+1].focus():save(true);
    }
  });

  // --- import
  const setFile=()=>{
    const f=$('#iFile').files[0];
    $('#iName').textContent=f?f.name:'.csv atau .xlsx';
    if(f) renderImportPreview(f);
    else { const pb = $('#iPreviewBox'); if(pb) pb.remove(); }
  };
  $('#iX').onclick=$('#iClose').onclick=()=>$('#dImp').close();
  $('#iFile').onchange=setFile;
  const dz=$('#iDrop');
  ['dragover','dragenter'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.add('over')}));
  ['dragleave','drop'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.remove('over')}));
  dz.addEventListener('drop',e=>{$('#iFile').files=e.dataTransfer.files;setFile()});
  $('#dImp').addEventListener('click',e=>{
    if(e.detail===0)return;
    const r=e.currentTarget.getBoundingClientRect();
    if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.currentTarget.close();
  });
  $('#iGo').onclick=async()=>{
    const f=$('#iFile').files[0];
    if(!f){$('#iMsg').className='msg err';$('#iMsg').textContent='Pilih file dulu';return}
    const fd=new FormData();fd.append('file',f);
    $('#iMsg').className='msg';$('#iMsg').textContent='';$('#iRes').innerHTML='';$('#iGo').disabled=true;
    const tid=toast.loading('Mengupload & memproses…',{description:f.name});
    try{
      const r=await (await fetch('/api/import',{method:'POST',body:fd})).json();
      if(r.error){$('#iMsg').className='msg err';$('#iMsg').textContent=r.error;toast.error('Import gagal',{id:tid,description:r.error})}
      else{
        toast.success('Import selesai',{id:tid,description:`${r.pn_added} PN masuk, ${r.pn_duplicate_skipped} dobel dilewati`});
        showRes(r);await changed();
      }
    }catch(e){$('#iMsg').className='msg err';$('#iMsg').textContent='Gagal upload';toast.error('Gagal upload',{id:tid})}
    $('#iGo').disabled=false;
  };

  // Keyboard shortcuts
  document.addEventListener('keydown',e=>{
    if(/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    if(document.querySelector('dialog[open]')) return;
    if(e.key==='/'){
      const q=$('#q');if(q){e.preventDefault();q.focus();q.select()}
    }else if(e.key==='?'){
      e.preventDefault();
      $('#dHelp').showModal();
    }
  });
}
async function boot(){chrome();await loadAuth();await loadMeta()}