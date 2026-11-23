import React, { useState } from 'react'
import { Building2, CheckCircle2, CreditCard, Plus, Sparkles, Trash2, User, Users, Wallet, X } from 'lucide-react'
import { Api } from '../api/client'
import { BANK_LIST, useAuth } from '../context/AuthContext'

interface OnboardingWizardModalProps {
  open: boolean
  onClose: () => void
  onCompleted?: () => void
}

interface WizardMember {
  name: string
  bank: string
  initial_balance: string
  has_card: boolean
}

const RULE_PRESETS: Array<{
  id: string
  label: string
  desc: string
  needs: number
  wants: number
  savings: number
}> = [
  {
    id: '50-30-20',
    label: '50 / 30 / 20 Estándar (Recomendada)',
    desc: '50% Necesidades · 30% Ocio · 20% Ahorro e Inversión',
    needs: 50,
    wants: 30,
    savings: 20,
  },
  {
    id: '60-20-20',
    label: '60 / 20 / 20 Coste de Vida Alto',
    desc: '60% Necesidades (hipoteca/alquiler alto) · 20% Ocio · 20% Ahorro',
    needs: 60,
    wants: 20,
    savings: 20,
  },
  {
    id: '70-20-10',
    label: '70 / 20 / 10 Flexible / Familiar',
    desc: '70% Necesidades · 20% Ocio · 10% Ahorro',
    needs: 70,
    wants: 20,
    savings: 10,
  },
  {
    id: '50-20-30',
    label: '50 / 20 / 30 Ahorro Intensivo (FIRE)',
    desc: '50% Necesidades · 20% Ocio · 30% Ahorro e Inversión',
    needs: 50,
    wants: 20,
    savings: 30,
  },
  {
    id: 'custom',
    label: 'Personalizada',
    desc: 'Configura tus propios porcentajes objetivo',
    needs: 50,
    wants: 30,
    savings: 20,
  },
]

