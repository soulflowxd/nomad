import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  vite: () => ({ plugins: [tailwindcss()] }),
  manifest: {
    name: 'Nomad',
    // Public key only: pins the extension ID (nnmhdppapchhdgfiohekgpmmhoodcojd) so the OAuth
    // redirect URI is the same on every computer. The private key stays in .keys/ (gitignored).
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAoPZeBPcQlKjZ3JQRq87KCu/S/vNaXUOnQGlGVfTFqaclZFod8BZGqZwPk32UNUrG2/wOL6VqxtQFr6MjP+x7tZYL3D3rurdrlbCjuZAS6PxIz+RtmCmS0bYiSgQblisTpGWG/LSiPJvKn305xABUueu6TVhu9Xit4y4RYyI2eroyxu6Z/B5Rrnxta2tg0eZQ/VO6cXew0wbTi5D6gvZltnKN2tlqV4lxWYnutxl9Di4qVvxzCGpXDk9hlrymslda5R1yalltKdU9ZzjASxAwKe5ThkrfDi8m2wEMGntscJCqESIqXIO8tEWksGFpEFTr95iwaaCfL1qDPH7D8WOLAQIDAQAB',
    description: 'Automatically sync your Canvas and D2L calendars to Google Calendar.',
    permissions: ['storage', 'alarms', 'identity', 'activeTab', 'scripting'],
    // Feed hosts are requested one school at a time, at runtime, when a feed is added.
    optional_host_permissions: ['https://*/*'],
  },
});
