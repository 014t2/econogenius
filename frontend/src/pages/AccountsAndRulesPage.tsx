import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Building2,
  CreditCard,
  Download,
  FileJson,
  Link2,
  Pencil,
  Plus,
  ShieldCheck,
  Sparkles,
  Tag,
  Trash2,
  Upload,
  UserPlus,
  Users,
  Wallet,
  Wand2,
} from 'lucide-react'
import { Api } from '../api/client'
import { BANK_LIST, useAuth } from '../context/AuthContext'
import { useCurrency } from '../context/CurrencyContext'
import { GROUP_META } from '../components/Layout'
import { OnboardingWizardModal } from '../components/OnboardingWizardModal'
import { PageTutorialBanner } from '../components/PageTutorialBanner'
import type { AccountType, Group, Member, Rule, WorkspaceInfo } from '../types'

export function AccountsAndRulesPage() {
  const {
    user,
    workspace,
    accounts,
    categories,
    selectWorkspace,
    createSharedWorkspace,
    renameWorkspace,
    deleteWorkspace,
    reloadCatalog,
    logout,
  } = useAuth()
  const { format } = useCurrency()

  const [rules, setRules] = useState<Rule[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [deleteAccountModal, setDeleteAccountModal] = useState(false)
  const [deletingMe, setDeletingMe] = useState(false)
  const restoreInputRef = useRef<HTMLInputElement | null>(null)

  // Gestión de Espacios (crear, renombrar, miembros y eliminar)
  const [newSpaceName, setNewSpaceName] = useState('')
  const [wsMembers, setWsMembers] = useState<Member[]>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [wsToDelete, setWsToDelete] = useState<WorkspaceInfo | null>(null)
  const [deletingWs, setDeletingWs] = useState(false)
  const [wsActionError, setWsActionError] = useState<string | null>(null)

  // Nueva cuenta (soporta cualquier banco y saldo actual en el banco)
  const [accName, setAccName] = useState('')
  const [accBankSelect, setAccBankSelect] = useState('BBVA')
  const [accCustomBank, setAccCustomBank] = useState('')
  const [accType, setAccType] = useState<AccountType>('checking')
  const [accLinkedId, setAccLinkedId] = useState<number | ''>('')
  const [accIban, setAccIban] = useState('')
  const [accCard, setAccCard] = useState('')
  const [accBalance, setAccBalance] = useState('')
  const [accCreateLinkedCard, setAccCreateLinkedCard] = useState(false)
  const [accLinkedCardName, setAccLinkedCardName] = useState('')
  const [editingBalances, setEditingBalances] = useState<Record<number, string>>({})

  const bankAccounts = accounts.filter((a) => a.type !== 'credit_card')

  // Nueva regla
  const [rulePattern, setRulePattern] = useState('')
  const [ruleKind, setRuleKind] = useState<'category' | 'transfer'>('category')
  const [ruleCatId, setRuleCatId] = useState<number | ''>('')
  const [ruleOwedByJoint, setRuleOwedByJoint] = useState(false)

  // Nueva categoría
  const [catName, setCatName] = useState('')
  const [catGroup, setCatGroup] = useState<Group>('needs')

  const loadRules = useCallback(async () => {
    if (!workspace) return
    const [rList, mList] = await Promise.all([Api.rules(), Api.members(workspace.id)])
    setRules(rList)
    setWsMembers(mList)
  }, [workspace])

  useEffect(() => {
    loadRules()
  }, [loadRules])

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!accName.trim()) return
    const chosenBank =
      accBankSelect === 'Otra entidad' ? accCustomBank.trim() || 'Otra entidad' : accBankSelect
    const parsedBalance = accBalance.trim() === '' ? 0 : parseFloat(accBalance.replace(',', '.'))
    const balanceValue = Number.isFinite(parsedBalance) ? parsedBalance : 0
    const created = await Api.createAccount({
      name: accName.trim(),
      type: accType,
      bank: chosenBank,
      iban: accType !== 'credit_card' ? accIban.trim() || null : null,
      card_number: accType === 'credit_card' ? accCard.trim() || null : null,
      linked_account_id: accType === 'credit_card' && accLinkedId !== '' ? Number(accLinkedId) : null,
      initial_balance: balanceValue,
      current_balance: balanceValue,
    })
    let createdMsg = `Cuenta «${accName.trim()}» creada con saldo actual de ${format(balanceValue)}.`
    if (accType !== 'credit_card' && accCreateLinkedCard) {
      const cardTitle = accLinkedCardName.trim() || `Tarjeta ${accName.trim()}`
      await Api.createAccount({
        name: cardTitle,
        type: 'credit_card',
        bank: chosenBank,
        card_number: accCard.trim() || null,
        linked_account_id: created.id,
        initial_balance: 0,
        current_balance: 0,
      })
      createdMsg = `Creadas 2 cuentas: «${accName.trim()}» (${format(balanceValue)}) y «${cardTitle}» vinculada.`
    }
    setAccName('')
    setAccCustomBank('')
    setAccIban('')
    setAccCard('')
    setAccBalance('')
    setAccLinkedId('')
    setAccCreateLinkedCard(false)
    setAccLinkedCardName('')
    await reloadCatalog()
    setToast(createdMsg)
    setTimeout(() => setToast(null), 4000)
  }

  const handleSaveAccountBalance = async (accountId: number, fallbackBalance: number) => {
    const raw = editingBalances[accountId]
    const parsed = raw !== undefined ? parseFloat(raw.replace(',', '.')) : fallbackBalance
    if (!Number.isFinite(parsed)) return
    await Api.updateAccount(accountId, { current_balance: parsed })
    await reloadCatalog()
    setToast(`Saldo en el banco actualizado a ${format(parsed)}.`)
    setTimeout(() => setToast(null), 3500)
  }

  const handleChangeAccountBank = async (accountId: number, newBank: string) => {
    await Api.updateAccount(accountId, { bank: newBank })
    await reloadCatalog()
  }

  const handleDeleteAccount = async (id: number) => {
    if (!confirm('¿Eliminar esta cuenta y todos sus movimientos asociados?')) return
    await Api.deleteAccount(id)
    await reloadCatalog()
  }

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!rulePattern.trim()) return
    await Api.createRule({
      pattern: rulePattern.trim().toUpperCase(),
      kind: ruleKind,
      category_id: ruleKind === 'category' && ruleCatId ? Number(ruleCatId) : null,
      is_owed_by_joint: ruleKind === 'category' ? ruleOwedByJoint : false,
      priority: ruleKind === 'transfer' ? 20 : 10,
    })
    setRulePattern('')
    setRuleOwedByJoint(false)
    await loadRules()
  }

  const handleDeleteRule = async (id: number) => {
    await Api.deleteRule(id)
    await loadRules()
  }

  const handleApplyRules = async () => {
    const res = await Api.applyRules()
    setToast(`Reglas aplicadas: ${res.updated} movimientos sin categoría han sido clasificados.`)
    setTimeout(() => setToast(null), 4000)
  }

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!catName.trim()) return
    await Api.createCategory({ name: catName.trim(), group: catGroup })
    setCatName('')
    await reloadCatalog()
  }

  const handleDeleteCategory = async (id: number) => {
    await Api.deleteCategory(id)
    await reloadCatalog()
  }

  return (
    <div className="space-y-6">
      <PageTutorialBanner
        pageId="settings"
        title="Tutorial de Cuentas y Reglas · ¿Qué hay en esta página y cómo se utiliza?"
        subtitle="Configura tus cuentas bancarias, tarjetas vinculadas, reglas automáticas por comercio, presupuestos y copias de seguridad."
        steps={[
          {
            title: '1. Cuentas, Saldos y Tarjetas',
            badge: 'Multi-Cuenta',
            description:
              'Añade cuentas de cualquier banco, actualiza su saldo base o vincula cada tarjeta a su cuenta bancaria para que sus gastos descuenten de ella.',
          },
          {
            title: '2. Reglas de Categorización',
            badge: 'Automatización',
            description:
              'Crea reglas por comercio (ej. MERCADONA → Alimentos) o marca gastos domiciliados (ej. GEMINI) para que siempre se asignen a deuda de Cuenta Común.',
          },
          {
            title: '3. Categorías y Topes Mensuales',
            badge: 'Presupuestos',
            description:
              'Añade nuevas categorías a los bloques Necesidades, Ocio, Ahorro o Ingresos y pulsa «Tope mes» para activar alertas de presupuesto en el Dashboard.',
          },
          {
            title: '4. Backup JSON, Excel y RGPD',
            badge: 'Portabilidad',
            description:
              'Exporta todas las transacciones a Excel/CSV, descarga o restaura una copia de seguridad completa en JSON en 1 clic o elimina tu cuenta.',
          },
        ]}
        tip="Usa el botón «Asistente Personalizable (Individual / Pareja / Familia)» en el bloque 1 para crear de golpe cuentas, tarjetas vinculadas y tu regla de ahorro preferida."
      />

      {toast && (
        <div className="card p-3.5 bg-emerald-50 border-emerald-200 text-emerald-800 text-xs font-medium">
          {toast}
        </div>
      )}

      {/* Apartado de Gestión de Espacios (Crear, Renombrar, Miembros y Eliminar) */}
      <div className="card p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-2xl bg-blue-50 text-primary-accent shrink-0">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-ink">
                Gestión de Espacios (Personales y Compartidos)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Cambia entre espacios, crea nuevos espacios familiares o compartidos, gestiona sus miembros,
                renómbralos o elimina los que ya no necesites.
              </p>
            </div>
          </div>
        </div>

        {wsActionError && (
          <div className="rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-xs font-medium text-red-700">
            {wsActionError}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {(user?.workspaces ?? []).map((w) => {
            const isActive = workspace?.id === w.id
            const isOwner = w.role === 'owner'
            const canDelete = isOwner && (user?.workspaces.length ?? 0) > 1

            return (
              <div
                key={w.id}
                className={`p-4 rounded-2xl border flex flex-col justify-between gap-3 transition ${
                  isActive
                    ? 'border-primary-accent bg-blue-50/40 ring-1 ring-primary-accent'
                    : 'border-line bg-slate-50/60'
                }`}
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-bold text-sm text-ink truncate">
                          {w.is_personal ? `🔒 ${w.name}` : `👨‍👩‍👧 ${w.name}`}
                        </span>
                        {isActive && (
                          <span className="chip bg-primary-accent text-white text-[10px] font-semibold">
                            Activo
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {w.is_personal ? 'Espacio privado personal' : 'Espacio compartido'} · Rol:{' '}
                        <strong>{isOwner ? 'Propietario' : 'Miembro'}</strong>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {isOwner && (
                        <button
                          type="button"
                          title={`Renombrar «${w.name}»`}
                          onClick={async () => {
                            const nextName = prompt('Nuevo nombre para el espacio:', w.name)
                            if (!nextName || !nextName.trim() || nextName.trim() === w.name) return
                            setWsActionError(null)
                            try {
                              await renameWorkspace(w.id, nextName.trim())
                              setToast(`Espacio renombrado a «${nextName.trim()}».`)
                              setTimeout(() => setToast(null), 3500)
                            } catch (err) {
                              setWsActionError(err instanceof Error ? err.message : 'No se pudo renombrar')
                            }
                          }}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-primary-accent hover:bg-blue-50"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {isOwner && (
                        <button
                          type="button"
                          disabled={!canDelete}
                          title={
                            canDelete
                              ? `Eliminar espacio «${w.name}»`
                              : 'Debes conservar al menos un espacio activo'
                          }
                          onClick={() => {
                            setWsActionError(null)
                            setWsToDelete(w)
                          }}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t border-line flex items-center justify-between gap-2">
                  {isActive ? (
                    <span className="text-[11px] font-semibold text-primary-accent">
                      ✓ Viendo este espacio ahora
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => selectWorkspace(w)}
                      className="btn-outline py-1 px-2.5 text-xs"
                    >
                      Cambiar a este espacio
                    </button>
                  )}

                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => {
                        setWsActionError(null)
                        setWsToDelete(w)
                      }}
                      className="text-[11px] font-semibold text-red-600 hover:underline"
                    >
                      Eliminar
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Crear nuevo espacio compartido y miembros del espacio activo */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-3 border-t border-line">
          <form
            onSubmit={async (e) => {
              e.preventDefault()
              if (!newSpaceName.trim()) return
              setWsActionError(null)
              try {
                const created = await createSharedWorkspace(newSpaceName.trim())
                setNewSpaceName('')
                setToast(`Espacio «${created.name}» creado y activado.`)
                setTimeout(() => setToast(null), 4000)
              } catch (err) {
                setWsActionError(err instanceof Error ? err.message : 'No se pudo crear el espacio')
              }
            }}
            className="space-y-2"
          >
            <label className="label">Crear nuevo espacio compartido / familiar</label>
            <div className="flex gap-2">
              <input
                type="text"
                required
                placeholder="Ej. Familia García & López / Piso compartido"
                value={newSpaceName}
                onChange={(e) => setNewSpaceName(e.target.value)}
                className="input flex-1 text-xs"
              />
              <button type="submit" className="btn-accent text-xs shrink-0">
                <Plus className="h-4 w-4" />
                <span>Crear espacio</span>
              </button>
            </div>
          </form>

          {workspace && !workspace.is_personal && (
            <div className="space-y-2">
              <label className="label">Miembros de «{workspace.name}»</label>
              <div className="flex flex-wrap gap-1.5">
                {wsMembers.map((m) => (
                  <span
                    key={m.user_id}
                    className="chip bg-slate-100 text-slate-700 border border-line"
                  >
                    <span>
                      {m.full_name} ({m.email})
                    </span>
                    {m.user_id !== user?.id && (
                      <button
                        type="button"
                        onClick={async () => {
                          await Api.removeMember(workspace.id, m.user_id)
                          setWsMembers(await Api.members(workspace.id))
                        }}
                        className="text-red-500 hover:text-red-700 ml-1"
                        title="Quitar miembro"
                      >
                        ×
                      </button>
                    )}
                  </span>
                ))}
              </div>
              <form
                onSubmit={async (e) => {
                  e.preventDefault()
                  if (!inviteEmail.trim()) return
                  setWsActionError(null)
                  try {
                    await Api.addMember(workspace.id, inviteEmail.trim())
                    setInviteEmail('')
                    setWsMembers(await Api.members(workspace.id))
                    setToast('Miembro añadido al espacio compartido.')
                    setTimeout(() => setToast(null), 3500)
                  } catch (err) {
                    setWsActionError(err instanceof Error ? err.message : 'No se pudo invitar al miembro')
                  }
                }}
                className="flex gap-2"
              >
                <input
                  type="email"
                  required
                  placeholder="Invitar por email (ej. pareja@gmail.com)"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="input flex-1 text-xs"
                />
                <button type="submit" className="btn-outline text-xs shrink-0">
                  <UserPlus className="h-3.5 w-3.5 text-primary-accent" />
                  <span>Invitar</span>
                </button>
              </form>
            </div>
          )}
        </div>
      </div>

      {/* Gestión Multi-Cuenta y Multi-Banco */}
      <div className="card p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-ink">1. Cuentas Bancarias, Tarjetas y Efectivo (Multi-Banco)</h2>
            <p className="text-xs text-slate-500">
              Gestiona cuentas de cualquier entidad (BBVA, Santander, CaixaBank, ING, Revolut, N26, Sabadell,
              Kutxabank, etc.) con su IBAN o numeración opcional.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setWizardOpen(true)}
              className="btn-accent text-xs"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Asistente Personalizable (Individual / Pareja / Familia)
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {accounts.map((acc) => (
            <div
              key={acc.id}
              className="p-4 rounded-2xl border border-line bg-slate-50/60 flex flex-col justify-between gap-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-sm font-bold text-ink">
                    {acc.type === 'credit_card' ? (
                      <CreditCard className="h-4 w-4 text-amber-500 shrink-0" />
                    ) : acc.type === 'joint' ? (
                      <Users className="h-4 w-4 text-emerald-600 shrink-0" />
                    ) : (
                      <Wallet className="h-4 w-4 text-primary-accent shrink-0" />
                    )}
                    <span className="truncate">{acc.name}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <Building2 className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    <select
                      aria-label={`Entidad bancaria de ${acc.name}`}
                      value={BANK_LIST.includes(acc.bank) ? acc.bank : 'Otra entidad'}
                      onChange={(e) => handleChangeAccountBank(acc.id, e.target.value)}
                      className="rounded-lg border border-line bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700"
                    >
                      {BANK_LIST.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                      {!BANK_LIST.includes(acc.bank) && <option value={acc.bank}>{acc.bank}</option>}
                    </select>
                    <span className="text-[11px] text-slate-500">
                      ·{' '}
                      {acc.type === 'credit_card'
                        ? 'Tarjeta'
                        : acc.type === 'joint'
                        ? 'Cuenta Común'
                        : acc.type === 'savings'
                        ? 'Ahorro'
                        : 'Corriente'}
                    </span>
                  </div>
                  {(acc.iban || acc.card_number) && (
                    <div className="text-[11px] font-mono text-slate-500 mt-1">
                      {acc.iban || acc.card_number}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleDeleteAccount(acc.id)}
                  className="text-slate-400 hover:text-red-600 p-1"
                  title="Eliminar cuenta"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="pt-2.5 border-t border-line space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 font-medium">
                    {acc.type === 'credit_card' ? 'Gasto / saldo en tarjeta:' : 'Saldo real en cuenta:'}
                  </span>
                  <span className="font-bold text-sm text-ink">{format(acc.current_balance)}</span>
                </div>

                {acc.type !== 'credit_card' && acc.linked_cards && acc.linked_cards.length > 0 && (
                  <div className="p-2 rounded-xl bg-amber-50/80 border border-amber-200 space-y-1 text-[11px]">
                    <div className="flex items-center justify-between text-slate-600">
                      <span>Saldo base según extracto:</span>
                      <span className="font-semibold">{format(acc.base_balance ?? acc.current_balance)}</span>
                    </div>
                    <div className="flex items-center justify-between text-amber-900">
                      <span className="truncate pr-1">
                        Gastos tarjeta ({acc.linked_cards.map((c) => c.name).join(', ')}):
                      </span>
                      <span className="font-bold shrink-0">
                        {format(acc.linked_cards_balance ?? 0, { signed: true })}
                      </span>
                    </div>
                  </div>
                )}

                {acc.type === 'credit_card' && (
                  <div className="p-2.5 rounded-xl bg-blue-50/60 border border-blue-200 space-y-1.5">
                    <label className="flex items-center gap-1 text-[11px] font-semibold text-blue-900">
                      <Link2 className="h-3.5 w-3.5 text-primary-accent shrink-0" />
                      <span>¿Pertenece a la misma cuenta del banco?</span>
                    </label>
                    <select
                      aria-label={`Cuenta bancaria vinculada para ${acc.name}`}
                      value={acc.linked_account_id ?? ''}
                      onChange={async (e) => {
                        const val = e.target.value ? Number(e.target.value) : null
                        await Api.updateAccount(acc.id, { linked_account_id: val })
                        await reloadCatalog()
                        setToast(
                          val
                            ? `La tarjeta «${acc.name}» ahora repercute en el saldo de la cuenta seleccionada.`
                            : `La tarjeta «${acc.name}» se ha desvinculado.`
                        )
                        setTimeout(() => setToast(null), 3500)
                      }}
                      className="w-full rounded-lg border border-blue-300 bg-white px-2 py-1 text-[11px] font-medium text-ink"
                    >
                      <option value="">Tarjeta independiente (sin vincular)</option>
                      {bankAccounts
                        .filter((b) => b.id !== acc.id)
                        .map((b) => (
                          <option key={b.id} value={b.id}>
                            Misma cuenta: {b.name} ({b.bank})
                          </option>
                        ))}
                    </select>
                    {acc.linked_account_name && (
                      <div className="text-[10px] font-medium text-emerald-700">
                        ✓ Sus gastos repercuten en el saldo de «{acc.linked_account_name}»
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    step="0.01"
                    aria-label={`Saldo actual en el banco para ${acc.name}`}
                    value={editingBalances[acc.id] ?? String(acc.base_balance ?? acc.current_balance)}
                    onChange={(e) =>
                      setEditingBalances((prev) => ({ ...prev, [acc.id]: e.target.value }))
                    }
                    className="input py-1 px-2.5 text-xs flex-1"
                    placeholder="Saldo en banco (€)"
                  />
                  <button
                    type="button"
                    onClick={() => handleSaveAccountBalance(acc.id, acc.base_balance ?? acc.current_balance)}
                    className="btn-outline py-1 px-2.5 text-xs shrink-0"
                  >
                    Guardar saldo
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        <form
          onSubmit={handleCreateAccount}
          className="pt-4 border-t border-line grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3 items-end"
        >
          <div>
            <label className="label">Nombre de cuenta</label>
            <input
              type="text"
              required
              placeholder="Ej. Cuenta Nómina / Revolut"
              value={accName}
              onChange={(e) => setAccName(e.target.value)}
              className="input"
            />
          </div>
          <div>
            <label className="label">Entidad Bancaria</label>
            <select
              value={accBankSelect}
              onChange={(e) => setAccBankSelect(e.target.value)}
              className="input"
            >
              {BANK_LIST.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
          {accBankSelect === 'Otra entidad' && (
            <div>
              <label className="label">Nombre del banco</label>
              <input
                type="text"
                required
                placeholder="Ej. Caja Rural / Wise"
                value={accCustomBank}
                onChange={(e) => setAccCustomBank(e.target.value)}
                className="input"
              />
            </div>
          )}
          <div>
            <label className="label">Tipo</label>
            <select
              value={accType}
              onChange={(e) => setAccType(e.target.value as AccountType)}
              className="input"
            >
              <option value="checking">Cuenta Corriente</option>
              <option value="credit_card">Tarjeta de Crédito</option>
              <option value="joint">Cuenta Común</option>
              <option value="savings">Cuenta de Ahorro / Inversión</option>
            </select>
          </div>
          {accType === 'credit_card' && (
            <div>
              <label className="label text-blue-900 font-semibold">Pertenece a la cuenta</label>
              <select
                value={accLinkedId}
                onChange={(e) => setAccLinkedId(e.target.value ? Number(e.target.value) : '')}
                className="input border-blue-300"
              >
                <option value="">Independiente (sin vincular)</option>
                {bankAccounts.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.bank})
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="label">IBAN / Número (opcional)</label>
            <input
              type="text"
              placeholder="ES91 2100 ..."
              value={accIban}
              onChange={(e) => setAccIban(e.target.value)}
              className="input"
            />
          </div>
          <div>
            <label className="label">Nº Tarjeta (opcional)</label>
            <input
              type="text"
              placeholder="4921..."
              value={accCard}
              onChange={(e) => setAccCard(e.target.value)}
              className="input"
            />
          </div>
          <div>
            <label className="label text-emerald-800 font-bold">Saldo actual en el banco (€) *</label>
            <input
              type="number"
              step="0.01"
              required
              placeholder="Ej. 3527.49"
              value={accBalance}
              onChange={(e) => setAccBalance(e.target.value)}
              className="input border-emerald-300 focus:border-emerald-600 font-semibold"
            />
          </div>
          {accType !== 'credit_card' && (
            <div className="sm:col-span-2 lg:col-span-7 p-3 rounded-xl bg-amber-50/70 border border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-amber-950 cursor-pointer">
                <input
                  type="checkbox"
                  checked={accCreateLinkedCard}
                  onChange={(e) => setAccCreateLinkedCard(e.target.checked)}
                  className="rounded text-amber-600"
                />
                <CreditCard className="h-4 w-4 text-amber-600 shrink-0" />
                <span>Crear también su tarjeta vinculada a la vez (2 cuentas: Cuenta Corriente + Tarjeta)</span>
              </label>
              {accCreateLinkedCard && (
                <input
                  type="text"
                  placeholder={`Nombre tarjeta (por defecto: Tarjeta ${accName.trim() || 'Principal'})`}
                  value={accLinkedCardName}
                  onChange={(e) => setAccLinkedCardName(e.target.value)}
                  className="input text-xs bg-white sm:w-72"
                />
              )}
            </div>
          )}
          <button type="submit" className="btn-accent sm:col-span-2 lg:col-span-2">
            <Plus className="h-4 w-4" />
            {accType !== 'credit_card' && accCreateLinkedCard ? 'Crear Cuenta + Tarjeta (2)' : 'Añadir Cuenta'}
          </button>
        </form>
      </div>

      {/* Reglas Automáticas y Palabras Clave de Traspaso */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="card p-6 lg:col-span-7 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-ink">2. Reglas de Categorización y Conciliación</h2>
              <p className="text-xs text-slate-500">
                Patrones por comercio (<code>LIDL</code>, <code>MERCADONA</code>, <code>NETFLIX</code>) y palabras
                clave de traspaso interno entre bancos (<code>TRASPASO PROPIO</code>, <code>OP.NET</code>).
              </p>
            </div>
            <button type="button" onClick={handleApplyRules} className="btn-outline text-xs shrink-0">
              <Wand2 className="h-3.5 w-3.5 text-primary-accent" />
              Re-aplicar a pendientes
            </button>
          </div>

          <form onSubmit={handleCreateRule} className="space-y-2.5">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
              <div className="sm:col-span-1">
                <label className="label">Tipo de Regla</label>
                <select
                  value={ruleKind}
                  onChange={(e) => setRuleKind(e.target.value as 'category' | 'transfer')}
                  className="input text-xs"
                >
                  <option value="category">Comercio → Categoría</option>
                  <option value="transfer">Palabra clave Traspaso</option>
                </select>
              </div>
              <div className="sm:col-span-1">
                <label className="label">Patrón / Texto</label>
                <input
                  type="text"
                  required
                  placeholder="Ej. GEMINI o EROSKI"
                  value={rulePattern}
                  onChange={(e) => setRulePattern(e.target.value)}
                  className="input text-xs"
                />
              </div>
              {ruleKind === 'category' ? (
                <div className="sm:col-span-1">
                  <label className="label">Categoría</label>
                  <select
                    required
                    value={ruleCatId}
                    onChange={(e) => setRuleCatId(e.target.value ? Number(e.target.value) : '')}
                    className="input text-xs"
                  >
                    <option value="">Elegir...</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="sm:col-span-1 text-[11px] text-slate-500 pb-2">
                  Se marcará como <strong>Transferencia Interna</strong>
                </div>
              )}
              <button type="submit" className="btn-primary text-xs">
                <Plus className="h-4 w-4" />
                Guardar Regla
              </button>
            </div>
            {ruleKind === 'category' && (
              <label className="inline-flex items-center gap-2 text-xs text-purple-800 bg-purple-50 border border-purple-200 px-3 py-1.5 rounded-xl cursor-pointer">
                <input
                  type="checkbox"
                  checked={ruleOwedByJoint}
                  onChange={(e) => setRuleOwedByJoint(e.target.checked)}
                  className="rounded text-purple-600"
                />
                <span>
                  Gasto domiciliado de Cuenta Común (ej. suscripción Gemini): marcar siempre como «Me lo debe C. Común»
                  al subir extractos personales
                </span>
              </label>
            )}
          </form>

          <div className="max-h-80 overflow-y-auto divide-y divide-line border border-line rounded-xl text-xs">
            {rules.map((r) => (
              <div key={r.id} className="flex items-center justify-between px-3 py-2">
                <div className="flex items-center gap-2">
                  <code className="px-2 py-0.5 rounded bg-slate-100 font-semibold text-ink">{r.pattern}</code>
                  <span className="text-slate-400">→</span>
                  {r.kind === 'transfer' ? (
                    <span className="chip bg-slate-800 text-white">Palabra clave Traspaso Interno</span>
                  ) : (
                    <>
                      <span className="chip bg-blue-50 text-blue-700 border border-blue-200">
                        {r.category_name ?? 'Sin categoría'}
                      </span>
                      {r.is_owed_by_joint && (
                        <span className="chip bg-purple-100 text-purple-800 border border-purple-200">
                          Me lo debe C. Común
                        </span>
                      )}
                    </>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleDeleteRule(r.id)}
                  className="text-slate-400 hover:text-red-600 p-1"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Categorías 50/30/20 */}
        <div className="card p-6 lg:col-span-5 space-y-4">
          <div>
            <h2 className="text-base font-bold text-ink">3. Categorías 50 / 30 / 20</h2>
            <p className="text-xs text-slate-500">
              Estructura de Necesidades (50%), Ocio (30%), Ahorro (20%), Ingresos y Transferencias Internas.
            </p>
          </div>

          <form onSubmit={handleCreateCategory} className="flex flex-wrap gap-2 items-end">
            <div className="flex-1 min-w-[140px]">
              <label className="label">Nueva Categoría</label>
              <input
                type="text"
                required
                placeholder="Ej. Guardería / Mascotas"
                value={catName}
                onChange={(e) => setCatName(e.target.value)}
                className="input text-xs"
              />
            </div>
            <div>
              <label className="label">Bloque 50/30/20</label>
              <select
                value={catGroup}
                onChange={(e) => setCatGroup(e.target.value as Group)}
                className="input text-xs"
              >
                <option value="needs">Necesidades (50%)</option>
                <option value="wants">Ocio (30%)</option>
                <option value="savings">Ahorro (20%)</option>
                <option value="income">Ingresos</option>
                <option value="transfer">Transferencia Interna</option>
              </select>
            </div>
            <button type="submit" className="btn-accent text-xs">
              <Tag className="h-3.5 w-3.5" />
              Crear
            </button>
          </form>

          <div className="max-h-80 overflow-y-auto divide-y divide-line border border-line rounded-xl text-xs">
            {categories.map((c) => {
              const meta = GROUP_META[c.group]
              return (
                <div key={c.id} className="flex items-center justify-between px-3 py-2 gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-semibold text-ink truncate">{c.name}</span>
                    <span className={`chip ${meta?.badgeClass ?? 'bg-slate-100'}`}>{meta?.label ?? c.group}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {c.group !== 'income' && c.group !== 'transfer' && (
                      <button
                        type="button"
                        onClick={async () => {
                          const raw = prompt(
                            `Presupuesto mensual (EUR €) para «${c.name}» (deja vacío o 0 para sin límite):`,
                            c.monthly_budget ? String(c.monthly_budget) : ''
                          )
                          if (raw === null) return
                          const val = raw.trim() === '' ? null : parseFloat(raw.replace(',', '.'))
                          await Api.updateCategory(c.id, {
                            monthly_budget: val && val > 0 ? val : null,
                          })
                          await reloadCatalog()
                          setToast(
                            val && val > 0
                              ? `Presupuesto de «${c.name}» fijado en ${format(val)}/mes.`
                              : `Presupuesto eliminado para «${c.name}».`
                          )
                          setTimeout(() => setToast(null), 3500)
                        }}
                        className="chip bg-slate-100 hover:bg-blue-50 text-slate-700 border border-slate-200 cursor-pointer"
                        title="Configurar presupuesto mensual"
                      >
                        <Pencil className="h-3 w-3" />
                        <span>{c.monthly_budget ? `${format(c.monthly_budget)}/mes` : 'Tope mes'}</span>
                      </button>
                    )}
                    {!c.is_system && (
                      <button
                        type="button"
                        onClick={() => handleDeleteCategory(c.id)}
                        className="text-slate-400 hover:text-red-600 p-1"
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
      </div>

      {/* 4. Portabilidad (Excel / CSV / Backup JSON) y Privacidad RGPD */}
      <div className="card p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-2xl bg-emerald-50 text-emerald-600 shrink-0">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-ink">
                4. Exportación, Copia de Seguridad en 1 Clic y Privacidad (RGPD)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Tus datos financieros te pertenecen: expórtalos a Excel/CSV, guarda o restaura una copia completa en
                JSON o elimina tu cuenta irreversiblemente.
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl bg-slate-50 border border-line p-4 text-xs text-slate-700 space-y-1.5">
          <div className="font-bold text-ink flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            <span>Garantía de Privacidad en Memoria (Sin almacenamiento de extractos en disco)</span>
          </div>
          <p className="text-slate-600 leading-relaxed">
            Los archivos bancarios que subes (<code>.pdf</code>, <code>.xls</code>, <code>.xlsx</code>,{' '}
            <code>.csv</code>) se procesan exclusivamente en memoria RAM durante la ingesta (
            <code>import_service.py</code>). Los ficheros originales <strong>no se guardan en disco</strong> ni se
            comparten o venden a terceros.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-line">
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => Api.downloadTransactionsCsv()}
              className="btn-outline text-xs"
            >
              <Download className="h-4 w-4 text-emerald-600" />
              <span>Exportar todas las transacciones (Excel / CSV)</span>
            </button>

            <button
              type="button"
              onClick={async () => {
                const data = await Api.exportBackup()
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
                const a = document.createElement('a')
                a.href = URL.createObjectURL(blob)
                a.download = `econogenius_backup_${new Date().toISOString().slice(0, 10)}.json`
                document.body.appendChild(a)
                a.click()
                a.remove()
                setToast('Copia de seguridad completa (JSON) descargada.')
                setTimeout(() => setToast(null), 4000)
              }}
              className="btn-outline text-xs"
            >
              <FileJson className="h-4 w-4 text-primary-accent" />
              <span>Descargar Copia de Seguridad (JSON)</span>
            </button>

            <input
              ref={restoreInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0]
                if (!f) return
                try {
                  const text = await f.text()
                  const parsed = JSON.parse(text)
                  const res = await Api.restoreBackup(parsed)
                  await reloadCatalog()
                  await loadRules()
                  setToast(
                    `Backup restaurado: ${res.restored_accounts} cuentas nuevas y ${res.restored_transactions} transacciones importadas.`
                  )
                  setTimeout(() => setToast(null), 5000)
                } catch (err) {
                  alert(err instanceof Error ? err.message : 'Archivo de backup JSON no válido')
                } finally {
                  e.target.value = ''
                }
              }}
            />
            <button
              type="button"
              onClick={() => restoreInputRef.current?.click()}
              className="btn-outline text-xs"
            >
              <Upload className="h-4 w-4 text-amber-600" />
              <span>Restaurar Copia de Seguridad (JSON)</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => setDeleteAccountModal(true)}
            className="btn bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-xs font-semibold"
          >
            <Trash2 className="h-4 w-4" />
            <span>Eliminar mi cuenta y todos mis datos (RGPD)</span>
          </button>
        </div>
      </div>

      <OnboardingWizardModal
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onCompleted={() => {
          loadRules()
          setToast('Configuración del asistente completada correctamente.')
          setTimeout(() => setToast(null), 4000)
        }}
      />

      {wsToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="card w-full max-w-md p-6 space-y-4 animate-fade-up">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-2xl bg-red-100 text-red-600 flex items-center justify-center shrink-0">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-ink">
                  ¿Eliminar el espacio «{wsToDelete.name}»?
                </h3>
                <p className="text-xs text-slate-600 mt-1">
                  Se eliminarán de forma permanente todas las cuentas bancarias, tarjetas, reglas, objetivos de ahorro y
                  transacciones de este espacio. Esta acción no se puede deshacer.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-line">
              <button
                type="button"
                disabled={deletingWs}
                onClick={() => setWsToDelete(null)}
                className="btn-outline text-xs"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={deletingWs}
                onClick={async () => {
                  setDeletingWs(true)
                  setWsActionError(null)
                  try {
                    const removedName = wsToDelete.name
                    await deleteWorkspace(wsToDelete.id)
                    setWsToDelete(null)
                    setToast(`Espacio «${removedName}» eliminado correctamente.`)
                    setTimeout(() => setToast(null), 4000)
                  } catch (err) {
                    setWsActionError(err instanceof Error ? err.message : 'No se pudo eliminar el espacio')
                    setWsToDelete(null)
                  } finally {
                    setDeletingWs(false)
                  }
                }}
                className="btn bg-red-600 hover:bg-red-700 text-white text-xs font-semibold"
              >
                <Trash2 className="h-4 w-4" />
                <span>{deletingWs ? 'Eliminando...' : 'Sí, eliminar espacio'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteAccountModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="card w-full max-w-md p-6 space-y-4 animate-fade-up">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-2xl bg-red-100 text-red-600 flex items-center justify-center shrink-0">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-ink">
                  ¿Eliminar tu cuenta y todos tus datos financieros?
                </h3>
                <p className="text-xs text-slate-600 mt-1">
                  Esta acción es <strong>irreversible</strong> (Derecho de Supresión RGPD). Se borrarán tu usuario,
                  espacios personales, cuentas, reglas y todas las transacciones asociadas.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-line">
              <button
                type="button"
                disabled={deletingMe}
                onClick={() => setDeleteAccountModal(false)}
                className="btn-outline text-xs"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={deletingMe}
                onClick={async () => {
                  setDeletingMe(true)
                  try {
                    await Api.deleteMe()
                    await logout()
                  } finally {
                    setDeletingMe(false)
                  }
                }}
                className="btn bg-red-600 hover:bg-red-700 text-white text-xs font-semibold"
              >
                <Trash2 className="h-4 w-4" />
                <span>{deletingMe ? 'Eliminando...' : 'Sí, eliminar mi cuenta permanentemente'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
