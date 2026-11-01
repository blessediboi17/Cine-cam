'use strict';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const store={
  get(k,d){try{const v=localStorage.getItem('cc.'+k);return v===null?d:JSON.parse(v)}catch(e){return d}},
  set(k,v){try{localStorage.setItem('cc.'+k,JSON.stringify(v))}catch(e){}}
};
const S={facing:'environment',res:store.get('res',1080),fps:store.get('fps',24),mbps:store.get('mbps',20),
  tools:store.get('tools',{}),guide:store.get('guide',2.39),lut:store.get('lut','none'),
  mic:store.get('mic',''),prspd:store.get('prspd',60),prsz:store.get('prsz',40),prmir:store.get('prmir',false),script:store.get('script','')};
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
async function getStream(vc){
  const base={echoCancellation:false,noiseSuppression:false,autoGainControl:false},tries=[];
  if(S.mic)tries.push({video:vc,audio:Object.assign({deviceId:{exact:S.mic}},base)});
  tries.push({video:vc,audio:base},{video:vc,audio:false});
  let err;for(const c of tries){try{return await navigator.mediaDevices.getUserMedia(c)}catch(e){err=e}}
  throw err;
}
async function start(){
  if(stream)stream.getTracks().forEach(t=>t.stop());
  const H=+S.res,vc={facingMode:{ideal:S.facing},width:{ideal:Math.round(H*16/9)},height:{ideal:H},frameRate:{ideal:+S.fps}};
  try{stream=await getStream(vc)
  }catch(e){$('#h-fmt').textContent='No camera';toast('Camera blocked. Allow camera access and reload.',null,8000);return}
  v.srcObject=stream;track=stream.getVideoTracks()[0];manual={};
  try{caps=track.getCapabilities?track.getCapabilities():{}}catch(e){caps={}}
  const st=track.getSettings();fpsNow=Math.round(st.frameRate||S.fps);
  mime=pickMime();
  const codec=!mime?'No rec':mime.includes('mp4')?'H.264':mime.includes('vp9')?'VP9':'WebM';
  $('#h-fmt').textContent=`${st.width||'?'}×${st.height||'?'} · ${fpsNow}p · ${codec}`;
  buildTiles();fit();setupMeter();fillMics();
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
function tileText(k,st){
  const d=DEF[k],x=st[k];let t=x!==undefined?d.fmt(x):'–';
  if(d.mode)t=x===undefined&&!manual[k]?'Auto':(manual[k]?'':'A ')+t;
  return t;
}
function refresh(){
  if(!track)return;const st=track.getSettings();
  $$('.tile').forEach(b=>{b.children[1].textContent=tileText(b.dataset.k,st)});
  if(cur&&!sliding){const x=st[cur];$('#sl').value=toPos(cur,x!==undefined?x:caps[cur].min)}
}
$('#sl').addEventListener('pointerdown',()=>sliding=true);
addEventListener('pointerup',()=>sliding=false);
function setPos(k,p){
  const d=DEF[k],c=caps[k];if(!c||!d||!isFinite(p))return;
  let x=toVal(k,Math.min(1000,Math.max(0,p)));
  if(c.step)x=Math.round(x/c.step)*c.step;x=Math.min(c.max,Math.max(c.min,x));
  const adv={[k]:x};if(d.mode){manual[k]=true;adv[d.mode[0]]=d.mode[1]}
  push(adv);setTimeout(refresh,80);
}
function setAuto(k){const d=DEF[k];if(!d||!d.mode||!caps[k])return;manual[k]=false;push({[d.mode[0]]:d.mode[2]});setTimeout(refresh,150)}
function snap180(){
  const c=caps.exposureTime;if(!c)return;
  const x=Math.min(c.max,Math.max(c.min,1e4/(2*fpsNow)));
  manual.exposureTime=true;push({exposureTime:x,exposureMode:'manual'});setTimeout(refresh,120);
}
function toggleTorch(){if(!caps.torch)return;torch=!torch;$('#torch').classList.toggle('on',torch);push({torch})}
$('#sl').oninput=e=>{if(cur)setPos(cur,+e.target.value)};
$('#auto').onclick=()=>{if(cur)setAuto(cur)};
$('#snap').onclick=snap180;
$('#torch').onclick=toggleTorch;
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
function toggleRec(){
  if(rec&&rec.state==='recording'){rec.stop();return}
  if(!stream)return;
  if(!mime){toast('Recording isn’t supported in this browser');return}
  chunks=[];
  try{rec=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:S.mbps*1e6,audioBitsPerSecond:256000})}
  catch(e){toast('Could not start recording');return}
  rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
  rec.onstop=()=>{
    clearInterval(timer);document.body.classList.remove('rec');$('#rec').classList.remove('on');
    ['res','fps','mic'].forEach(i=>$('#'+i).disabled=false);$('#flip').disabled=false;
    const blob=new Blob(chunks,{type:mime}),a=document.createElement('a');
    a.href=URL.createObjectURL(blob);a.download=`cine-${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.${mime.includes('mp4')?'mp4':'webm'}`;
    a.textContent=`Save clip (${(blob.size/1048576).toFixed(0)} MB)`;toast('Recorded.',a,20000);
  };
  rec.start(1000);t0=Date.now();
  document.body.classList.add('rec');$('#rec').classList.add('on');
  ['res','fps','mic'].forEach(i=>$('#'+i).disabled=true);$('#flip').disabled=true;
  timer=setInterval(()=>{const s=Math.floor((Date.now()-t0)/1000);$('#h-time').textContent=`${pad(s/3600|0)}:${pad(s/60%60|0)}:${pad(s%60)}`},250);
}
$('#rec').onclick=toggleRec;

