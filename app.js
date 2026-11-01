'use strict';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const store={
  get(k,d){try{const v=localStorage.getItem('cc.'+k);return v===null?d:JSON.parse(v)}catch(e){return d}},
  set(k,v){try{localStorage.setItem('cc.'+k,JSON.stringify(v))}catch(e){}}
};
const S={facing:'environment',res:store.get('res',1080),fps:store.get('fps',24),mbps:store.get('mbps',20),
  tools:store.get('tools',{}),guide:store.get('guide',2.39),lut:store.get('lut','none')};
const LUTS={none:'none',cine:'contrast(1.12) saturate(.82) sepia(.12) hue-rotate(-6deg)',mono:'grayscale(1) contrast(1.15)',
  warm:'sepia(.28) saturate(1.15)',cool:'saturate(.9) hue-rotate(12deg) brightness(.98)'};
let stream=null,track=null,caps={},cur=null,manual={},rec=null,chunks=[],t0=0,timer=0,torch=false,fpsNow=S.fps,mime='',sliding=false,liveOn=false;
const v=$('#v');

// ---------- controls definition ----------
const shut=x=>{const s=x/1e4;return '1/'+Math.round(1/s)+' · '+Math.round(s*fpsNow*360)+'°'};
const DEF={
  iso:{label:'ISO',mode:['exposureMode','manual','continuous'],log:true,fmt:x=>Math.round(x)},
  exposureTime:{label:'Shutter',mode:['exposureMode','manual','continuous'],log:true,fmt:shut},
  focusDistance:{label:'Focus',mode:['focusMode','manual','continuous'],fmt:x=>x.toFixed(2)+' m'},
  colorTemperature:{label:'WB',mode:['whiteBalanceMode','manual','continuous'],fmt:x=>(Math.round(x/10)*10)+'K'},
  exposureCompensation:{label:'EV',fmt:x=>(x>0?'+':'')+x.toFixed(1)},
  zoom:{label:'Zoom',fmt:x=>x.toFixed(1)+'×'}
};
const toVal=(k,p)=>{const c=caps[k];return DEF[k].log&&c.min>0?c.min*Math.pow(c.max/c.min,p/1000):c.min+(c.max-c.min)*p/1000};
const toPos=(k,x)=>{const c=caps[k];if(c.max===c.min)return 0;const r=DEF[k].log&&c.min>0?Math.log(x/c.min)/Math.log(c.max/c.min):(x-c.min)/(c.max-c.min);return Math.round(Math.min(1,Math.max(0,r))*1000)};

let tt=0;
function toast(msg,node,ms){
  const t=$('#toast');t.textContent=msg;if(node){t.append(' ',node)}t.style.display='block';
  clearTimeout(tt);tt=setTimeout(()=>t.style.display='none',ms||2800);
}
let busy=false,nextAdv=null;
async function push(adv){
  if(!track)return;
  if(busy){nextAdv=adv;return}
  busy=true;
  try{await track.applyConstraints({advanced:[adv]})}catch(e){toast('Not supported on this camera')}
  busy=false;
  if(nextAdv){const n=nextAdv;nextAdv=null;push(n)}
}

