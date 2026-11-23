import React, { useEffect, useState } from 'react'
import { Building2, Coins, Link2, Plus, Wallet, X } from 'lucide-react'
import { Api } from '../api/client'
import { BANK_LIST, useAuth } from '../context/AuthContext'
import type { Account, AccountType } from '../types'

interface AccountModalProps {
  open: boolean
  onClose: () => void
  onCreated?: (account: Account) => void
}

export function AccountModal({ open, onClose, onCreated }: AccountModalProps) {
  const { accounts, reloadCatalog } = useAuth()
  const bankAccounts = accounts.filter((a) => a.type !== 'credit_card')

  const [name, setName] = useState('')
  const [bankSelect, setBankSelect] = useState('BBVA')
  const [customBank, setCustomBank] = useState('')
  const [type, setType] = useState<AccountType>('checking')
  const [linkedAccountId, setLinkedAccountId] = useState<number | ''>('')
  const [currentBalance, setCurrentBalance] = useState('')
  const [iban, setIban] = useState('')
  const [cardNumber, setCardNumber] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (type === 'credit_card' && linkedAccountId === '' && bankAccounts.length === 1) {
      setLinkedAccountId(bankAccounts[0].id)
    }
  }, [type, linkedAccountId, bankAccounts])

  if (!open) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setError(null)
    setSubmitting(true)
    try {
      const bank = bankSelect === 'Otra entidad' ? customBank.trim() || 'Otra entidad' : bankSelect
      const parsedBalance = currentBalance.trim() === '' ? 0 : parseFloat(currentBalance.replace(',', '.'))
      const created = await Api.createAccount({
        name: name.trim(),
        type,
        bank,
        iban: iban.trim() || null,
        card_number: cardNumber.trim() || null,
        linked_account_id: type === 'credit_card' && linkedAccountId !== '' ? Number(linkedAccountId) : null,
        initial_balance: Number.isFinite(parsedBalance) ? parsedBalance : 0,
        current_balance: Number.isFinite(parsedBalance) ? parsedBalance : 0,
      })
      await reloadCatalog()
      onCreated?.(created)
      setName('')
      setCurrentBalance('')
      setIban('')
      setCardNumber('')
      setLinkedAccountId('')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear la cuenta')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <form onSubmit={handleSubmit} className="card w-full max-w-lg p-6 space-y-4 animate-fade-up">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-blue-50 text-primary-accent flex items-center justify-center">
              <Wallet className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-ink">Añadir Nueva Cuenta Bancaria</h3>
              <p className="text-xs text-slate-500">
                Configura tu cuenta e indica qué saldo tienes actualmente en el banco
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

        {error && (
          <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Nombre de la cuenta *</label>
            <input
              type="text"
              required
              placeholder="Ej. Cuenta Nómina Olatz / Común"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input"
            />
          </div>

          <div>
            <label className="label">Entidad Bancaria *</label>
            <div className="relative">
              <Building2 className="h-4 w-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
              <select
                value={bankSelect}
                onChange={(e) => setBankSelect(e.target.value)}
                className="input pl-9"
              >
                {BANK_LIST.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {bankSelect === 'Otra entidad' && (
          <div>
            <label className="label">Nombre de tu banco o entidad *</label>
            <input
              type="text"
              required
              placeholder="Ej. Caja Rural / Wise / Trade Republic"
              value={customBank}
              onChange={(e) => setCustomBank(e.target.value)}
              className="input"
            />
          </div>
        )}

        {/* Campo destacado para la cuantía / saldo actual en el banco */}
        <div className="p-4 rounded-2xl bg-emerald-50/70 border border-emerald-200 space-y-2">
          <label className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-emerald-900">
            <Coins className="h-4 w-4 text-emerald-600" />
            <span>Saldo actual en el banco (€) *</span>
          </label>
          <div className="relative">
            <input
              type="number"
              step="0.01"
              required
              placeholder="Ej. 3527.49 (pon 0 si empiezas desde cero)"
              value={currentBalance}
              onChange={(e) => setCurrentBalance(e.target.value)}
              className="input text-base font-bold border-emerald-300 focus:border-emerald-600 pr-12"
            />
            <span className="absolute right-3.5 top-2 text-sm font-bold text-emerald-700">EUR €</span>
          </div>
          <p className="text-[11px] text-emerald-800">
            Introduce la cuantía exacta que tienes ahora mismo en esta cuenta bancaria. Se sumará automáticamente al
            saldo total de tu Dashboard.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Tipo de cuenta</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as AccountType)}
              className="input"
            >
              <option value="checking">Cuenta Corriente</option>
              <option value="joint">Cuenta Común / Conjunta</option>
              <option value="savings">Cuenta de Ahorro / Inversión</option>
              <option value="credit_card">Tarjeta de Crédito</option>
            </select>
          </div>

          {type === 'credit_card' ? (
            <div>
              <label className="label">Nº Tarjeta (opcional)</label>
              <input
                type="text"
                placeholder="4921 0740 ..."
                value={cardNumber}
                onChange={(e) => setCardNumber(e.target.value)}
                className="input"
              />
            </div>
          ) : (
            <div>
              <label className="label">IBAN / Nº de cuenta (opcional)</label>
              <input
                type="text"
                placeholder="ES91 2100 ..."
                value={iban}
                onChange={(e) => setIban(e.target.value)}
                className="input"
              />
            </div>
          )}
        </div>

        {type === 'credit_card' && (
          <div className="p-3.5 rounded-2xl bg-blue-50/70 border border-blue-200 space-y-2">
            <label className="flex items-center gap-1.5 text-xs font-bold text-blue-900">
              <Link2 className="h-4 w-4 text-primary-accent" />
              <span>¿Pertenece a la misma cuenta del banco que estás utilizando?</span>
            </label>
            <select
              value={linkedAccountId}
              onChange={(e) => setLinkedAccountId(e.target.value ? Number(e.target.value) : '')}
              className="input text-xs border-blue-300 bg-white"
            >
              <option value="">Tarjeta independiente (no descuenta de otra cuenta)</option>
              {bankAccounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  Sí, pertenece a: {acc.name} ({acc.bank})
                </option>
              ))}
            </select>
            <p className="text-[11px] text-blue-800">
              Al indicar a qué cuenta bancaria pertenece la tarjeta, todos los gastos que subas o registres en esta
              tarjeta repercutirán y se descontarán automáticamente del saldo de esa cuenta.
            </p>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-line">
          <button type="button" onClick={onClose} className="btn-outline text-xs">
            Cancelar
          </button>
          <button type="submit" disabled={submitting} className="btn-accent text-xs sm:text-sm">
            <Plus className="h-4 w-4" />
            <span>{submitting ? 'Guardando cuenta...' : 'Crear cuenta con este saldo'}</span>
          </button>
        </div>
      </form>
    </div>
  )
}
