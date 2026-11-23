"""Servicio de importación: validación -> parseo -> dedup -> categorización -> conciliación -> preview -> confirmación."""
from __future__ import annotations

from collections import Counter
from datetime import timedelta
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.accounts.router import recalculate_account_balance
from app.core.deps import get_in_workspace
from app.imports.dedup import compute_transaction_hash
from app.imports.parsers import ParserError, parse_file
from app.imports.parsers.utils import normalize_concept
from app.imports.reconciliation import CAT_BETWEEN, RecRow, reconcile
from app.imports.validators import validate_upload
from app.models import Account, Category, ImportBatch, Transaction, User, Workspace
from app.rules.engine import Categorizer, extract_merchant
from app.rules.router import load_rule_specs


def _digits(s: str | None) -> str:
    return "".join(ch for ch in (s or "") if ch.isdigit())


class ImportService:
    def __init__(self, db: Session, workspace: Workspace, user: User):
        self.db = db
        self.ws = workspace
        self.user = user

    # ------------------------------------------------------------------ helpers
    def _categories(self) -> dict[str, Category]:
        cats = self.db.scalars(select(Category).where(Category.workspace_id == self.ws.id)).all()
        return {c.name: c for c in cats}

    def _accounts(self) -> dict[int, Account]:
        return {a.id: a for a in self.db.scalars(select(Account).where(Account.workspace_id == self.ws.id))}

    # ------------------------------------------------------------------ preview
    def preview(self, account_id: int | None, filename: str | None, content_type: str | None, content: bytes) -> ImportBatch:
        if not account_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Selecciona la cuenta destino antes de subir el extracto")
        account = get_in_workspace(self.db, Account, account_id, self.ws.id, "Cuenta")
        ext = validate_upload(filename, content_type, content)
        try:
            parsed = parse_file(ext, content)
        except ParserError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))

        warnings = list(parsed.warnings)
        if parsed.account_number and (account.iban or account.card_number):
            detected = _digits(parsed.account_number)
            known = [_digits(account.iban), _digits(account.card_number)]
            if detected and not any(k and (k.endswith(detected[-10:]) or detected.endswith(k[-10:])) for k in known):
                warnings.append(
                    f"El número detectado en el extracto ({parsed.account_number}) no coincide con la cuenta «{account.name}»."
                )
        if (
            account.type == "credit_card"
            and parsed.detected_format.startswith("kutxabank_pdf")
            and any(t.balance is not None for t in parsed.transactions)
        ):
            warnings.append("Has seleccionado una tarjeta pero el fichero parece un extracto de cuenta corriente.")
        if account.type != "credit_card" and parsed.detected_format.endswith("_card"):
            warnings.append("El fichero parece de movimientos de tarjeta pero la cuenta seleccionada no es una tarjeta.")

        cats = self._categories()
        cat_by_id = {c.id: c for c in cats.values()}
        specs = load_rule_specs(self.db, self.ws.id)
        cz = Categorizer(specs)
        keywords = [s.pattern for s in specs if s.kind == "transfer"]
        existing_hashes = set(
            self.db.scalars(select(Transaction.transaction_hash).where(Transaction.account_id == account.id))
        )

        # Hash con contador de ocurrencias para movimientos idénticos en el mismo fichero
        occurrences: Counter[tuple] = Counter()
        rows: list[dict] = []
        rec_rows: list[RecRow] = []
        for idx, tx in enumerate(parsed.transactions):
            norm = normalize_concept(tx.concept)
            key = (tx.operation_date, tx.value_date, tx.amount, norm)
            occ = occurrences[key]
            occurrences[key] += 1
            h = compute_transaction_hash(account.id, tx.operation_date, tx.value_date, tx.amount, norm, occ)
            rule = cz.match(norm, tx.amount)
            category_id = rule.category_id if rule else None
            owed_by_joint = bool(rule and rule.is_owed_by_joint and account.type != "joint" and tx.amount < 0)
            rows.append(
                {
                    "index": idx,
                    "operation_date": tx.operation_date.isoformat(),
                    "value_date": tx.value_date.isoformat() if tx.value_date else None,
                    "concept": tx.concept,
                    "normalized_concept": norm,
                    "amount": str(tx.amount),
                    "balance": str(tx.balance) if tx.balance is not None else None,
                    "transaction_hash": h,
                    "is_duplicate": h in existing_hashes,
                    "category_id": category_id,
                    "rule_id": rule.id if rule else None,
                    "is_internal_transfer": False,
                    "is_owed_by_joint": owed_by_joint,
                    "transfer_reason": None,
                    "pair_ref": None,
                    "alerts": [],
                    "merchant_hint": extract_merchant(tx.concept),
                }
            )
            rec_rows.append(
                RecRow(
                    ref=f"new:{idx}", account_id=account.id, account_type=account.type, account_name=account.name,
                    operation_date=tx.operation_date, amount=tx.amount, normalized_concept=norm,
                )
            )

        # Conciliación contra movimientos de las otras cuentas del espacio
        existing_updates: list[dict] = []
        if rec_rows:
            accounts = self._accounts()
            start = min(r.operation_date for r in rec_rows) - timedelta(days=7)
            end = max(r.operation_date for r in rec_rows) + timedelta(days=7)
            existing = self.db.scalars(
                select(Transaction).where(
                    Transaction.workspace_id == self.ws.id,
                    Transaction.account_id != account.id,
                    Transaction.operation_date.between(start, end),
                )
            ).all()
            existing_rec = [
                RecRow(
                    ref=f"db:{t.id}", account_id=t.account_id, account_type=accounts[t.account_id].type,
                    account_name=accounts[t.account_id].name, operation_date=t.operation_date, amount=t.amount,
                    normalized_concept=t.normalized_concept, is_new=False,
                    is_internal_transfer=t.is_internal_transfer,
                    pair_ref=f"db:{t.transfer_pair_id}" if t.transfer_pair_id else None,
                )
                for t in existing
            ]
            touched = reconcile([r for r, row in zip(rec_rows, rows) if not row["is_duplicate"]], existing_rec, keywords)
            for rr, row in zip(rec_rows, rows):
                row["alerts"] = rr.alerts
                if rr.is_internal_transfer:
                    cat = cats.get(rr.transfer_category or CAT_BETWEEN) or cats.get(CAT_BETWEEN)
                    row.update(
                        is_internal_transfer=True,
                        transfer_reason=rr.transfer_reason,
                        pair_ref=rr.pair_ref,
                        category_id=cat.id if cat else row["category_id"],
                    )
                    if rr.pair_ref:
                        row["pair_description"] = next(
                            (f"{p.account_name} · {p.operation_date:%d/%m/%Y} · {p.amount} €" for p in existing_rec if p.ref == rr.pair_ref),
                            None,
                        )
            for t in touched:
                cat = cats.get(t.transfer_category or CAT_BETWEEN)
                existing_updates.append(
                    {"id": int(t.ref.split(":")[1]), "category_id": cat.id if cat else None, "pair_ref": t.pair_ref}
                )

        # Si el usuario no tiene la categoría (renombrada), evita ids huérfanos
        for row in rows:
            if row["category_id"] is not None and row["category_id"] not in cat_by_id:
                row["category_id"] = None

        batch = ImportBatch(
            workspace_id=self.ws.id,
            account_id=account.id,
            user_id=self.user.id,
            filename=(filename or "extracto")[:255],
            file_type=ext.lstrip("."),
            detected_format=parsed.detected_format,
            language=parsed.language,
            account_number=parsed.account_number,
            period_start=parsed.period_start,
            period_end=parsed.period_end,
            status="preview",
            payload={"rows": rows, "existing_updates": existing_updates, "warnings": warnings},
            total_rows=len(rows),
            duplicate_rows=sum(1 for r in rows if r["is_duplicate"]),
        )
        self.db.add(batch)
        self.db.commit()
        self.db.refresh(batch)
        return batch

    # ------------------------------------------------------------------ confirm
    def confirm(self, batch_id: int, decisions: list[dict]) -> dict:
        batch = get_in_workspace(self.db, ImportBatch, batch_id, self.ws.id, "Importación")
        if batch.status != "preview":
            raise HTTPException(status.HTTP_409_CONFLICT, "Esta importación ya fue confirmada")
        account = get_in_workspace(self.db, Account, batch.account_id, self.ws.id, "Cuenta")
        cats = self._categories()
        valid_cat_ids = {c.id for c in cats.values()}
        transfer_cat_ids = {c.id for c in cats.values() if c.group == "transfer"}
        default_transfer = cats.get(CAT_BETWEEN)
        by_index = {d["index"]: d for d in decisions}
        existing_hashes = set(
            self.db.scalars(select(Transaction.transaction_hash).where(Transaction.account_id == account.id))
        )

        created: dict[int, Transaction] = {}
        skipped_dup = 0
        for row in batch.payload.get("rows", []):
            d = by_index.get(row["index"], {})
            if row["is_duplicate"] or row["transaction_hash"] in existing_hashes:
                skipped_dup += 1
                continue
            if not d.get("include", True):
                continue
            category_id = d.get("category_id", row["category_id"])
            if category_id is not None and category_id not in valid_cat_ids:
                category_id = None
            is_transfer = bool(d.get("is_internal_transfer", row["is_internal_transfer"]))
            if is_transfer and category_id not in transfer_cat_ids:
                category_id = default_transfer.id if default_transfer else None
            if not is_transfer and category_id in transfer_cat_ids:
                is_transfer = True
            is_owed = bool(d.get("is_owed_by_joint", row.get("is_owed_by_joint", False))) and account.type != "joint"
            tx = Transaction(
                workspace_id=self.ws.id,
                account_id=account.id,
                import_batch_id=batch.id,
                operation_date=_d(row["operation_date"]),
                value_date=_d(row["value_date"]) if row["value_date"] else None,
                concept=row["concept"],
                normalized_concept=row["normalized_concept"],
                amount=Decimal(row["amount"]),
                balance=Decimal(row["balance"]) if row["balance"] is not None else None,
                category_id=category_id,
                is_internal_transfer=is_transfer,
                is_owed_by_joint=is_owed,
                joint_settled=False,
                transaction_hash=row["transaction_hash"],
            )
            self.db.add(tx)
            existing_hashes.add(row["transaction_hash"])
            created[row["index"]] = tx
        self.db.flush()

        # Enlaza parejas de transferencias con movimientos ya existentes
        rows_by_index = {r["index"]: r for r in batch.payload.get("rows", [])}
        updates = {u["id"]: u for u in batch.payload.get("existing_updates", [])}
        linked = 0
        for idx, tx in created.items():
            pair_ref = rows_by_index[idx].get("pair_ref")
            if not tx.is_internal_transfer or not pair_ref or not pair_ref.startswith("db:"):
                continue
            other = self.db.get(Transaction, int(pair_ref.split(":")[1]))
            if other is None or other.workspace_id != self.ws.id:
                continue
            tx.transfer_pair_id = other.id
            other.transfer_pair_id = tx.id
            other.is_internal_transfer = True
            upd = updates.get(other.id)
            if upd and upd.get("category_id") in valid_cat_ids:
                other.category_id = upd["category_id"]
            elif other.category_id not in transfer_cat_ids and default_transfer:
                other.category_id = default_transfer.id
            linked += 1

        recalculate_account_balance(self.db, account)
        batch.status = "confirmed"
        batch.imported_rows = len(created)
        batch.duplicate_rows = skipped_dup
        self.db.commit()
        return {
            "batch_id": batch.id,
            "imported": len(created),
            "duplicates_skipped": skipped_dup,
            "transfers_linked": linked,
            "account_balance": float(account.current_balance),
        }


def _d(s: str):
    from datetime import date

    return date.fromisoformat(s)