// ---------- live to OBS ----------
let pin=store.get('livePin',null);
if(!pin){pin=String(1000+Math.floor(Math.random()*9000));store.set('livePin',pin)}
$('#live').onclick=()=>{
  const box=$('#livebox'),b=$('#live');
  if(liveOn){Live.stop();liveOn=false;b.classList.remove('on');box.hidden=true;return}
  if(!stream||typeof Peer==='undefined'){toast('Live needs an internet connection');return}
  liveOn=true;b.classList.add('on');box.hidden=false;
  Live.start(stream,st=>{
    $('#lurl').value=st.url;
    $('#lremote').value=st.url?st.url.replace('viewer.html','remote.html')+'&pin='+pin:'';
    if(st.url)store.set('liveId',st.url.split('id=')[1]);
    const r=st.remotes?` · remote on`:'';
    $('#lstat').textContent=st.state==='error'?'Error: '+st.msg:(st.viewers?`${st.viewers} viewer connected`:'Ready. Waiting for OBS…')+r;
  },store.get('liveId',null),pin);
};
const copy=async id=>{try{await navigator.clipboard.writeText($(id).value);toast('Link copied')}catch(e){$(id).select()}};
$('#lcopy').onclick=()=>copy('#lurl');$('#lcopy2').onclick=()=>copy('#lremote');

// remote control from the PC (remote.html)
Live.onCmd=m=>{
  if(!m||typeof m!=='object')return;
  if(m.t==='pos'&&DEF[m.k])setPos(m.k,+m.p);
  else if(m.t==='auto')setAuto(m.k);
  else if(m.t==='snap')snap180();
  else if(m.t==='rec')toggleRec();
  else if(m.t==='torch')toggleTorch();
};
setInterval(()=>{
  if(!liveOn||!Live.remotes()||!track)return;
  const st=track.getSettings(),keys=Object.keys(DEF).filter(k=>caps[k]&&caps[k].max!==undefined);
  const o={t:'state',keys,lab:{},mode:{},txt:{},pos:{},rec:!!(rec&&rec.state==='recording'),time:$('#h-time').textContent,fmt:$('#h-fmt').textContent,torchAvail:!!caps.torch,torch};
  keys.forEach(k=>{o.lab[k]=DEF[k].label;o.mode[k]=!!DEF[k].mode;o.txt[k]=tileText(k,st);const x=st[k];o.pos[k]=toPos(k,x!==undefined?x:caps[k].min)});
  Live.send(o);
},500);

