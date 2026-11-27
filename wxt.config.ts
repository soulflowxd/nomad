import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  vite: () => ({ plugins: [tailwindcss()] }),
  manifest: {
    name: 'Nomad',
    description: 'Automatically sync your Canvas and D2L calendars to Google Calendar.',
    permissions: ['storage', 'alarms', 'identity', 'activeTab', 'scripting'],
    // Feed hosts are requested one school at a time, at runtime, when a feed is added.
    optional_host_permissions: ['https://*/*'],
  },
});
