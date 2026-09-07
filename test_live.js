const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(__dirname + '/live-player.js', 'utf8');

function setup({failPost = false, delayedOffer = false} = {}) {
  let now = 1000, id = 0; const offerResolvers = [];
  const timers = new Map(), intervals = new Map(), peers = [], requests = [], hlsInstances = [];
  function element() { return {textContent:'', dataset:{}, listeners:{}, classList:{toggle(){}}, addEventListener(n, f){ this.listeners[n] = f; }}; }
  const badge=element(), detail=element(), reconnect=element(), enlarge=element();
  const card = element();
  card.querySelector = s => ({'.camera-live':badge,'.playback-detail':detail,'.reconnect':reconnect,'.enlarge':enlarge}[s]);
  const video = Object.assign(element(), {dataset:{camera:'gate'}, currentTime:0, readyState:0, paused:true,
    closest:()=>card, requestVideoFrameCallback(fn){this.frame=fn;return 1;}, cancelVideoFrameCallback(){},
    removeAttribute(){}, load(){}, pause(){this.paused=true;this.listeners.pause?.();},
    play(){this.paused=false;this.listeners.playing?.();return Promise.resolve();},
    canPlayType(){return '';}, seekable:{length:0}});
  const quality=Object.assign(element(),{value:'full'}), diagnostics=Object.assign(element(),{checked:false}), all=element(), link=element();
  class Peer {
    constructor(){peers.push(this);this.connectionState='new';this.stats=[];}
    addTransceiver(){}
    createOffer(){return delayedOffer ? new Promise(r=>{offerResolvers.push(r);}) : Promise.resolve({type:'offer',sdp:'offer'});}
    setLocalDescription(offer){this.localDescription=offer;return Promise.resolve();}
    setRemoteDescription(){return Promise.resolve();}
    close(){this.closed=true;}
    getStats(){return Promise.resolve(new Map(this.stats.map((s,i)=>[i,s])));}
  }
  class Hls {
    static Events={MANIFEST_PARSED:'manifest',ERROR:'error'};
    static isSupported(){return true;}
    constructor(config){this.config=config;this.events={};hlsInstances.push(this);}
    on(n,fn){this.events[n]=fn;}
    loadSource(url){this.url=url;}
    attachMedia(video){this.video=video;}
    destroy(){this.destroyed=true;}
  }
  const context = {console,URL,AbortController,MediaStream:class{},RTCPeerConnection:Peer,Hls,
    location:{hostname:'192.168.1.19',reload(){}},navigator:{userAgent:'Chrome',platform:'Linux',maxTouchPoints:0},
    performance:{now:()=>now},
    setTimeout(fn,ms){const n=++id;timers.set(n,{fn,ms});return n;},clearTimeout(n){timers.delete(n);},
    setInterval(fn,ms){const n=++id;intervals.set(n,fn);return n;},clearInterval(n){intervals.delete(n);},
    fetch:async(url,options={})=>{requests.push({url,...options});return {ok:!failPost || options.method!=='POST',status:failPost?503:201,headers:{get:()=>null},text:async()=> 'answer'};},
    document:{hidden:false,body:element(),querySelectorAll:()=>[video],querySelector:()=>link,getElementById:n=>({'stream-quality':quality,'show-diagnostics':diagnostics,'reconnect-all':all}[n])},
    addEventListener(){}};
  context.window=context;
  vm.runInNewContext(source,context);
  const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
  async function runTimer(ms){const entry=[...timers].find(([,t])=>t.ms===ms);assert.ok(entry,'timer '+ms);timers.delete(entry[0]);entry[1].fn();await flush();}
  async function tick(ms){now+=ms;for(const fn of intervals.values())fn();await flush();}
  return {video,badge,detail,reconnect,enlarge,quality,peers,requests,hlsInstances,timers,runTimer,tick,flush,resolve:(index)=>offerResolvers[index]({sdp:'offer'})};
}
(async()=>{
  let env=setup();await env.runTimer(0);
  assert.equal(env.badge.textContent,'Connecting','SDP acceptance must not claim Live');
  env.peers[0].ontrack({streams:[{}]});await env.flush();env.video.frame();await env.tick(1000);
  assert.equal(env.badge.textContent,'Live','actual frames mark Live');
  await env.tick(13000);assert.equal(env.badge.textContent,'Reconnecting');assert.ok(env.peers[0].closed);
  await env.runTimer(2000);assert.equal(env.peers.length,2,'stall creates new peer');
  env.peers[1].connectionState='failed';env.peers[1].onconnectionstatechange();
  await env.runTimer(4000);assert.equal(env.hlsInstances.length,1,'repeated failures fall back to HLS');
  assert.equal(env.hlsInstances[0].config.liveMaxLatencyDurationCount,5);
  env.hlsInstances[0].events.error(null,{fatal:true});assert.equal(env.badge.textContent,'Offline — retrying');
  env.reconnect.listeners.click();await env.flush();assert.equal(env.peers.length,3);
  env.quality.value='light';env.quality.listeners.change();await env.flush();
  assert.ok(env.requests.some(r=>r.url.includes('/gate_sub/whep')),'lightweight uses substream');
  env.enlarge.listeners.click();await env.flush();assert.ok(env.requests.at(-1).url.endsWith('/gate/whep'),'enlarge uses main');

  env=setup({failPost:true});await env.runTimer(0);
  assert.equal(env.hlsInstances.length,1,'failed setup falls back immediately');
  assert.ok(env.peers[0].closed);

  env=setup({delayedOffer:true});await env.runTimer(0);
  
  env.reconnect.listeners.click();await env.flush();
  // Resolve the old offer after replacement: it must not POST or abort the new attempt.
  env.resolve(0);await env.flush();
  assert.equal(env.requests.filter(r=>r.method==='POST').length,0);
  env.resolve(1);await env.flush();
  assert.equal(env.requests.filter(r=>r.method==='POST').length,1);

  env=setup();await env.runTimer(0);env.peers[0].ontrack({streams:[{}]});await env.flush();env.video.frame();
  env.video.pause();await env.tick(40000);
  assert.equal(env.badge.textContent,'Paused','manual pause must not trigger reconnect');
  assert.equal(env.peers.length,1);

  env=setup();await env.runTimer(0);env.peers[0].ontrack({streams:[{}]});await env.flush();
  for(let i=0;i<6;i++){
    env.peers[0].stats=[{type:'inbound-rtp',kind:'video',timestamp:1000+i*1000,framesDecoded:25*i,jitterBufferEmittedCount:25*i,jitterBufferDelay:50*i}];
    env.video.frame();await env.tick(1000);
  }
  assert.equal(env.badge.textContent,'Reconnecting','persistent receive-buffer delay triggers recovery');
  console.log('PASS: frame status, stall recovery, fallback, manual reconnect, quality switch, pause, delayed buffer');
})().catch(error=>{console.error(error);process.exitCode=1;});
