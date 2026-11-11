import { defineStore } from 'pinia';
import { ref } from 'vue';

const WS_URL = 'wss://lomarosa-calling-production.up.railway.app';

export const useWaCallsStore = defineStore('waCalls', () => {
  const status = ref('idle'); // idle | ringing | pre_accepting | accepting | in_call | ended
  const callInfo = ref(null);
  const duration = ref(0);
  const error = ref('');

  let ws = null;
  let pc = null;
  let audioEl = null;
  let durationTimer = null;
  let reconnectTimer = null;

  // ── WebSocket ────────────────────────────────────────────────────────────────
  function connect() {
    ws = new WebSocket(WS_URL);
    ws.onopen = () => { error.value = ''; };
    ws.onclose = () => { reconnectTimer = setTimeout(connect, 3000); };
    ws.onerror = () => { error.value = 'Error de conexión'; };
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'incoming_call') _onIncoming(msg);
        else if (msg.type === 'call_terminated') _onTerminated(msg);
      } catch (e) { /* ignore parse errors */ }
    };
  }

  function disconnect() {
    if (ws) { ws.close(); ws = null; }
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    _stopTimer();
    _cleanupPc();
  }

  function _send(payload) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  }

  // ── Call events ──────────────────────────────────────────────────────────────
  function _onIncoming(msg) {
    status.value = 'ringing';
    callInfo.value = { callId: msg.callId, phoneNumberId: msg.phoneNumberId, from: msg.from, sdp: msg.sdp };
    error.value = '';
  }

  function _onTerminated(msg) {
    status.value = 'ended';
    _stopTimer();
    _cleanupPc();
    setTimeout(() => { status.value = 'idle'; callInfo.value = null; }, 4000);
  }

  // ── Actions ──────────────────────────────────────────────────────────────────
  async function answer() {
    if (!callInfo.value) return;
    status.value = 'pre_accepting';
    error.value = '';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      stream.getTracks().forEach(t => pc.addTrack(t, stream));

      pc.ontrack = (e) => {
        if (!audioEl) { audioEl = new Audio(); audioEl.autoplay = true; }
        audioEl.srcObject = e.streams[0];
      };

      await pc.setRemoteDescription({ type: 'offer', sdp: callInfo.value.sdp });
      const ans = await pc.createAnswer();
      await pc.setLocalDescription(ans);

      await new Promise((resolve) => {
        if (pc.iceGatheringState === 'complete') { resolve(); return; }
        pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === 'complete') resolve(); };
        setTimeout(resolve, 5000);
      });

      _send({ type: 'call_response', action: 'pre_accept', callId: callInfo.value.callId, phoneNumberId: callInfo.value.phoneNumberId, sdp: pc.localDescription.sdp });
      status.value = 'accepting';

      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('Timeout')), 30000);
        pc.onconnectionstatechange = () => {
          if (pc.connectionState === 'connected') { clearTimeout(t); resolve(); }
          else if (pc.connectionState === 'failed') { clearTimeout(t); reject(new Error('WebRTC falló')); }
        };
      });

      _send({ type: 'call_response', action: 'accept', callId: callInfo.value.callId, phoneNumberId: callInfo.value.phoneNumberId });
      status.value = 'in_call';
      _startTimer();
    } catch (e) {
      error.value = e.message;
      status.value = 'ringing';
      _cleanupPc();
    }
  }

  function reject() {
    if (!callInfo.value) return;
    _send({ type: 'call_response', action: 'terminate', callId: callInfo.value.callId, phoneNumberId: callInfo.value.phoneNumberId });
    status.value = 'idle';
    callInfo.value = null;
    _cleanupPc();
  }

  function hangUp() {
    if (!callInfo.value) return;
    _send({ type: 'call_response', action: 'terminate', callId: callInfo.value.callId, phoneNumberId: callInfo.value.phoneNumberId });
    status.value = 'ended';
    _stopTimer();
    _cleanupPc();
    setTimeout(() => { status.value = 'idle'; callInfo.value = null; }, 2000);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function _cleanupPc() {
    if (pc) { pc.close(); pc = null; }
    if (audioEl) { audioEl.srcObject = null; audioEl = null; }
  }

  function _startTimer() {
    duration.value = 0;
    durationTimer = setInterval(() => { duration.value++; }, 1000);
  }

  function _stopTimer() {
    if (durationTimer) { clearInterval(durationTimer); durationTimer = null; }
    duration.value = 0;
  }

  return { status, callInfo, duration, error, connect, disconnect, answer, reject, hangUp };
});
