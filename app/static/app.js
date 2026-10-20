const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));

const norm=s=>String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const jget=async u=>(await fetch(u)).json();
const fmt=n=>Number(n||0).toLocaleString('id-ID');
const csvq=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
let COMPS=[],STATS={items:0,pns:0,companies:0},LASTDUP=[];


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

function cell(list,q){
  if(!list||!list.length)return '<span class="mu">–</span>';
  const qn=norm(q);
  return list.map(p=>{
    const hit=qn&&norm(p.pn).includes(qn)?' hit':'';
    return p.seq===0
      ?`<button type="button" class="pn main${hit}" data-pn="${esc(p.pn)}" title="Klik untuk salin" aria-label="Salin PN ${esc(p.pn)}">${esc(p.pn)}</button>`
      :`<button type="button" class="pn rep${hit}" data-pn="${esc(p.pn)}" title="Pengganti ${p.seq} · klik untuk salin" aria-label="Salin PN pengganti ${esc(p.pn)}">↳ ${esc(p.pn)}</button>`;
  }).join('');
}
const headHtml=()=>'<tr><th>Barang</th>'+COMPS.map(c=>`<th>${esc(c)}</th>`).join('')+'</tr>';
function rowCells(i,q,no){
  const m={};i.pns.forEach(p=>(m[p.company]=m[p.company]||[]).push(p));
  const nm=i.name?esc(i.name):'<span class="mu">(tanpa nama)</span>';
  return `<td class="nm">${no?`<span class="no">${no}</span>`:''}${nm}</td>`+COMPS.map(c=>`<td>${cell(m[c],q)}</td>`).join('');
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
  $('#nav').innerHTML=`<a class="brand" href="/"><span class="logo">PN</span><span class="t">Compare PN</span></a>
    <nav><a href="/" class="${pg==='search'?'on':''}">Cari</a><a href="/list" class="${pg==='list'?'on':''}">Daftar</a></nav>
    <span class="sp"></span><span class="mu" id="stats"></span>
    <select id="thm" class="btn" style="padding:6px 10px">${themes.map(([v,l])=>`<option value="${v}" ${cur===v?'selected':''}>${l}</option>`).join('')}</select>
    <button class="btn" id="bImp">Import</button><button class="btn pri" id="bAdd">+ Tambah</button>`;
  setTimeout(()=>{$('#thm')&&($('#thm').onchange=e=>applyTheme(e.target.value));},0);
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

  // kepadatan tabel
  const dn=$('#dn');
  if(dn){
    const set=v=>{document.body.classList.toggle('compact',v);dn.textContent=v?'Nyaman':'Rapat';try{localStorage.setItem('cmpDense',v?'1':'0')}catch(e){}};
    let v=false;try{v=localStorage.getItem('cmpDense')==='1'}catch(e){}
    set(v);dn.onclick=()=>set(!document.body.classList.contains('compact'));
  }

  // --- tambah manual
  const addRow=(c,fixed)=>{
    const d=document.createElement('div');d.className='r';
    if(fixed){d.dataset.c=c;d.innerHTML=`<span class="cn" title="${esc(c)}">${esc(c)}</span><input class="p" placeholder="PN" autocomplete="off"><span></span>`}
    else d.innerHTML=`<input class="c" list="cl" placeholder="Nama company" autocomplete="off"><input class="p" placeholder="PN" autocomplete="off"><button class="x" title="Hapus baris">×</button>`;
    $('#aRows').appendChild(d);
  };
  const openAdd=()=>{
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
  $('#bAdd').onclick=openAdd;$('#aX').onclick=()=>$('#dAdd').close();
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
  $('#bImp').onclick=()=>{$('#iMsg').textContent='';$('#iRes').innerHTML='';$('#iFile').value='';setFile();$('#dImp').showModal()};
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
async function boot(){chrome();await loadMeta()}