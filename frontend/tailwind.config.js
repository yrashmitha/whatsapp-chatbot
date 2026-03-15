/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: { 50:'#f5f3ff', 100:'#ede9fe', 200:'#ddd6fe', 500:'#8b5cf6', 600:'#7c3aed', 700:'#6d28d9' },
        nova: {
          950: '#050810',
          900: '#080c14',
          800: '#0d1420',
          700: '#131b2e',
          600: '#1a2440',
          500: '#1e2d4a',
          400: '#2a3f6a',
          300: '#3d5a8a',
        },
        accent: {
          DEFAULT: '#6366f1',
          cyan: '#38bdf8',
          violet: '#8b5cf6',
        },
      },
      fontFamily: {
        sans: ['Space Grotesk', 'system-ui', 'sans-serif'],
      },
    }
  },
  plugins: [],
}