// ---------- camera ----------
function pickMime(){
  const l=['video/mp4;codecs=avc1.640033,mp4a.40.2','video/mp4','video/webm;codecs=vp9,opus','video/webm;codecs=h264,opus','video/webm'];
  return window.MediaRecorder?l.find(t=>MediaRecorder.isTypeSupported(t))||'':'';
}
async function start(){
  if(stream)stream.getTracks().forEach(t=>t.stop());
  const H=+S.res,vc={facingMode:{ideal:S.facing},width:{ideal:Math.round(H*16/9)},height:{ideal:H},frameRate:{ideal:+S.fps}};
  const au={echoCancellation:false,noiseSuppression:false,autoGainControl:false};
  try{
    try{stream=await navigator.mediaDevices.getUserMedia({video:vc,audio:au})}
    catch(e){stream=await navigator.mediaDevices.getUserMedia({video:vc,audio:false})}
  }catch(e){$('#h-fmt').textContent='No camera';toast('Camera blocked. Allow camera access and reload.',null,8000);return}
  v.srcObject=stream;track=stream.getVideoTracks()[0];manual={};
  try{caps=track.getCapabilities?track.getCapabilities():{}}catch(e){caps={}}
  const st=track.getSettings();fpsNow=Math.round(st.frameRate||S.fps);
  mime=pickMime();
  const codec=!mime?'No rec':mime.includes('mp4')?'H.264':mime.includes('vp9')?'VP9':'WebM';
  $('#h-fmt').textContent=`${st.width||'?'}×${st.height||'?'} · ${fpsNow}p · ${codec}`;
  buildTiles();fit();
  if(liveOn)Live.replace(stream);
}
function buildTiles(){
  const box=$('#tiles');box.replaceChildren();cur=null;
  Object.keys(DEF).forEach(k=>{
    const c=caps[k];if(!c||c.max===undefined)return;
    const b=document.createElement('button');b.className='tile';b.dataset.k=k;
    b.innerHTML='<small></small><b></b>';b.children[0].textContent=DEF[k].label;b.onclick=()=>pick(k);box.append(b);
  });
  $('#torch').hidden=!caps.torch;
  if(!box.children.length){toast('No manual controls in this browser. Chrome on Android has them.',null,6000);pick(null)}
  else pick(box.children[0].dataset.k);
}
function pick(k){
  cur=k;$$('.tile').forEach(b=>b.classList.toggle('on',b.dataset.k===k));
  $('#sl').disabled=!k;$('#auto').hidden=!(k&&DEF[k].mode);$('#snap').hidden=k!=='exposureTime';
  refresh();
}
function refresh(){
  if(!track)return;const st=track.getSettings();
  $$('.tile').forEach(b=>{
    const k=b.dataset.k,d=DEF[k],x=st[k];let t=x!==undefined?d.fmt(x):'–';
    if(d.mode)t=x===undefined&&!manual[k]?'Auto':(manual[k]?'':'A ')+t;
    b.children[1].textContent=t;
  });
  if(cur&&!sliding){const x=st[cur];$('#sl').value=toPos(cur,x!==undefined?x:caps[cur].min)}
}
$('#sl').addEventListener('pointerdown',()=>sliding=true);
addEventListener('pointerup',()=>sliding=false);
$('#sl').oninput=e=>{
  if(!cur)return;const d=DEF[cur],c=caps[cur];let x=toVal(cur,+e.target.value);
  if(c.step)x=Math.round(x/c.step)*c.step;x=Math.min(c.max,Math.max(c.min,x));
  const adv={[cur]:x};if(d.mode){manual[cur]=true;adv[d.mode[0]]=d.mode[1]}
  push(adv);setTimeout(refresh,80);
};
$('#auto').onclick=()=>{if(!cur||!DEF[cur].mode)return;manual[cur]=false;push({[DEF[cur].mode[0]]:DEF[cur].mode[2]});setTimeout(refresh,150)};
$('#snap').onclick=()=>{
  const c=caps.exposureTime;if(!c)return;
  const x=Math.min(c.max,Math.max(c.min,1e4/(2*fpsNow)));
  manual.exposureTime=true;push({exposureTime:x,exposureMode:'manual'});setTimeout(refresh,120);
};
$('#torch').onclick=e=>{torch=!torch;e.currentTarget.classList.toggle('on',torch);push({torch})};
setInterval(refresh,500);

// ---------- layout, guides, looks ----------
function fit(){
  const r=$('#stage').getBoundingClientRect(),vw=v.videoWidth||16,vh=v.videoHeight||9,s=Math.min(r.width/vw,r.height/vh),f=$('#frame');
  f.style.width=vw*s+'px';f.style.height=vh*s+'px';setGuide();
}
function setGuide(){
  const g=+S.guide,i=$('#guide i'),fr=(v.videoWidth||16)/(v.videoHeight||9);
  document.body.classList.toggle('guided',g>0);if(!g)return;
  i.style.width=g>=fr?'100%':(g/fr*100)+'%';i.style.height=g>=fr?(fr/g*100)+'%':'100%';
}
v.addEventListener('loadedmetadata',fit);addEventListener('resize',fit);
if(screen.orientation)screen.orientation.addEventListener('change',()=>setTimeout(fit,200));
function look(){v.style.filter=LUTS[S.lut]||'none'}

// ---------- tools: zebra, peaking, histogram ----------
const sc=document.createElement('canvas');sc.width=192;sc.height=108;
const sx=sc.getContext('2d',{willReadFrequently:true}),fxc=$('#fx').getContext('2d'),hx=$('#hist').getContext('2d');
let n=0;
setInterval(()=>{
  const T=S.tools;
  if(!(T.zebra||T.peak||T.hist)||!v.videoWidth||document.body.classList.contains('clean')){fxc.clearRect(0,0,192,108);return}
  sx.drawImage(v,0,0,192,108);const d=sx.getImageData(0,0,192,108).data;
  const out=fxc.createImageData(192,108),o=out.data,L=new Uint8Array(192*108),h=new Uint32Array(64);
  for(let i=0,p=0;i<d.length;i+=4,p++){const y=.2126*d[i]+.7152*d[i+1]+.0722*d[i+2];L[p]=y;h[y>>2]++}
  n++;
  if(T.zebra||T.peak){
    for(let y=1;y<108;y++)for(let x=1;x<192;x++){
      const p=y*192+x,q=p*4;
      if(T.zebra&&L[p]>=240&&(((x+y+n)>>1)&1)){o[q]=255;o[q+1]=255;o[q+2]=255;o[q+3]=210}
      else if(T.peak&&Math.abs(L[p]-L[p-1])+Math.abs(L[p]-L[p-192])>42){o[q]=255;o[q+1]=40;o[q+2]=60;o[q+3]=235}
    }
  }
  fxc.putImageData(out,0,0);
  if(T.hist){
    hx.clearRect(0,0,128,56);const m=Math.max(1,...Array.from(h).slice(1,63));
    for(let i=0;i<64;i++){const hh=Math.min(54,h[i]/m*54);hx.fillStyle=(i>=62&&h[i]>60)||(i<=1&&h[i]>60)?'#ff3b30':'rgba(236,235,230,.85)';hx.fillRect(i*2,56-hh,2,hh)}
  }
},100);
$$('[data-tool]').forEach(b=>{
  const k=b.dataset.tool;
  if(k!=='clean'){b.classList.toggle('on',!!S.tools[k]);document.body.classList.toggle('t-'+k,!!S.tools[k])}
  b.onclick=()=>{
    if(k==='clean'){document.body.classList.add('clean');fxc.clearRect(0,0,192,108);return}
    S.tools[k]=!S.tools[k];store.set('tools',S.tools);
    b.classList.toggle('on',S.tools[k]);document.body.classList.toggle('t-'+k,S.tools[k]);
    if(!S.tools.zebra&&!S.tools.peak)fxc.clearRect(0,0,192,108);
  };
});
$('#stage').addEventListener('click',()=>document.body.classList.remove('clean'));

