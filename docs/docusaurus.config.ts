import type { Config } from '@docusaurus/types'
import type * as Preset from '@docusaurus/preset-classic'

const config: Config = {
  title: 'barista',
  tagline: 'Talk to your Claude Code sessions from Telegram',
  favicon: 'img/icon.svg',
  url: 'https://barista.local',
  baseUrl: '/',
  onBrokenLinks: 'throw',
  markdown: { mermaid: true },
  themes: ['@docusaurus/theme-mermaid'],
  presets: [
    [
      'classic',
      {
        docs: { routeBasePath: '/', sidebarPath: './sidebars.ts' },
        blog: false,
        theme: { customCss: './src/css/custom.css' },
      } satisfies Preset.Options,
    ],
  ],
  themeConfig: {
    colorMode: { respectPrefersColorScheme: true },
    navbar: { title: 'barista', logo: { alt: 'barista', src: 'img/icon.svg' } },
    footer: { style: 'dark', copyright: 'barista · MIT' },
  } satisfies Preset.ThemeConfig,
}

export default config
