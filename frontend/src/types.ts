export type Group = 'needs' | 'wants' | 'savings' | 'income' | 'transfer'
export type AccountType = 'checking' | 'credit_card' | 'joint' | 'savings'

export interface WorkspaceInfo {
  id: number
  name: string
  is_personal: boolean
  role: string
  target_needs?: number
  target_wants?: number
  target_savings?: number
}
export interface Me { id: number; email: string; full_name: string; workspaces: WorkspaceInfo[] }
export interface TokenResponse { access_token: string; expires_in: number; user: Me }

export interface LinkedCardInfo {
  account_id: number
  name: string
  current_balance: number
}

export interface Account {
  id: number; name: string; owner_name?: string | null; type: AccountType; bank: string; iban: string | null; card_number: string | null
  linked_account_id?: number | null; linked_account_name?: string | null
  currency: string; initial_balance: number; base_balance?: number; current_balance: number
  linked_cards_balance?: number; effective_balance?: number; linked_cards?: LinkedCardInfo[]
  balance_date: string | null
  color: string | null; is_active: boolean
}
export interface Category {
  id: number
  name: string
  group: Group
  icon: string | null
  monthly_budget?: number | null
  is_system: boolean
}
export interface Rule {
  id: number; pattern: string; kind: 'category' | 'transfer'; match_type: 'contains' | 'regex'
  direction: 'any' | 'in' | 'out'; category_id: number | null; category_name: string | null; is_owed_by_joint?: boolean; priority: number; is_active: boolean
}
export interface Transaction {
  id: number; account_id: number; account_name: string; account_owner?: string; operation_date: string; value_date: string | null
  concept: string; amount: number; balance: number | null; category_id: number | null; category_name: string | null
  category_group: Group | null; is_internal_transfer: boolean; transfer_pair_id: number | null
  is_owed_by_joint: boolean; joint_settled: boolean; notes: string | null
  merchant_hint: string
}
export interface Page<T> { items: T[]; total: number; page: number; size: number }

export interface PreviewRow {
  index: number; operation_date: string; value_date: string | null; concept: string; amount: number
  balance: number | null; is_duplicate: boolean; category_id: number | null; is_internal_transfer: boolean
  is_owed_by_joint: boolean
  transfer_reason: string | null; pair_description: string | null; alerts: string[]; merchant_hint: string
}
export interface ImportPreview {
  batch_id: number; account_id: number; filename: string; detected_format: string; language: string | null
  account_number: string | null; period_start: string | null; period_end: string | null; warnings: string[]
  stats: Record<'total' | 'new' | 'duplicates' | 'transfers' | 'categorized' | 'alerts', number>
  rows: PreviewRow[]
}
export interface ImportBatch {
  id: number; account_id: number; account_name: string; filename: string; detected_format: string; status: string
  period_start: string | null; period_end: string | null; total_rows: number; imported_rows: number
  duplicate_rows: number; created_at: string | null
}
export interface JointDebtOwner {
  owner: string
  pending_amount: number
  settled_amount: number
  pending_count: number
  accounts: { account_id: number; account_name: string; bank: string; amount: number; count: number }[]
  items: { id: number; operation_date: string; concept: string; amount: number; account_id: number; account_name: string }[]
}

export interface SubscriptionDetected {
  merchant: string
  sample_concept: string
  category_name: string
  frequency: 'monthly' | 'annual'
  occurrences: number
  last_date: string
  last_amount: number
  prev_amount: number | null
  monthly_cost: number
  annual_cost: number
  price_increase: boolean
  price_diff: number
}

export interface AntExpenseDetected {
  merchant: string
  sample_concept: string
  category_name: string
  occurrences: number
  avg_amount: number
  total_spent: number
  annual_cost: number
}

export interface CategoryBudgetStatus {
  category_id: number
  name: string
  group: string
  month: string
  monthly_budget: number | null
  spent: number
  pct: number
  status: 'ok' | 'warning' | 'exceeded' | 'unconfigured'
  projected_amount: number
  projected_pct: number
  projected_status: 'ok' | 'warning' | 'exceeded' | 'unconfigured'
}

export interface SavingsGoal {
  id: number
  name: string
  target_amount: number
  current_amount: number
  remaining_amount: number
  progress_pct: number
  target_date: string | null
  months_left: number | null
  monthly_needed: number | null
  icon: string | null
  color: string | null
}

export interface Summary {
  kpis: { income: number; expenses: number; net_savings: number; savings_rate: number; invested: number; internal_transfers: number; total_balance: number }
  joint_debts: { total_pending: number; total_settled: number; by_owner: JointDebtOwner[] }
  rule_503020: { key: 'needs' | 'wants' | 'savings'; label: string; target_pct: number; amount: number; actual_pct: number; target_amount: number }[]
  subscriptions_and_vampires?: {
    total_monthly_subscriptions: number
    total_annual_subscriptions: number
    total_ant_expenses: number
    price_increase_alerts: number
    subscriptions: SubscriptionDetected[]
    ant_expenses: AntExpenseDetected[]
  }
  category_budgets?: CategoryBudgetStatus[]
  savings_goals?: SavingsGoal[]
  unclassified_expenses: number
  monthly: { month: string; income: number; needs: number; wants: number; savings: number; other: number; transfers: number }[]
  top_categories: { category_id: number | null; name: string; group: string; amount: number; count: number }[]
  balances: {
    account_id: number
    name: string
    type: AccountType
    bank?: string
    base_balance?: number
    linked_cards_balance?: number
    current_balance: number
    effective_balance?: number
    linked_account_id?: number | null
    linked_account_name?: string | null
    linked_cards?: LinkedCardInfo[]
    balance_date: string | null
  }[]
}
export interface Member { user_id: number; email: string; full_name: string; role: string }
