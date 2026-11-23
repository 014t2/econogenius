import { useEffect, useState } from 'react'
import { BookOpen, ChevronDown, ChevronUp, HelpCircle, Lightbulb } from 'lucide-react'

export interface TutorialStep {
  title: string
  description: string
  badge?: string
}

export interface PageTutorialProps {
  pageId: 'dashboard' | 'transactions' | 'import' | 'settings'
  title: string
  subtitle: string
  steps: TutorialStep[]
  tip?: string
}

export function PageTutorialBanner({ pageId, title, subtitle, steps, tip }: PageTutorialProps) {
  const storageKey = `fc_tutorial_open_${pageId}`
  const [open, setOpen] = useState<boolean>(() => {
    const saved = localStorage.getItem(storageKey)
    return saved === null ? true : saved === '1'
  })

  useEffect(() => {
    localStorage.setItem(storageKey, open ? '1' : '0')
  }, [open, storageKey])

  return (
    <div className="card border-blue-200 bg-gradient-to-r from-blue-50/70 via-white to-indigo-50/50 overflow-hidden transition-all">
      {/* Cabecera siempre visible */}
      <div
        onClick={() => setOpen((v) => !v)}
        className="px-4 py-3 sm:px-5 flex items-center justify-between gap-3 cursor-pointer select-none hover:bg-blue-50/40 transition"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 rounded-xl bg-primary-accent text-white flex items-center justify-center shrink-0 shadow-sm">
            <BookOpen className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs sm:text-sm font-bold text-ink">{title}</span>
              <span className="chip bg-blue-100 text-primary-accent border border-blue-200 font-semibold">
                <HelpCircle className="h-3 w-3" />
                <span>Guía de uso</span>
              </span>
            </div>
            <p className="text-xs text-slate-600 truncate">{subtitle}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setOpen((v) => !v)
          }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-white border border-blue-200 text-primary-accent hover:bg-blue-50 shrink-0 shadow-sm"
        >
          <span>{open ? 'Ocultar tutorial' : 'Ver cómo funciona'}</span>
          {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* Contenido desplegable paso a paso */}
      {open && (
        <div className="px-4 pb-4 pt-2 sm:px-5 border-t border-blue-100 space-y-3 animate-fade-up">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {steps.map((s, idx) => (
              <div
                key={idx}
                className="p-3.5 rounded-2xl bg-white border border-blue-100 shadow-sm flex flex-col justify-between gap-2"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center justify-center h-6 w-6 rounded-lg bg-blue-50 text-primary-accent font-extrabold text-xs">
                      {idx + 1}
                    </span>
                    {s.badge && (
                      <span className="chip bg-slate-100 text-slate-700 font-semibold text-[10px]">
                        {s.badge}
                      </span>
                    )}
                  </div>
                  <h3 className="text-xs font-bold text-ink leading-snug">{s.title}</h3>
                  <p className="text-[11px] text-slate-600 leading-relaxed">{s.description}</p>
                </div>
              </div>
            ))}
          </div>

          {tip && (
            <div className="rounded-xl bg-amber-50/80 border border-amber-200 px-3.5 py-2 text-xs text-amber-900 flex items-start sm:items-center gap-2">
              <Lightbulb className="h-4 w-4 text-amber-600 shrink-0 mt-0.5 sm:mt-0" />
              <div>
                <strong>Consejo rápido:</strong> {tip}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
