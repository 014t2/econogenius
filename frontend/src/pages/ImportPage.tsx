import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  CreditCard,
  FileSpreadsheet,
  FileText,
  FileUp,
  History,
  Plus,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  UploadCloud,
  Users,
  Wallet,
} from 'lucide-react'
import { Api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useCurrency } from '../context/CurrencyContext'
import { GROUP_META } from '../components/Layout'
import { AccountModal } from '../components/AccountModal'
import { PageTutorialBanner } from '../components/PageTutorialBanner'
import type { Category, ImportBatch, ImportPreview } from '../types'

interface RowDecision {
  include: boolean
  category_id: number | null
  is_internal_transfer: boolean
  is_owed_by_joint: boolean
}

const FORMAT_LABELS: Record<string, string> = {
  kutxabank_pdf_es: 'PDF Extracto Bancario (Español)',
  kutxabank_pdf_eu: 'PDF Extracto Bancario (Euskera)',
  kutxabank_xls_card: 'Excel Movimientos Tarjeta (.xls)',
  kutxabank_xlsx_card: 'Excel Movimientos Tarjeta (.xlsx)',
  kutxabank_xls_account: 'Excel Cuenta Bancaria (.xls)',
  kutxabank_xlsx_account: 'Excel Cuenta Bancaria (.xlsx)',
  kutxabank_csv_account: 'CSV Cuenta Bancaria',
  kutxabank_csv_card: 'CSV Tarjeta de Crédito',
}

