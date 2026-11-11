import { frontendURL } from '../../../helper/URLHelper';
import WaCallsIndex from './pages/WaCallsIndex.vue';

export const routes = [
  {
    path: frontendURL('accounts/:accountId/wa-calls'),
    name: 'wa_calls_index',
    component: WaCallsIndex,
    meta: {
      permissions: ['administrator', 'agent', 'custom_role'],
    },
  },
];
