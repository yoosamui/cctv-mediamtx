/* CCTV live playback: bounded recovery, frame-based status, per-camera controls,
 * and optional substreams. MediaMTX and recording settings are not modified. */
'use strict';
(() => {
  const server = location.hostname;
  const players = [];
  const quality = document.getElementById('stream-quality');
  const diagnostics = document.getElementById('show-diagnostics');
  let leaving = false;

  class CameraPlayer {
    constructor(video, name, delay) {
      this.video = video;
      this.name = name;
      this.card = video.closest('.camera');
      this.badge = this.card.querySelector('.camera-live');
      this.detail = this.card.querySelector('.playback-detail');
      this.reconnects = 0;
      this.failures = 0;
      this.generation = 0;
      this.lastFrameAt = 0;
      this.lastTime = -1;
      this.statsText = 'Waiting for video';
      this.initialTimer = setTimeout(() => this.start(), delay);
      this.monitor = setInterval(() => this.tick(), 1000);
      this.card.querySelector('.reconnect').addEventListener('click', () => this.restart());
      this.card.querySelector('.enlarge').addEventListener('click', () => this.enlarge());
      video.addEventListener('error', () => {
        if (this.active && !this.hls) this.scheduleRetry('Playback error');
      });
      video.addEventListener('playing', () => { this.needsPlay = false; this.userPaused = false; });
      video.addEventListener('pause', () => {
        if (this.active && this.lastFrameAt) { this.userPaused = true; this.setStatus('Paused', 'waiting'); }
      });
      if (video.requestVideoFrameCallback) {
        const frame = () => {
          if (this.active) this.lastFrameAt = performance.now();
          if (!leaving) this.frameCallback = video.requestVideoFrameCallback(frame);
        };
        this.frameCallback = video.requestVideoFrameCallback(frame);
      }
    }
    setStatus(text, state) {
      this.badge.textContent = text;
      this.badge.dataset.state = state;
    }
    cleanup() {
      clearTimeout(this.initialTimer);
      clearTimeout(this.retryTimer);
      clearTimeout(this.handshakeTimer);
      this.retryTimer = null;
      this.active = false;
      this.generation++;
      if (this.abort) this.abort.abort();
      if (this.peer) {
        this.peer.ontrack = null;
        this.peer.onconnectionstatechange = null;
        this.peer.close();
        this.peer = null;
      }
      if (this.sessionUrl) {
        fetch(this.sessionUrl, { method: 'DELETE', keepalive: true }).catch(() => {});
        this.sessionUrl = null;
      }
      if (this.hls) { this.hls.destroy(); this.hls = null; }
      this.video.pause();
      this.video.srcObject = null;
      this.video.removeAttribute('src');
      this.video.load();
      this.previousStats = null;
    }
    restart() {
      this.failures = 0;
      this.reconnects++;
      this.start();
    }
    scheduleRetry(reason) {
      if (this.retryTimer || leaving) return;
      this.cleanup();
      this.failures++;
      const wait = Math.min(30, 2 ** Math.min(this.failures, 5));
      this.setStatus(this.failures >= 3 ? 'Offline — retrying' : 'Reconnecting', 'waiting');
      this.detail.textContent = `${reason}. Retry in ${wait}s · reconnects ${this.reconnects}`;
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.reconnects++;
        this.start(this.failures >= 2);
      }, wait * 1000);
    }
    async play() {
      const generation = this.generation;
      try { await this.video.play(); }
      catch (error) {
        if (!this.active || this.generation !== generation) return;
        if (error.name === 'NotAllowedError') {
          this.needsPlay = true;
          this.setStatus('Press play', 'waiting');
        } else if (error.name !== 'AbortError') {
          this.scheduleRetry('Playback could not start');
        }
      }
    }
    async start(forceHls = false) {
      if (leaving) return;
      this.cleanup();
      const generation = this.generation;
      this.active = true;
      this.startedAt = performance.now();
      this.lastFrameAt = 0;
      this.lastTime = -1;
      this.needsPlay = false;
      this.userPaused = false;
      this.highBufferSamples = 0;
      this.statsText = 'Waiting for video';
      this.setStatus(this.reconnects ? 'Reconnecting' : 'Connecting', 'waiting');
      const stream = this.name + (quality.value === 'light' && !this.expanded ? '_sub' : '');
      const hlsUrl = `http://${server}:8888/${stream}/index.m3u8`;
      const abort = new AbortController();
      this.abort = abort;
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      if (!ios && !forceHls && window.RTCPeerConnection) {
        this.mode = 'WebRTC';
        const peer = new RTCPeerConnection({ iceServers: [] });
        this.peer = peer;
        peer.addTransceiver('video', { direction: 'recvonly' });
        peer.ontrack = event => {
          if (this.generation !== generation) return;
          this.video.srcObject = event.streams[0] || new MediaStream([event.track]);
          this.play();
        };
        peer.onconnectionstatechange = () => {
          if (this.generation !== generation) return;
          if (peer.connectionState === 'failed') this.scheduleRetry('Connection failed');
          else if (peer.connectionState === 'disconnected') this.setStatus('Buffering', 'waiting');
        };
        let handshakeTimer;
        try {
          await peer.setLocalDescription(await peer.createOffer());
          // This LAN deployment uses server ICE candidates. Send the offer then
          // monitor the actual peer and frames; SDP acceptance is not "Live".
          if (this.generation !== generation) return;
          handshakeTimer = setTimeout(() => abort.abort(), 10000);
          this.handshakeTimer = handshakeTimer;
          const endpoint = `http://${server}:8889/${stream}/whep`;
          const response = await fetch(endpoint, {
            method: 'POST', headers: { 'Content-Type': 'application/sdp' },
            body: peer.localDescription.sdp, signal: abort.signal
          });
          if (!response.ok) throw new Error(`Connection request failed (${response.status})`);
          const resource = response.headers.get('Location');
          if (resource && this.generation === generation) this.sessionUrl = new URL(resource, endpoint).href;
          const answer = await response.text();
          if (this.generation !== generation) return;
          await peer.setRemoteDescription({ type: 'answer', sdp: answer });
          clearTimeout(handshakeTimer);
          return;
        } catch (error) {
          clearTimeout(handshakeTimer);
          if (this.generation !== generation || leaving) return;
          peer.onconnectionstatechange = null;
          peer.ontrack = null;
          peer.close();
          this.peer = null;
          if (this.sessionUrl) {
            fetch(this.sessionUrl, { method: 'DELETE', keepalive: true }).catch(() => {});
            this.sessionUrl = null;
          }
          this.video.srcObject = null;
        }
      }
      if (this.generation !== generation) return;
      this.mode = 'HLS';
      this.startedAt = performance.now();
      if (ios || (!(window.Hls && Hls.isSupported()) && this.video.canPlayType('application/vnd.apple.mpegurl'))) {
        this.video.src = hlsUrl;
        this.play();
      } else if (window.Hls && Hls.isSupported()) {
        const hls = new Hls({
          lowLatencyMode: false, liveSyncDurationCount: 2,
          liveMaxLatencyDurationCount: 5, maxBufferLength: 10,
          backBufferLength: 10, enableWorker: true
        });
        this.hls = hls;
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (this.generation === generation) this.play();
        });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (this.generation === generation && data.fatal) this.scheduleRetry('Video stream unavailable');
        });
        hls.loadSource(hlsUrl);
        hls.attachMedia(this.video);
      } else {
        this.scheduleRetry('Video format unavailable');
      }
    }
    async readStats() {
      if (!this.peer || this.statsPending) return;
      const peer = this.peer;
      this.statsPending = true;
      try {
        const report = await peer.getStats();
        if (peer !== this.peer) return;
        for (const stat of report.values()) {
          if (stat.type !== 'inbound-rtp' || (stat.kind || stat.mediaType) !== 'video') continue;
          const old = this.previousStats;
          const dt = old ? (stat.timestamp - old.timestamp) / 1000 : 0;
          const fps = dt > 0 ? Math.max(0, ((stat.framesDecoded || 0) - (old.framesDecoded || 0)) / dt) : null;
          const emitted = old ? (stat.jitterBufferEmittedCount || 0) - (old.jitterBufferEmittedCount || 0) : 0;
          const jitter = emitted > 0 ? ((stat.jitterBufferDelay || 0) - (old.jitterBufferDelay || 0)) / emitted * 1000 : null;
          this.statsText = `${fps === null ? '—' : fps.toFixed(1)} fps · ${stat.framesDropped || 0} dropped · ${stat.packetsLost || 0} packets lost` +
            (jitter === null ? '' : ` · receive buffer ${Math.round(jitter)} ms`);
          this.previousStats = stat;
          this.highBufferSamples = jitter !== null && jitter > 1500 ? this.highBufferSamples + 1 : 0;
          if (this.highBufferSamples >= 5 && !this.video.paused && !document.hidden) {
            this.scheduleRetry('Receive buffer remained over 1.5 seconds');
          }
        }
      } catch (_) { /* The peer can close while a stats request is in flight. */ }
      finally { this.statsPending = false; }
    }
    tick() {
      if (!this.active || leaving) return;
      const now = performance.now();
      if (document.hidden) { this.startedAt = now; this.lastFrameAt = 0; return; }
      if (!this.video.requestVideoFrameCallback && this.video.currentTime !== this.lastTime && this.video.readyState >= 2) {
        this.lastTime = this.video.currentTime;
        this.lastFrameAt = now;
      }
      if (this.needsPlay || this.userPaused || (this.video.paused && this.lastFrameAt)) return;
      const elapsed = now - (this.lastFrameAt || this.startedAt);
      if (this.lastFrameAt && elapsed < 3000) {
        this.setStatus('Live', 'live');
        // A healthy minute resets retry escalation, not every single frame.
        if (now - this.startedAt > 60000) this.failures = 0;
      } else if (elapsed > 3000) this.setStatus('Buffering', 'waiting');
      // HLS cold start can span several camera keyframe intervals.
      if (elapsed > (this.lastFrameAt ? 12000 : this.mode === 'HLS' ? 30000 : 15000)) {
        this.scheduleRetry('No new video frames'); return;
      }
      if (this.mode === 'WebRTC') this.readStats();
      else {
        const end = this.video.seekable.length ? this.video.seekable.end(this.video.seekable.length - 1) : null;
        const behind = end === null ? null : Math.max(0, end - this.video.currentTime);
        this.statsText = behind === null ? 'Waiting for video' : `${behind.toFixed(1)}s behind available video`;
        if (!this.hls && behind !== null && behind > 12 && !this.video.paused) this.video.currentTime = Math.max(0, end - 3);
      }
      this.detail.textContent = `${this.mode} · ${this.statsText} · reconnects ${this.reconnects}`;
    }
    enlarge() {
      this.expanded = !this.expanded;
      this.card.classList.toggle('expanded', this.expanded);
      this.card.querySelector('.enlarge').textContent = this.expanded ? 'Reduce' : 'Enlarge';
      if (quality.value === 'light') this.restart();
    }
    dispose() {
      clearInterval(this.monitor);
      if (this.frameCallback && this.video.cancelVideoFrameCallback) this.video.cancelVideoFrameCallback(this.frameCallback);
      this.cleanup();
    }
  }

  document.querySelectorAll('video[data-camera]').forEach((video, index) => {
    players.push(new CameraPlayer(video, video.dataset.camera, index * 750));
  });
  quality.addEventListener('change', () => players.forEach(player => player.restart()));
  diagnostics.addEventListener('change', () => {
    document.body.classList.toggle('show-diagnostics', diagnostics.checked);
  });
  document.getElementById('reconnect-all').addEventListener('click', () => players.forEach(player => player.restart()));
  document.querySelector('.dashboard-link').href = `http://${server}:8881/`;
  window.addEventListener('pagehide', () => { leaving = true; players.forEach(player => player.dispose()); });
  window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
})();
