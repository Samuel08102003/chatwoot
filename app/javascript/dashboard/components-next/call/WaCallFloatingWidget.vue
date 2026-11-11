<script setup>
import { computed } from 'vue';
import { useWaCallsStore } from 'dashboard/stores/waCalls';

const store = useWaCallsStore();

const show = computed(() => store.status !== 'idle');

function formatDuration(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
</script>

<template>
  <!-- Backdrop + centered card — appears on top of everything -->
  <Teleport to="body">
    <div
      v-if="show"
      class="fixed inset-0 z-[9999] flex items-center justify-center"
      style="background: rgba(0,0,0,0.55);"
    >
      <div class="bg-white dark:bg-n-solid-1 rounded-2xl shadow-2xl p-8 flex flex-col items-center gap-6 min-w-[320px]">

        <!-- Ringing -->
        <template v-if="store.status === 'ringing'">
          <div class="w-20 h-20 rounded-full bg-green-500 flex items-center justify-center animate-pulse">
            <span class="i-lucide-phone-incoming text-4xl text-white" />
          </div>
          <div class="text-center">
            <p class="text-xs text-n-slate-11 uppercase tracking-widest mb-1">Llamada de WhatsApp</p>
            <p class="text-2xl font-bold text-n-slate-12">{{ store.callInfo?.from }}</p>
          </div>
          <p v-if="store.error" class="text-sm text-red-500">{{ store.error }}</p>
          <div class="flex gap-8">
            <button class="flex flex-col items-center gap-2" @click="store.reject()">
              <span class="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center cursor-pointer transition-colors">
                <span class="i-lucide-phone-off text-2xl text-white" />
              </span>
              <span class="text-sm text-n-slate-11">Rechazar</span>
            </button>
            <button class="flex flex-col items-center gap-2" @click="store.answer()">
              <span class="w-16 h-16 rounded-full bg-green-500 hover:bg-green-600 flex items-center justify-center cursor-pointer transition-colors">
                <span class="i-lucide-phone text-2xl text-white" />
              </span>
              <span class="text-sm text-n-slate-11">Contestar</span>
            </button>
          </div>
        </template>

        <!-- Connecting -->
        <template v-else-if="store.status === 'pre_accepting' || store.status === 'accepting'">
          <div class="w-20 h-20 rounded-full bg-yellow-400 flex items-center justify-center">
            <span class="i-lucide-loader-2 text-4xl text-white animate-spin" />
          </div>
          <p class="text-lg font-semibold text-n-slate-12">Conectando audio...</p>
        </template>

        <!-- In call -->
        <template v-else-if="store.status === 'in_call'">
          <div class="w-20 h-20 rounded-full bg-green-500 flex items-center justify-center">
            <span class="i-lucide-phone text-4xl text-white" />
          </div>
          <div class="text-center">
            <p class="text-2xl font-bold text-n-slate-12">{{ store.callInfo?.from }}</p>
            <p class="text-sm font-mono text-n-slate-11 mt-1">{{ formatDuration(store.duration) }}</p>
          </div>
          <button class="flex flex-col items-center gap-2" @click="store.hangUp()">
            <span class="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center cursor-pointer transition-colors">
              <span class="i-lucide-phone-off text-2xl text-white" />
            </span>
            <span class="text-sm text-n-slate-11">Colgar</span>
          </button>
        </template>

        <!-- Ended -->
        <template v-else-if="store.status === 'ended'">
          <span class="i-lucide-phone-missed text-5xl text-n-slate-9" />
          <p class="text-lg font-semibold text-n-slate-12">Llamada finalizada</p>
        </template>

      </div>
    </div>
  </Teleport>
</template>
