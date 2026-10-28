const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));

const norm=s=>String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const jget=async u=>(await fetch(u)).json();
const fmt=n=>Number(n||0).toLocaleString('id-ID');
const csvq=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
let COMPS=[],STATS={items:0,pns:0,companies:0},LASTDUP=[],CURRENT_USER=null;

function copyText(t){
  const done=()=>toast.success('Disalin',{description:t});
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
document.addEventListener('click',e=>{const p=e.target.closest('.pn');if(p)copyText(p.dataset.pn)});

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
const headHtml=()=>'<tr><th>Barang</th>'+COMPS.map(c=>`<th>${esc(c)}</th>`).join('')+'<th class="author-th">Diupdate Oleh</th>'+(document.body.dataset.page==='list'?'<th class="act-th">Aksi</th>':'')+'</tr>';
function rowCells(i,q,no){
  const m={};i.pns.forEach(p=>(m[p.company]=m[p.company]||[]).push(p));
  const nm=i.name?esc(i.name):'<span class="mu">(tanpa nama)</span>';
  const who = i.updated_by || i.created_by;
  const author = who
    ?`<span class="badge-user" title="Diupdate oleh ${esc(who)}">👤 ${esc(who)}</span>`
    :'<span class="mu">–</span>';
  const canEdit = CURRENT_USER && ((i.user_id == null) || (i.user_id == CURRENT_USER.id));
  const isApproved = !!i.approved_by_name;
  let apBtnTip = 'Kroscek & Approve';
  if(isApproved){
    try{
      const d=new Date(i.approved_at);
      if(!isNaN(d.getTime())) apBtnTip = `Disetujui oleh ${i.approved_by_name} • ${d.toLocaleString('id-ID')}`;
      else apBtnTip = `Disetujui oleh ${i.approved_by_name}`;
    }catch(e){ apBtnTip = `Disetujui oleh ${i.approved_by_name}`; }
  }
  const approveBtn = CURRENT_USER ? `<button class="btn sm ${isApproved?'ok':''}" data-approve="${i.id}" data-appr="${isApproved?'0':'1'}" title="${esc(apBtnTip)}">${isApproved?'✓ Disetujui':'✓ Approve'}</button>` : '';
  const editBtn = (canEdit && !isApproved) ? `<button class="btn sm" data-edit="${i.id}" title="Edit">Edit</button>` : (canEdit && isApproved ? `<button class="btn sm" disabled title="Batalin approve dulu kalo mau edit">Edit</button>` : '');
  const apprName = isApproved ? i.approved_by_name : '';
  const actCol = document.body.dataset.page==='list' ? `<td class="act-col" style="display:flex;gap:4px;flex-wrap:wrap">${approveBtn}${editBtn}</td>` : '';
  const nmCell = nm;
  return `<td class="nm">${no?`<span class="no">${no}</span>`:''}${nmCell}</td>`
    +COMPS.map(c=>`<td>${cell(m[c],q,apprName,i.approved_at)}</td>`).join('')
    +`<td class="author-col">${author}</td>`
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
  if(CURRENT_USER){
    el.innerHTML='<span class="user-pill" title="Login sebagai '+esc(CURRENT_USER.username)+'">👤 <b>'+esc(CURRENT_USER.username)+'</b></span><md-text-button id="bLogout">Keluar</md-text-button>';
    const bLo=$('#bLogout');
    if(bLo)bLo.onclick=async()=>{
      await fetch('/api/auth/logout',{method:'POST'});
      CURRENT_USER=null;
      renderNavAuth();
      toast.info('Berhasil keluar');
      await changed();
    };
  }else{
    el.innerHTML='<md-text-button id="bLogin">Masuk</md-text-button>';
    const bLi=$('#bLogin');
    if(bLi)bLi.onclick=()=>openAuth();
  }
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
function chrome(){
  const pg=document.body.dataset.page;
  let cur='';try{cur=localStorage.getItem('cmp-theme')||'';}catch(e){}
  applyTheme(cur);
  const themes=[['','Light'],['dark','Dark'],['theme-sakura','Sakura'],['theme-bamboo','Bamboo'],['theme-cyberpunk','Cyberpunk'],['theme-mingyu','Mingyu'],['theme-ocean','Ocean'],['theme-retrolight','Retrolight']];
  $('#nav').innerHTML='<a class="brand" href="/"><span class="logo">PN</span><span class="t">Compare PN</span></a>'+
    '<nav><a href="/" class="'+(pg==='search'?'on':'')+'">Cari</a><a href="/list" class="'+(pg==='list'?'on':'')+'">Daftar</a></nav>'+
    '<span class="sp"></span><span class="mu" id="stats"></span>'+
    '<span id="navAuth" style="display:inline-flex;align-items:center;gap:8px"></span>'+
    '<md-outlined-select id="thm" style="min-width:130px">'+themes.map(([v,l])=>'<md-select-option value="'+v+'" '+(cur===v?'selected':'')+'><div slot="headline">'+l+'</div></md-select-option>').join('')+'</md-outlined-select>'+
    '<md-outlined-button id="bImp">Import</md-outlined-button><md-filled-button id="bAdd">Tambah</md-filled-button>';
  renderNavAuth();
  setTimeout(()=>{
    const th=$('#thm');
    if(th){
      th.value=cur;
      th.addEventListener('change',e=>{
        const v=e.target.value||'';
        applyTheme(v);
      });
    }
  },0);
  try{
    const navEl=$('#nav');
    if(navEl){
      let ticking=false,sc=false;
      window.addEventListener('scroll',()=>{
        if(ticking)return;
        ticking=true;
        requestAnimationFrame(()=>{
          const y=window.scrollY||window.pageYOffset;
          if(!sc && y>80){navEl.classList.add('scrolled');sc=true;}
          else if(sc && y<20){navEl.classList.remove('scrolled');sc=false;}
          ticking=false;
        });
      },{passive:true});
    }
  }catch(e){}
  document.body.insertAdjacentHTML('beforeend',`
  <datalist id="cl"></datalist><div id="toasts" popover="manual"></div>
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
      Header = nama company, contoh <code>unico,matric</code> (kolom <code>name</code> opsional di depan). Beberapa PN dalam 1 cell pisah pakai <code>;</code>.
      Kolom PN di Excel pakai format <b>Text</b> supaya nol di depan tidak hilang.
      <a download="template.csv" href="data:text/csv;charset=utf-8,unico%2Cmatric%0A001%2C07x%0A002%3B002A%2C08-Y%0A">Download template</a></details>
    <div id="iMsg" class="msg"></div><div id="iRes"></div>
    <div class="act"><button class="btn" id="iClose">Tutup</button><button class="btn pri" id="iGo">Upload</button></div>
  </dialog>`);

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
    const set=v=>{document.body.classList.toggle('compact',v);dn.textContent=v?'Nyaman':'Rapat';try{localStorage.setItem('cmpDense',v?'1':'0')}catch(e){}};
    let v=false;try{v=localStorage.getItem('cmpDense')==='1'}catch(e){}
    set(v);dn.onclick=()=>set(!document.body.classList.contains('compact'));
  }

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
    const eb=e.target.closest('[data-edit]');
    if(eb){
      e.preventDefault();
      if(eb.disabled)return;
      openEdit(eb.dataset.edit);
      return;
    }
    const ab=e.target.closest('[data-approve]');
    if(ab){
      e.preventDefault();
      if(!CURRENT_USER){openAuth('Silakan masuk untuk approve data PN.');return;}
      const id=ab.dataset.approve;
      const appr=ab.dataset.appr==='1';
      const ok = confirm(appr?'Yakin mau approve item ini?':'Yakin mau batalin approve item ini?');
      if(!ok)return;
      ab.disabled=true;
      try{
        const r=await fetch('/api/items/'+id+'/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({approve:appr})}).then(x=>x.json());
        if(r.error){toast.error(r.error);ab.disabled=false;return;}
        toast.success(appr?'Disetujui':'Approval dibatalkan');
        await changed();
      }catch(err){toast.error('Gagal');ab.disabled=false;}
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
      $('#iMsg').textContent='';$('#iRes').innerHTML='';$('#iFile').value='';setFile();$('#dImp').showModal();
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
  const setFile=()=>{const f=$('#iFile').files[0];$('#iName').textContent=f?f.name:'.csv atau .xlsx'};
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

  // shortcut "/" fokus ke kotak cari
  document.addEventListener('keydown',e=>{
    if(e.key==='/'&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)&&!document.querySelector('dialog[open]')){
      const q=$('#q');if(q){e.preventDefault();q.focus();q.select()}
    }
  });
}
async function boot(){chrome();await loadAuth();await loadMeta()}