"""Analítica 50/30/20. Las transferencias internas se excluyen de ingresos y gastos reales.

* Ingresos reales  = entradas no-traspaso (excepto grupo Ahorro).
* Gastos reales    = salidas no-traspaso de Necesidades + Ocio + sin clasificar.
* Ahorro           = Ingresos - Gastos (incluye aportaciones explícitas a Inversiones).
"""
import calendar
from collections import defaultdict
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.accounts.router import recalculate_account_balance
from app.core.database import get_db
from app.core.deps import get_workspace
from app.models import Account, Category, SavingsGoal, Transaction, Workspace, resolve_account_owner
from app.rules.engine import extract_merchant
from app.workspaces.router import serialize_savings_goal

router = APIRouter(prefix="/analytics", tags=["analytics"])
DEFAULT_TARGETS = {"needs": 50, "wants": 30, "savings": 20}
LABELS = {"needs": "Necesidades", "wants": "Ocio", "savings": "Ahorro"}
ZERO = Decimal("0")
KNOWN_SUBSCRIPTION_HINTS = {
    "NETFLIX",
    "SPOTIFY",
    "DISNEY",
    "HBO",
    "AMAZON PRIME",
    "PRIME VIDEO",
    "GOOGLE",
    "GEMINI",
    "OPENAI",
    "CHATGPT",
    "APPLE",
    "ICLOUD",
    "YOUTUBE",
    "DIGI",
    "SIMYO",
    "MOVISTAR",
    "VODAFONE",
    "ORANGE",
    "IBERDROLA",
    "ENDESA",
    "NATURGY",
    "CUOTA PTMO",
    "MAIL.KUOTA",
    "KUTXABANK BIZITZA",
    "KUTXABANK SEG",
    "MAPFRE",
    "ALLIANZ",
    "GIMNASIO",
    "GYM",
    "PATREON",
    "TWITCH",
    "DAZN",
    "ADOBE",
    "MICROSOFT",
    "GITHUB",
}


def _bucket() -> dict[str, Decimal]:
    return {"income": ZERO, "needs": ZERO, "wants": ZERO, "savings": ZERO, "other": ZERO, "transfers": ZERO}


def _accumulate(b: dict[str, Decimal], amount: Decimal, group: str | None, is_transfer: bool) -> None:
    if is_transfer or group == "transfer":
        b["transfers"] += abs(amount)
    elif group == "savings":
        b["savings"] += -amount
    elif amount > 0:
        b["income"] += amount
    elif group in ("needs", "wants"):
        b[group] += -amount
    else:
        b["other"] += -amount


