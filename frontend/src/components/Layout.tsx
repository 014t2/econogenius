import React, { useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  ArrowLeftRight,
  Building2,
  Coins,
  Eye,
  EyeOff,
  FileUp,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  Settings2,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  Wallet,
  X,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { CURRENCIES, type CurrencyCode, useCurrency } from '../context/CurrencyContext'
import { Api } from '../api/client'
import type { Member } from '../types'

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard 50/30/20', icon: LayoutDashboard },
  { to: '/transactions', label: 'Transacciones', icon: ArrowLeftRight },
  { to: '/import', label: 'Subir Extracto', icon: FileUp },
  { to: '/settings', label: 'Cuentas y Reglas', icon: Settings2 },
]

export const GROUP_META: Record<
  string,
  { label: string; badgeClass: string; color: string }
> = {
  needs: {
    label: 'Necesidades (50%)',
    badgeClass: 'bg-blue-50 text-blue-700 border border-blue-200',
    color: '#2563EB',
  },
  wants: {
    label: 'Ocio (30%)',
    badgeClass: 'bg-amber-50 text-amber-700 border border-amber-200',
    color: '#F59E0B',
  },
  savings: {
    label: 'Ahorro (20%)',
    badgeClass: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
    color: '#10B981',
  },
  income: {
    label: 'Ingresos',
    badgeClass: 'bg-teal-50 text-teal-700 border border-teal-200',
    color: '#059669',
  },
  transfer: {
    label: 'Transferencia Interna',
    badgeClass: 'bg-slate-100 text-slate-700 border border-slate-300',
    color: '#64748B',
  },
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, workspace, selectWorkspace, createSharedWorkspace, deleteWorkspace, logout } = useAuth()
  const { currency, setCurrency, rates, setCustomRate, rateSource, privacyMode, togglePrivacyMode } = useCurrency()
  const navigate = useNavigate()
  const location = useLocation()

  const [mobileOpen, setMobileOpen] = useState(false)
  const [rateOpen, setRateOpen] = useState(false)
  const [wsModalOpen, setWsModalOpen] = useState(false)
  const [newWsName, setNewWsName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [members, setMembers] = useState<Member[]>([])
  const [wsError, setWsError] = useState<string | null>(null)

  const openWorkspaceModal = async () => {
    setWsError(null)
    setWsModalOpen(true)
    if (workspace) {
      try {
        setMembers(await Api.members(workspace.id))
      } catch {
        setMembers([])
      }
    }
  }

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newWsName.trim()) return
    setWsError(null)
    try {
      const created = await createSharedWorkspace(newWsName.trim())
      setNewWsName('')
      setMembers(await Api.members(created.id))
    } catch (err) {
      setWsError(err instanceof Error ? err.message : 'Error al crear el espacio')
    }
  }

  const handleInviteMember = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!workspace || !inviteEmail.trim()) return
    setWsError(null)
    try {
      await Api.addMember(workspace.id, inviteEmail.trim())
      setInviteEmail('')
      setMembers(await Api.members(workspace.id))
    } catch (err) {
      setWsError(err instanceof Error ? err.message : 'No se pudo invitar al usuario')
    }
  }

  const handleRemoveMember = async (userId: number) => {
    if (!workspace) return
    try {
      await Api.removeMember(workspace.id, userId)
      setMembers(await Api.members(workspace.id))
    } catch (err) {
      setWsError(err instanceof Error ? err.message : 'No se pudo eliminar al miembro')
    }
  }

  return (
    <div className="min-h-screen flex bg-surface text-ink">
      {/* Sidebar Desktop */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 bg-primary text-white">
        <div className="flex items-center gap-3 px-6 h-16 border-b border-slate-800">
          <div className="h-9 w-9 rounded-xl bg-primary-accent flex items-center justify-center shadow-sm">
            <Wallet className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="font-bold tracking-tight text-base leading-none">€conogenius</div>
            <div className="text-[11px] text-slate-400 mt-0.5">Multi-Banco · Regla 50/30/20</div>
          </div>
        </div>

        <div className="px-4 py-4 border-b border-slate-800">
          <div className="text-[11px] uppercase tracking-wider text-slate-400 mb-1.5 px-2">
            Espacio activo
          </div>
          <div className="flex items-center gap-1.5">
            <select
              aria-label="Seleccionar espacio de trabajo"
              value={workspace?.id ?? ''}
              onChange={(e) => {
                const found = user?.workspaces.find((w) => w.id === Number(e.target.value))
                if (found) selectWorkspace(found)
              }}
              className="flex-1 rounded-xl bg-slate-800/90 border border-slate-700 px-3 py-2 text-xs font-medium text-white outline-none focus:border-blue-400"
            >
              {user?.workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.is_personal ? `🔒 ${w.name}` : `👨‍👩‍👧 ${w.name}`}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={openWorkspaceModal}
              title="Gestionar espacios y miembros"
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
            >
              <Users className="h-4 w-4" />
            </button>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-primary-accent text-white shadow-sm'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t border-slate-800 space-y-3">
          <div className="rounded-xl bg-slate-800/70 p-3 text-xs text-slate-300 space-y-1">
            <div className="flex items-center gap-1.5 text-emerald-400 font-medium">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>Anti-Doble Contabilidad</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Excluye traspasos internos (`OP.NET`, `NET ER.`) y liquidaciones (`KRED. TXAR.`, `TARJ.CRDTO`) del 50/30/20.
            </p>
          </div>

          <div className="flex items-center justify-between pt-1">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-white truncate">{user?.full_name}</div>
              <div className="text-[11px] text-slate-400 truncate">{user?.email}</div>
            </div>
            <button
              type="button"
              onClick={logout}
              title="Cerrar sesión"
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Contenido Principal */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        {/* Topbar */}
        <header className="sticky top-0 z-20 h-16 bg-white/90 backdrop-blur border-b border-line px-4 sm:px-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-2 rounded-xl border border-line text-slate-700 hover:bg-slate-100"
              aria-label="Abrir menú"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div>
              <h1 className="text-base sm:text-lg font-bold text-ink leading-tight">
                {NAV_ITEMS.find((i) => (i.to === '/' ? location.pathname === '/' : location.pathname.startsWith(i.to)))
                  ?.label ?? '€conogenius'}
              </h1>
              <p className="text-xs text-slate-500 hidden sm:block">
                Espacio: <span className="font-medium text-slate-700">{workspace?.name}</span> · Moneda base EUR (€)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {/* Botón Modo Privacidad (Ocultar Saldos - Alt+P) */}
            <button
              type="button"
              onClick={togglePrivacyMode}
              title="Modo Privacidad: Ocultar o mostrar importes (Atajo: Alt+P)"
              aria-label="Modo Privacidad: Ocultar o mostrar saldos"
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition ${
                privacyMode
                  ? 'bg-amber-500 text-white border-amber-600 shadow-sm'
                  : 'bg-slate-50 text-slate-700 border-line hover:bg-slate-100'
              }`}
            >
              {privacyMode ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              <span className="hidden md:inline">
                {privacyMode ? 'Saldos ocultos' : 'Ocultar saldos'}
              </span>
            </button>

            {/* Selector Global Multi-Divisa */}
            <div className="relative">
              <div className="inline-flex items-center rounded-xl border border-line bg-slate-50 p-0.5">
                {(Object.keys(CURRENCIES) as CurrencyCode[]).map((code) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => setCurrency(code)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                      currency === code
                        ? 'bg-primary text-white shadow-sm'
                        : 'text-slate-600 hover:text-ink'
                    }`}
                  >
                    {code} {CURRENCIES[code].symbol}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setRateOpen((v) => !v)}
                  title="Configurar tasas de cambio"
                  className="px-2 py-1 text-slate-500 hover:text-ink"
                >
                  <Coins className="h-3.5 w-3.5" />
                </button>
              </div>

              {rateOpen && (
                <div className="absolute right-0 mt-2 w-72 card p-4 z-30 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-ink">Tasas sobre 1 EUR (€)</span>
                    <span className="chip bg-slate-100 text-slate-600">
                      {rateSource === 'live' ? 'Frankfurter API' : rateSource === 'custom' ? 'Manual' : 'Por defecto'}
                    </span>
                  </div>
                  {(['USD', 'GBP'] as CurrencyCode[]).map((c) => (
                    <div key={c} className="flex items-center justify-between gap-2 text-xs">
                      <label className="font-medium text-slate-600">1 EUR → {c}</label>
                      <input
                        type="number"
                        step="0.0001"
                        min="0.01"
                        value={rates[c]}
                        onChange={(e) => setCustomRate(c, parseFloat(e.target.value))}
                        className="input w-28 py-1 text-right text-xs"
                      />
                    </div>
                  ))}
                  <p className="text-[11px] text-slate-400">
                    La base de datos conserva siempre los importes originales en EUR (€).
                  </p>
                </div>
              )}
            </div>

            {location.pathname !== '/import' && (
              <button
                type="button"
                onClick={() => navigate('/import')}
                className="btn-accent text-xs sm:text-sm py-2 px-3 sm:px-4"
              >
                <FileUp className="h-4 w-4" />
                <span className="hidden sm:inline">Subir Extracto</span>
              </button>
            )}
          </div>
        </header>

        {/* Drawer Móvil */}
        {mobileOpen && (
          <div className="fixed inset-0 z-40 lg:hidden flex">
            <div className="fixed inset-0 bg-slate-900/50" onClick={() => setMobileOpen(false)} />
            <div className="relative w-72 max-w-full bg-primary text-white flex flex-col justify-between p-4 z-50">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="h-8 w-8 rounded-xl bg-primary-accent flex items-center justify-center">
                      <Wallet className="h-4 w-4 text-white" />
                    </div>
                    <span className="font-bold">€conogenius</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMobileOpen(false)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-white"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div>
                  <label className="text-[11px] uppercase text-slate-400 block mb-1">Espacio</label>
                  <select
                    value={workspace?.id ?? ''}
                    onChange={(e) => {
                      const found = user?.workspaces.find((w) => w.id === Number(e.target.value))
                      if (found) selectWorkspace(found)
                      setMobileOpen(false)
                    }}
                    className="w-full rounded-xl bg-slate-800 border border-slate-700 px-3 py-2 text-xs text-white"
                  >
                    {user?.workspaces.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </div>

                <nav className="space-y-1">
                  {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
                    <NavLink
                      key={to}
                      to={to}
                      end={to === '/'}
                      onClick={() => setMobileOpen(false)}
                      className={({ isActive }) =>
                        `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium ${
                          isActive ? 'bg-primary-accent text-white' : 'text-slate-300 hover:bg-slate-800'
                        }`
                      }
                    >
                      <Icon className="h-4 w-4" />
                      <span>{label}</span>
                    </NavLink>
                  ))}
                </nav>
              </div>

              <button
                type="button"
                onClick={logout}
                className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-rose-300 hover:bg-slate-800"
              >
                <LogOut className="h-4 w-4" />
                <span>Cerrar sesión ({user?.full_name})</span>
              </button>
            </div>
          </div>
        )}

        <main className="flex-1 p-4 sm:p-6 max-w-7xl w-full mx-auto space-y-6">{children}</main>
      </div>

      {/* Modal de Espacios Familiares / Compartidos */}
      {wsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="card w-full max-w-lg p-6 space-y-5 animate-fade-up">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Building2 className="h-5 w-5 text-primary-accent" />
                <h2 className="text-base font-bold text-ink">Espacios Personales y Familiares</h2>
              </div>
              <button
                type="button"
                onClick={() => setWsModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {wsError && (
              <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
                {wsError}
              </div>
            )}

            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-600">
                Tus espacios ({user?.workspaces.length ?? 0})
              </div>
              <div className="divide-y divide-line border border-line rounded-xl max-h-40 overflow-y-auto">
                {user?.workspaces.map((w) => {
                  const isActive = workspace?.id === w.id
                  const canDelete = w.role === 'owner' && (user?.workspaces.length ?? 0) > 1
                  return (
                    <div
                      key={w.id}
                      className={`flex items-center justify-between px-3 py-2 text-xs gap-2 ${
                        isActive ? 'bg-blue-50/70' : ''
                      }`}
                    >
                      <button
                        type="button"
                        onClick={async () => {
                          await selectWorkspace(w)
                          setMembers(await Api.members(w.id))
                        }}
                        className="flex items-center gap-2 min-w-0 text-left flex-1"
                      >
                        <span className="font-semibold text-ink truncate">
                          {w.is_personal ? `🔒 ${w.name}` : `👨‍👩‍👧 ${w.name}`}
                        </span>
                        {isActive && (
                          <span className="chip bg-primary-accent text-white text-[10px]">Activo</span>
                        )}
                      </button>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="chip bg-slate-100 text-slate-600">{w.role}</span>
                        {canDelete && (
                          <button
                            type="button"
                            title={`Eliminar espacio «${w.name}»`}
                            onClick={async () => {
                              if (
                                !confirm(
                                  `¿Eliminar el espacio «${w.name}» y todas sus cuentas y transacciones? Esta acción no se puede deshacer.`
                                )
                              ) {
                                return
                              }
                              setWsError(null)
                              try {
                                await deleteWorkspace(w.id)
                              } catch (err) {
                                setWsError(err instanceof Error ? err.message : 'No se pudo eliminar el espacio')
                              }
                            }}
                            className="p-1 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-600">
                Miembros de «{workspace?.name}» {workspace?.is_personal ? '(Privado)' : '(Compartido)'}
              </div>
              <div className="divide-y divide-line border border-line rounded-xl">
                {members.map((m) => (
                  <div key={m.user_id} className="flex items-center justify-between px-3 py-2 text-xs">
                    <div>
                      <span className="font-semibold text-ink">{m.full_name}</span>{' '}
                      <span className="text-slate-500">({m.email})</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="chip bg-slate-100 text-slate-600">{m.role}</span>
                      {!workspace?.is_personal && m.user_id !== user?.id && (
                        <button
                          type="button"
                          onClick={() => handleRemoveMember(m.user_id)}
                          className="text-red-500 hover:text-red-700 p-1"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {!workspace?.is_personal ? (
              <form onSubmit={handleInviteMember} className="space-y-2">
                <label className="label">Invitar familiar por email (debe estar registrado)</label>
                <div className="flex gap-2">
                  <input
                    type="email"
                    required
                    placeholder="ej. pareja@gmail.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className="input flex-1"
                  />
                  <button type="submit" className="btn-accent shrink-0">
                    <UserPlus className="h-4 w-4" />
                    Invitar
                  </button>
                </div>
              </form>
            ) : (
              <p className="text-xs text-slate-500 bg-slate-50 p-3 rounded-xl border border-line">
                El espacio <strong>Personal</strong> es estrictamente privado. Crea un espacio compartido (por ejemplo{' '}
                <strong>Familia García &amp; López</strong>) para gestionar cuentas conjuntas o invitar a otro miembro.
              </p>
            )}

            <form onSubmit={handleCreateWorkspace} className="pt-2 border-t border-line space-y-2">
              <label className="label">Crear nuevo espacio compartido</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  required
                  placeholder="Ej. Familia García & López"
                  value={newWsName}
                  onChange={(e) => setNewWsName(e.target.value)}
                  className="input flex-1"
                />
                <button type="submit" className="btn-primary shrink-0">
                  <Plus className="h-4 w-4" />
                  Crear
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