// ---------- level ----------
addEventListener('deviceorientation',e=>{
  if(!S.tools.level||e.gamma===null)return;
  const a=(screen.orientation&&screen.orientation.angle)||0;
  const roll=a===90?e.beta:a===270?-e.beta:e.gamma,l=$('#level');
  l.style.setProperty('--r',(-roll)+'deg');l.classList.toggle('ok',Math.abs(roll)<1);
});

// ---------- record ----------
const pad=x=>String(x).padStart(2,'0');
$('#rec').onclick=()=>{
  if(rec&&rec.state==='recording'){rec.stop();return}
  if(!stream)return;
  if(!mime){toast('Recording isn’t supported in this browser');return}
  chunks=[];
  try{rec=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:S.mbps*1e6,audioBitsPerSecond:256000})}
  catch(e){toast('Could not start recording');return}
  rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
  rec.onstop=()=>{
    clearInterval(timer);document.body.classList.remove('rec');$('#rec').classList.remove('on');
    ['res','fps'].forEach(i=>$('#'+i).disabled=false);$('#flip').disabled=false;
    const blob=new Blob(chunks,{type:mime}),a=document.createElement('a');
    a.href=URL.createObjectURL(blob);a.download=`cine-${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.${mime.includes('mp4')?'mp4':'webm'}`;
    a.textContent=`Save clip (${(blob.size/1048576).toFixed(0)} MB)`;toast('Recorded.',a,20000);
  };
  rec.start(1000);t0=Date.now();
  document.body.classList.add('rec');$('#rec').classList.add('on');
  ['res','fps'].forEach(i=>$('#'+i).disabled=true);$('#flip').disabled=true;
  timer=setInterval(()=>{const s=Math.floor((Date.now()-t0)/1000);$('#h-time').textContent=`${pad(s/3600|0)}:${pad(s/60%60|0)}:${pad(s%60)}`},250);
};

// ---------- live to OBS ----------
$('#live').onclick=()=>{
  const box=$('#livebox'),b=$('#live');
  if(liveOn){Live.stop();liveOn=false;b.classList.remove('on');box.hidden=true;return}
  if(!stream||typeof Peer==='undefined'){toast('Live needs an internet connection');return}
  liveOn=true;b.classList.add('on');box.hidden=false;
  const id=Live.start(stream,st=>{
    $('#lurl').value=st.url;store.set('liveId',st.url.split('id=')[1]);
    $('#lstat').textContent=st.state==='error'?'Error: '+st.msg:st.viewers?`${st.viewers} viewer connected`:'Ready. Waiting for OBS…';
  },store.get('liveId',null));
};
$('#lcopy').onclick=async()=>{try{await navigator.clipboard.writeText($('#lurl').value);toast('Link copied')}catch(e){$('#lurl').select()}};

// ---------- settings and misc ----------
$('#flip').onclick=()=>{S.facing=S.facing==='environment'?'user':'environment';start()};
[['res',+S.res],['fps',+S.fps],['mbps',+S.mbps]].forEach(([k,val])=>{
  const el=$('#'+k);el.value=val;el.onchange=()=>{S[k]=+el.value;store.set(k,S[k]);if(k!=='mbps')start()};
});
$('#guide-sel').value=String(S.guide);$('#guide-sel').onchange=e=>{S.guide=+e.target.value;store.set('guide',S.guide);setGuide()};
$('#lut').value=S.lut;$('#lut').onchange=e=>{S.lut=e.target.value;store.set('lut',S.lut);look()};
function sys(){
  const parts=[];
  const done=()=>{$('#h-sys').textContent=parts.join(' · ')};
  if(navigator.getBattery)navigator.getBattery().then(b=>{parts[0]=Math.round(b.level*100)+'%';done()}).catch(()=>{});
  if(navigator.storage&&navigator.storage.estimate)navigator.storage.estimate().then(e=>{parts[1]=((e.quota-e.usage)/1073741824).toFixed(0)+' GB';done()}).catch(()=>{});
}
sys();setInterval(sys,30000);
if('serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('sw.js').catch(()=>{});
look();start();
