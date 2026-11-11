<script setup>
import { useWaCallsStore } from 'dashboard/stores/waCalls';

const store = useWaCallsStore();

function formatDuration(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
</script>

<template>
  <div class="flex flex-col items-center justify-center w-full h-full bg-n-surface-1 gap-4">

    <!-- Idle -->
    <template v-if="store.status === 'idle'">
      <span class="i-lucide-phone text-5xl text-n-slate-9" />
      <p class="text-lg font-medium text-n-slate-12">Llamadas WhatsApp</p>
      <p class="text-sm text-n-slate-11">Esperando llamadas entrantes...</p>
      <p v-if="store.error" class="text-sm text-red-500">{{ store.error }}</p>
    </template>

    <!-- Ringing (widget flotante ya aparece, aquí solo info de respaldo) -->
    <template v-else-if="store.status === 'ringing'">
      <div class="w-20 h-20 rounded-full bg-green-500 flex items-center justify-center animate-pulse">
        <span class="i-lucide-phone-incoming text-4xl text-white" />
      </div>
      <p class="text-xl font-semibold text-n-slate-12">{{ store.callInfo?.from }}</p>
      <p class="text-sm text-n-slate-11">Llamada entrante — usa el panel flotante para contestar</p>
    </template>

    <!-- Connecting -->
    <template v-else-if="store.status === 'pre_accepting' || store.status === 'accepting'">
      <span class="i-lucide-loader-2 text-5xl text-yellow-400 animate-spin" />
      <p class="text-lg font-medium text-n-slate-12">Conectando audio...</p>
    </template>

    <!-- In call -->
    <template v-else-if="store.status === 'in_call'">
      <div class="w-20 h-20 rounded-full bg-green-500 flex items-center justify-center">
        <span class="i-lucide-phone text-4xl text-white" />
      </div>
      <p class="text-xl font-semibold text-n-slate-12">{{ store.callInfo?.from }}</p>
      <p class="text-sm font-mono text-n-slate-11">{{ formatDuration(store.duration) }}</p>
      <button @click="store.hangUp()">
        <span class="w-14 h-14 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center cursor-pointer transition-colors">
          <span class="i-lucide-phone-off text-2xl text-white" />
        </span>
      </button>
    </template>

    <!-- Ended -->
    <template v-else-if="store.status === 'ended'">
      <span class="i-lucide-phone-missed text-5xl text-n-slate-9" />
      <p class="text-lg font-medium text-n-slate-12">Llamada finalizada</p>
    </template>

  </div>
</template>
