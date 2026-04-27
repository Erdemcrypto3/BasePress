import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        base: {
          50: '#eef4ff',
          100: '#dbe6ff',
          200: '#b8ccff',
          300: '#85a8ff',
          400: '#5683ff',
          500: '#0052FF',
          600: '#0040cc',
          700: '#003299',
          800: '#002370',
          900: '#001540',
        },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
