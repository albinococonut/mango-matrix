import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Mango palette derived from the live dashboard
        mango: {
          orange: '#ED7B26',
          green: '#19A268',
          red: '#E0524B',
          amber: '#E58E13',
          ink: '#0F1419',
          muted: '#5B6471',
          line: '#E6E8EC',
          surface: '#FFFFFF',
          bg: '#F4F5F7',
          info: '#3B82F6',
        },
      },
      borderRadius: {
        card: '14px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(15, 20, 25, 0.04), 0 0 0 1px rgba(15, 20, 25, 0.06)',
      },
    },
  },
  plugins: [],
};
export default config;
