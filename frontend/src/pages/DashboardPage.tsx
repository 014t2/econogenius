import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowLeftRight,
  ArrowUpRight,
  Calendar,
  CheckCircle2,
  CreditCard,
  FileUp,
  Filter,
  Flame,
  Gauge,
  Link2,
  Pencil,
  PiggyBank,
  Plus,
  Repeat,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useCurrency } from '../context/CurrencyContext'
import { GROUP_META } from '../components/Layout'
import { AccountModal } from '../components/AccountModal'
import { OnboardingWizardModal } from '../components/OnboardingWizardModal'
import { PageTutorialBanner } from '../components/PageTutorialBanner'
import type { Summary } from '../types'

const DONUT_COLORS: Record<'needs' | 'wants' | 'savings', string> = {
  needs: '#2563EB', // Azul primario - Necesidades (50%)
  wants: '#F59E0B', // Ámbar - Ocio (30%)
  savings: '#10B981', // Esmeralda - Ahorro (20%)
}

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  checking: 'Cuenta Corriente',
  credit_card: 'Tarjeta de Crédito',
  joint: 'Cuenta Común',
  savings: 'Cuenta Ahorro',
}

export function DashboardPage() {
  const { accounts, workspace, reloadCatalog } = useAuth()
  const { format, convert } = useCurrency()
  const navigate = useNavigate()

  const [selectedAccountId, setSelectedAccountId] = useState<number | ''>('')
  const [selectedMonth, setSelectedMonth] = useState<string>('')
  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [accountModalOpen, setAccountModalOpen] = useState(false)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [settleModal, setSettleModal] = useState<{ owner?: string; amount: number; count: number } | null>(null)
  const [settlingDebt, setSettlingDebt] = useState(false)
  const [debtToast, setDebtToast] = useState<string | null>(null)

  // Huchas / Objetivos de Ahorro (Sinking Funds)
  const [goalName, setGoalName] = useState('')
  const [goalTarget, setGoalTarget] = useState('')
  const [goalCurrent, setGoalCurrent] = useState('')
  const [goalDate, setGoalDate] = useState('')
  const [goalFormOpen, setGoalFormOpen] = useState(false)

  const fetchSummary = useCallback(async () => {
    if (!workspace) return
    setLoading(true)
    try {
      const data = await Api.summary({
        account_id: selectedAccountId || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      })
      setSummary(data)
    } finally {
      setLoading(false)
    }
  }, [workspace, selectedAccountId, dateFrom, dateTo])

  useEffect(() => {
    fetchSummary()
  }, [fetchSummary])

  const handleSelectMonth = (ym: string) => {
    setSelectedMonth(ym)
    if (!ym) {
      setDateFrom('')
      setDateTo('')
      return
    }
    const [y, m] = ym.split('-').map(Number)
    const lastDay = new Date(y, m, 0).getDate()
    setDateFrom(`${ym}-01`)
    setDateTo(`${ym}-${String(lastDay).padStart(2, '0')}`)
  }

  const donutData = useMemo(() => {
    if (!summary) return []
    return summary.rule_503020.map((item) => ({
      ...item,
      convertedAmount: convert(item.amount),
      convertedTarget: convert(item.target_amount),
      color: DONUT_COLORS[item.key],
    }))
  }, [summary, convert])

  const monthlyData = useMemo(() => {
    if (!summary) return []
    return summary.monthly.map((m) => ({
      month: m.month,
      Ingresos: Number(convert(m.income).toFixed(2)),
      Necesidades: Number(convert(m.needs).toFixed(2)),
      Ocio: Number(convert(m.wants + m.other).toFixed(2)),
      Ahorro: Number(convert(Math.max(m.income - (m.needs + m.wants + m.other), m.savings, 0)).toFixed(2)),
    }))
  }, [summary, convert])

  const availableMonths = useMemo(() => {
    if (!summary) return []
    return summary.monthly.map((m) => m.month).reverse()
  }, [summary])

  return (
    <div className="space-y-6">
      <PageTutorialBanner
        pageId="dashboard"
        title="Tutorial del Dashboard · ¿Qué hay en esta página y cómo se utiliza?"
        subtitle="Resumen en tiempo real de tus saldos bancarios, regla 50/30/20, deudas de la Cuenta Común, suscripciones y huchas."
        steps={[
          {
            title: 'Filtra por Cuenta o Mes',
            badge: 'Barra superior',
            description:
              'Pulsa sobre «Todas» o sobre una cuenta concreta y elige un mes o rango de fechas para recalcular todos los indicadores al instante.',
          },
          {
            title: 'Saldos Reales y Tarjetas Vinculadas',
            badge: 'Saldo en Cuentas',
            description:
              'En cada tarjeta puedes indicar a qué cuenta bancaria pertenece para que sus gastos se descuenten automáticamente del saldo real de esa cuenta.',
          },
          {
            title: 'Liquidación de Cuenta Común',
            badge: 'Reembolsos',
            description:
              'Muestra el total acumulado que la Cuenta Común debe a cada titular por gastos pagados con tarjetas personales y el botón «Ya se ha saldado la deuda».',
          },
          {
            title: '50/30/20, Presupuestos, Suscripciones y Huchas',
            badge: 'Inteligencia',
            description:
              'Controla tu porcentaje de Necesidades/Ocio/Ahorro, fija topes mensuales con semáforo, detecta subidas en suscripciones y crea huchas de ahorro.',
          },
        ]}
        tip="Puedes pulsar el botón «Ocultar saldos» (o Alt+P) en la barra superior cuando quieras enseñar tu Dashboard sin mostrar las cifras en euros."
      />

      {/* Banner Inicial de Configuración Rápida si aún no hay cuentas */}
      {accounts.length === 0 && (
        <div className="card p-5 bg-gradient-to-r from-slate-900 to-slate-800 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
              <Sparkles className="h-4 w-4" />
              <span>Asistente de Bienvenida Multi-Banco</span>
            </div>
            <h2 className="text-base sm:text-lg font-bold">
              Configura €conogenius para uso Individual, En Pareja o en Familia en 3 pasos
            </h2>
            <p className="text-xs text-slate-300">
              Personaliza los nombres de los titulares, sus bancos, sus tarjetas vinculadas y la regla de ahorro
              (50/30/20, 60/20/20, 70/20/10 o personalizada).
            </p>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setWizardOpen(true)}
              className="btn bg-emerald-500 hover:bg-emerald-600 text-white font-semibold"
            >
              <Sparkles className="h-4 w-4" />
              <span>Abrir Asistente de Bienvenida (3 pasos)</span>
            </button>
            <button
              type="button"
              onClick={() => setAccountModalOpen(true)}
              className="btn bg-slate-700 hover:bg-slate-600 text-white"
            >
              <Plus className="h-4 w-4" />
              <span>Añadir cuenta (1 o Cuenta + Tarjeta)</span>
            </button>
          </div>
        </div>
      )}

      {/* Barra de Filtros: Cuenta + Mes / Rango de Fechas */}
      <div className="card p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 mr-1">
            <Filter className="h-3.5 w-3.5" />
            Cuenta:
          </span>
          <button
            type="button"
            onClick={() => setSelectedAccountId('')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
              selectedAccountId === ''
                ? 'bg-primary text-white shadow-sm'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Todas ({accounts.length})
          </button>
          {accounts.map((acc) => (
            <button
              key={acc.id}
              type="button"
              onClick={() => setSelectedAccountId(acc.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 ${
                selectedAccountId === acc.id
                  ? 'bg-primary-accent text-white shadow-sm'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {acc.type === 'credit_card' ? (
                <CreditCard className="h-3.5 w-3.5" />
              ) : acc.type === 'joint' ? (
                <Users className="h-3.5 w-3.5" />
              ) : (
                <Wallet className="h-3.5 w-3.5" />
              )}
              <span>{acc.name}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setAccountModalOpen(true)}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold border border-dashed border-slate-300 text-primary-accent hover:bg-blue-50 transition flex items-center gap-1"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Nueva cuenta</span>
          </button>
          <button
            type="button"
            onClick={() => setWizardOpen(true)}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-50 border border-emerald-200 text-emerald-800 hover:bg-emerald-100 transition flex items-center gap-1"
          >
            <Sparkles className="h-3.5 w-3.5 text-emerald-600" />
            <span>Asistente Pareja / Familia</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Calendar className="h-4 w-4 text-slate-400 hidden sm:block" />
          <select
            aria-label="Filtrar por mes"
            value={selectedMonth}
            onChange={(e) => handleSelectMonth(e.target.value)}
            className="input w-auto py-1.5 text-xs"
          >
            <option value="">Todos los meses</option>
            {availableMonths.map((m) => (
              <option key={m} value={m}>
                Mes {m}
              </option>
            ))}
          </select>
          <input
            type="date"
            aria-label="Fecha desde"
            value={dateFrom}
            onChange={(e) => {
              setSelectedMonth('')
              setDateFrom(e.target.value)
            }}
            className="input w-auto py-1.5 text-xs"
          />
          <span className="text-xs text-slate-400">—</span>
          <input
            type="date"
            aria-label="Fecha hasta"
            value={dateTo}
            onChange={(e) => {
              setSelectedMonth('')
              setDateTo(e.target.value)
            }}
            className="input w-auto py-1.5 text-xs"
          />
          {(dateFrom || dateTo || selectedAccountId !== '') && (
            <button
              type="button"
              onClick={() => {
                setSelectedAccountId('')
                setSelectedMonth('')
                setDateFrom('')
                setDateTo('')
              }}
              className="btn-ghost text-xs py-1.5 px-2.5"
            >
              Limpiar
            </button>
          )}
        </div>
      </div>

      {/* KPIs Principales */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="card p-5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ingresos Reales</span>
            <span className="p-2 rounded-xl bg-emerald-50 text-emerald-600">
              <ArrowUpRight className="h-4 w-4" />
            </span>
          </div>
          <div className="text-2xl font-bold text-ink">{format(summary?.kpis.income ?? 0)}</div>
          <div className="text-xs text-slate-500">
            Excluye traspasos internos entre cuentas
          </div>
        </div>

        <div className="card p-5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Gastos Reales</span>
            <span className="p-2 rounded-xl bg-red-50 text-red-600">
              <ArrowDownRight className="h-4 w-4" />
            </span>
          </div>
          <div className="text-2xl font-bold text-ink">{format(summary?.kpis.expenses ?? 0)}</div>
          <div className="text-xs text-slate-500">
            Necesidades + Ocio (sin liquidaciones de tarjeta)
          </div>
        </div>

        <div className="card p-5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ahorro Neto</span>
            <span className="p-2 rounded-xl bg-blue-50 text-blue-600">
              <PiggyBank className="h-4 w-4" />
            </span>
          </div>
          <div
            className={`text-2xl font-bold ${
              (summary?.kpis.net_savings ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600'
            }`}
          >
            {format(summary?.kpis.net_savings ?? 0, { signed: true })}
          </div>
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Tasa: {summary?.kpis.savings_rate ?? 0}%</span>
            <span>Invertido: {format(summary?.kpis.invested ?? 0)}</span>
          </div>
        </div>

        <div className="card p-5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Saldo en Cuentas</span>
            <span className="p-2 rounded-xl bg-slate-100 text-slate-700">
              <Wallet className="h-4 w-4" />
            </span>
          </div>
          <div className="text-2xl font-bold text-ink">{format(summary?.kpis.total_balance ?? 0)}</div>
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <ArrowLeftRight className="h-3.5 w-3.5 text-slate-400" />
            <span>Traspasos excluidos: {format(summary?.kpis.internal_transfers ?? 0)}</span>
          </div>
        </div>
      </div>

      {/* Apartado de Saldo de las Cuentas y Vinculación de Tarjetas */}
      {summary && summary.balances.length > 0 && (
        <div className="card p-5 space-y-3.5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-ink flex items-center gap-2">
                <Wallet className="h-4 w-4 text-primary-accent" />
                <span>Saldo de las Cuentas y Vinculación de Tarjetas</span>
              </h2>
              <p className="text-xs text-slate-500">
                Si una tarjeta pertenece a una cuenta bancaria, indícalo aquí para que sus gastos repercutan y se descuenten automáticamente del saldo de la cuenta.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {summary.balances.map((b) => {
              const bankAccounts = accounts.filter(
                (a) => a.type !== 'credit_card' && a.id !== b.account_id
              )
              const linkedCards = b.linked_cards ?? []
              const hasLinkedCards = linkedCards.length > 0
              const baseBalance = b.base_balance ?? b.current_balance
              const cardsImpact = b.linked_cards_balance ?? 0

              return (
                <div
                  key={b.account_id}
                  onClick={() => setSelectedAccountId(selectedAccountId === b.account_id ? '' : b.account_id)}
                  className={`p-3.5 rounded-2xl border text-left cursor-pointer transition flex flex-col justify-between gap-2.5 ${
                    selectedAccountId === b.account_id
                      ? 'bg-blue-50/40 ring-2 ring-primary-accent border-primary-accent'
                      : 'bg-slate-50/70 border-line hover:border-primary-accent'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span className="font-medium truncate">
                        {ACCOUNT_TYPE_LABELS[b.type] ?? b.type}
                        {b.bank ? ` · ${b.bank}` : ''}
                      </span>
                      <button
                        type="button"
                        title="Modificar saldo base en el banco"
                        onClick={async (e) => {
                          e.stopPropagation()
                          const input = prompt(
                            `Introduce el saldo base en el banco (EUR €) para «${b.name}»:`,
                            String(baseBalance)
                          )
                          if (input === null) return
                          const val = parseFloat(input.replace(',', '.'))
                          if (!Number.isFinite(val)) return
                          await Api.updateAccount(b.account_id, { current_balance: val })
                          await reloadCatalog()
                          await fetchSummary()
                        }}
                        className="p-1 rounded-lg text-slate-400 hover:text-primary-accent hover:bg-blue-50"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="font-bold text-sm text-ink mt-0.5 truncate">{b.name}</div>
                    <div
                      className={`text-lg font-bold mt-1 ${
                        b.current_balance >= 0 ? 'text-ink' : 'text-red-600'
                      }`}
                    >
                      {format(b.current_balance)}
                    </div>
                  </div>

                  {/* Si es una cuenta bancaria con tarjetas vinculadas: muestra desglose del impacto */}
                  {b.type !== 'credit_card' && hasLinkedCards && (
                    <div className="pt-2 border-t border-slate-200/80 space-y-1 text-[11px]">
                      <div className="flex items-center justify-between text-slate-500">
                        <span>Saldo base cuenta:</span>
                        <span className="font-semibold text-slate-700">{format(baseBalance)}</span>
                      </div>
                      <div className="flex items-center justify-between text-amber-800">
                        <span className="truncate pr-1">
                          Tarjeta ({linkedCards.map((c) => c.name).join(', ')}):
                        </span>
                        <span className="font-bold shrink-0">{format(cardsImpact, { signed: true })}</span>
                      </div>
                    </div>
                  )}

                  {/* Si es una tarjeta: permite indicar a qué cuenta del banco pertenece */}
                  {b.type === 'credit_card' && (
                    <div
                      className="pt-2 border-t border-slate-200/80 space-y-1.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <label className="flex items-center gap-1 text-[11px] font-semibold text-slate-600">
                        <Link2 className="h-3 w-3 text-primary-accent shrink-0" />
                        <span>¿Pertenece a una cuenta del banco?</span>
                      </label>
                      <select
                        aria-label={`Cuenta bancaria a la que pertenece ${b.name}`}
                        value={b.linked_account_id ?? ''}
                        onChange={async (e) => {
                          const val = e.target.value ? Number(e.target.value) : null
                          await Api.updateAccount(b.account_id, { linked_account_id: val })
                          await reloadCatalog()
                          await fetchSummary()
                        }}
                        className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-ink focus:border-primary-accent focus:outline-none"
                      >
                        <option value="">Tarjeta independiente (sin vincular)</option>
                        {bankAccounts.map((acc) => (
                          <option key={acc.id} value={acc.id}>
                            Misma cuenta: {acc.name} ({acc.bank})
                          </option>
                        ))}
                      </select>
                      {b.linked_account_name ? (
                        <div className="text-[10px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-0.5">
                          Sus gastos repercuten en el saldo de «{b.linked_account_name}»
                        </div>
                      ) : (
                        <div className="text-[10px] text-amber-700">
                          Selecciona su cuenta si sus gastos descuentan de ella
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Apartado de Reembolsos: ¿Cuánto debe la Cuenta Común a cada usuario? */}
      <div className="card p-6 border-purple-200 bg-gradient-to-br from-white via-white to-purple-50/40 space-y-4">
        {debtToast && (
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-2.5 text-xs font-semibold text-emerald-800 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            <span>{debtToast}</span>
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-2xl bg-purple-100 text-purple-700 shrink-0">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-bold text-ink">
                  Liquidación Cuenta Común · ¿Cuánto le debe la Cuenta Común a cada uno?
                </h2>
                <span className="chip bg-purple-600 text-white font-semibold">
                  Total deuda pendiente: {format(summary?.joint_debts?.total_pending ?? 0)}
                </span>
                {(summary?.joint_debts?.total_settled ?? 0) > 0 && (
                  <span className="chip bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">
                    Total ya saldado: {format(summary?.joint_debts?.total_settled ?? 0)}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Total que la Cuenta Común debe reembolsar a cada titular por compras o recibos domiciliados pagados con
                tarjetas o cuentas personales.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {(summary?.joint_debts?.total_pending ?? 0) > 0 && (
              <button
                type="button"
                onClick={() =>
                  setSettleModal({
                    amount: summary?.joint_debts?.total_pending ?? 0,
                    count:
                      summary?.joint_debts?.by_owner.reduce((acc, o) => acc + o.pending_count, 0) ?? 0,
                  })
                }
                className="btn bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>Ya se ha saldado toda la deuda ({format(summary?.joint_debts?.total_pending ?? 0)})</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => navigate('/transactions?owed_by_joint=pending')}
              className="btn-outline text-xs"
            >
              Ver / editar gastos en Transacciones
            </button>
          </div>
        </div>

        {summary?.joint_debts && summary.joint_debts.by_owner.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {summary.joint_debts.by_owner.map((ownerDebt) => {
              const hasPending = ownerDebt.pending_amount > 0
              return (
                <div
                  key={ownerDebt.owner}
                  className={`rounded-2xl border p-4 shadow-sm space-y-3 flex flex-col justify-between ${
                    hasPending
                      ? 'border-purple-300 bg-white'
                      : 'border-slate-200 bg-slate-50/70'
                  }`}
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-purple-700">
                          Total que la Cuenta Común debe a
                        </span>
                        <h3 className="text-lg font-bold text-ink">{ownerDebt.owner}</h3>
                        {ownerDebt.settled_amount > 0 && (
                          <div className="text-[11px] text-emerald-700 font-medium mt-0.5">
                            ✓ Ya saldado anteriormente: {format(ownerDebt.settled_amount)}
                          </div>
                        )}
                      </div>
                      <div className="text-right">
                        <div
                          className={`text-2xl font-extrabold ${
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
                            : 'Sin deuda pendiente'}
                        </div>
                      </div>
                    </div>

                    {hasPending && (
                      <>
                        {/* Desglose por cuenta / tarjeta personal */}
                        <div className="flex flex-wrap gap-1.5">
                          {ownerDebt.accounts.map((acc) => (
                            <span
                              key={acc.account_id}
                              className="chip bg-purple-50 text-purple-800 border border-purple-200 font-medium"
                            >
                              Pagado con {acc.account_name} ({acc.bank}): {format(acc.amount)}
                            </span>
                          ))}
                        </div>

                        {/* Lista de gastos concretos */}
                        <div className="max-h-40 overflow-y-auto divide-y divide-line border border-line rounded-xl bg-slate-50/60 text-xs">
                          {ownerDebt.items.map((it) => (
                            <div key={it.id} className="px-3 py-2 flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <div className="font-medium text-ink truncate">{it.concept}</div>
                                <div className="text-[10px] text-slate-400">
                                  {it.operation_date} · {it.account_name}
                                </div>
                              </div>
                              <div className="font-bold text-purple-800 shrink-0">{format(it.amount)}</div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>

                  <div className="pt-3 border-t border-line flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <span className="text-xs text-slate-600">
                      {hasPending ? (
                        <>
                          Total a transferir de Cuenta Común a <strong>{ownerDebt.owner}</strong>:{' '}
                          <strong className="text-purple-800">{format(ownerDebt.pending_amount)}</strong>
                        </>
                      ) : (
                        <span className="text-emerald-700 font-medium">
                          ✓ La Cuenta Común está al día con {ownerDebt.owner}
                        </span>
                      )}
                    </span>
                    {hasPending ? (
                      <button
                        type="button"
                        onClick={() =>
                          setSettleModal({
                            owner: ownerDebt.owner,
                            amount: ownerDebt.pending_amount,
                            count: ownerDebt.pending_count,
                          })
                        }
                        className="btn bg-purple-600 hover:bg-purple-700 text-white py-2 px-3.5 text-xs font-semibold shrink-0"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        <span>Ya se ha saldado la deuda ({format(ownerDebt.pending_amount)})</span>
                      </button>
                    ) : (
                      <span className="chip bg-emerald-100 text-emerald-800 border border-emerald-200 font-semibold shrink-0">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>Deuda saldada</span>
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-purple-200 bg-white/80 p-4 text-xs text-slate-600">
            <strong>No hay deudas pendientes de la Cuenta Común en este momento.</strong> Cuando subas un Excel/PDF o
            edites un movimiento en <em>Transacciones</em>, pulsa <strong>«Me lo debe C. Común»</strong> en cualquier
            compra o recibo domiciliado para que se sume aquí automáticamente.
          </div>
        )}
      </div>

      {/* Modal de Confirmación para Saldar Deuda de la Cuenta Común */}
      {settleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="card w-full max-w-md p-6 space-y-4 animate-fade-up">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-2xl bg-purple-100 text-purple-700 flex items-center justify-center shrink-0">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-ink">
                  {settleModal.owner
                    ? `¿Confirmar que se ha saldado la deuda con ${settleModal.owner}?`
                    : '¿Confirmar que se ha saldado toda la deuda de la Cuenta Común?'}
                </h3>
                <p className="text-xs text-slate-600 mt-1">
                  Se marcarán como <strong>Ya reembolsados</strong> los{' '}
                  <strong>{settleModal.count} gastos pendientes</strong> por un importe total de{' '}
                  <strong className="text-purple-700">{format(settleModal.amount)}</strong>
                  {settleModal.owner ? ` a favor de ${settleModal.owner}` : ''}.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-line">
              <button
                type="button"
                disabled={settlingDebt}
                onClick={() => setSettleModal(null)}
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
                      settleModal.owner ? { owner: settleModal.owner } : {}
                    )
                    const settledTarget = settleModal.owner ?? 'todos los titulares'
                    setSettleModal(null)
                    setDebtToast(
                      `Deuda saldada con ${settledTarget}: ${format(res.settled_amount)} (${res.settled_count} gastos marcados como reembolsados).`
                    )
                    setTimeout(() => setDebtToast(null), 4500)
                    await fetchSummary()
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
                    : `Sí, deuda saldada (${format(settleModal.amount)})`}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      <AccountModal
        open={accountModalOpen}
        onClose={() => setAccountModalOpen(false)}
        onCreated={() => fetchSummary()}
      />

      <OnboardingWizardModal
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onCompleted={() => fetchSummary()}
      />

      {/* Gráfico Donut 50/30/20 + Comparativa Real vs Objetivo */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="card p-6 lg:col-span-7 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-ink">Regla 50 / 30 / 20 (Real vs Objetivo)</h2>
              <p className="text-xs text-slate-500">
                Distribución sobre ingresos reales ({format(summary?.kpis.income ?? 0)}). Las transferencias internas
                quedan excluidas.
              </p>
            </div>
            {(summary?.unclassified_expenses ?? 0) > 0 && (
              <button
                type="button"
                onClick={() => navigate('/transactions?uncategorized=1')}
                className="chip bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100"
              >
                Sin categorizar: {format(summary?.unclassified_expenses ?? 0)}
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
            <div className="md:col-span-5 h-60">
              {donutData.some((d) => d.amount > 0) ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={donutData}
                      dataKey="convertedAmount"
                      nameKey="label"
                      innerRadius={58}
                      outerRadius={86}
                      paddingAngle={4}
                    >
                      {donutData.map((entry) => (
                        <Cell key={entry.key} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(val: number, name: string) => [
                        format(val / (convert(1) || 1)),
                        name,
                      ]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center p-4 border border-dashed border-line rounded-2xl text-slate-400 text-xs">
                  <FileUp className="h-7 w-7 mb-2 text-slate-300" />
                  <span>Sube un extracto bancario (PDF, Excel o CSV) o añade movimientos para visualizar el análisis 50/30/20.</span>
                </div>
              )}
            </div>

            <div className="md:col-span-7 space-y-4">
              {donutData.map((bucket) => {
                const isSavings = bucket.key === 'savings'
                const overTarget = !isSavings && bucket.actual_pct > bucket.target_pct
                const metSavings = isSavings && bucket.actual_pct >= bucket.target_pct
                return (
                  <div key={bucket.key} className="p-3.5 rounded-xl border border-line bg-slate-50/60 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-3 w-3 rounded-full"
                          style={{ backgroundColor: bucket.color }}
                        />
                        <span className="text-sm font-bold text-ink">{bucket.label}</span>
                        <span className="chip bg-white border border-line text-slate-600">
                          Objetivo {bucket.target_pct}%
                        </span>
                      </div>
                      <span
                        className={`text-sm font-bold ${
                          overTarget
                            ? 'text-red-600'
                            : metSavings
                            ? 'text-emerald-600'
                            : 'text-ink'
                        }`}
                      >
                        {bucket.actual_pct}% ({format(bucket.amount)})
                      </span>
                    </div>

                    <div className="w-full h-2.5 bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${Math.min(100, bucket.actual_pct)}%`,
                          backgroundColor: overTarget ? '#EF4444' : bucket.color,
                        }}
                      />
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-500">
                      <span>Objetivo ideal: {format(bucket.target_amount)}</span>
                      <span>
                        {overTarget
                          ? `Exceso de ${format(bucket.amount - bucket.target_amount)}`
                          : `Margen: ${format(Math.max(0, bucket.target_amount - bucket.amount))}`}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Top Subcategorías de Gasto */}
        <div className="card p-6 lg:col-span-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-ink">Top Subcategorías de Gasto</h2>
              <p className="text-xs text-slate-500">Mayores partidas reales del período seleccionado</p>
            </div>
            <TrendingUp className="h-4 w-4 text-slate-400" />
          </div>

          {summary && summary.top_categories.length > 0 ? (
            <div className="space-y-3">
              {summary.top_categories.slice(0, 7).map((cat) => {
                const pctOfSpend =
                  summary.kpis.expenses > 0
                    ? Math.round((cat.amount / summary.kpis.expenses) * 100)
                    : 0
                const meta = GROUP_META[cat.group] ?? {
                  label: 'Sin clasificar',
                  badgeClass: 'bg-slate-100 text-slate-600',
                  color: '#64748B',
                }
                return (
                  <div key={`${cat.category_id}-${cat.name}`} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-semibold text-ink truncate">{cat.name}</span>
                        <span className={`chip ${meta.badgeClass}`}>{cat.count} mov.</span>
                      </div>
                      <div className="font-bold text-ink shrink-0">
                        {format(cat.amount)}{' '}
                        <span className="text-slate-400 font-normal">({pctOfSpend}%)</span>
                      </div>
                    </div>
                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(4, pctOfSpend)}%`,
                          backgroundColor: meta.color,
                        }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="h-52 flex items-center justify-center text-xs text-slate-400 border border-dashed border-line rounded-2xl">
              {loading ? 'Cargando métricas...' : 'No hay gastos registrados en este rango.'}
            </div>
          )}
        </div>
      </div>

      {/* Gráfico de Barras Apiladas de Evolución Mensual */}
      <div className="card p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-ink">Evolución Mensual Apilada (Ingresos vs 50/30/20)</h2>
            <p className="text-xs text-slate-500">
              Comparativa mensual de Ingresos Reales frente a Necesidades, Ocio y Ahorro Neto
            </p>
          </div>
        </div>

        <div className="h-72 w-full">
          {monthlyData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#475569' }} />
                <YAxis tick={{ fontSize: 12, fill: '#475569' }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Ingresos" fill="#0F172A" radius={[6, 6, 0, 0]} />
                <Bar dataKey="Necesidades" stackId="503020" fill="#2563EB" />
                <Bar dataKey="Ocio" stackId="503020" fill="#F59E0B" />
                <Bar dataKey="Ahorro" stackId="503020" fill="#10B981" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-xs text-slate-400 border border-dashed border-line rounded-2xl">
              Sin serie histórica todavía. Importa tus extractos mensuales para ver la evolución.
            </div>
          )}
        </div>
      </div>

      {/* Presupuestos por Categoría + Semáforo y Proyección Lineal a Día 30 (Cash-Flow Forecast) */}
      <div className="card p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-start gap-2.5">
            <div className="p-2 rounded-xl bg-blue-50 text-primary-accent shrink-0">
              <Gauge className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-ink">
                Presupuestos por Categoría · Semáforo y Proyección a Fin de Mes (Día 30)
              </h2>
              <p className="text-xs text-slate-500">
                Configura un tope mensual (ej. Restaurantes 200 €, Alimentos 400 €). Semáforo: Verde (&lt;80%), Ámbar
                (80-100%), Rojo (&gt;100%) + estimación lineal a día 30.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => navigate('/settings')}
            className="btn-outline text-xs shrink-0"
          >
            Configurar todas las categorías
          </button>
        </div>

        {summary?.category_budgets && summary.category_budgets.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {summary.category_budgets.map((cb) => {
              const hasBudget = cb.monthly_budget !== null && cb.monthly_budget > 0
              const barColor =
                cb.status === 'exceeded'
                  ? '#EF4444'
                  : cb.status === 'warning'
                  ? '#F59E0B'
                  : cb.status === 'ok'
                  ? '#10B981'
                  : '#64748B'
              const badgeStyle =
                cb.status === 'exceeded'
                  ? 'bg-red-100 text-red-800 border-red-200'
                  : cb.status === 'warning'
                  ? 'bg-amber-100 text-amber-800 border-amber-200'
                  : cb.status === 'ok'
                  ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                  : 'bg-slate-100 text-slate-600 border-slate-200'

              return (
                <div
                  key={cb.category_id}
                  className="p-4 rounded-2xl border border-line bg-slate-50/70 space-y-2.5 flex flex-col justify-between"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-ink truncate">{cb.name}</div>
                        <div className="text-[11px] text-slate-500">Mes activo: {cb.month}</div>
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          const raw = prompt(
                            `Presupuesto mensual (EUR €) para «${cb.name}» (deja vacío o 0 para quitar tope):`,
                            cb.monthly_budget ? String(cb.monthly_budget) : '250'
                          )
                          if (raw === null) return
                          const val = raw.trim() === '' ? null : parseFloat(raw.replace(',', '.'))
                          await Api.updateCategory(cb.category_id, {
                            monthly_budget: val && val > 0 ? val : null,
                          })
                          await reloadCatalog()
                          await fetchSummary()
                        }}
                        className="chip bg-white border border-line text-slate-700 hover:border-primary-accent cursor-pointer shrink-0"
                        title="Configurar tope mensual"
                      >
                        <Pencil className="h-3 w-3" />
                        <span>{hasBudget ? `Tope: ${format(cb.monthly_budget!)}` : '+ Fijar tope'}</span>
                      </button>
                    </div>

                    <div className="flex items-baseline justify-between">
                      <div>
                        <span className="text-xs text-slate-500">Gastado: </span>
                        <span className="text-sm font-bold text-ink">{format(cb.spent)}</span>
                      </div>
                      {hasBudget && (
                        <span className={`chip border font-bold ${badgeStyle}`}>
                          {cb.pct}%{' '}
                          {cb.status === 'exceeded'
                            ? '· Superado'
                            : cb.status === 'warning'
                            ? '· En alerta'
                            : '· Saludable'}
                        </span>
                      )}
                    </div>

                    {hasBudget && (
                      <div className="w-full h-2.5 bg-slate-200 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${Math.min(100, cb.pct)}%`,
                            backgroundColor: barColor,
                          }}
                        />
                      </div>
                    )}
                  </div>

                  <div className="pt-2 border-t border-slate-200/80 flex items-center justify-between text-[11px]">
                    <span className="text-slate-500">Proyección día 30:</span>
                    <span
                      className={`font-bold ${
                        cb.projected_status === 'exceeded'
                          ? 'text-red-600'
                          : cb.projected_status === 'warning'
                          ? 'text-amber-700'
                          : 'text-slate-700'
                      }`}
                    >
                      {format(cb.projected_amount)}
                      {hasBudget ? ` (${cb.projected_pct}%)` : ''}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-line p-4 text-xs text-slate-500">
            Aún no hay gastos categorizados ni presupuestos configurados. Puedes fijar un presupuesto mensual en
            cualquier categoría desde <em>Cuentas y Reglas</em>.
          </div>
        )}
      </div>

      {/* Detector Automático de Suscripciones / Gastos Fijos y Gastos Hormiga / Vampiro + Huchas de Ahorro */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Detector de Suscripciones y Gastos Hormiga */}
        <div className="card p-6 lg:col-span-7 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-start gap-2.5">
              <div className="p-2 rounded-xl bg-amber-50 text-amber-600 shrink-0">
                <Repeat className="h-5 w-5" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-bold text-ink">
                    Gastos Fijos, Suscripciones y «Gastos Hormiga» Detectados
                  </h2>
                  {(summary?.subscriptions_and_vampires?.price_increase_alerts ?? 0) > 0 && (
                    <span className="chip bg-red-100 text-red-800 border border-red-200 font-bold">
                      <AlertTriangle className="h-3 w-3" />
                      <span>
                        {summary?.subscriptions_and_vampires?.price_increase_alerts} subida(s) de precio
                      </span>
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500">
                  Coste fijo mensual estimado:{' '}
                  <strong className="text-ink">
                    {format(summary?.subscriptions_and_vampires?.total_monthly_subscriptions ?? 0)}/mes
                  </strong>{' '}
                  · Proyección anual:{' '}
                  <strong className="text-amber-700">
                    {format(summary?.subscriptions_and_vampires?.total_annual_subscriptions ?? 0)}/año
                  </strong>
                </p>
              </div>
            </div>
          </div>

          {summary?.subscriptions_and_vampires &&
          (summary.subscriptions_and_vampires.subscriptions.length > 0 ||
            summary.subscriptions_and_vampires.ant_expenses.length > 0) ? (
            <div className="space-y-4">
              {summary.subscriptions_and_vampires.subscriptions.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Suscripciones y Recibos Periódicos ({summary.subscriptions_and_vampires.subscriptions.length})
                  </div>
                  <div className="divide-y divide-line border border-line rounded-2xl bg-slate-50/60 max-h-64 overflow-y-auto">
                    {summary.subscriptions_and_vampires.subscriptions.map((sub) => (
                      <div
                        key={sub.merchant}
                        className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-ink truncate">{sub.merchant}</span>
                            <span className="chip bg-white border border-line text-slate-600">
                              {sub.category_name}
                            </span>
                            <span className="chip bg-blue-50 text-blue-700">
                              {sub.frequency === 'annual' ? 'Anual' : 'Mensual'} · {sub.occurrences}x
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500 truncate mt-0.5">
                            Último cargo ({sub.last_date}): {sub.sample_concept}
                          </div>
                          {sub.price_increase && (
                            <div className="inline-flex items-center gap-1 text-[11px] font-bold text-red-600 mt-1">
                              <AlertTriangle className="h-3.5 w-3.5" />
                              <span>
                                ¡Ha subido +{format(sub.price_diff)} respecto al cargo anterior (
                                {format(sub.prev_amount ?? 0)} → {format(sub.last_amount)})!
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-bold text-sm text-ink">{format(sub.monthly_cost)}/mes</div>
                          <div className="text-[11px] font-semibold text-amber-700">
                            {format(sub.annual_cost)}/año
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {summary.subscriptions_and_vampires.ant_expenses.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                      <Flame className="h-3.5 w-3.5 text-rose-500" />
                      <span>Microgastos / «Gastos Hormiga» (≤ 20 €)</span>
                    </span>
                    <span className="font-semibold text-rose-700">
                      Total acumulado: {format(summary.subscriptions_and_vampires.total_ant_expenses)}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {summary.subscriptions_and_vampires.ant_expenses.slice(0, 6).map((ant) => (
                      <div
                        key={ant.merchant}
                        className="p-2.5 rounded-xl border border-rose-100 bg-rose-50/40 flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="font-bold text-ink truncate">{ant.merchant}</div>
                          <div className="text-[10px] text-slate-500">
                            {ant.occurrences} compras · media {format(ant.avg_amount)}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-bold text-rose-700">{format(ant.total_spent)}</div>
                          <div className="text-[10px] text-slate-500">~{format(ant.annual_cost)}/año</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="h-44 flex items-center justify-center text-xs text-slate-400 border border-dashed border-line rounded-2xl">
              Sube tus extractos para que el motor detecte automáticamente suscripciones, recibos fijos y gastos hormiga.
            </div>
          )}
        </div>

        {/* Huchas u Objetivos de Ahorro (Sinking Funds) */}
        <div className="card p-6 lg:col-span-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-start gap-2.5">
              <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600 shrink-0">
                <Target className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-ink">Huchas y Objetivos de Ahorro</h2>
                <p className="text-xs text-slate-500">
                  Separa tu ahorro en metas (Vacaciones, ITV/Seguro, Amortizar hipoteca) y calcula cuánto aportar al mes.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setGoalFormOpen((v) => !v)}
              className="btn-accent py-1.5 px-3 text-xs shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Nueva hucha</span>
            </button>
          </div>

          {goalFormOpen && (
            <form
              onSubmit={async (e) => {
                e.preventDefault()
                if (!goalName.trim() || !goalTarget) return
                await Api.createSavingsGoal({
                  name: goalName.trim(),
                  target_amount: parseFloat(goalTarget.replace(',', '.')) || 0,
                  current_amount: parseFloat(goalCurrent.replace(',', '.')) || 0,
                  target_date: goalDate || null,
                })
                setGoalName('')
                setGoalTarget('')
                setGoalCurrent('')
                setGoalDate('')
                setGoalFormOpen(false)
                await fetchSummary()
              }}
              className="p-3.5 rounded-2xl border border-emerald-200 bg-emerald-50/50 space-y-2.5 text-xs"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="label">Nombre de la meta *</label>
                  <input
                    type="text"
                    required
                    placeholder="Ej. Vacaciones Verano / Seguro Coche"
                    value={goalName}
                    onChange={(e) => setGoalName(e.target.value)}
                    className="input text-xs bg-white"
                  />
                </div>
                <div>
                  <label className="label">Objetivo total (€) *</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    placeholder="Ej. 1500"
                    value={goalTarget}
                    onChange={(e) => setGoalTarget(e.target.value)}
                    className="input text-xs bg-white"
                  />
                </div>
                <div>
                  <label className="label">Ya ahorrado (€)</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="0"
                    value={goalCurrent}
                    onChange={(e) => setGoalCurrent(e.target.value)}
                    className="input text-xs bg-white"
                  />
                </div>
                <div>
                  <label className="label">Fecha objetivo</label>
                  <input
                    type="date"
                    value={goalDate}
                    onChange={(e) => setGoalDate(e.target.value)}
                    className="input text-xs bg-white"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setGoalFormOpen(false)}
                  className="btn-outline py-1 px-2.5 text-xs"
                >
                  Cancelar
                </button>
                <button type="submit" className="btn bg-emerald-600 hover:bg-emerald-700 text-white py-1 px-3 text-xs">
                  Crear hucha
                </button>
              </div>
            </form>
          )}

          {summary?.savings_goals && summary.savings_goals.length > 0 ? (
            <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
              {summary.savings_goals.map((g) => (
                <div
                  key={g.id}
                  className="p-3.5 rounded-2xl border border-line bg-slate-50/70 space-y-2 text-xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-bold text-sm text-ink">{g.name}</div>
                      <div className="text-[11px] text-slate-500">
                        {format(g.current_amount)} de {format(g.target_amount)} ({g.progress_pct}%)
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={async () => {
                          const raw = prompt(
                            `¿Cuánto quieres aportar (o restar con signo -) a la hucha «${g.name}»?`,
                            '100'
                          )
                          if (raw === null) return
                          const val = parseFloat(raw.replace(',', '.'))
                          if (!Number.isFinite(val)) return
                          await Api.updateSavingsGoal(g.id, { add_amount: val })
                          await fetchSummary()
                        }}
                        className="chip bg-emerald-100 text-emerald-800 border border-emerald-200 font-semibold hover:bg-emerald-200 cursor-pointer"
                      >
                        + Aportar
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await Api.deleteSavingsGoal(g.id)
                          await fetchSummary()
                        }}
                        className="p-1 text-slate-400 hover:text-red-600"
                        title="Eliminar hucha"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="w-full h-2.5 bg-slate-200 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all"
                      style={{ width: `${Math.min(100, g.progress_pct)}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-600">
                    <span>Faltan: {format(g.remaining_amount)}</span>
                    {g.monthly_needed !== null && g.months_left !== null ? (
                      <span className="font-bold text-emerald-700">
                        Aportar {format(g.monthly_needed)}/mes ({g.months_left} mes{g.months_left === 1 ? '' : 'es'})
                      </span>
                    ) : (
                      <span>Sin fecha límite</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="h-44 flex flex-col items-center justify-center text-center p-4 text-xs text-slate-400 border border-dashed border-line rounded-2xl">
              <PiggyBank className="h-7 w-7 mb-1.5 text-slate-300" />
              <span>
                Crea tu primera hucha virtual (ej. Vacaciones, Fondo ITV/Seguro, Entrada de piso) para saber cuánto
                apartar cada mes.
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