export function OnboardingWizardModal({ open, onClose, onCompleted }: OnboardingWizardModalProps) {
  const { user, reloadCatalog } = useAuth()
  const defaultFirstName = (user?.full_name || 'Titular 1').split(' ')[0]

  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [mode, setMode] = useState<'individual' | 'couple' | 'family'>('couple')
  const [members, setMembers] = useState<WizardMember[]>([
    { name: defaultFirstName, bank: 'Kutxabank', initial_balance: '0', has_card: true },
    { name: 'Pareja / Titular 2', bank: 'Kutxabank', initial_balance: '0', has_card: true },
  ])
  const [createJoint, setCreateJoint] = useState(true)
  const [jointName, setJointName] = useState('Cuenta Común')
  const [jointBank, setJointBank] = useState('Kutxabank')
  const [jointBalance, setJointBalance] = useState('0')

  const [presetId, setPresetId] = useState('50-30-20')
  const [needsPct, setNeedsPct] = useState(50)
  const [wantsPct, setWantsPct] = useState(30)
  const [savingsPct, setSavingsPct] = useState(20)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  const handleSelectMode = (nextMode: 'individual' | 'couple' | 'family') => {
    setMode(nextMode)
    if (nextMode === 'individual') {
      setMembers([{ name: defaultFirstName, bank: 'Kutxabank', initial_balance: '0', has_card: true }])
      setCreateJoint(false)
    } else if (nextMode === 'couple') {
      setMembers([
        { name: defaultFirstName, bank: 'Kutxabank', initial_balance: '0', has_card: true },
        { name: members[1]?.name || 'Titular 2', bank: 'Kutxabank', initial_balance: '0', has_card: true },
      ])
      setCreateJoint(true)
    } else {
      setMembers([
        { name: defaultFirstName, bank: 'Kutxabank', initial_balance: '0', has_card: true },
        { name: members[1]?.name || 'Titular 2', bank: 'Kutxabank', initial_balance: '0', has_card: true },
      ])
      setCreateJoint(true)
    }
  }

  const updateMember = (idx: number, patch: Partial<WizardMember>) => {
    setMembers((prev) => prev.map((m, i) => (i === idx ? { ...m, ...patch } : m)))
  }

  const addMember = () => {
    setMembers((prev) => [
      ...prev,
      { name: `Titular ${prev.length + 1}`, bank: 'Kutxabank', initial_balance: '0', has_card: true },
    ])
  }

  const removeMember = (idx: number) => {
    if (members.length <= 1) return
    setMembers((prev) => prev.filter((_, i) => i !== idx))
  }

  const handleSelectPreset = (id: string) => {
    setPresetId(id)
    const found = RULE_PRESETS.find((p) => p.id === id)
    if (found && id !== 'custom') {
      setNeedsPct(found.needs)
      setWantsPct(found.wants)
      setSavingsPct(found.savings)
    }
  }

  const handleFinish = async (e: React.FormEvent) => {
    e.preventDefault()
    if (needsPct + wantsPct + savingsPct !== 100) {
      setError('La suma de Necesidades + Ocio + Ahorro debe ser exactamente 100%.')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      await Api.runOnboarding({
        mode,
        members: members
          .filter((m) => m.name.trim())
          .map((m) => ({
            name: m.name.trim(),
            bank: m.bank,
            initial_balance: parseFloat(m.initial_balance.replace(',', '.')) || 0,
            has_card: m.has_card,
          })),
        create_joint_account: mode !== 'individual' && createJoint,
        joint_account_name: jointName.trim() || 'Cuenta Común',
        joint_bank: jointBank,
        joint_initial_balance: parseFloat(jointBalance.replace(',', '.')) || 0,
        target_needs: needsPct,
        target_wants: wantsPct,
        target_savings: savingsPct,
      })
      await reloadCatalog()
      onCompleted?.()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo completar la configuración')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 overflow-y-auto">
      <div className="card w-full max-w-2xl p-6 space-y-5 animate-fade-up my-8">
        {/* Cabecera del Asistente */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-blue-50 text-primary-accent flex items-center justify-center shrink-0">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-ink">
                Asistente de Configuración Personalizable · Paso {step} de 3
              </h2>
              <p className="text-xs text-slate-500">
                Adapta €conogenius a tu situación personal, de pareja o familiar sin nombres predefinidos
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Indicador de pasos */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { n: 1, title: '1. Modo de uso' },
            { n: 2, title: '2. Titulares y Bancos' },
            { n: 3, title: '3. Regla de Ahorro' },
          ].map((s) => (
            <button
              key={s.n}
              type="button"
              onClick={() => setStep(s.n as 1 | 2 | 3)}
              className={`py-2 px-3 rounded-xl text-xs font-semibold border text-left transition ${
                step === s.n
                  ? 'bg-primary text-white border-primary'
                  : step > s.n
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  : 'bg-slate-50 text-slate-500 border-line'
              }`}
            >
              {s.title}
            </button>
          ))}
        </div>

        {error && (
          <div className="rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-xs text-red-700 font-medium">
            {error}
          </div>
        )}

        {/* PASO 1: MODO DE USO */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="text-sm font-bold text-ink">¿Cómo vas a utilizar €conogenius?</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                {
                  id: 'individual' as const,
                  icon: User,
                  title: 'Individual',
                  desc: 'Gestiona tus cuentas personales, tarjetas de crédito e inversiones.',
                },
                {
                  id: 'couple' as const,
                  icon: Users,
                  title: 'En Pareja',
                  desc: '2 titulares con sus cuentas/tarjetas personales + Cuenta Común y cálculo de deudas cruzadas.',
                },
                {
                  id: 'family' as const,
                  icon: Building2,
                  title: 'Familia / Grupo',
                  desc: '2 o más miembros con múltiples cuentas, tarjetas vinculadas y fondo común.',
                },
              ].map((opt) => {
                const Icon = opt.icon
                const active = mode === opt.id
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handleSelectMode(opt.id)}
                    className={`p-4 rounded-2xl border text-left transition flex flex-col justify-between gap-3 ${
                      active
                        ? 'border-primary-accent bg-blue-50/60 ring-2 ring-blue-200'
                        : 'border-line bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="h-9 w-9 rounded-xl bg-blue-100 text-primary-accent flex items-center justify-center">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="font-bold text-sm text-ink">{opt.title}</div>
                      <p className="text-xs text-slate-500 mt-1">{opt.desc}</p>
                    </div>
                  </button>
                )
              })}
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-line">
              <button type="button" onClick={onClose} className="btn-outline text-xs">
                Cancelar
              </button>
              <button type="button" onClick={() => setStep(2)} className="btn-accent text-xs">
                Siguiente: Titulares y Bancos →
              </button>
            </div>
          </div>
        )}

        {/* PASO 2: TITULARES Y BANCOS */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-ink">
                  Configura los titulares, su banco principal y su saldo actual
                </div>
                <p className="text-xs text-slate-500">
                  Se crearán automáticamente sus cuentas personales, sus tarjetas vinculadas y las reglas de traspaso.
                </p>
              </div>
              {mode !== 'individual' && (
                <button type="button" onClick={addMember} className="btn-outline text-xs py-1.5 px-2.5">
                  <Plus className="h-3.5 w-3.5" />
                  Añadir titular
                </button>
              )}
            </div>

            <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
              {members.map((m, idx) => (
                <div key={idx} className="p-3.5 rounded-2xl border border-line bg-slate-50/70 space-y-2.5">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div>
                      <label className="label">Nombre del titular #{idx + 1} *</label>
                      <input
                        type="text"
                        required
                        placeholder="Ej. Laura / Carlos"
                        value={m.name}
                        onChange={(e) => updateMember(idx, { name: e.target.value })}
                        className="input text-xs"
                      />
                    </div>
                    <div>
                      <label className="label">Banco principal</label>
                      <select
                        value={m.bank}
                        onChange={(e) => updateMember(idx, { bank: e.target.value })}
                        className="input text-xs"
                      >
                        {BANK_LIST.map((b) => (
                          <option key={b} value={b}>
                            {b}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="label">Saldo actual en cuenta (€)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={m.initial_balance}
                        onChange={(e) => updateMember(idx, { initial_balance: e.target.value })}
                        className="input text-xs"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={m.has_card}
                        onChange={(e) => updateMember(idx, { has_card: e.target.checked })}
                        className="rounded text-primary-accent"
                      />
                      <CreditCard className="h-3.5 w-3.5 text-amber-500" />
                      <span>
                        Crear también <strong>Tarjeta {m.name || ''}</strong> vinculada a su cuenta (descuenta de su saldo)
                      </span>
                    </label>
                    {members.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeMember(idx)}
                        className="text-slate-400 hover:text-red-600 p-1"
                        title="Quitar titular"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}

              {mode !== 'individual' && (
                <div className="p-3.5 rounded-2xl border border-emerald-200 bg-emerald-50/60 space-y-2.5">
                  <label className="inline-flex items-center gap-2 text-xs font-bold text-emerald-900 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={createJoint}
                      onChange={(e) => setCreateJoint(e.target.checked)}
                      className="rounded text-emerald-600"
                    />
                    <Wallet className="h-4 w-4 text-emerald-600" />
                    <span>Crear Cuenta Común / Conjunta para gastos compartidos</span>
                  </label>
                  {createJoint && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      <div>
                        <label className="label">Nombre Cuenta Común</label>
                        <input
                          type="text"
                          value={jointName}
                          onChange={(e) => setJointName(e.target.value)}
                          className="input text-xs bg-white"
                        />
                      </div>
                      <div>
                        <label className="label">Banco Cuenta Común</label>
                        <select
                          value={jointBank}
                          onChange={(e) => setJointBank(e.target.value)}
                          className="input text-xs bg-white"
                        >
                          {BANK_LIST.map((b) => (
                            <option key={b} value={b}>
                              {b}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="label">Saldo actual (€)</label>
                        <input
                          type="number"
                          step="0.01"
                          value={jointBalance}
                          onChange={(e) => setJointBalance(e.target.value)}
                          className="input text-xs bg-white"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-between gap-2 pt-3 border-t border-line">
              <button type="button" onClick={() => setStep(1)} className="btn-outline text-xs">
                ← Anterior
              </button>
              <button type="button" onClick={() => setStep(3)} className="btn-accent text-xs">
                Siguiente: Regla de Ahorro →
              </button>
            </div>
          </div>
        )}

        {/* PASO 3: REGLA DE AHORRO */}
        {step === 3 && (
          <form onSubmit={handleFinish} className="space-y-4">
            <div>
              <div className="text-sm font-bold text-ink">¿Qué regla de ahorro y distribución prefieres?</div>
              <p className="text-xs text-slate-500">
                El gráfico Donut y las barras de objetivos de tu Dashboard se adaptarán a estos porcentajes.
              </p>
            </div>

            <div className="space-y-2">
              {RULE_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleSelectPreset(p.id)}
                  className={`w-full p-3 rounded-xl border text-left transition flex items-center justify-between ${
                    presetId === p.id
                      ? 'border-primary-accent bg-blue-50/60 ring-1 ring-primary-accent'
                      : 'border-line bg-white hover:border-slate-300'
                  }`}
                >
                  <div>
                    <div className="text-xs font-bold text-ink">{p.label}</div>
                    <div className="text-[11px] text-slate-500">{p.desc}</div>
                  </div>
                  {presetId === p.id && <CheckCircle2 className="h-4 w-4 text-primary-accent shrink-0" />}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-3 p-3.5 rounded-2xl bg-slate-50 border border-line">
              <div>
                <label className="label text-blue-700 font-bold">Necesidades (%)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={needsPct}
                  onChange={(e) => {
                    setPresetId('custom')
                    setNeedsPct(Number(e.target.value))
                  }}
                  className="input text-xs font-bold"
                />
              </div>
              <div>
                <label className="label text-amber-700 font-bold">Ocio y Caprichos (%)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={wantsPct}
                  onChange={(e) => {
                    setPresetId('custom')
                    setWantsPct(Number(e.target.value))
                  }}
                  className="input text-xs font-bold"
                />
              </div>
              <div>
                <label className="label text-emerald-700 font-bold">Ahorro e Inversión (%)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={savingsPct}
                  onChange={(e) => {
                    setPresetId('custom')
                    setSavingsPct(Number(e.target.value))
                  }}
                  className="input text-xs font-bold"
                />
              </div>
            </div>

            <div className="flex justify-between gap-2 pt-3 border-t border-line">
              <button type="button" onClick={() => setStep(2)} className="btn-outline text-xs">
                ← Anterior
              </button>
              <button type="submit" disabled={submitting} className="btn-accent text-xs font-semibold">
                <CheckCircle2 className="h-4 w-4" />
                <span>{submitting ? 'Configurando...' : 'Finalizar y Crear Cuentas'}</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
