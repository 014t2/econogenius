import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { Api, refreshSession, session } from '../api/client'
import type { Account, Category, Me, WorkspaceInfo } from '../types'

interface AuthContextValue {
  user: Me | null
  workspace: WorkspaceInfo | null
  accounts: Account[]
  categories: Category[]
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (fullName: string, email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  selectWorkspace: (ws: WorkspaceInfo) => Promise<void>
  createSharedWorkspace: (name: string) => Promise<WorkspaceInfo>
  renameWorkspace: (id: number, name: string) => Promise<WorkspaceInfo>
  deleteWorkspace: (id: number) => Promise<void>
  reloadCatalog: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export const BANK_LIST = [
  'Kutxabank',
  'BBVA',
  'Banco Santander',
  'CaixaBank',
  'ING',
  'Banco Sabadell',
  'Bankinter',
  'Revolut',
  'N26',
  'Openbank',
  'Laboral Kutxa',
  'MyInvestor',
  'Indexa Capital',
  'Abanca',
  'Unicaja',
  'Ibercaja',
  'Efectivo / Metálico',
  'Otra entidad',
]

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<Me | null>(null)
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)

  const loadWorkspaceCatalog = useCallback(async (wsId: number) => {
    session.setWorkspace(wsId)
    const [accs, cats] = await Promise.all([Api.accounts(), Api.categories()])
    setAccounts(accs)
    setCategories(cats)
  }, [])

  const applyAuthenticatedUser = useCallback(
    async (me: Me, token?: string) => {
      if (token) session.setToken(token)
      setUser(me)
      const savedWsId = Number(localStorage.getItem('fc_workspace_id') || 0)
      const chosen = me.workspaces.find((w) => w.id === savedWsId) || me.workspaces[0] || null
      setWorkspace(chosen)
      if (chosen) {
        localStorage.setItem('fc_workspace_id', String(chosen.id))
        await loadWorkspaceCatalog(chosen.id)
      }
    },
    [loadWorkspaceCatalog]
  )

  useEffect(() => {
    session.onUnauthorized(() => {
      session.setToken(null)
      setUser(null)
      setWorkspace(null)
      setAccounts([])
      setCategories([])
    })
    refreshSession()
      .then(async (res) => {
        if (res) {
          await applyAuthenticatedUser(res.user, res.access_token)
        }
      })
      .finally(() => setLoading(false))
  }, [applyAuthenticatedUser])

  const login = async (email: string, password: string) => {
    const res = await Api.login(email, password)
    await applyAuthenticatedUser(res.user, res.access_token)
  }

  const register = async (fullName: string, email: string, password: string) => {
    const res = await Api.register(fullName, email, password)
    await applyAuthenticatedUser(res.user, res.access_token)
  }

  const logout = async () => {
    try {
      await Api.logout()
    } finally {
      session.setToken(null)
      session.setWorkspace(null)
      setUser(null)
      setWorkspace(null)
      setAccounts([])
      setCategories([])
    }
  }

  const selectWorkspace = async (ws: WorkspaceInfo) => {
    setWorkspace(ws)
    localStorage.setItem('fc_workspace_id', String(ws.id))
    await loadWorkspaceCatalog(ws.id)
  }

  const createSharedWorkspace = async (name: string) => {
    const created = await Api.createWorkspace(name)
    const me = await Api.me()
    setUser(me)
    await selectWorkspace(created)
    return created
  }

  const renameWorkspace = async (id: number, name: string) => {
    const updated = await Api.updateWorkspace(id, name)
    const me = await Api.me()
    setUser(me)
    if (workspace?.id === id) {
      setWorkspace(updated)
    }
    return updated
  }

  const deleteWorkspace = async (id: number) => {
    await Api.deleteWorkspace(id)
    const me = await Api.me()
    setUser(me)
    if (workspace?.id === id) {
      const fallback = me.workspaces[0] || null
      setWorkspace(fallback)
      if (fallback) {
        localStorage.setItem('fc_workspace_id', String(fallback.id))
        await loadWorkspaceCatalog(fallback.id)
      } else {
        setAccounts([])
        setCategories([])
      }
    }
  }

  const reloadCatalog = useCallback(async () => {
    if (!workspace) return
    await loadWorkspaceCatalog(workspace.id)
  }, [workspace, loadWorkspaceCatalog])

  return (
    <AuthContext.Provider
      value={{
        user,
        workspace,
        accounts,
        categories,
        loading,
        login,
        register,
        logout,
        selectWorkspace,
        createSharedWorkspace,
        renameWorkspace,
        deleteWorkspace,
        reloadCatalog,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return ctx
}