def summarize(db: Session, workspace_id: int, account_id: int | None, date_from: date | None, date_to: date | None) -> dict:
    conds = [Transaction.workspace_id == workspace_id]
    if account_id:
        conds.append(Transaction.account_id == account_id)
    if date_from:
        conds.append(Transaction.operation_date >= date_from)
    if date_to:
        conds.append(Transaction.operation_date <= date_to)
    rows = db.execute(
        select(
            Transaction.operation_date,
            Transaction.amount,
            Transaction.is_internal_transfer,
            Transaction.concept,
            Transaction.normalized_concept,
            Category.id,
            Category.name,
            Category.group,
        )
        .outerjoin(Category, Transaction.category_id == Category.id)
        .where(*conds)
        .order_by(Transaction.operation_date.asc(), Transaction.id.asc())
    ).all()

    total = _bucket()
    monthly: dict[str, dict[str, Decimal]] = defaultdict(_bucket)
    by_cat: dict[tuple, dict] = {}
    by_cat_monthly: dict[tuple[int | None, str], Decimal] = defaultdict(lambda: ZERO)
    merchant_charges: dict[str, list[tuple[date, Decimal, str, str | None]]] = defaultdict(list)

    for op_date, amount, is_transfer, concept, norm_concept, cat_id, cat_name, group in rows:
        _accumulate(total, amount, group, is_transfer)
        ym = op_date.strftime("%Y-%m")
        _accumulate(monthly[ym], amount, group, is_transfer)
        if amount < 0 and not is_transfer and group not in ("transfer", "savings", "income"):
            key = (cat_id, cat_name or "Sin categoría", group or "other")
            entry = by_cat.setdefault(key, {"amount": ZERO, "count": 0})
            entry["amount"] += -amount
            entry["count"] += 1
            by_cat_monthly[(cat_id, ym)] += -amount
            m_key = extract_merchant(concept or norm_concept or "") or (norm_concept or "OTROS")[:24]
            merchant_charges[m_key].append((op_date, -amount, concept, cat_name))

    income = total["income"]
    expenses = total["needs"] + total["wants"] + total["other"]
    net = income - expenses
    remaining_savings = income - expenses  # todo lo no gastado (incluye inversiones)
    actual = {"needs": total["needs"], "wants": total["wants"] + total["other"], "savings": max(remaining_savings, ZERO)}

    def pct(v: Decimal) -> float:
        return round(float(v / income * 100), 1) if income > 0 else 0.0

    accounts_q = select(Account).where(Account.workspace_id == workspace_id)
    if account_id:
        accounts_q = accounts_q.where(Account.id == account_id)
    accounts = db.scalars(accounts_q.order_by(Account.type, Account.name)).all()

    # Cálculo de lo que la Cuenta Común debe a cada usuario/titular y sincronización del saldo real
    all_accounts = {a.id: a for a in db.scalars(select(Account).where(Account.workspace_id == workspace_id)).all()}
    dirty_bal = False
    for acc_obj in all_accounts.values():
        has_txs = db.scalar(select(Transaction.id).where(Transaction.account_id == acc_obj.id).limit(1)) is not None
        if has_txs or (not has_txs and acc_obj.current_balance != (acc_obj.initial_balance or ZERO)):
            prev_b = acc_obj.current_balance
            recalculate_account_balance(db, acc_obj)
            if acc_obj.current_balance != prev_b:
                dirty_bal = True
    if dirty_bal:
        db.commit()
    debt_conds = [
        Transaction.workspace_id == workspace_id,
        Transaction.is_owed_by_joint.is_(True),
    ]
    if date_from:
        debt_conds.append(Transaction.operation_date >= date_from)
    if date_to:
        debt_conds.append(Transaction.operation_date <= date_to)
    debt_rows = db.scalars(
        select(Transaction).where(*debt_conds).order_by(Transaction.operation_date.desc(), Transaction.id.desc())
    ).all()

    by_owner_map: dict[str, dict] = {}
    for acc_item in all_accounts.values():
        if acc_item.type == "joint":
            continue
        owner_key = resolve_account_owner(acc_item)
        if owner_key and owner_key.lower() not in ("cuenta común", "cuenta comun", "común", "comun", "conjunta"):
            by_owner_map.setdefault(
                owner_key,
                {
                    "owner": owner_key,
                    "pending_amount": ZERO,
                    "settled_amount": ZERO,
                    "pending_count": 0,
                    "accounts": {},
                    "items": [],
                },
            )
    total_pending_debt = ZERO
    total_settled_debt = ZERO
    for tx in debt_rows:
        acc = all_accounts.get(tx.account_id)
        if not acc or acc.type == "joint":
            continue
        owner = resolve_account_owner(acc)
        amt = abs(tx.amount)
        entry = by_owner_map.setdefault(
            owner,
            {
                "owner": owner,
                "pending_amount": ZERO,
                "settled_amount": ZERO,
                "pending_count": 0,
                "accounts": {},
                "items": [],
            },
        )
        if tx.joint_settled:
            entry["settled_amount"] += amt
            total_settled_debt += amt
        else:
            entry["pending_amount"] += amt
            entry["pending_count"] += 1
            total_pending_debt += amt
            acc_entry = entry["accounts"].setdefault(
                acc.id,
                {"account_id": acc.id, "account_name": acc.name, "bank": acc.bank, "amount": ZERO, "count": 0},
            )
            acc_entry["amount"] += amt
            acc_entry["count"] += 1
            entry["items"].append(
                {
                    "id": tx.id,
                    "operation_date": tx.operation_date.isoformat(),
                    "concept": tx.concept,
                    "amount": float(amt),
                    "account_id": acc.id,
                    "account_name": acc.name,
                }
            )

    by_owner_list = sorted(
        [
            {
                "owner": v["owner"],
                "pending_amount": float(v["pending_amount"]),
                "settled_amount": float(v["settled_amount"]),
                "pending_count": v["pending_count"],
                "accounts": [
                    {**a, "amount": float(a["amount"])} for a in v["accounts"].values()
                ],
                "items": v["items"][:20],
            }
            for v in by_owner_map.values()
        ],
        key=lambda x: (-x["pending_amount"], x["owner"]),
    )

    # Tarjetas vinculadas a cuentas bancarias (sus gastos repercuten en el saldo de la cuenta a la que pertenecen)
    cards_by_parent: dict[int, list[Account]] = defaultdict(list)
    for acc_item in all_accounts.values():
        if acc_item.linked_account_id and acc_item.linked_account_id in all_accounts:
            cards_by_parent[acc_item.linked_account_id].append(acc_item)

    balances_list: list[dict] = []
    for a in accounts:
        base_bal = a.current_balance or ZERO
        linked_cards = cards_by_parent.get(a.id, [])
        cards_bal = sum(((c.current_balance or ZERO) for c in linked_cards), ZERO)
        effective_bal = base_bal + cards_bal
        parent = all_accounts.get(a.linked_account_id) if a.linked_account_id else None
        balances_list.append(
            {
                "account_id": a.id,
                "name": a.name,
                "type": a.type,
                "bank": a.bank,
                "base_balance": float(base_bal),
                "linked_cards_balance": float(cards_bal),
                "current_balance": float(effective_bal),
                "effective_balance": float(effective_bal),
                "linked_account_id": a.linked_account_id if parent else None,
                "linked_account_name": parent.name if parent else None,
                "linked_cards": [
                    {
                        "account_id": c.id,
                        "name": c.name,
                        "current_balance": float(c.current_balance or ZERO),
                    }
                    for c in linked_cards
                ],
                "balance_date": a.balance_date.isoformat() if a.balance_date else None,
            }
        )

    non_card_accounts = [a for a in accounts if a.type != "credit_card"]
    if non_card_accounts:
        total_balance = sum(
            (
                (a.current_balance or ZERO)
                + sum(((c.current_balance or ZERO) for c in cards_by_parent.get(a.id, [])), ZERO)
                for a in non_card_accounts
            ),
            ZERO,
        )
    else:
        total_balance = sum(((a.current_balance or ZERO) for a in accounts), ZERO)

    ws_obj = db.get(Workspace, workspace_id)
    targets = {
        "needs": (ws_obj.target_needs if ws_obj and ws_obj.target_needs is not None else DEFAULT_TARGETS["needs"]),
        "wants": (ws_obj.target_wants if ws_obj and ws_obj.target_wants is not None else DEFAULT_TARGETS["wants"]),
        "savings": (ws_obj.target_savings if ws_obj and ws_obj.target_savings is not None else DEFAULT_TARGETS["savings"]),
    }

    # 1. Detector automático de Suscripciones / Gastos Fijos y «Gastos Hormiga / Vampiro»
    subscriptions_list: list[dict] = []
    ant_expenses_list: list[dict] = []
    active_months_count = max(1, len(monthly))

    for m_key, charges in merchant_charges.items():
        charges_sorted = sorted(charges, key=lambda x: x[0])
        amounts = [c[1] for c in charges_sorted]
        count = len(charges_sorted)
        avg_amt = sum(amounts, ZERO) / Decimal(count)
        last_date, last_amt, sample_concept, cat_label = charges_sorted[-1]
        prev_amt = charges_sorted[-2][1] if count >= 2 else None
        upper_concept = (sample_concept or "").upper()
        is_known_sub = any(k in upper_concept or k in m_key.upper() for k in KNOWN_SUBSCRIPTION_HINTS)

        # Variación de importe pequeña (cargo recurrente / fijo) o comercio de suscripción/suministro conocido
        min_amt, max_amt = min(amounts), max(amounts)
        similar_amounts = count >= 2 and (max_amt - min_amt) <= max(Decimal("5.00"), avg_amt * Decimal("0.25"))

        if is_known_sub or (similar_amounts and avg_amt > Decimal("4.00")):
            # Determina frecuencia (mensual vs anual)
            if count >= 2:
                span_days = max(1, (charges_sorted[-1][0] - charges_sorted[0][0]).days)
                avg_gap = span_days / max(1, count - 1)
            else:
                avg_gap = 30.0
            frequency = "annual" if avg_gap >= 300 else "monthly"
            monthly_est = (last_amt / Decimal("12")) if frequency == "annual" else last_amt
            annual_est = last_amt if frequency == "annual" else (last_amt * Decimal("12"))
            price_inc = bool(prev_amt is not None and last_amt > prev_amt + Decimal("0.05"))
            price_diff = float(last_amt - prev_amt) if (prev_amt is not None and price_inc) else 0.0
            subscriptions_list.append(
                {
                    "merchant": m_key,
                    "sample_concept": sample_concept,
                    "category_name": cat_label or "Sin categoría",
                    "frequency": frequency,
                    "occurrences": count,
                    "last_date": last_date.isoformat(),
                    "last_amount": float(round(last_amt, 2)),
                    "prev_amount": float(round(prev_amt, 2)) if prev_amt is not None else None,
                    "monthly_cost": float(round(monthly_est, 2)),
                    "annual_cost": float(round(annual_est, 2)),
                    "price_increase": price_inc,
                    "price_diff": round(price_diff, 2),
                }
            )
        elif (count >= 2 and avg_amt <= Decimal("20.00")) or (count == 1 and avg_amt <= Decimal("12.00")):
            total_ant = sum(amounts, ZERO)
            monthly_ant = total_ant / Decimal(active_months_count)
            ant_expenses_list.append(
                {
                    "merchant": m_key,
                    "sample_concept": sample_concept,
                    "category_name": cat_label or "Sin categoría",
                    "occurrences": count,
                    "avg_amount": float(round(avg_amt, 2)),
                    "total_spent": float(round(total_ant, 2)),
                    "annual_cost": float(round(monthly_ant * Decimal("12"), 2)),
                }
            )

    subscriptions_list.sort(key=lambda x: (-int(x["price_increase"]), -x["monthly_cost"]))
    ant_expenses_list.sort(key=lambda x: (-x["total_spent"], -x["occurrences"]))
    total_sub_monthly = round(sum(s["monthly_cost"] for s in subscriptions_list), 2)
    total_sub_annual = round(sum(s["annual_cost"] for s in subscriptions_list), 2)
    total_ant_spent = round(sum(a["total_spent"] for a in ant_expenses_list), 2)

    # 2. Presupuestos por Categoría + Semáforo (<80% ok, 80-100% warning, >100% exceeded) + Proyección lineal a día 30
    all_categories = db.scalars(
        select(Category).where(Category.workspace_id == workspace_id).order_by(Category.group, Category.name)
    ).all()
    latest_ym = max(monthly.keys()) if monthly else date.today().strftime("%Y-%m")
    # Día de referencia en el mes activo para la proyección lineal a 30 días
    ref_dates_in_ym = [r[0] for r in rows if r[0].strftime("%Y-%m") == latest_ym]
    if ref_dates_in_ym:
        latest_day_in_month = max(d.day for d in ref_dates_in_ym)
        year_i, month_i = int(latest_ym[:4]), int(latest_ym[5:7])
        days_in_month = calendar.monthrange(year_i, month_i)[1]
    else:
        latest_day_in_month = date.today().day
        days_in_month = 30
    elapsed_ratio = max(0.15, min(1.0, latest_day_in_month / max(1, days_in_month)))

    category_budgets_list: list[dict] = []
    for cat_obj in all_categories:
        if cat_obj.group in ("income", "transfer"):
            continue
        spent_month = float(by_cat_monthly.get((cat_obj.id, latest_ym), ZERO))
        budget_val = float(cat_obj.monthly_budget) if cat_obj.monthly_budget is not None else None
        if budget_val is None and spent_month == 0:
            continue
        projected_val = round(spent_month / elapsed_ratio, 2) if spent_month > 0 else 0.0
        if budget_val and budget_val > 0:
            used_pct = round(spent_month / budget_val * 100.0, 1)
            proj_pct = round(projected_val / budget_val * 100.0, 1)
            status_str = "exceeded" if used_pct > 100 else ("warning" if used_pct >= 80 else "ok")
            proj_status = "exceeded" if proj_pct > 100 else ("warning" if proj_pct >= 80 else "ok")
        else:
            used_pct = 0.0
            proj_pct = 0.0
            status_str = "unconfigured"
            proj_status = "unconfigured"
        category_budgets_list.append(
            {
                "category_id": cat_obj.id,
                "name": cat_obj.name,
                "group": cat_obj.group,
                "month": latest_ym,
                "monthly_budget": budget_val,
                "spent": round(spent_month, 2),
                "pct": used_pct,
                "status": status_str,
                "projected_amount": projected_val,
                "projected_pct": proj_pct,
                "projected_status": proj_status,
            }
        )
    category_budgets_list.sort(
        key=lambda x: (x["monthly_budget"] is None, -(x["pct"] if x["monthly_budget"] else x["spent"]))
    )

    # 3. Huchas / Objetivos de Ahorro (Sinking Funds)
    goals = db.scalars(
        select(SavingsGoal).where(SavingsGoal.workspace_id == workspace_id).order_by(SavingsGoal.id.asc())
    ).all()
    savings_goals_out = [serialize_savings_goal(g).model_dump() for g in goals]

    return {
        "kpis": {
            "income": float(income),
            "expenses": float(expenses),
            "net_savings": float(net),
            "savings_rate": pct(net),
            "invested": float(total["savings"]),
            "internal_transfers": float(total["transfers"]),
            "total_balance": float(total_balance),
        },
        "joint_debts": {
            "total_pending": float(total_pending_debt),
            "total_settled": float(total_settled_debt),
            "by_owner": by_owner_list,
        },
        "rule_503020": [
            {
                "key": k,
                "label": LABELS[k],
                "target_pct": targets[k],
                "amount": float(actual[k]),
                "actual_pct": pct(actual[k]),
                "target_amount": float(income * Decimal(targets[k]) / Decimal(100)),
            }
            for k in ("needs", "wants", "savings")
        ],
        "subscriptions_and_vampires": {
            "total_monthly_subscriptions": total_sub_monthly,
            "total_annual_subscriptions": total_sub_annual,
            "total_ant_expenses": total_ant_spent,
            "price_increase_alerts": sum(1 for s in subscriptions_list if s["price_increase"]),
            "subscriptions": subscriptions_list[:15],
            "ant_expenses": ant_expenses_list[:12],
        },
        "category_budgets": category_budgets_list,
        "savings_goals": savings_goals_out,
        "unclassified_expenses": float(total["other"]),
        "monthly": [
            {"month": m, **{k: float(v) for k, v in b.items()}} for m, b in sorted(monthly.items())
        ],
        "top_categories": sorted(
            [{"category_id": k[0], "name": k[1], "group": k[2], "amount": float(v["amount"]), "count": v["count"]}
             for k, v in by_cat.items()],
            key=lambda x: -x["amount"],
        )[:10],
        "balances": balances_list,
    }


@router.get("/summary")
def summary(
    account_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    ws: Workspace = Depends(get_workspace),
    db: Session = Depends(get_db),
):
    return summarize(db, ws.id, account_id, date_from, date_to)
