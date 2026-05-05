/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        shake: 'shake 0.5s ease-in-out',
      },
      keyframes: {
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '15%':      { transform: 'translateX(-6px)' },
          '30%':      { transform: 'translateX(6px)' },
          '45%':      { transform: 'translateX(-4px)' },
          '60%':      { transform: 'translateX(4px)' },
          '75%':      { transform: 'translateX(-2px)' },
          '90%':      { transform: 'translateX(2px)' },
        },
      },
      colors: {
        brand: {
          50:  '#f0f7ff',
          100: '#e0effe',
          200: '#bae0fd',
          300: '#7dc8fb',
          400: '#38aaf6',
          500: '#0e90e3',
          600: '#0272c2',
          700: '#035b9d',
          800: '#074d82',
          900: '#0c416c',
        },
      },
    },
  },
  plugins: [],
}

