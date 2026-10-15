import type { Config } from 'tailwindcss';
export default {
  content: ['./src/**/*.{ts,tsx}', './index.html'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: { extend: {} },
  plugins: []
} satisfies Config;
