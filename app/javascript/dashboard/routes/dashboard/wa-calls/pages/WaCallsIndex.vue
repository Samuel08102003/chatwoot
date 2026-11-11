<script setup>
import { ref, onMounted, onUnmounted } from 'vue';

const WS_URL = 'wss://lomarosa-calling-production.up.railway.app';

const status = ref('idle'); // idle | ringing | pre_accepting | accepting | in_call | ended
const callInfo = ref(null);
const duration = ref(0);
const errorMsg = ref('');
const statusLabel = ref('');

let ws = null;
let pc = null;
let audioEl = null;
let durationTimer = null;
let reconnectTimer = null;

function connectWs() {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    statusLabel.value = 'Conectado al servidor';
    errorMsg.value = '';
  };

  ws.onclose = () => {
    statusLabel.value = 'Reconectando...';
    reconnectTimer = setTimeout(connectWs, 3000);
  };

  ws.onerror = () => {
    errorMsg.value = 'Error de conexión con servidor de llamadas';
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'incoming_call') handleIncoming(msg);
      else if (msg.type === 'call_terminated') handleTerminated(msg);
    } catch (e) {
      console.error('[wa-calls] ws parse error', e);
    }
  };
}

function handleIncoming(msg) {
  status.value = 'ringing';
  callInfo.value = {
    callId: msg.callId,
    phoneNumberId: msg.phoneNumberId,
    from: msg.from,
    sdp: msg.sdp,
  };
  statusLabel.value = `Llamada entrante de ${msg.from}`;
}

function handleTerminated(msg) {
  status.value = 'ended';
  statusLabel.value = msg.status === 'missed'
    ? 'Llamada perdida'
    : `Llamada finalizada (${formatDuration(msg.duration || 0)})`;
  stopDurationTimer();
  cleanupPc();
  setTimeout(() => {
    status.value = 'idle';
    callInfo.value = null;
    statusLabel.value = '';
  }, 4000);
}

async function answerCall() {
  if (!callInfo.value) return;
  status.value = 'pre_accepting';
  statusLabel.value = 'Conectando audio...';
  errorMsg.value = '';

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

    pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    stream.getTracks().forEach(t => pc.addTrack(t, stream));

    pc.ontrack = (event) => {
      if (!audioEl) {
        audioEl = new Audio();
        audioEl.autoplay = true;
      }
      audioEl.srcObject = event.streams[0];
    };

    await pc.setRemoteDescription({ type: 'offer', sdp: callInfo.value.sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    // Wait for ICE gathering to complete
    await new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') { resolve(); return; }
      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === 'complete') resolve();
      };
      setTimeout(resolve, 5000); // fallback
    });

    sendWs({
      type: 'call_response',
      action: 'pre_accept',
      callId: callInfo.value.callId,
      phoneNumberId: callInfo.value.phoneNumberId,
      sdp: pc.localDescription.sdp,
    });

    status.value = 'accepting';
    statusLabel.value = 'Esperando conexión...';

    // Wait for connected state then send accept
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout')), 30000);
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
          clearTimeout(timeout);
          resolve();
        } else if (pc.connectionState === 'failed') {
          clearTimeout(timeout);
          reject(new Error('WebRTC connection failed'));
        }
      };
    });

    sendWs({
      type: 'call_response',
      action: 'accept',
      callId: callInfo.value.callId,
      phoneNumberId: callInfo.value.phoneNumberId,
    });

    status.value = 'in_call';
    statusLabel.value = 'En llamada';
    startDurationTimer();

  } catch (e) {
    errorMsg.value = e.message;
    status.value = 'ringing';
    statusLabel.value = 'Error al conectar';
    cleanupPc();
  }
}

function rejectCall() {
  if (!callInfo.value) return;
  sendWs({
    type: 'call_response',
    action: 'terminate',
    callId: callInfo.value.callId,
    phoneNumberId: callInfo.value.phoneNumberId,
  });
  status.value = 'idle';
  callInfo.value = null;
  statusLabel.value = '';
  cleanupPc();
}

function hangUp() {
  if (!callInfo.value) return;
  sendWs({
    type: 'call_response',
    action: 'terminate',
    callId: callInfo.value.callId,
    phoneNumberId: callInfo.value.phoneNumberId,
  });
  status.value = 'ended';
  statusLabel.value = 'Llamada finalizada';
  stopDurationTimer();
  cleanupPc();
  setTimeout(() => {
    status.value = 'idle';
    callInfo.value = null;
    statusLabel.value = '';
  }, 2000);
}

