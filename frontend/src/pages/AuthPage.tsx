import React, { useState } from 'react'
import { CheckCircle2, Lock, ShieldCheck, Wallet } from 'lucide-react'
import { useAuth } from '../context/AuthContext'

export function AuthPage() {
  const { login, register } = useAuth()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [autofillLocked, setAutofillLocked] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      if (mode === 'login') {
        await login(email.trim(), password)
      } else {
        await register(fullName.trim(), email.trim(), password)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de autenticación')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-surface flex flex-col lg:flex-row">
      {/* Panel Informativo Fintech */}
      <div className="lg:w-1/2 bg-primary text-white p-8 sm:p-12 flex flex-col justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-2xl bg-primary-accent flex items-center justify-center shadow-lg">
            <Wallet className="h-6 w-6 text-white" />
          </div>
          <div>
            <span className="text-xl font-bold tracking-tight">€conogenius</span>
            <span className="block text-xs text-slate-400">Arquitectura Financiera Personal y Familiar</span>
          </div>
        </div>

        <div className="my-10 space-y-6 max-w-lg">
          <h1 className="text-3xl sm:text-4xl font-bold leading-tight">
            Control real 50/30/20 para{' '}
            <span className="text-blue-400">todas tus cuentas y bancos</span>.
          </h1>
          <p className="text-slate-300 text-sm sm:text-base leading-relaxed">
            Importa extractos en PDF, Excel (<code>.xls</code> / <code>.xlsx</code>) y CSV de cualquier entidad
            bancaria (BBVA, Santander, CaixaBank, ING, Revolut, N26, Sabadell, Bankinter, Kutxabank ES/EU, etc.) o
            registra movimientos manuales. €conogenius detecta traspasos internos y liquidaciones de tarjeta entre bancos
            para evitar la doble contabilidad.
          </p>

          <ul className="space-y-3 text-sm text-slate-200">
            <li className="flex items-start gap-2.5">
              <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
              <span>
                <strong>Motor de Ingesta Universal Multi-Banco:</strong> Soporta cabeceras en Español, Euskera e Inglés,
                columnas separadas Cargo/Abono, hojas <code>.xls</code>/<code>.xlsx</code> y PDFs bancarios.
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
              <span>
                <strong>Conciliación Anti-Doble Contabilidad:</strong> Empareja automáticamente liquidaciones de tarjeta
                de crédito (<code>LIQUIDACION TARJETA</code>, <code>KRED. TXAR.</code>, <code>TARJ.CRDTO</code>) y
                traspasos entre cuentas (±3 días).
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
              <span>
                <strong>Deduplicación SHA-256 &amp; Aislamiento Multi-Cuenta:</strong> Cuentas personales, tarjetas y
                cuentas conjuntas de distintos bancos con seguridad JWT + Cookie HttpOnly.
              </span>
            </li>
          </ul>
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-400">
          <ShieldCheck className="h-4 w-4 text-emerald-400" />
          <span>Cifrado Argon2 · JWT + Refresh Cookie HttpOnly · Aislamiento por Workspace</span>
        </div>
      </div>

      {/* Formulario Login / Registro */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-12">
        <div className="card w-full max-w-md p-6 sm:p-8 space-y-6 animate-fade-up">
          <div className="flex rounded-xl bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => {
                setMode('login')
                setEmail('')
                setPassword('')
                setAutofillLocked(true)
                setError(null)
              }}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition ${
                mode === 'login' ? 'bg-white text-ink shadow-sm' : 'text-slate-600 hover:text-ink'
              }`}
            >
              Iniciar Sesión
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register')
                setFullName('')
                setEmail('')
                setPassword('')
                setAutofillLocked(true)
                setError(null)
              }}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition ${
                mode === 'register' ? 'bg-white text-ink shadow-sm' : 'text-slate-600 hover:text-ink'
              }`}
            >
              Crear Cuenta
            </button>
          </div>

          <div>
            <h2 className="text-xl font-bold text-ink">
              {mode === 'login' ? 'Bienvenido de nuevo' : 'Crea tu cuenta en €conogenius'}
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              {mode === 'login'
                ? 'Accede a tu panel financiero multi-banco y tus cuentas.'
                : 'Se creará automáticamente tu espacio con las categorías 50/30/20 y reglas de comercios.'}
            </p>
          </div>

          {error && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-xs font-medium text-red-700">
              {error}
            </div>
          )}

          <form
            key={mode}
            onSubmit={handleSubmit}
            autoComplete="off"
            className="space-y-4"
          >
            {mode === 'register' && (
              <div>
                <label className="label">Nombre completo</label>
                <input
                  type="text"
                  name="fc_full_name"
                  required
                  autoComplete="off"
                  readOnly={autofillLocked}
                  onFocus={() => setAutofillLocked(false)}
                  onPointerDown={() => setAutofillLocked(false)}
                  placeholder="Ej. Laura García"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="input"
                />
              </div>
            )}

            <div>
              <label className="label">Correo electrónico</label>
              <input
                type="email"
                name={mode === 'register' ? 'fc_register_email' : 'fc_login_email'}
                required
                autoComplete="off"
                readOnly={autofillLocked}
                onFocus={() => setAutofillLocked(false)}
                onPointerDown={() => setAutofillLocked(false)}
                placeholder="ejemplo@gmail.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
              />
            </div>

            <div>
              <label className="label">Contraseña</label>
              <input
                type="password"
                name={mode === 'register' ? 'fc_register_password' : 'fc_login_password'}
                required
                minLength={8}
                autoComplete="new-password"
                readOnly={autofillLocked}
                onFocus={() => setAutofillLocked(false)}
                onPointerDown={() => setAutofillLocked(false)}
                placeholder={mode === 'register' ? 'Mínimo 8 caracteres (letras y números)' : '••••••••'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input"
              />
            </div>

            <button type="submit" disabled={submitting} className="btn-accent w-full py-2.5">
              <Lock className="h-4 w-4" />
              <span>
                {submitting
                  ? 'Procesando...'
                  : mode === 'login'
                  ? 'Entrar a €conogenius'
                  : 'Registrarme y crear espacio'}
              </span>
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
