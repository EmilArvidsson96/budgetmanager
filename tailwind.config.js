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
        // Warm terracotta — main interactive/brand colour
        brand: {
          50:  '#FDF6F1',
          100: '#F9E8DA',
          200: '#F2C9AD',
          300: '#E8A478',
          400: '#DA7E48',
          500: '#C96332',
          600: '#AD5028',
          700: '#8A3E1E',
          800: '#652E15',
          900: '#411D0C',
        },
        // Warm cream neutrals for backgrounds / sidebar
        warm: {
          50:  '#FDFAF6',
          100: '#FAF6EF',
          200: '#F3EBE0',
          300: '#EAE0D2',
          400: '#DDD1C1',
          500: '#C9BAA6',
          600: '#A89383',
          700: '#836D5E',
          800: '#5C4B3F',
          900: '#352B24',
        },
      },
    },
  },
  plugins: [],
}

