import { defineStore } from 'pinia';
import { ref } from 'vue';

const WS_URL = 'wss://lomarosa-calling-production.up.railway.app';
const UPLOAD_URL = 'https://lomarosa-calling-production.up.railway.app/upload-recording';

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
  let mediaRecorder = null;
  let recordingChunks = [];
  let localStream = null;
  let remoteStream = null;
  let audioCtx = null;
  let audioDest = null;
  let hiddenRemoteAudio = null;
  let localSrcNode = null;
  let remoteSrcNode = null;

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
    _stopRecordingAndUpload();
    status.value = 'ended';
    _stopTimer();
    _cleanupPc();
    setTimeout(() => { status.value = 'idle'; callInfo.value = null; }, 4000);
  }

  // ── Recording ────────────────────────────────────────────────────────────────
  function _startRecording() {
    if (mediaRecorder) return; // already recording
    if (!localStream && !remoteStream) return;

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
      ? 'audio/ogg;codecs=opus'
      : 'audio/webm';

    // Chrome Bug #40094084: remote WebRTC streams are silent in Web Audio API
    // unless a hidden muted <audio> element is actively pulling the stream
    if (remoteStream) {
      hiddenRemoteAudio = new Audio();
      hiddenRemoteAudio.muted = true;
      hiddenRemoteAudio.srcObject = remoteStream;
      hiddenRemoteAudio.play().catch(() => {});
    }

    audioCtx = new AudioContext();
    audioDest = audioCtx.createMediaStreamDestination();
    if (localStream) { localSrcNode = audioCtx.createMediaStreamSource(localStream); localSrcNode.connect(audioDest); }
    if (remoteStream) { remoteSrcNode = audioCtx.createMediaStreamSource(remoteStream); remoteSrcNode.connect(audioDest); }

    recordingChunks = [];
    mediaRecorder = new MediaRecorder(audioDest.stream, { mimeType });
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordingChunks.push(e.data);
    };
    mediaRecorder.start(1000);
  }

  function _stopRecordingAndUpload() {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
    const from = callInfo.value?.from ?? '';
    const mimeType = mediaRecorder.mimeType;

    mediaRecorder.onstop = () => {
      const blob = new Blob(recordingChunks, { type: mimeType });
      recordingChunks = [];
      mediaRecorder = null;
      if (blob.size < 2000 || !from) return; // too short or no caller info
      _uploadRecording(blob, from, mimeType);
    };
    mediaRecorder.stop();
  }

  function _uploadRecording(blob, from, mimeType) {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result.split(',')[1];
      fetch(UPLOAD_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recording: base64, from, mimeType }),
      }).catch(e => console.error('[waCalls] upload error', e));
    };
    reader.readAsDataURL(blob);
  }

  // ── Actions ──────────────────────────────────────────────────────────────────
  async function answer() {
    if (!callInfo.value) return;
    status.value = 'pre_accepting';
    error.value = '';
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

      pc.ontrack = (e) => {
        remoteStream = e.streams[0];
        if (!audioEl) { audioEl = new Audio(); audioEl.autoplay = true; }
        audioEl.srcObject = remoteStream;
        // Start recording as soon as remote audio arrives
        _startRecording();
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
      // Fallback: start recording with at least local audio if ontrack hasn't fired yet
      setTimeout(() => _startRecording(), 1500);
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
    _stopRecordingAndUpload();
    status.value = 'ended';
    _stopTimer();
    _cleanupPc();
    setTimeout(() => { status.value = 'idle'; callInfo.value = null; }, 2000);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function _cleanupPc() {
    if (pc) { pc.close(); pc = null; }
    if (audioEl) { audioEl.srcObject = null; audioEl = null; }
    if (hiddenRemoteAudio) { hiddenRemoteAudio.srcObject = null; hiddenRemoteAudio = null; }
    if (audioCtx) { audioCtx.close(); audioCtx = null; audioDest = null; }
    localSrcNode = null;
    remoteSrcNode = null;
    localStream = null;
    remoteStream = null;
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