function sendWs(payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function cleanupPc() {
  if (pc) { pc.close(); pc = null; }
  if (audioEl) { audioEl.srcObject = null; audioEl = null; }
}

function startDurationTimer() {
  duration.value = 0;
  durationTimer = setInterval(() => { duration.value++; }, 1000);
}

function stopDurationTimer() {
  if (durationTimer) { clearInterval(durationTimer); durationTimer = null; }
}

function formatDuration(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

onMounted(() => {
  connectWs();
});

onUnmounted(() => {
  if (ws) ws.close();
  if (reconnectTimer) clearTimeout(reconnectTimer);
  stopDurationTimer();
  cleanupPc();
});
</script>

<template>
  <div class="flex flex-col items-center justify-center w-full h-full bg-n-surface-1 gap-6">

    <!-- Idle -->
    <div v-if="status === 'idle'" class="flex flex-col items-center gap-4 text-n-slate-11">
      <span class="i-lucide-phone text-5xl text-n-slate-9" />
      <p class="text-lg font-medium text-n-slate-12">Llamadas WhatsApp</p>
      <p class="text-sm">{{ statusLabel || 'Esperando llamadas entrantes...' }}</p>
      <p v-if="errorMsg" class="text-sm text-red-500">{{ errorMsg }}</p>
    </div>

    <!-- Ringing -->
    <div v-else-if="status === 'ringing'" class="flex flex-col items-center gap-6">
      <div class="w-24 h-24 rounded-full bg-n-brand flex items-center justify-center animate-pulse">
        <span class="i-lucide-phone-incoming text-4xl text-white" />
      </div>
      <div class="text-center">
        <p class="text-xl font-semibold text-n-slate-12">{{ callInfo?.from }}</p>
        <p class="text-sm text-n-slate-11 mt-1">Llamada de WhatsApp entrante</p>
      </div>
      <div class="flex gap-4">
        <button
          class="flex flex-col items-center gap-2"
          @click="rejectCall"
        >
          <span class="w-14 h-14 rounded-full bg-red-500 flex items-center justify-center hover:bg-red-600 cursor-pointer">
            <span class="i-lucide-phone-off text-2xl text-white" />
          </span>
          <span class="text-sm text-n-slate-11">Rechazar</span>
        </button>
        <button
          class="flex flex-col items-center gap-2"
          @click="answerCall"
        >
          <span class="w-14 h-14 rounded-full bg-green-500 flex items-center justify-center hover:bg-green-600 cursor-pointer">
            <span class="i-lucide-phone text-2xl text-white" />
          </span>
          <span class="text-sm text-n-slate-11">Contestar</span>
        </button>
      </div>
      <p v-if="errorMsg" class="text-sm text-red-500">{{ errorMsg }}</p>
    </div>

    <!-- Connecting states -->
    <div v-else-if="status === 'pre_accepting' || status === 'accepting'" class="flex flex-col items-center gap-4">
      <div class="w-24 h-24 rounded-full bg-yellow-500 flex items-center justify-center">
        <span class="i-lucide-loader-2 text-4xl text-white animate-spin" />
      </div>
      <p class="text-lg font-medium text-n-slate-12">{{ statusLabel }}</p>
    </div>

    <!-- In call -->
    <div v-else-if="status === 'in_call'" class="flex flex-col items-center gap-6">
      <div class="w-24 h-24 rounded-full bg-green-500 flex items-center justify-center">
        <span class="i-lucide-phone text-4xl text-white" />
      </div>
      <div class="text-center">
        <p class="text-xl font-semibold text-n-slate-12">{{ callInfo?.from }}</p>
        <p class="text-sm text-n-slate-11 mt-1 font-mono">{{ formatDuration(duration) }}</p>
      </div>
      <button @click="hangUp">
        <span class="w-14 h-14 rounded-full bg-red-500 flex items-center justify-center hover:bg-red-600 cursor-pointer">
          <span class="i-lucide-phone-off text-2xl text-white" />
        </span>
      </button>
    </div>

    <!-- Ended -->
    <div v-else-if="status === 'ended'" class="flex flex-col items-center gap-4">
      <span class="i-lucide-phone-missed text-5xl text-n-slate-9" />
      <p class="text-lg font-medium text-n-slate-12">{{ statusLabel }}</p>
    </div>

  </div>
</template>