// ---------- audio meter and mic select ----------
let actx=null,asrc=null,an=null,abuf=null,pkDb=-90,pkT=0;
function setupMeter(){
  const a=stream&&stream.getAudioTracks()[0];
  $('#meter').hidden=!a;$('#mdb').hidden=!a;an=null;if(!a)return;
  try{
    if(!actx)actx=new (window.AudioContext||window.webkitAudioContext)();
    if(asrc)asrc.disconnect();
    asrc=actx.createMediaStreamSource(new MediaStream([a]));an=actx.createAnalyser();an.fftSize=1024;
    abuf=new Float32Array(an.fftSize);asrc.connect(an);
  }catch(e){an=null}
}
addEventListener('pointerdown',()=>{if(actx&&actx.state==='suspended')actx.resume()});
const lvl=db=>Math.min(100,Math.max(0,(db+60)/60*100));
function meterLoop(){
  requestAnimationFrame(meterLoop);
  if(!an||document.hidden||document.body.classList.contains('clean'))return;
  an.getFloatTimeDomainData(abuf);
  let m=0,sum=0;for(let i=0;i<abuf.length;i++){const x=Math.abs(abuf[i]);if(x>m)m=x;sum+=x*x}
  const rms=20*Math.log10(Math.sqrt(sum/abuf.length)+1e-9),pk=20*Math.log10(m+1e-9),now=performance.now();
  if(pk>pkDb||now-pkT>1200){pkDb=pk;pkT=now}
  $('#mcov').style.height=(100-lvl(rms))+'%';$('#mpk').style.top=(100-lvl(pkDb))+'%';
  const t=$('#mdb');t.textContent=pkDb<-80?'-∞':Math.round(pkDb)+' dB';t.classList.toggle('clip',pkDb>-1.5);
}
meterLoop();
async function fillMics(){
  try{
    const ds=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='audioinput'&&d.deviceId!=='default'&&d.deviceId!=='communications');
    const el=$('#mic');el.replaceChildren(new Option('Mic: Default',''));
    ds.forEach((d,i)=>el.append(new Option('Mic: '+(d.label||'Input '+(i+1)),d.deviceId)));
    el.value=S.mic;if(el.value!==S.mic)el.value='';
  }catch(e){}
}
$('#mic').onchange=e=>{S.mic=e.target.value;store.set('mic',S.mic);start()};
if(navigator.mediaDevices&&navigator.mediaDevices.addEventListener)navigator.mediaDevices.addEventListener('devicechange',fillMics);

// ---------- teleprompter ----------
const pr={y:0,run:false,paused:false,last:0},prEl=$('#pr'),ptx=$('#prtext'),pv=$('#prview');
$('#prsrc').value=S.script;$('#prspd').value=S.prspd;$('#prsz').value=S.prsz;$('#prmir').classList.toggle('on',S.prmir);
const prDraw=()=>{ptx.style.fontSize=S.prsz+'px';ptx.style.transform=`translateY(${pr.y}px) scaleX(${S.prmir?-1:1})`};
function prTick(t){
  if(!pr.run)return;requestAnimationFrame(prTick);
  const dt=Math.min(.1,(t-pr.last)/1000);pr.last=t;
  if(!pr.paused){
    pr.y-=S.prspd*dt;
    if(pr.y<-ptx.offsetHeight){pr.paused=true;$('#prgo').textContent='Restart'}
  }
  prDraw();
}
function prStart(){
  S.script=$('#prsrc').value;store.set('script',S.script);
  if(!S.script.trim()){toast('Paste your script first');return}
  ptx.textContent=S.script;prEl.classList.add('run');$('#predit').hidden=false;
  pr.y=pv.clientHeight*.55;pr.paused=false;pr.run=true;pr.last=performance.now();$('#prgo').textContent='Pause';
  prDraw();requestAnimationFrame(prTick);
}
function prStop(){pr.run=false;prEl.classList.remove('run');$('#predit').hidden=true;$('#prgo').textContent='Start'}
$('#prbtn').onclick=()=>{prEl.hidden=!prEl.hidden;$('#prbtn').classList.toggle('on',!prEl.hidden);if(prEl.hidden)prStop()};
$('#prx').onclick=()=>{prEl.hidden=true;$('#prbtn').classList.remove('on');prStop()};
$('#predit').onclick=prStop;
$('#prgo').onclick=()=>{
  if(!pr.run){prStart();return}
  if($('#prgo').textContent==='Restart'){pr.y=pv.clientHeight*.55;pr.paused=false;$('#prgo').textContent='Pause';return}
  pr.paused=!pr.paused;$('#prgo').textContent=pr.paused?'Resume':'Pause';
};
pv.onclick=()=>{if(pr.run&&$('#prgo').textContent!=='Restart')$('#prgo').click()};
$('#prmir').onclick=e=>{S.prmir=!S.prmir;store.set('prmir',S.prmir);e.currentTarget.classList.toggle('on',S.prmir);prDraw()};
$('#prspd').oninput=e=>{S.prspd=+e.target.value;store.set('prspd',S.prspd)};
$('#prsz').oninput=e=>{S.prsz=+e.target.value;store.set('prsz',S.prsz);prDraw()};
$('#prsrc').oninput=e=>{S.script=e.target.value;store.set('script',S.script)};
prEl.addEventListener('click',e=>e.stopPropagation());

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
