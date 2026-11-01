'use strict';
// Sends the camera stream to a viewer page (OBS Browser Source) over WebRTC.
// Signaling goes through the free public PeerJS server; video flows peer-to-peer.
const Live=(()=>{
  let peer=null,calls=[],stream=null,id=null,cb=()=>{};
  const code=()=>{const c='abcdefghjkmnpqrstuvwxyz23456789';return Array.from({length:6},()=>c[Math.random()*c.length|0]).join('')};
  const url=()=>new URL('viewer.html?id='+id,location.href).href;
  const note=extra=>cb(Object.assign({viewers:calls.length,url:id?url():''},extra));
  function boost(c){
    const pc=c.peerConnection;if(!pc)return;
    pc.getSenders().forEach(s=>{
      if(s.track&&s.track.kind==='video'){
        const p=s.getParameters();if(!p.encodings||!p.encodings.length)p.encodings=[{}];
        p.encodings[0].maxBitrate=10e6;s.setParameters(p).catch(()=>{});
      }
    });
  }
  function callViewer(pid){
    const c=peer.call(pid,stream);calls.push(c);
    c.on('close',()=>{calls=calls.filter(x=>x!==c);note({state:'ready'})});
    c.on('error',()=>{});
    setTimeout(()=>boost(c),1500);note({state:'live'});
  }
  function start(s,onState,saved){
    stream=s;cb=onState;id=saved||('cc-'+code());
    peer=new Peer(id);
    peer.on('open',()=>note({state:'ready'}));
    peer.on('connection',c=>c.on('open',()=>callViewer(c.peer)));
    peer.on('disconnected',()=>{try{peer.reconnect()}catch(e){}});
    peer.on('error',e=>{
      if(e.type==='unavailable-id'){stop();start(s,onState,'cc-'+code());return}
      note({state:'error',msg:e.type});
    });
    return id;
  }
  function replace(s){
    stream=s;
    calls.forEach(c=>c.peerConnection&&c.peerConnection.getSenders().forEach(x=>{
      const k=x.track&&x.track.kind,t=s.getTracks().find(t=>t.kind===k);if(t)x.replaceTrack(t);
    }));
  }
  function stop(){calls.forEach(c=>c.close());calls=[];if(peer){peer.destroy();peer=null}}
  return{start,stop,replace};
})();
