import type {
  Account, Category, ImportBatch, ImportPreview, Me, Member, Page, Rule, SavingsGoal, Summary, TokenResponse, Transaction, WorkspaceInfo,
} from '../types'

/** Access token solo en memoria (nunca en localStorage). El refresh token vive en cookie HttpOnly. */
let accessToken: string | null = null
let workspaceId: number | null = null
let onUnauthorized: (() => void) | null = null
let refreshing: Promise<TokenResponse | null> | null = null

export const session = {
  setToken: (t: string | null) => { accessToken = t },
  setWorkspace: (id: number | null) => { workspaceId = id },
  onUnauthorized: (fn: () => void) => { onUnauthorized = fn },
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export function refreshSession(): Promise<TokenResponse | null> {
  if (!refreshing) {
    refreshing = fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
      .then(async (r) => {
        if (!r.ok) return null
        const data = (await r.json()) as TokenResponse
        accessToken = data.access_token
        return data
      })
      .catch(() => null)
      .finally(() => { setTimeout(() => { refreshing = null }, 0) })
  }
  return refreshing
}

type Opts = Omit<RequestInit, 'body'> & { json?: unknown; body?: BodyInit; query?: Record<string, unknown> }

export async function api<T>(path: string, opts: Opts = {}, retry = true): Promise<T> {
  const headers = new Headers(opts.headers)
  let body = opts.body
  if (opts.json !== undefined) {
    headers.set('Content-Type', 'application/json')
    body = JSON.stringify(opts.json)
  }
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)
  if (workspaceId) headers.set('X-Workspace-Id', String(workspaceId))
  let url = `/api${path}`
  if (opts.query) {
    const qs = new URLSearchParams()
    Object.entries(opts.query).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v))
    })
    if ([...qs].length) url += `?${qs}`
  }
  const res = await fetch(url, { ...opts, headers, body, credentials: 'include' })
  if (res.status === 401 && retry && !path.startsWith('/auth/login') && !path.startsWith('/auth/register')) {
    if (await refreshSession()) return api<T>(path, opts, false)
    onUnauthorized?.()
  }
  if (!res.ok) {
    let msg = res.statusText
    try {
      const d = await res.json()
      msg = typeof d.detail === 'string' ? d.detail : Array.isArray(d.detail) ? d.detail.map((x: { msg: string }) => x.msg).join(', ') : msg
    } catch { /* sin cuerpo */ }
    throw new ApiError(res.status, msg)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const Api = {
  login: (email: string, password: string) => api<TokenResponse>('/auth/login', { method: 'POST', json: { email, password } }),
  register: (full_name: string, email: string, password: string) =>
    api<TokenResponse>('/auth/register', { method: 'POST', json: { full_name, email, password } }),
  logout: () => api<void>('/auth/logout', { method: 'POST' }),
  me: () => api<Me>('/auth/me'),
  deleteMe: () => api<void>('/auth/me', { method: 'DELETE' }),

  workspaces: () => api<WorkspaceInfo[]>('/workspaces'),
  createWorkspace: (name: string) => api<WorkspaceInfo>('/workspaces', { method: 'POST', json: { name } }),
  updateWorkspace: (id: number, name: string) => api<WorkspaceInfo>(`/workspaces/${id}`, { method: 'PATCH', json: { name } }),
  deleteWorkspace: (id: number) => api<void>(`/workspaces/${id}`, { method: 'DELETE' }),
  members: (id: number) => api<Member[]>(`/workspaces/${id}/members`),
  addMember: (id: number, email: string) => api<Member>(`/workspaces/${id}/members`, { method: 'POST', json: { email } }),
  removeMember: (id: number, userId: number) => api<void>(`/workspaces/${id}/members/${userId}`, { method: 'DELETE' }),
  runOnboarding: (data: {
    mode: 'individual' | 'couple' | 'family'
    members: { name: string; bank: string; initial_balance: number; has_card: boolean }[]
    create_joint_account: boolean
    joint_account_name: string
    joint_bank: string
    joint_initial_balance: number
    target_needs: number
    target_wants: number
    target_savings: number
  }) =>
    api<{
      created_accounts: string[]
      created_rules: string[]
      targets: { needs: number; wants: number; savings: number }
    }>('/workspaces/onboarding', { method: 'POST', json: data }),

  savingsGoals: () => api<SavingsGoal[]>('/workspaces/savings-goals'),
  createSavingsGoal: (data: {
    name: string
    target_amount: number
    current_amount?: number
    target_date?: string | null
    icon?: string | null
    color?: string | null
  }) => api<SavingsGoal>('/workspaces/savings-goals', { method: 'POST', json: data }),
  updateSavingsGoal: (
    id: number,
    data: {
      name?: string
      target_amount?: number
      current_amount?: number
      add_amount?: number
      target_date?: string | null
    }
  ) => api<SavingsGoal>(`/workspaces/savings-goals/${id}`, { method: 'PATCH', json: data }),
  deleteSavingsGoal: (id: number) => api<void>(`/workspaces/savings-goals/${id}`, { method: 'DELETE' }),

  exportBackup: () => api<Record<string, unknown>>('/workspaces/current/backup'),
  restoreBackup: (payload: Record<string, unknown>) =>
    api<{ restored_accounts: number; restored_transactions: number }>('/workspaces/current/restore', {
      method: 'POST',
      json: payload,
    }),

  accounts: () => api<Account[]>('/accounts'),
  createAccount: (data: Partial<Account>) => api<Account>('/accounts', { method: 'POST', json: data }),
  updateAccount: (id: number, data: Partial<Account>) => api<Account>(`/accounts/${id}`, { method: 'PATCH', json: data }),
  deleteAccount: (id: number) => api<void>(`/accounts/${id}`, { method: 'DELETE' }),

  categories: () => api<Category[]>('/categories'),
  createCategory: (data: Pick<Category, 'name' | 'group'> & { monthly_budget?: number | null }) =>
    api<Category>('/categories', { method: 'POST', json: data }),
  updateCategory: (id: number, data: Partial<Category>) =>
    api<Category>(`/categories/${id}`, { method: 'PATCH', json: data }),
  deleteCategory: (id: number) => api<void>(`/categories/${id}`, { method: 'DELETE' }),

  rules: () => api<Rule[]>('/rules'),
  createRule: (data: Partial<Rule>) => api<Rule>('/rules', { method: 'POST', json: data }),
  deleteRule: (id: number) => api<void>(`/rules/${id}`, { method: 'DELETE' }),
  applyRules: () => api<{ updated: number }>('/rules/apply', { method: 'POST' }),

  transactions: (query: Record<string, unknown>) => api<Page<Transaction>>('/transactions', { query }),
  createTransaction: (data: {
    account_id: number
    operation_date: string
    value_date?: string | null
    concept: string
    amount: number
    category_id?: number | null
    is_internal_transfer?: boolean
    is_owed_by_joint?: boolean
    notes?: string | null
  }) => api<Transaction>('/transactions', { method: 'POST', json: data }),
  updateTransaction: (id: number, data: Record<string, unknown>) =>
    api<{ transaction: Transaction; rule_id: number | null; recategorized: number }>(`/transactions/${id}`, { method: 'PATCH', json: data }),
  settleJointDebts: (data: { owner?: string; account_id?: number; transaction_ids?: number[] }) =>
    api<{ settled_count: number; settled_amount: number }>('/transactions/settle-joint', { method: 'POST', json: data }),
  deleteTransaction: (id: number) => api<void>(`/transactions/${id}`, { method: 'DELETE' }),
  bulkDeleteTransactions: (data: {
    transaction_ids?: number[]
    delete_all?: boolean
    q?: string
    account_id?: number
    category_id?: number
    uncategorized?: boolean
    transfers?: string
    owed_by_joint?: string
    date_from?: string
    date_to?: string
  }) => api<{ deleted: number }>('/transactions/bulk-delete', { method: 'POST', json: data }),

  previewImport: (accountId: number, file: File) => {
    const fd = new FormData()
    fd.append('account_id', String(accountId))
    fd.append('file', file)
    return api<ImportPreview>('/imports/preview', { method: 'POST', body: fd })
  },
  confirmImport: (
    batchId: number,
    decisions: {
      index: number
      include: boolean
      category_id: number | null
      is_internal_transfer: boolean
      is_owed_by_joint?: boolean
    }[]
  ) =>
    api<{ imported: number; duplicates_skipped: number; transfers_linked: number; account_balance: number }>(
      `/imports/${batchId}/confirm`, { method: 'POST', json: { decisions } }),
  imports: () => api<ImportBatch[]>('/imports'),
  undoImport: (id: number) => api<void>(`/imports/${id}`, { method: 'DELETE' }),

  summary: (query: Record<string, unknown>) => api<Summary>('/analytics/summary', { query }),

  downloadTransactionsCsv: async (query: Record<string, unknown> = {}) => {
    const headers = new Headers()
    if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)
    if (workspaceId) headers.set('X-Workspace-Id', String(workspaceId))
    const qs = new URLSearchParams()
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v))
    })
    const url = `/api/transactions/export-csv${[...qs].length ? `?${qs}` : ''}`
    const res = await fetch(url, { headers, credentials: 'include' })
    if (!res.ok) throw new Error('No se pudo exportar el archivo CSV')
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `econogenius_transacciones_${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
  },
}
