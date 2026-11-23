import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'

export type CurrencyCode = 'EUR' | 'USD' | 'GBP'

interface CurrencyMeta {
  code: CurrencyCode
  symbol: string
  label: string
  locale: string
}

export const CURRENCIES: Record<CurrencyCode, CurrencyMeta> = {
  EUR: { code: 'EUR', symbol: '€', label: 'EUR (€)', locale: 'es-ES' },
  USD: { code: 'USD', symbol: '$', label: 'USD ($)', locale: 'en-US' },
  GBP: { code: 'GBP', symbol: '£', label: 'GBP (£)', locale: 'en-GB' },
}

const DEFAULT_RATES: Record<CurrencyCode, number> = {
  EUR: 1,
  USD: 1.08,
  GBP: 0.85,
}

interface CurrencyContextValue {
  currency: CurrencyCode
  setCurrency: (c: CurrencyCode) => void
  rates: Record<CurrencyCode, number>
  setCustomRate: (code: CurrencyCode, rate: number) => void
  rateSource: 'live' | 'fallback' | 'custom'
  privacyMode: boolean
  togglePrivacyMode: () => void
  convert: (amountEur: number) => number
  format: (amountEur: number, opts?: { signed?: boolean; compact?: boolean }) => string
}

const CurrencyContext = createContext<CurrencyContextValue | null>(null)

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  const [currency, setCurrency] = useState<CurrencyCode>(() => {
    const saved = localStorage.getItem('fc_currency')
    return saved === 'USD' || saved === 'GBP' ? saved : 'EUR'
  })
  const [privacyMode, setPrivacyMode] = useState<boolean>(() => {
    return localStorage.getItem('fc_privacy_mode') === '1'
  })
  const [rates, setRates] = useState<Record<CurrencyCode, number>>(() => {
    try {
      const saved = localStorage.getItem('fc_rates')
      if (saved) return { ...DEFAULT_RATES, ...JSON.parse(saved), EUR: 1 }
    } catch {
      /* ignore */
    }
    return DEFAULT_RATES
  })
  const [rateSource, setRateSource] = useState<'live' | 'fallback' | 'custom'>('fallback')

  useEffect(() => {
    localStorage.setItem('fc_currency', currency)
  }, [currency])

  useEffect(() => {
    localStorage.setItem('fc_privacy_mode', privacyMode ? '1' : '0')
  }, [privacyMode])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        setPrivacyMode((prev) => !prev)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const togglePrivacyMode = () => setPrivacyMode((prev) => !prev)

  useEffect(() => {
    let cancelled = false
    fetch('https://api.frankfurter.app/latest?from=EUR&to=USD,GBP')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.rates) return
        setRates((prev) => {
          const next: Record<CurrencyCode, number> = {
            EUR: 1,
            USD: typeof data.rates.USD === 'number' ? data.rates.USD : prev.USD,
            GBP: typeof data.rates.GBP === 'number' ? data.rates.GBP : prev.GBP,
          }
          localStorage.setItem('fc_rates', JSON.stringify(next))
          return next
        })
        setRateSource('live')
      })
      .catch(() => {
        /* sin red o bloqueado: usa tasas configuradas */
      })
    return () => {
      cancelled = true
    }
  }, [])

  const setCustomRate = (code: CurrencyCode, rate: number) => {
    if (code === 'EUR' || !Number.isFinite(rate) || rate <= 0) return
    setRates((prev) => {
      const next = { ...prev, [code]: rate, EUR: 1 }
      localStorage.setItem('fc_rates', JSON.stringify(next))
      return next
    })
    setRateSource('custom')
  }

  const value = useMemo<CurrencyContextValue>(() => {
    const rate = rates[currency] ?? 1
    const meta = CURRENCIES[currency]
    const nf = new Intl.NumberFormat('es-ES', {
      style: 'currency',
      currency: meta.code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
    const nfCompact = new Intl.NumberFormat('es-ES', {
      style: 'currency',
      currency: meta.code,
      notation: 'compact',
      maximumFractionDigits: 1,
    })

    const convert = (amountEur: number) => (Number.isFinite(amountEur) ? amountEur * rate : 0)

    const format = (amountEur: number, opts?: { signed?: boolean; compact?: boolean }) => {
      if (privacyMode) {
        return `••••,•• ${meta.symbol}`
      }
      const converted = convert(amountEur || 0)
      const str = opts?.compact ? nfCompact.format(converted) : nf.format(converted)
      if (opts?.signed && converted > 0) return `+${str}`
      return str
    }

    return {
      currency,
      setCurrency,
      rates,
      setCustomRate,
      rateSource,
      privacyMode,
      togglePrivacyMode,
      convert,
      format,
    }
  }, [currency, rates, rateSource, privacyMode])

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>
}

export function useCurrency() {
  const ctx = useContext(CurrencyContext)
  if (!ctx) throw new Error('useCurrency debe usarse dentro de CurrencyProvider')
  return ctx
}
