import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Users,
  Wallet,
  X,
} from 'lucide-react'
import { Api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useCurrency } from '../context/CurrencyContext'
import { GROUP_META } from '../components/Layout'
import { PageTutorialBanner } from '../components/PageTutorialBanner'
import type { Category, Summary, Transaction } from '../types'

export function TransactionsPage() {
  const { accounts, categories, workspace, reloadCatalog } = useAuth()
  const { format } = useCurrency()
  const [searchParams] = useSearchParams()

  const [q, setQ] = useState('')
  const [accountId, setAccountId] = useState<number | ''>('')
  const [categoryId, setCategoryId] = useState<number | ''>('')
  const [uncategorized, setUncategorized] = useState(() => searchParams.get('uncategorized') === '1')
  const [transfers, setTransfers] = useState<'all' | 'exclude' | 'only'>('all')
  const [owedByJoint, setOwedByJoint] = useState<'all' | 'pending' | 'settled'>(() => {
    const p = searchParams.get('owed_by_joint')
    return p === 'pending' || p === 'settled' ? p : 'all'
  })
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)
  const [items, setItems] = useState<Transaction[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [autoCreateRule, setAutoCreateRule] = useState(true)
  const [toast, setToast] = useState<string | null>(null)
  const [jointDebts, setJointDebts] = useState<Summary['joint_debts'] | null>(null)
  const [settleDebtModal, setSettleDebtModal] = useState<{ owner?: string; amount: number; count: number } | null>(null)
  const [settlingDebt, setSettlingDebt] = useState(false)

  // Selección múltiple y modal de confirmación de eliminación
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [selectAllMatching, setSelectAllMatching] = useState(false)
  const [confirmDeleteState, setConfirmDeleteState] = useState<{
    mode: 'single' | 'selected' | 'all'
    tx?: Transaction
    count: number
  } | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Modal de Nuevo Movimiento Manual
  const [manualOpen, setManualOpen] = useState(false)
  const [mAccountId, setMAccountId] = useState<number | ''>('')
  const [mDate, setMDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [mConcept, setMConcept] = useState('')
  const [mAmount, setMAmount] = useState('')
  const [mCatId, setMCatId] = useState<number | ''>('')
  const [mIsTransfer, setMIsTransfer] = useState(false)
  const [mIsOwedByJoint, setMIsOwedByJoint] = useState(false)

  const groupedCategories = useMemo(() => {
    const map: Record<string, Category[]> = {}
    for (const c of categories) {
      map[c.group] = map[c.group] || []
      map[c.group].push(c)
    }
    return map
  }, [categories])

  const loadTransactions = useCallback(async () => {
    if (!workspace) return
    setLoading(true)
    try {
      const [res, sum] = await Promise.all([
        Api.transactions({
          q: q.trim() || undefined,
          account_id: accountId || undefined,
          category_id: !uncategorized && categoryId ? categoryId : undefined,
          uncategorized: uncategorized || undefined,
          transfers,
          owed_by_joint: owedByJoint,
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
          page,
          size: 50,
        }),
        Api.summary({
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
        }),
      ])
      setItems(res.items)
      setTotal(res.total)
      setJointDebts(sum.joint_debts)
      setSelectedIds([])
      setSelectAllMatching(false)
    } finally {
      setLoading(false)
    }
  }, [workspace, q, accountId, categoryId, uncategorized, transfers, owedByJoint, dateFrom, dateTo, page])

  useEffect(() => {
    loadTransactions()
  }, [loadTransactions])

  const handleCategoryChange = async (tx: Transaction, newCategoryId: number | null) => {
    try {
      const res = await Api.updateTransaction(tx.id, {
        category_id: newCategoryId,
        create_rule: autoCreateRule && Boolean(newCategoryId && tx.merchant_hint),
        rule_pattern: tx.merchant_hint || undefined,
      })
      if (res.rule_id) {
        setToast(
          `Regla automática guardada para «${tx.merchant_hint}» (${res.recategorized} mov. adicionales categorizados).`
        )
        setTimeout(() => setToast(null), 4500)
        await loadTransactions()
      } else {
        setItems((prev) => prev.map((it) => (it.id === tx.id ? res.transaction : it)))
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error al actualizar movimiento')
    }
  }

  const handleToggleTransfer = async (tx: Transaction) => {
    try {
      const res = await Api.updateTransaction(tx.id, {
        is_internal_transfer: !tx.is_internal_transfer,
      })
      setItems((prev) => prev.map((it) => (it.id === tx.id ? res.transaction : it)))
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error al actualizar transferencia')
    }
  }

  const handleToggleOwedByJoint = async (tx: Transaction) => {
    try {
      const nextVal = !tx.is_owed_by_joint
      const res = await Api.updateTransaction(tx.id, {
        is_owed_by_joint: nextVal,
        joint_settled: false,
        create_rule: autoCreateRule && nextVal && Boolean(tx.merchant_hint),
        rule_pattern: tx.merchant_hint || undefined,
      })
      setItems((prev) => prev.map((it) => (it.id === tx.id ? res.transaction : it)))
      const sum = await Api.summary({
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      })
      setJointDebts(sum.joint_debts)
      if (nextVal) {
        setToast(
          `Marcado como reembolsable por la Cuenta Común (${format(Math.abs(tx.amount))} a favor de ${
            tx.account_owner || tx.account_name
          }).`
        )
        setTimeout(() => setToast(null), 4000)
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error al actualizar reembolso de Cuenta Común')
    }
  }

  const allPageSelected = items.length > 0 && items.every((t) => selectedIds.includes(t.id))

  const toggleSelectAllOnPage = () => {
    if (allPageSelected) {
      setSelectedIds([])
      setSelectAllMatching(false)
    } else {
      setSelectedIds(items.map((t) => t.id))
    }
  }

  const toggleSelectOne = (id: number) => {
    setSelectAllMatching(false)
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const requestDeleteSingle = (tx: Transaction) => {
    setConfirmDeleteState({ mode: 'single', tx, count: 1 })
  }

  const requestDeleteSelected = () => {
    if (selectAllMatching) {
      setConfirmDeleteState({ mode: 'all', count: total })
    } else if (selectedIds.length > 0) {
      setConfirmDeleteState({ mode: 'selected', count: selectedIds.length })
    }
  }

  const executeConfirmedDelete = async () => {
    if (!confirmDeleteState) return
    setDeleting(true)
    try {
      let deletedCount = 0
      if (confirmDeleteState.mode === 'single' && confirmDeleteState.tx) {
        await Api.deleteTransaction(confirmDeleteState.tx.id)
        deletedCount = 1
      } else if (confirmDeleteState.mode === 'all') {
        const res = await Api.bulkDeleteTransactions({
          delete_all: true,
          q: q.trim() || undefined,
          account_id: accountId ? Number(accountId) : undefined,
          category_id: !uncategorized && categoryId ? Number(categoryId) : undefined,
          uncategorized: uncategorized || undefined,
          transfers,
          owed_by_joint: owedByJoint,
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
        })
        deletedCount = res.deleted
      } else {
        const res = await Api.bulkDeleteTransactions({
          transaction_ids: selectedIds,
        })
        deletedCount = res.deleted
      }
      setConfirmDeleteState(null)
      setToast(
        deletedCount === 1
          ? 'Se ha eliminado 1 transacción correctamente.'
          : `Se han eliminado ${deletedCount} transacciones correctamente.`
      )
      setTimeout(() => setToast(null), 4000)
      await reloadCatalog()
      await loadTransactions()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error al eliminar transacciones')
    } finally {
      setDeleting(false)
    }
  }

  const handleCreateManual = async (e: React.FormEvent) => {
    e.preventDefault()
    const targetAcc = mAccountId || accounts[0]?.id
    if (!targetAcc || !mConcept.trim() || !mAmount) return
    await Api.createTransaction({
      account_id: Number(targetAcc),
      operation_date: mDate,
      concept: mConcept.trim(),
      amount: parseFloat(mAmount),
      category_id: mCatId ? Number(mCatId) : null,
      is_internal_transfer: mIsTransfer,
      is_owed_by_joint: mIsOwedByJoint,
    })
    setManualOpen(false)
    setMConcept('')
    setMAmount('')
    setMCatId('')
    setMIsTransfer(false)
    setMIsOwedByJoint(false)
    await reloadCatalog()
    await loadTransactions()
  }

  const totalPages = Math.max(1, Math.ceil(total / 50))

  return (
    <div className="space-y-5">
      <PageTutorialBanner
        pageId="transactions"
        title="Tutorial de Transacciones · ¿Qué hay en esta página y cómo se utiliza?"
        subtitle="Explora, filtra, categoriza en línea, marca gastos que te debe la Cuenta Común, exporta a Excel o elimina movimientos."
        steps={[
          {
            title: 'Saldo Real y Buscador Avanzado',
            badge: 'Filtros',
            description:
              'En la barra superior ves el Saldo Real de cada cuenta. Filtra por texto (ej. LIDL, IBERDROLA), cuenta, categoría, fechas o «⚠️ Sin categorizar».',
          },
          {
            title: 'Categorización en Línea + Auto-Reglas',
            badge: 'Tabla',
            description:
              'Cambia la categoría de cualquier fila en su desplegable. Si «Crear regla automática» está activo, clasificará solo los movimientos futuros de ese comercio.',
          },
          {
            title: 'Deuda de Cuenta Común y Traspasos',
            badge: 'Reembolsos',
            description:
              'Pulsa «Gasto personal / Me lo debe C. Común» en compras pagadas con tu tarjeta personal para sumarlas a la deuda superior y saldarla con 1 clic.',
          },
          {
            title: 'Exportar a Excel/CSV y Eliminar',
            badge: 'Acciones',
            description:
              'Exporta el listado a Excel/CSV, añade un movimiento manual o selecciona transacciones (una, varias o todas) para eliminarlas con confirmación.',
          },
        ]}
        tip="Si un movimiento entre dos de tus cuentas no es un gasto real, pulsa su etiqueta de la columna «Tipo» para marcarlo como «Traspaso Interno» y excluirlo del 50/30/20."
      />

      {/* Toast de regla creada */}
      {toast && (
        <div className="card p-3.5 bg-emerald-50 border-emerald-200 text-emerald-800 flex items-center gap-2.5 text-xs font-medium animate-fade-up">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
          <span>{toast}</span>
        </div>
      )}

      {/* Barra de Saldo Real de las Cuentas */}
      {accounts.length > 0 && (
        <div className="card p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-gradient-to-r from-white to-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-blue-50 text-primary-accent shrink-0">
              <Wallet className="h-4 w-4" />
            </div>
            <div>
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Saldo Real en Cuenta{accountId !== '' ? ' seleccionada' : 's'}
              </div>
              <div className="text-lg font-bold text-ink">
                {accountId !== ''
                  ? format(accounts.find((a) => a.id === accountId)?.current_balance ?? 0)
                  : format(
                      accounts
                        .filter((a) => a.type !== 'credit_card')
                        .reduce((accSum, a) => accSum + a.current_balance, 0)
                    )}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {accounts.map((a) => {
              const active = accountId === a.id
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => {
                    setPage(1)
                    setAccountId(active ? '' : a.id)
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs border transition flex items-center gap-1.5 ${
                    active
                      ? 'bg-primary-accent text-white border-primary-accent shadow-sm font-semibold'
                      : 'bg-white text-slate-700 border-line hover:border-primary-accent'
                  }`}
                >
                  <span>{a.name}:</span>
                  <span className="font-bold">{format(a.current_balance)}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Apartado de Lo que debe la Cuenta Común a cada uno */}
      {jointDebts && (jointDebts.by_owner.length > 0 || owedByJoint !== 'all') && (
        <div className="card p-4 border-purple-200 bg-gradient-to-r from-white via-purple-50/30 to-purple-50/60 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-purple-100 text-purple-700 shrink-0">
                <Users className="h-4 w-4" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold text-ink">
                    Lo que debe la Cuenta Común a cada uno
                  </span>
                  <span className="chip bg-purple-600 text-white font-semibold">
                    Total pendiente: {format(jointDebts.total_pending)}
                  </span>
                  {jointDebts.total_settled > 0 && (
                    <span className="chip bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">
                      Ya saldado: {format(jointDebts.total_settled)}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500">
                  Importe acumulado que la Cuenta Común debe reembolsar a cada titular por gastos pagados con cuentas o tarjetas personales.
                </p>
              </div>
            </div>

            {jointDebts.total_pending > 0 && (
              <button
                type="button"
                onClick={() =>
                  setSettleDebtModal({
                    amount: jointDebts.total_pending,
                    count: jointDebts.by_owner.reduce((acc, o) => acc + o.pending_count, 0),
                  })
                }
                className="btn bg-emerald-600 hover:bg-emerald-700 text-white py-1.5 px-3 text-xs font-semibold shrink-0"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>Ya se ha saldado toda la deuda ({format(jointDebts.total_pending)})</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {jointDebts.by_owner.map((ownerDebt) => {
              const hasPending = ownerDebt.pending_amount > 0
              return (
                <div
                  key={ownerDebt.owner}
                  className={`p-3 rounded-2xl border flex items-center justify-between gap-3 ${
                    hasPending
                      ? 'bg-white border-purple-300 shadow-sm'
                      : 'bg-white/70 border-slate-200'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-purple-700">
                      Cuenta Común debe a {ownerDebt.owner}
                    </div>
                    <div
                      className={`text-lg font-extrabold ${
                        hasPending ? 'text-purple-700' : 'text-emerald-600'
                      }`}
                    >
                      {format(ownerDebt.pending_amount)}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {hasPending
                        ? `${ownerDebt.pending_count} ${
                            ownerDebt.pending_count === 1 ? 'gasto pendiente' : 'gastos pendientes'
                          }`
                        : ownerDebt.settled_amount > 0
                        ? `Saldado (${format(ownerDebt.settled_amount)})`
                        : 'Sin deuda pendiente'}
                    </div>
                  </div>

                  {hasPending ? (
                    <button
                      type="button"
                      onClick={() =>
                        setSettleDebtModal({
                          owner: ownerDebt.owner,
                          amount: ownerDebt.pending_amount,
                          count: ownerDebt.pending_count,
                        })
                      }
                      className="btn bg-purple-600 hover:bg-purple-700 text-white py-1.5 px-3 text-xs font-semibold shrink-0"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>Ya se ha saldado la deuda</span>
                    </button>
                  ) : (
                    <span className="chip bg-emerald-100 text-emerald-800 border border-emerald-200 font-semibold shrink-0">
                      <CheckCircle2 className="h-3 w-3" />
                      <span>Deuda saldada</span>
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Filtros y Buscador */}
      <div className="card p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <div className="lg:col-span-2 relative">
            <Search className="h-4 w-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Buscar concepto o comercio (ej. LIDL, OP.NET, KRED...)"
              value={q}
              onChange={(e) => {
                setPage(1)
                setQ(e.target.value)
              }}
              className="input pl-9"
            />
          </div>

          <select
            aria-label="Filtrar por cuenta"
            value={accountId}
            onChange={(e) => {
              setPage(1)
              setAccountId(e.target.value ? Number(e.target.value) : '')
            }}
            className="input"
          >
            <option value="">Todas las cuentas</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>

          <select
            aria-label="Filtrar por categoría"
            value={uncategorized ? '__uncat__' : categoryId}
            onChange={(e) => {
              setPage(1)
              if (e.target.value === '__uncat__') {
                setUncategorized(true)
                setCategoryId('')
              } else {
                setUncategorized(false)
                setCategoryId(e.target.value ? Number(e.target.value) : '')
              }
            }}
            className="input"
          >
            <option value="">Todas las categorías</option>
            <option value="__uncat__">⚠️ Sin categorizar</option>
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

          <input
            type="date"
            aria-label="Fecha desde"
            value={dateFrom}
            onChange={(e) => {
              setPage(1)
              setDateFrom(e.target.value)
            }}
            className="input"
          />

          <input
            type="date"
            aria-label="Fecha hasta"
            value={dateTo}
            onChange={(e) => {
              setPage(1)
              setDateTo(e.target.value)
            }}
            className="input"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-line">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-xl bg-slate-100 p-0.5 text-xs">
              {(
                [
                  ['all', 'Todos'],
                  ['exclude', 'Excluir traspasos'],
                  ['only', 'Solo traspasos internos'],
                ] as const
              ).map(([val, label]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => {
                    setPage(1)
                    setTransfers(val)
                  }}
                  className={`px-2.5 py-1 rounded-lg font-medium transition ${
                    transfers === val ? 'bg-white text-ink shadow-sm' : 'text-slate-600 hover:text-ink'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="inline-flex rounded-xl bg-purple-50 border border-purple-200 p-0.5 text-xs">
              {(
                [
                  ['all', 'Todos'],
                  ['pending', '🟣 Lo debe C. Común'],
                  ['settled', '✅ Ya reembolsados'],
                ] as const
              ).map(([val, label]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => {
                    setPage(1)
                    setOwedByJoint(val)
                  }}
                  className={`px-2.5 py-1 rounded-lg font-medium transition ${
                    owedByJoint === val ? 'bg-purple-600 text-white shadow-sm' : 'text-purple-800 hover:text-purple-950'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <label className="inline-flex items-center gap-2 text-xs text-slate-600 cursor-pointer bg-blue-50/70 border border-blue-200 px-3 py-1.5 rounded-xl">
              <input
                type="checkbox"
                checked={autoCreateRule}
                onChange={(e) => setAutoCreateRule(e.target.checked)}
                className="rounded text-primary-accent"
              />
              <Sparkles className="h-3.5 w-3.5 text-primary-accent" />
              <span>Crear regla automática por comercio al editar categoría en línea</span>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="text-xs text-slate-500 mr-1">
              Mostrando <strong>{items.length}</strong> de <strong>{total}</strong> movimientos
            </div>
            {items.length > 0 && (
              <button
                type="button"
                onClick={() =>
                  Api.downloadTransactionsCsv({
                    q: q.trim() || undefined,
                    account_id: accountId || undefined,
                    category_id: !uncategorized && categoryId ? categoryId : undefined,
                    uncategorized: uncategorized || undefined,
                    transfers,
                    owed_by_joint: owedByJoint,
                    date_from: dateFrom || undefined,
                    date_to: dateTo || undefined,
                  })
                }
                className="btn-outline py-1.5 px-3 text-xs"
                title="Exportar listado a Excel / CSV (UTF-8)"
              >
                <Download className="h-3.5 w-3.5 text-emerald-600" />
                <span>Exportar Excel / CSV</span>
              </button>
            )}
            {items.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  if (selectAllMatching || allPageSelected) {
                    setSelectedIds([])
                    setSelectAllMatching(false)
                  } else {
                    setSelectedIds(items.map((t) => t.id))
                    setSelectAllMatching(true)
                  }
                }}
                className="btn-outline py-1.5 px-3 text-xs"
              >
                {selectAllMatching || allPageSelected
                  ? 'Deseleccionar todas'
                  : `Seleccionar todas (${total})`}
              </button>
            )}
            {accounts.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setMAccountId(accounts[0].id)
                  setManualOpen(true)
                }}
                className="btn-primary py-1.5 px-3 text-xs"
              >
                <Plus className="h-3.5 w-3.5" />
                Añadir movimiento manual
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Barra de Selección Activa para Eliminación en Lote */}
      {(selectedIds.length > 0 || selectAllMatching) && (
        <div className="card p-3.5 bg-red-50/90 border-red-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-fade-up">
          <div className="flex flex-wrap items-center gap-2 text-xs text-red-950">
            <span className="font-bold">
              {selectAllMatching
                ? `Todas las ${total} transacciones seleccionadas`
                : `${selectedIds.length} ${
                    selectedIds.length === 1 ? 'transacción seleccionada' : 'transacciones seleccionadas'
                  }`}
            </span>
            {!selectAllMatching && allPageSelected && total > items.length && (
              <button
                type="button"
                onClick={() => setSelectAllMatching(true)}
                className="underline font-semibold text-red-700 hover:text-red-900 ml-1"
              >
                Seleccionar las {total} transacciones de todas las páginas
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setSelectedIds([])
                setSelectAllMatching(false)
              }}
              className="btn-outline py-1.5 px-3 text-xs bg-white"
            >
              Cancelar selección
            </button>
            <button
              type="button"
              onClick={requestDeleteSelected}
              className="btn bg-red-600 hover:bg-red-700 text-white py-1.5 px-3.5 text-xs font-semibold shadow-sm"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>
                Eliminar seleccionadas ({selectAllMatching ? total : selectedIds.length})
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Modal de Confirmación de Eliminación */}
      {confirmDeleteState && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="card w-full max-w-md p-6 space-y-4 animate-fade-up">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-2xl bg-red-100 text-red-600 shrink-0">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-ink">Confirmar eliminación de transacciones</h3>
                {confirmDeleteState.mode === 'single' && confirmDeleteState.tx ? (
                  <p className="text-xs text-slate-600 leading-relaxed">
                    ¿Estás seguro de que quieres eliminar el movimiento{' '}
                    <strong>«{confirmDeleteState.tx.concept}»</strong> ({confirmDeleteState.tx.operation_date}) por
                    importe de <strong>{format(confirmDeleteState.tx.amount, { signed: true })}</strong>?
                  </p>
                ) : (
                  <p className="text-xs text-slate-600 leading-relaxed">
                    ¿Estás seguro de que quieres eliminar{' '}
                    <strong>
                      {confirmDeleteState.count}{' '}
                      {confirmDeleteState.count === 1 ? 'transacción seleccionada' : 'transacciones seleccionadas'}
                    </strong>
                    ?
                  </p>
                )}
                <p className="text-[11px] text-red-600 font-medium pt-1">
                  Esta acción es permanente y no se puede deshacer.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-line">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setConfirmDeleteState(null)}
                className="btn-outline text-xs"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={executeConfirmedDelete}
                className="btn bg-red-600 hover:bg-red-700 text-white text-xs font-semibold"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>
                  {deleting
                    ? 'Eliminando...'
                    : confirmDeleteState.count === 1
                    ? 'Sí, eliminar transacción'
                    : `Sí, eliminar las ${confirmDeleteState.count} transacciones`}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Confirmación para Saldar Deuda de la Cuenta Común */}
      {settleDebtModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="card w-full max-w-md p-6 space-y-4 animate-fade-up">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-2xl bg-purple-100 text-purple-700 flex items-center justify-center shrink-0">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-ink">
                  {settleDebtModal.owner
                    ? `¿Confirmar que se ha saldado la deuda con ${settleDebtModal.owner}?`
                    : '¿Confirmar que se ha saldado toda la deuda de la Cuenta Común?'}
                </h3>
                <p className="text-xs text-slate-600 mt-1">
                  Se marcarán como <strong>Ya reembolsados</strong> los{' '}
                  <strong>{settleDebtModal.count} gastos pendientes</strong> por un total de{' '}
                  <strong className="text-purple-700">{format(settleDebtModal.amount)}</strong>
                  {settleDebtModal.owner ? ` a favor de ${settleDebtModal.owner}` : ''}.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-line">
              <button
                type="button"
                disabled={settlingDebt}
                onClick={() => setSettleDebtModal(null)}
                className="btn-outline text-xs"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={settlingDebt}
                onClick={async () => {
                  setSettlingDebt(true)
                  try {
                    const res = await Api.settleJointDebts(
                      settleDebtModal.owner ? { owner: settleDebtModal.owner } : {}
                    )
                    const targetLabel = settleDebtModal.owner ?? 'todos los titulares'
                    setSettleDebtModal(null)
                    setToast(
                      `Deuda saldada con ${targetLabel}: ${format(res.settled_amount)} (${res.settled_count} gastos marcados como reembolsados).`
                    )
                    setTimeout(() => setToast(null), 4500)
                    await loadTransactions()
                  } finally {
                    setSettlingDebt(false)
                  }
                }}
                className="btn bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold"
              >
                <CheckCircle2 className="h-4 w-4" />
                <span>
                  {settlingDebt
                    ? 'Guardando...'
                    : `Sí, deuda saldada (${format(settleDebtModal.amount)})`}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Movimiento Manual */}
      {manualOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form onSubmit={handleCreateManual} className="card w-full max-w-md p-6 space-y-4 animate-fade-up">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-ink">Nuevo Movimiento Manual</h3>
              <button
                type="button"
                onClick={() => setManualOpen(false)}
                className="p-1 text-slate-400 hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div>
              <label className="label">Cuenta / Banco</label>
              <select
                required
                value={mAccountId}
                onChange={(e) => setMAccountId(Number(e.target.value))}
                className="input"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.bank})
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Fecha</label>
                <input
                  type="date"
                  required
                  value={mDate}
                  onChange={(e) => setMDate(e.target.value)}
                  className="input"
                />
              </div>
              <div>
                <label className="label">Importe EUR (- gasto, + ingreso)</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  placeholder="-45.20"
                  value={mAmount}
                  onChange={(e) => setMAmount(e.target.value)}
                  className="input"
                />
              </div>
            </div>
            <div>
              <label className="label">Concepto / Comercio</label>
              <input
                type="text"
                required
                placeholder="Ej. COMPRA EN MERCADONA / CENA RESTAURANTE"
                value={mConcept}
                onChange={(e) => setMConcept(e.target.value)}
                className="input"
              />
            </div>
            <div>
              <label className="label">Categoría (opcional, se auto-detecta por reglas)</label>
              <select
                value={mCatId}
                onChange={(e) => setMCatId(e.target.value ? Number(e.target.value) : '')}
                className="input"
              >
                <option value="">Auto-detectar por reglas</option>
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
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={mIsTransfer}
                onChange={(e) => setMIsTransfer(e.target.checked)}
                className="rounded text-primary-accent"
              />
              <span>Marcar como Transferencia Interna (excluida del 50/30/20)</span>
            </label>
            <label className="flex items-center gap-2 text-xs text-purple-800 bg-purple-50 border border-purple-200 px-3 py-2 rounded-xl cursor-pointer font-medium">
              <input
                type="checkbox"
                checked={mIsOwedByJoint}
                onChange={(e) => setMIsOwedByJoint(e.target.checked)}
                className="rounded text-purple-600"
              />
              <span>Gasto de Cuenta Común pagado con mi cuenta personal (me lo debe la Cuenta Común)</span>
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setManualOpen(false)} className="btn-outline text-xs">
                Cancelar
              </button>
              <button type="submit" className="btn-accent text-xs">
                Guardar movimiento
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Tabla de Transacciones con Edición Inline */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-line text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="py-3 px-3 w-10">
                  <input
                    type="checkbox"
                    aria-label="Seleccionar todas las transacciones de la página"
                    checked={allPageSelected}
                    onChange={toggleSelectAllOnPage}
                    className="rounded text-primary-accent cursor-pointer"
                  />
                </th>
                <th className="py-3 px-4">Fecha</th>
                <th className="py-3 px-4">Cuenta</th>
                <th className="py-3 px-4">Concepto / Comercio</th>
                <th className="py-3 px-4">Categoría (Edición en línea)</th>
                <th className="py-3 px-4">¿Deuda Cuenta Común?</th>
                <th className="py-3 px-4">Tipo</th>
                <th className="py-3 px-4 text-right">Importe</th>
                <th className="py-3 px-4 text-right">Saldo</th>
                <th className="py-3 px-3 text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line text-xs">
              {loading ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-400">
                    Cargando transacciones...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-400">
                    No se encontraron transacciones con los filtros seleccionados.
                  </td>
                </tr>
              ) : (
                items.map((tx) => {
                  const groupMeta = tx.category_group ? GROUP_META[tx.category_group] : null
                  const isSelected = selectAllMatching || selectedIds.includes(tx.id)
                  return (
                    <tr
                      key={tx.id}
                      className={`transition ${
                        isSelected ? 'bg-red-50/40 hover:bg-red-50/70' : 'hover:bg-slate-50/80'
                      }`}
                    >
                      <td className="py-3 px-3">
                        <input
                          type="checkbox"
                          aria-label={`Seleccionar movimiento ${tx.concept}`}
                          checked={isSelected}
                          onChange={() => toggleSelectOne(tx.id)}
                          className="rounded text-primary-accent cursor-pointer"
                        />
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap font-medium text-slate-700">
                        <div>{tx.operation_date}</div>
                        {tx.value_date && tx.value_date !== tx.operation_date && (
                          <div className="text-[10px] text-slate-400">Valor: {tx.value_date}</div>
                        )}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="chip bg-slate-100 text-slate-700 font-medium">{tx.account_name}</span>
                      </td>
                      <td className="py-3 px-4 max-w-md">
                        <div className="font-medium text-ink break-words">{tx.concept}</div>
                        {tx.merchant_hint && (
                          <div className="text-[11px] text-slate-400 mt-0.5">
                            Comercio detectado: <code className="text-slate-600">{tx.merchant_hint}</code>
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 min-w-[210px]">
                        <select
                          aria-label={`Categoría para ${tx.concept}`}
                          value={tx.category_id ?? ''}
                          onChange={(e) =>
                            handleCategoryChange(tx, e.target.value ? Number(e.target.value) : null)
                          }
                          className="input py-1.5 text-xs"
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
                      <td className="py-3 px-4 whitespace-nowrap">
                        {tx.amount < 0 ? (
                          <button
                            type="button"
                            onClick={() => handleToggleOwedByJoint(tx)}
                            title="Indicar que este gasto lo debe reembolsar la Cuenta Común"
                            className={`chip cursor-pointer transition ${
                              tx.is_owed_by_joint
                                ? tx.joint_settled
                                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                                  : 'bg-purple-600 text-white shadow-sm'
                                : 'bg-slate-100 text-slate-600 hover:bg-purple-50 hover:text-purple-700'
                            }`}
                          >
                            <Users className="h-3 w-3" />
                            <span>
                              {tx.is_owed_by_joint
                                ? tx.joint_settled
                                  ? 'Reembolsado'
                                  : 'Me lo debe C. Común'
                                : 'Gasto personal'}
                            </span>
                          </button>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleToggleTransfer(tx)}
                            title="Alternar marca de Transferencia Interna (excluida del 50/30/20)"
                            className={`chip cursor-pointer transition ${
                              tx.is_internal_transfer
                                ? 'bg-slate-800 text-white'
                                : groupMeta
                                ? groupMeta.badgeClass
                                : 'bg-amber-50 text-amber-700 border border-amber-200'
                            }`}
                          >
                            <ArrowLeftRight className="h-3 w-3" />
                            <span>
                              {tx.is_internal_transfer
                                ? 'Traspaso Interno'
                                : groupMeta?.label.split(' ')[0] ?? 'Sin clasificar'}
                            </span>
                          </button>
                          {tx.transfer_pair_id && (
                            <span
                              title={`Emparejado con movimiento #${tx.transfer_pair_id}`}
                              className="chip bg-blue-50 text-blue-700 border border-blue-200"
                            >
                              Par #{tx.transfer_pair_id}
                            </span>
                          )}
                        </div>
                      </td>
                      <td
                        className={`py-3 px-4 whitespace-nowrap text-right font-bold ${
                          tx.is_internal_transfer
                            ? 'text-slate-500'
                            : tx.amount >= 0
                            ? 'text-emerald-600'
                            : 'text-ink'
                        }`}
                      >
                        {format(tx.amount, { signed: true })}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap text-right text-slate-500">
                        {tx.balance !== null ? format(tx.balance) : '—'}
                      </td>
                      <td className="py-3 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => requestDeleteSingle(tx)}
                          title="Eliminar movimiento"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Paginación */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-line flex items-center justify-between text-xs text-slate-600">
            <span>
              Página <strong>{page}</strong> de <strong>{totalPages}</strong>
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="btn-outline py-1 px-2.5 text-xs"
              >
                <ChevronLeft className="h-4 w-4" />
                Anterior
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="btn-outline py-1 px-2.5 text-xs"
              >
                Siguiente
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
