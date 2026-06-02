import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Palette driven by CSS design tokens (app/globals.css :root). Stored
        // as `rgb(var(--token) / <alpha-value>)` so Tailwind /opacity modifiers
        // (e.g. bg-mango-orange/10) still work. Default token values === the
        // original hex, so the live look is unchanged; .theme-luxury re-skins
        // by overriding the variables only.
        mango: {
          orange:  'rgb(var(--mg-orange) / <alpha-value>)',
          gold:    'rgb(var(--mg-gold) / <alpha-value>)',
          amber:   'rgb(var(--mg-amber) / <alpha-value>)',
          green:   'rgb(var(--mg-green) / <alpha-value>)',
          red:     'rgb(var(--mg-red) / <alpha-value>)',
          ink:     'rgb(var(--mg-ink) / <alpha-value>)',
          muted:   'rgb(var(--mg-muted) / <alpha-value>)',
          faint:   'rgb(var(--mg-faint) / <alpha-value>)',
          line:    'rgb(var(--mg-line) / <alpha-value>)',
          surface: 'rgb(var(--mg-surface) / <alpha-value>)',
          bg:      'rgb(var(--mg-bg) / <alpha-value>)',
          info:    'rgb(var(--mg-info) / <alpha-value>)',
        },
        heat: {
          1: 'rgb(var(--mg-heat-1) / <alpha-value>)',
          2: 'rgb(var(--mg-heat-2) / <alpha-value>)',
          3: 'rgb(var(--mg-heat-3) / <alpha-value>)',
          4: 'rgb(var(--mg-heat-4) / <alpha-value>)',
          5: 'rgb(var(--mg-heat-5) / <alpha-value>)',
        },
      },
      borderRadius: {
        card: '16px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(31,41,55,0.04), 0 1px 3px rgba(31,41,55,0.03), 0 0 0 1px rgba(31,41,55,0.045)',
        soft: '0 1px 2px rgba(31,41,55,0.05)',
      },
    },
  },
  plugins: [],
};
export default config;
