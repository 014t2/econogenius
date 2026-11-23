/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
      colors: {
        surface: '#F8FAFC',
        card: '#FFFFFF',
        line: '#E2E8F0',
        ink: '#0F172A',
        primary: { DEFAULT: '#1E293B', accent: '#2563EB' },
        income: '#10B981',
        leisure: '#F59E0B',
        alert: '#EF4444',
      },
      boxShadow: {
        soft: '0 1px 2px rgba(15,23,42,0.04), 0 4px 16px rgba(15,23,42,0.04)',
        lift: '0 8px 30px rgba(15,23,42,0.08)',
      },
      keyframes: {
        'fade-up': { '0%': { opacity: 0, transform: 'translateY(6px)' }, '100%': { opacity: 1, transform: 'none' } },
      },
      animation: { 'fade-up': 'fade-up .35s ease-out both' },
    },
  },
  plugins: [],
}
