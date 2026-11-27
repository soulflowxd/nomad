import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  vite: () => ({ plugins: [tailwindcss()] }),
  hooks: {
    // The Canvas content script is registered at runtime per school. Don't let WXT turn its
    // placeholder match into a required host permission.
    'build:manifestGenerated': (_wxt, manifest) => {
      delete manifest.host_permissions;
    },
  },
  manifest: {
    name: 'Nomad',
    // Public key only: pins the extension ID (nnmhdppapchhdgfiohekgpmmhoodcojd) so the OAuth
    // redirect URI is the same on every computer. The private key stays in .keys/ (gitignored).
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAoPZeBPcQlKjZ3JQRq87KCu/S/vNaXUOnQGlGVfTFqaclZFod8BZGqZwPk32UNUrG2/wOL6VqxtQFr6MjP+x7tZYL3D3rurdrlbCjuZAS6PxIz+RtmCmS0bYiSgQblisTpGWG/LSiPJvKn305xABUueu6TVhu9Xit4y4RYyI2eroyxu6Z/B5Rrnxta2tg0eZQ/VO6cXew0wbTi5D6gvZltnKN2tlqV4lxWYnutxl9Di4qVvxzCGpXDk9hlrymslda5R1yalltKdU9ZzjASxAwKe5ThkrfDi8m2wEMGntscJCqESIqXIO8tEWksGFpEFTr95iwaaCfL1qDPH7D8WOLAQIDAQAB',
    description: 'Automatically sync Canvas, D2L, Blackboard, Moodle, Schoology and Sakai to Google Calendar.',
    // Camel icon. Source: assets/icon.svg, rendered with `bun run icons`.
    icons: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
    action: { default_icon: { 16: 'icon/16.png', 32: 'icon/32.png' } },
    permissions: ['storage', 'alarms', 'identity', 'activeTab', 'scripting'],
    // Feed hosts are requested one school at a time, at runtime, when a feed is added.
    optional_host_permissions: ['https://*/*'],
  },
});