export function ImportPage() {
  const { accounts, categories, workspace, reloadCatalog, seedFamilyAccounts } = useAuth()
  const { format } = useCurrency()
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [selectedAccountId, setSelectedAccountId] = useState<number | ''>('')
  const [accountModalOpen, setAccountModalOpen] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [decisions, setDecisions] = useState<Record<number, RowDecision>>({})
  const [batches, setBatches] = useState<ImportBatch[]>([])
  const [importResult, setImportResult] = useState<{
    imported: number
    duplicates_skipped: number
    transfers_linked: number
    account_balance: number
  } | null>(null)

  const groupedCategories = useMemo(() => {
    const map: Record<string, Category[]> = {}
    for (const c of categories) {
      map[c.group] = map[c.group] || []
      map[c.group].push(c)
    }
    return map
  }, [categories])

  const loadHistory = useCallback(async () => {
    if (!workspace) return
    try {
      setBatches(await Api.imports())
    } catch {
      /* ignore */
    }
  }, [workspace])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  useEffect(() => {
    if (accounts.length > 0 && selectedAccountId === '') {
      setSelectedAccountId(accounts[0].id)
    }
  }, [accounts, selectedAccountId])

  const handleFile = async (file: File) => {
    setError(null)
    setImportResult(null)
    if (!selectedAccountId) {
      setError('Debes seleccionar primero la Cuenta Destino antes de subir el extracto.')
      return
    }
    setUploading(true)
    try {
      const res = await Api.previewImport(Number(selectedAccountId), file)
      setPreview(res)
      const init: Record<number, RowDecision> = {}
      for (const r of res.rows) {
        init[r.index] = {
          include: !r.is_duplicate,
          category_id: r.category_id,
          is_internal_transfer: r.is_internal_transfer,
          is_owed_by_joint: Boolean(r.is_owed_by_joint),
        }
      }
      setDecisions(init)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al procesar el extracto')
    } finally {
      setUploading(false)
    }
  }

  const handleConfirm = async () => {
    if (!preview) return
    setConfirming(true)
    setError(null)
    try {
      const payload = Object.entries(decisions).map(([idx, d]) => ({
        index: Number(idx),
        include: d.include,
        category_id: d.category_id,
        is_internal_transfer: d.is_internal_transfer,
        is_owed_by_joint: d.is_owed_by_joint,
      }))
      const res = await Api.confirmImport(preview.batch_id, payload)
      setImportResult(res)
      setPreview(null)
      await reloadCatalog()
      await loadHistory()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al confirmar la importación')
    } finally {
      setConfirming(false)
    }
  }

  const handleUndoBatch = async (id: number) => {
    if (!confirm('¿Deshacer esta importación? Se eliminarán todos los movimientos asociados a este lote.')) return
    await Api.undoImport(id)
    await reloadCatalog()
    await loadHistory()
  }

  return (
    <div className="space-y-6">
      <PageTutorialBanner
        pageId="import"
        title="Tutorial de Subida de Extractos · ¿Qué hay en esta página y cómo se utiliza?"
        subtitle="Importa extractos bancarios reales en PDF, Excel (.xls / .xlsx) o CSV de cualquier entidad con detección de duplicados."
        steps={[
          {
            title: '1. Selecciona la Cuenta Destino',
            badge: 'Obligatorio',
            description:
              'Haz clic primero sobre la cuenta o tarjeta a la que pertenece el extracto que vas a subir (o pulsa «+ Añadir Banco» para crearla).',
          },
          {
            title: '2. Arrastra tu PDF, Excel o CSV',
            badge: 'Multi-Banco',
            description:
              'Soporta extractos en Castellano y Euskera (Kutxabank, BBVA, Santander, CaixaBank, ING, Revolut, etc.). Se procesan en memoria RAM con privacidad total.',
          },
          {
            title: '3. Previsualiza antes de Guardar',
            badge: 'Inteligente',
            description:
              'Revisa las categorías asignadas, los traspasos internos y pagos de tarjeta detectados, y marca «Me lo debe C. Común» en los gastos compartidos.',
          },
          {
            title: '4. Confirma o Deshaz en 1 clic',
            badge: 'Sin duplicados',
            description:
              'Al confirmar, se actualiza el saldo real de la cuenta omitiendo movimientos repetidos. Desde el historial inferior puedes deshacer cualquier lote.',
          },
        ]}
        tip="Puedes subir extractos con fechas solapadas sin miedo: el sistema calcula una huella única (SHA-256) por movimiento y bloquea automáticamente los duplicados."
      />

      {/* Banner si no hay cuentas creadas */}
      {accounts.length === 0 && (
        <div className="card p-5 bg-amber-50 border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="text-sm font-bold text-amber-900">
              Primero necesitas al menos una cuenta destino creada
            </div>
            <p className="text-xs text-amber-800">
              Crea tus cuentas de cualquier banco desde Cuentas y Reglas o genera en 1 clic el pack familiar inicial.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={() => seedFamilyAccounts()}
              className="btn bg-amber-600 hover:bg-amber-700 text-white"
            >
              <Sparkles className="h-4 w-4" />
              Crear pack 5 cuentas
            </button>
            <button
              type="button"
              onClick={() => setAccountModalOpen(true)}
              className="btn-outline"
            >
              Crear cuenta y saldo actual
            </button>
          </div>
        </div>
      )}

      {/* Resultado tras confirmar */}
      {importResult && (
        <div className="card p-5 bg-emerald-50 border-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-fade-up">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="h-6 w-6 text-emerald-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="text-sm font-bold text-emerald-950">
                ¡Extracto importado correctamente! ({importResult.imported} movimientos guardados)
              </div>
              <div className="text-xs text-emerald-800 flex flex-wrap gap-3">
                <span>Duplicados omitidos: {importResult.duplicates_skipped}</span>
                <span>Parejas de traspaso vinculadas: {importResult.transfers_linked}</span>
                <span>Nuevo saldo de la cuenta: {format(importResult.account_balance)}</span>
              </div>
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <button type="button" onClick={() => navigate('/')} className="btn-primary text-xs">
              Ver Dashboard 50/30/20
            </button>
            <button type="button" onClick={() => navigate('/transactions')} className="btn-outline text-xs">
              Ver Transacciones
            </button>
          </div>
        </div>
      )}

      {/* Paso 1: Selector Obligatorio de Cuenta + Drag & Drop */}
      {!preview && (
        <div className="card p-6 space-y-6">
          <div className="space-y-2">
            <label className="label">1. Selecciona la Cuenta Destino (Obligatorio)</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {accounts.map((acc) => {
                const active = selectedAccountId === acc.id
                return (
                  <button
                    key={acc.id}
                    type="button"
                    onClick={() => setSelectedAccountId(acc.id)}
                    className={`p-3.5 rounded-2xl border text-left transition flex flex-col justify-between ${
                      active
                        ? 'border-primary-accent bg-blue-50/60 ring-2 ring-blue-200'
                        : 'border-line bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span className="truncate">
                        {acc.bank} · {acc.type === 'credit_card' ? 'Tarjeta' : acc.type === 'joint' ? 'Común' : 'Cuenta'}
                      </span>
                      {acc.type === 'credit_card' ? (
                        <CreditCard className="h-4 w-4 text-amber-500" />
                      ) : acc.type === 'joint' ? (
                        <Users className="h-4 w-4 text-emerald-600" />
                      ) : (
                        <Wallet className="h-4 w-4 text-primary-accent" />
                      )}
                    </div>
                    <div className="font-bold text-sm text-ink mt-1.5">{acc.name}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{format(acc.current_balance)}</div>
                  </button>
                )
              })}
              <button
                type="button"
                onClick={() => setAccountModalOpen(true)}
                className="p-3.5 rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 hover:border-primary-accent hover:bg-blue-50/40 text-left transition flex flex-col justify-between"
              >
                <div className="flex items-center justify-between text-xs text-primary-accent font-semibold">
                  <span>Nueva cuenta</span>
                  <Plus className="h-4 w-4" />
                </div>
                <div className="font-bold text-sm text-ink mt-1.5">+ Añadir Banco</div>
                <div className="text-[11px] text-slate-500 mt-0.5">Con tu saldo actual</div>
              </button>
            </div>
          </div>

          {error && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-xs font-medium text-red-700 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-2">
            <label className="label">2. Arrastra o selecciona el extracto bancario (Cualquier entidad: PDF, XLS, XLSX o CSV)</label>
            <div
              onDragOver={(e) => {
                e.preventDefault()
                setDragActive(true)
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragActive(false)
                const file = e.dataTransfer.files?.[0]
                if (file) handleFile(file)
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`cursor-pointer border-2 border-dashed rounded-2xl p-8 sm:p-10 text-center transition ${
                dragActive
                  ? 'border-primary-accent bg-blue-50/60'
                  : 'border-slate-300 bg-slate-50/60 hover:border-primary-accent hover:bg-blue-50/20'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.xls,.xlsx,.csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) handleFile(file)
                  e.target.value = ''
                }}
              />
              <div className="mx-auto h-12 w-12 rounded-2xl bg-blue-100 text-primary-accent flex items-center justify-center mb-3">
                <UploadCloud className="h-6 w-6" />
              </div>
              <div className="text-sm font-bold text-ink">
                {uploading ? 'Analizando extracto y conciliando cuentas...' : 'Haz clic o arrastra tu extracto bancario aquí'}
              </div>
              <p className="text-xs text-slate-500 mt-1 max-w-xl mx-auto">
                Compatible con extractos de <strong>cualquier banco</strong> (BBVA, Santander, CaixaBank, ING, Sabadell,
                Bankinter, Revolut, N26, Kutxabank ES/EU, Laboral Kutxa, etc.) en <strong>PDF</strong>,{' '}
                <strong>Excel</strong> (<code>.xls</code> / <code>.xlsx</code>) y <strong>CSV</strong> (máx. 10 MB).
              </p>

              <div className="flex flex-wrap justify-center gap-2 mt-4 text-[11px] text-slate-600">
                <span className="chip bg-white border border-line">
                  <FileText className="h-3.5 w-3.5 text-red-500" />
                  PDF ES / EU / Multi-Banco (1 o 2 fechas, multilínea)
                </span>
                <span className="chip bg-white border border-line">
                  <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
                  Excel (.xls / .xlsx) Cuentas y Tarjetas
                </span>
                <span className="chip bg-white border border-line">
                  <FileSpreadsheet className="h-3.5 w-3.5 text-amber-600" />
                  CSV Estándar o Cargo / Abono separados
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Paso 2: Previsualización Interactiva antes de Guardar */}
      {preview && (
        <div className="space-y-5 animate-fade-up">
          <div className="card p-5 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="chip bg-blue-50 text-blue-700 border border-blue-200 font-semibold">
                    {FORMAT_LABELS[preview.detected_format] ?? preview.detected_format}
                  </span>
                  {preview.account_number && (
                    <span className="chip bg-slate-100 text-slate-700">Nº: {preview.account_number}</span>
                  )}
                  {preview.period_start && (
                    <span className="chip bg-slate-100 text-slate-700">
                      Período: {preview.period_start} → {preview.period_end}
                    </span>
                  )}
                </div>
                <h2 className="text-base font-bold text-ink">
                  Previsualización de «{preview.filename}» en cuenta{' '}
                  <span className="text-primary-accent">
                    {accounts.find((a) => a.id === preview.account_id)?.name}
                  </span>
                </h2>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPreview(null)}
                  className="btn-outline text-xs"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={confirming}
                  onClick={handleConfirm}
                  className="btn-accent text-xs sm:text-sm"
                >
                  <FileUp className="h-4 w-4" />
                  <span>
                    {confirming
                      ? 'Guardando movimientos...'
                      : `Confirmar e Importar (${
                          Object.values(decisions).filter((d) => d.include).length
                        } mov.)`}
                  </span>
                </button>
              </div>
            </div>

            {/* Estadísticas del lote */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
              <div className="p-3 rounded-xl bg-slate-50 border border-line">
                <div className="text-[11px] text-slate-500">Total Leídos</div>
                <div className="text-lg font-bold text-ink">{preview.stats.total}</div>
              </div>
              <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200">
                <div className="text-[11px] text-emerald-700">Nuevos</div>
                <div className="text-lg font-bold text-emerald-800">{preview.stats.new}</div>
              </div>
              <div className="p-3 rounded-xl bg-slate-100 border border-slate-200">
                <div className="text-[11px] text-slate-600">Duplicados (SHA-256)</div>
                <div className="text-lg font-bold text-slate-700">{preview.stats.duplicates}</div>
              </div>
              <div className="p-3 rounded-xl bg-blue-50/70 border border-blue-200">
                <div className="text-[11px] text-blue-700">Traspasos Internos</div>
                <div className="text-lg font-bold text-blue-800">{preview.stats.transfers}</div>
              </div>
              <div className="p-3 rounded-xl bg-indigo-50/70 border border-indigo-200">
                <div className="text-[11px] text-indigo-700">Auto-Categorizados</div>
                <div className="text-lg font-bold text-indigo-800">{preview.stats.categorized}</div>
              </div>
              <div className="p-3 rounded-xl bg-purple-50 border border-purple-200 col-span-2 sm:col-span-1 lg:col-span-2">
                <div className="text-[11px] font-semibold text-purple-800">
                  Lo debe Cuenta Común (marcados)
                </div>
                <div className="text-lg font-bold text-purple-900">
                  {format(
                    preview.rows.reduce((acc, r) => {
                      const d = decisions[r.index]
                      if (d?.include && d?.is_owed_by_joint && r.amount < 0) {
                        return acc + Math.abs(r.amount)
                      }
                      return acc
                    }, 0)
                  )}{' '}
                  <span className="text-xs font-normal text-purple-700">
                    (
                    {
                      preview.rows.filter(
                        (r) => decisions[r.index]?.include && decisions[r.index]?.is_owed_by_joint
                      ).length
                    }{' '}
                    gastos)
                  </span>
                </div>
              </div>
            </div>

            {/* Avisos globales del archivo */}
            {preview.warnings.length > 0 && (
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-3.5 space-y-1 text-xs text-amber-800">
                {preview.warnings.map((w, i) => (
                  <div key={i} className="flex items-center gap-2 font-medium">
                    <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                    <span>{w}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Tabla de Previsualización */}
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-line text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    <th className="py-3 px-3">Importar</th>
                    <th className="py-3 px-3">Fecha</th>
                    <th className="py-3 px-3">Concepto</th>
                    <th className="py-3 px-3">Categoría Sugerida</th>
                    <th className="py-3 px-3">¿Lo debe Cuenta Común?</th>
                    <th className="py-3 px-3">Conciliación / Alertas</th>
                    <th className="py-3 px-3 text-right">Importe</th>
                    <th className="py-3 px-3 text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line text-xs">
                  {preview.rows.map((r) => {
                    const dec = decisions[r.index] ?? {
                      include: !r.is_duplicate,
                      category_id: r.category_id,
                      is_internal_transfer: r.is_internal_transfer,
                      is_owed_by_joint: Boolean(r.is_owed_by_joint),
                    }
                    const destAccount = accounts.find((a) => a.id === preview.account_id)
                    const canBeOwedByJoint = destAccount?.type !== 'joint' && r.amount < 0
                    return (
                      <tr
                        key={r.index}
                        className={`${
                          r.is_duplicate
                            ? 'bg-slate-100/70 opacity-60'
                            : !dec.include
                            ? 'opacity-50'
                            : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="py-2.5 px-3">
                          {r.is_duplicate ? (
                            <span className="chip bg-slate-200 text-slate-600">Duplicado</span>
                          ) : (
                            <input
                              type="checkbox"
                              checked={dec.include}
                              onChange={(e) =>
                                setDecisions((prev) => ({
                                  ...prev,
                                  [r.index]: { ...dec, include: e.target.checked },
                                }))
                              }
                              className="rounded text-primary-accent"
                            />
                          )}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap font-medium text-slate-700">
                          {r.operation_date}
                        </td>
                        <td className="py-2.5 px-3 max-w-md">
                          <div className="font-medium text-ink">{r.concept}</div>
                        </td>
                        <td className="py-2.5 px-3 min-w-[200px]">
                          <select
                            disabled={r.is_duplicate}
                            value={dec.category_id ?? ''}
                            onChange={(e) => {
                              const newCatId = e.target.value ? Number(e.target.value) : null
                              const catObj = categories.find((c) => c.id === newCatId)
                              setDecisions((prev) => ({
                                ...prev,
                                [r.index]: {
                                  ...dec,
                                  category_id: newCatId,
                                  is_internal_transfer:
                                    catObj?.group === 'transfer' ? true : dec.is_internal_transfer,
                                },
                              }))
                            }}
                            className="input py-1 text-xs"
                          >
                            <option value="">— Sin categoría —</option>
                            {Object.entries(groupedCategories).map(([group, cats]) => (
                              <optgroup key={group} label={GROUP_META[group]?.label ?? group}>
                                {cats.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.name}
                                  </option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          {canBeOwedByJoint ? (
                            <button
                              type="button"
                              disabled={r.is_duplicate}
                              onClick={() =>
                                setDecisions((prev) => ({
                                  ...prev,
                                  [r.index]: { ...dec, is_owed_by_joint: !dec.is_owed_by_joint },
                                }))
                              }
                              className={`chip cursor-pointer transition ${
                                dec.is_owed_by_joint
                                  ? 'bg-purple-600 text-white shadow-sm'
                                  : 'bg-slate-100 text-slate-600 hover:bg-purple-50 hover:text-purple-700'
                              }`}
                            >
                              <Users className="h-3 w-3" />
                              <span>
                                {dec.is_owed_by_joint ? 'Sí · Me lo debe C. Común' : 'No (Gasto personal)'}
                              </span>
                            </button>
                          ) : (
                            <span className="text-[11px] text-slate-400">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              disabled={r.is_duplicate}
                              onClick={() =>
                                setDecisions((prev) => ({
                                  ...prev,
                                  [r.index]: { ...dec, is_internal_transfer: !dec.is_internal_transfer },
                                }))
                              }
                              className={`chip ${
                                dec.is_internal_transfer
                                  ? 'bg-slate-800 text-white'
                                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                              }`}
                            >
                              <ArrowLeftRight className="h-3 w-3" />
                              <span>
                                {dec.is_internal_transfer ? 'Transferencia Interna' : 'Movimiento Real'}
                              </span>
                            </button>
                            {r.transfer_reason && (
                              <span className="text-[11px] text-slate-500">{r.transfer_reason}</span>
                            )}
                          </div>
                          {r.pair_description && (
                            <div className="text-[11px] text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-2 py-0.5 inline-block">
                              Pareja detectada: {r.pair_description}
                            </div>
                          )}
                          {r.alerts.map((al, idx) => (
                            <div
                              key={idx}
                              className="flex items-center gap-1.5 text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-2 py-1"
                            >
                              <ShieldAlert className="h-3.5 w-3.5 text-red-600 shrink-0" />
                              <span>{al}</span>
                            </div>
                          ))}
                        </td>
                        <td
                          className={`py-2.5 px-3 whitespace-nowrap text-right font-bold ${
                            dec.is_internal_transfer
                              ? 'text-slate-500'
                              : r.amount >= 0
                              ? 'text-emerald-600'
                              : 'text-ink'
                          }`}
                        >
                          {format(r.amount, { signed: true })}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap text-right text-slate-500">
                          {r.balance !== null ? format(r.balance) : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Historial de Importaciones Confirmadas */}
      {batches.length > 0 && (
        <div className="card p-5 space-y-3">
          <div className="flex items-center gap-2 text-sm font-bold text-ink">
            <History className="h-4 w-4 text-slate-500" />
            <span>Historial de Extractos Importados</span>
          </div>
          <div className="divide-y divide-line text-xs">
            {batches.map((b) => (
              <div key={b.id} className="py-2.5 flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="font-semibold text-ink">
                    {b.filename} <span className="text-slate-400">·</span>{' '}
                    <span className="text-primary-accent">{b.account_name}</span>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {FORMAT_LABELS[b.detected_format] ?? b.detected_format} · Importados: {b.imported_rows}/
                    {b.total_rows} · Duplicados omitidos: {b.duplicate_rows}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleUndoBatch(b.id)}
                  className="btn-outline py-1 px-2.5 text-xs text-red-600 hover:bg-red-50"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Deshacer lote
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      <AccountModal
        open={accountModalOpen}
        onClose={() => setAccountModalOpen(false)}
        onCreated={(created) => setSelectedAccountId(created.id)}
      />
    </div>
  )
}
