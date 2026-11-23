from tests.conftest import auth, register

CSV_CHECKING = (
    "Fecha;Concepto;Fecha valor;Importe;Saldo\n"
    "30/09/2026;OP.NET Etxea Olatz;30/09/2026;1.200,00;3.527,49\n"
    "29/09/2026;KRED. TXAR. 4921074004230143;29/09/2026;-402,99;2.327,49\n"
    "28/09/2026;COMPRA EN LIDL OIARTZUN;28/09/2026;-45,10;2.730,48\n"
    "25/09/2026;NOMINA EMPRESA SL;25/09/2026;2.150,00;2.775,58\n"
).encode()


def _setup(client):
    data = register(client, "olatz@example.com", "Olatz")
    token = data["access_token"]
    acc = client.post("/api/accounts", json={"name": "Olatz", "type": "checking"}, headers=auth(token)).json()
    card = client.post("/api/accounts", json={"name": "Tarjeta Olatz", "type": "credit_card"}, headers=auth(token)).json()
    return token, acc, card


def test_register_login_refresh_and_me(client):
    data = register(client, "a@example.com")
    assert data["user"]["workspaces"][0]["is_personal"] is True
    assert "fc_refresh" in client.cookies
    r = client.post("/api/auth/login", json={"email": "a@example.com", "password": "Secreto123"})
    assert r.status_code == 200
    r = client.post("/api/auth/refresh")
    assert r.status_code == 200 and r.json()["access_token"]
    assert client.get("/api/auth/me", headers=auth(r.json()["access_token"])).status_code == 200
    assert client.post("/api/auth/login", json={"email": "a@example.com", "password": "mala1234"}).status_code == 401


def test_import_preview_confirm_and_dedup(client):
    token, acc, _ = _setup(client)
    files = {"file": ("movimientos.csv", CSV_CHECKING, "text/csv")}
    r = client.post("/api/imports/preview", data={"account_id": acc["id"]}, files=files, headers=auth(token))
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["stats"]["total"] == 4 and p["stats"]["duplicates"] == 0
    rows = {row["concept"]: row for row in p["rows"]}
    assert rows["OP.NET Etxea Olatz"]["is_internal_transfer"] is True
    assert rows["KRED. TXAR. 4921074004230143"]["is_internal_transfer"] is True
    assert rows["COMPRA EN LIDL OIARTZUN"]["is_internal_transfer"] is False
    assert rows["COMPRA EN LIDL OIARTZUN"]["category_id"] is not None

    r = client.post(f"/api/imports/{p['batch_id']}/confirm", json={"decisions": []}, headers=auth(token))
    assert r.status_code == 200 and r.json()["imported"] == 4
    assert r.json()["account_balance"] == 3527.49

    # Segunda subida del mismo extracto => todo duplicado
    r = client.post("/api/imports/preview", data={"account_id": acc["id"]}, files=files, headers=auth(token))
    assert r.json()["stats"]["duplicates"] == 4

    s = client.get("/api/analytics/summary", headers=auth(token)).json()
    assert s["kpis"]["income"] == 2150.0  # OP.NET excluido por ser traspaso interno
    assert s["kpis"]["expenses"] == 45.10  # KRED. TXAR. excluido


def test_card_settlement_links_both_accounts(client):
    token, acc, card = _setup(client)
    card_csv = "fecha;concepto;fecha valor;importe de la operación\n29/09/2026;PAGO RECIBO 4921074004230143;29/09/2026;402.99\n"
    r = client.post("/api/imports/preview", data={"account_id": card["id"]},
                    files={"file": ("tarjeta.csv", card_csv.encode(), "text/csv")}, headers=auth(token))
    client.post(f"/api/imports/{r.json()['batch_id']}/confirm", json={"decisions": []}, headers=auth(token))
    r = client.post("/api/imports/preview", data={"account_id": acc["id"]},
                    files={"file": ("movimientos.csv", CSV_CHECKING, "text/csv")}, headers=auth(token))
    kred = next(x for x in r.json()["rows"] if x["concept"].startswith("KRED"))
    assert kred["pair_description"] and "Tarjeta Olatz" in kred["pair_description"]
    res = client.post(f"/api/imports/{r.json()['batch_id']}/confirm", json={"decisions": []}, headers=auth(token)).json()
    assert res["transfers_linked"] == 1


def test_inline_edit_creates_rule(client):
    token, acc, _ = _setup(client)
    csv = "Fecha;Concepto;Fecha valor;Importe;Saldo\n01/10/2026;COMPRA EN FRUTERIA PILI;01/10/2026;-5,00;10,00\n02/10/2026;COMPRA EN FRUTERIA PILI;02/10/2026;-7,00;3,00\n"
    r = client.post("/api/imports/preview", data={"account_id": acc["id"]},
                    files={"file": ("m.csv", csv.encode(), "text/csv")}, headers=auth(token))
    client.post(f"/api/imports/{r.json()['batch_id']}/confirm", json={"decisions": []}, headers=auth(token))
    txs = client.get("/api/transactions", headers=auth(token)).json()["items"]
    assert txs[0]["category_id"] is None and txs[0]["merchant_hint"] == "FRUTERIA"
    cats = client.get("/api/categories", headers=auth(token)).json()
    alimentos = next(c["id"] for c in cats if c["name"] == "Alimentos")
    r = client.patch(f"/api/transactions/{txs[0]['id']}",
                     json={"category_id": alimentos, "create_rule": True}, headers=auth(token))
    assert r.status_code == 200 and r.json()["rule_id"] and r.json()["recategorized"] == 1


def test_workspace_isolation_and_sharing(client):
    t1, acc, _ = _setup(client)
    t2 = register(client, "iosu@example.com", "Iosu")["access_token"]
    # Iosu no ve las cuentas personales de Olatz
    assert client.get("/api/accounts", headers=auth(t2)).json() == []
    assert client.patch(f"/api/accounts/{acc['id']}", json={"name": "x"}, headers=auth(t2)).status_code == 404
    personal_ws = client.get("/api/workspaces", headers=auth(t1)).json()[0]["id"]
    assert client.get("/api/accounts", headers=auth(t2, personal_ws)).status_code == 404
    # No se puede invitar al espacio personal
    assert client.post(f"/api/workspaces/{personal_ws}/members", json={"email": "iosu@example.com"},
                       headers=auth(t1)).status_code == 400
    # Espacio compartido "Familia"
    fam = client.post("/api/workspaces", json={"name": "Familia"}, headers=auth(t1)).json()
    assert client.post(f"/api/workspaces/{fam['id']}/members", json={"email": "iosu@example.com"},
                       headers=auth(t1)).status_code == 201
    client.post("/api/accounts", json={"name": "Cuenta Común", "type": "joint"}, headers=auth(t1, fam["id"]))
    shared = client.get("/api/accounts", headers=auth(t2, fam["id"])).json()
    assert [a["name"] for a in shared] == ["Cuenta Común"]


def test_upload_validation(client):
    token, acc, _ = _setup(client)
    r = client.post("/api/imports/preview", data={"account_id": acc["id"]},
                    files={"file": ("virus.exe", b"MZ...", "application/octet-stream")}, headers=auth(token))
    assert r.status_code == 415
    r = client.post("/api/imports/preview", data={"account_id": acc["id"]},
                    files={"file": ("fake.pdf", b"not a pdf", "application/pdf")}, headers=auth(token))
    assert r.status_code == 415


def test_joint_account_debt_reimbursement_calculation(client):
    token, acc, card = _setup(client)
    # Extracto de Tarjeta Olatz con compra de 50€ por equivocación y suscripción Gemini de 29.99€
    card_csv = (
        "fecha;concepto;fecha valor;importe de la operación\n"
        "10/10/2026;COMPRA SUPERMERCADO;10/10/2026;-50.00\n"
        "11/10/2026;GOOGLE GEMINI SUBSCRIPTION;11/10/2026;-29.99\n"
        "12/10/2026;CAFE PERSONAL;12/10/2026;-2.50\n"
    )
    r = client.post(
        "/api/imports/preview",
        data={"account_id": card["id"]},
        files={"file": ("tarjeta_olatz.csv", card_csv.encode(), "text/csv")},
        headers=auth(token),
    )
    assert r.status_code == 200
    preview = r.json()
    # Marcamos en la previsualización que los 50€ y los 29.99€ de Gemini los debe la Cuenta Común
    decisions = [
        {"index": 0, "include": True, "is_owed_by_joint": True},
        {"index": 1, "include": True, "is_owed_by_joint": True},
        {"index": 2, "include": True, "is_owed_by_joint": False},
    ]
    r = client.post(
        f"/api/imports/{preview['batch_id']}/confirm",
        json={"decisions": decisions},
        headers=auth(token),
    )
    assert r.status_code == 200

    summary = client.get("/api/analytics/summary", headers=auth(token)).json()
    assert summary["joint_debts"]["total_pending"] == 79.99
    olatz_debt = next(d for d in summary["joint_debts"]["by_owner"] if d["owner"] == "Olatz")
    assert olatz_debt["pending_amount"] == 79.99
    assert olatz_debt["pending_count"] == 2

    # Liquidamos la deuda de la Cuenta Común hacia Olatz una vez transferida
    res = client.post("/api/transactions/settle-joint", json={"owner": "Olatz"}, headers=auth(token)).json()
    assert res["settled_count"] == 2 and res["settled_amount"] == 79.99
    summary_after = client.get("/api/analytics/summary", headers=auth(token)).json()
    assert summary_after["joint_debts"]["total_pending"] == 0.0
    assert summary_after["joint_debts"]["total_settled"] == 79.99


def test_bulk_and_individual_delete_transactions(client):
    token, acc, _ = _setup(client)
    for i in range(4):
        r = client.post(
            "/api/transactions",
            json={
                "account_id": acc["id"],
                "operation_date": f"2026-10-1{i}",
                "concept": f"COMPRA TEST {i}",
                "amount": -(10.0 + i),
            },
            headers=auth(token),
        )
        assert r.status_code == 201

    txs = client.get("/api/transactions", headers=auth(token)).json()["items"]
    assert len(txs) == 4

    # 1. Eliminación individual
    r_del = client.delete(f"/api/transactions/{txs[0]['id']}", headers=auth(token))
    assert r_del.status_code == 204
    txs_after_one = client.get("/api/transactions", headers=auth(token)).json()["items"]
    assert len(txs_after_one) == 3

    # 2. Eliminación por selección de IDs
    r_bulk = client.post(
        "/api/transactions/bulk-delete",
        json={"transaction_ids": [txs[1]["id"], txs[2]["id"]], "delete_all": False},
        headers=auth(token),
    )
    assert r_bulk.status_code == 200
    assert r_bulk.json()["deleted"] == 2

    # 3. Eliminación de todas las transacciones restantes (delete_all=True)
    r_all = client.post(
        "/api/transactions/bulk-delete",
        json={"transaction_ids": [], "delete_all": True},
        headers=auth(token),
    )
    assert r_all.status_code == 200
    assert r_all.json()["deleted"] == 1
    assert client.get("/api/transactions", headers=auth(token)).json()["total"] == 0


def test_linked_card_expenses_affect_bank_account_balance(client):
    token, acc, card = _setup(client)
    # 1. El usuario indica que en la cuenta bancaria «Olatz» tiene 1.500,00 €
    r = client.patch(f"/api/accounts/{acc['id']}", json={"current_balance": 1500.00}, headers=auth(token))
    assert r.status_code == 200

    # 2. Sube gastos en «Tarjeta Olatz» (-50.00 € y -29.99 € = -79.99 €)
    card_csv = (
        "fecha;concepto;fecha valor;importe de la operación\n"
        "10/10/2026;COMPRA SUPERMERCADO;10/10/2026;-50.00\n"
        "11/10/2026;GOOGLE GEMINI SUBSCRIPTION;11/10/2026;-29.99\n"
    )
    prev = client.post(
        "/api/imports/preview",
        data={"account_id": card["id"]},
        files={"file": ("tarjeta.csv", card_csv.encode(), "text/csv")},
        headers=auth(token),
    ).json()
    client.post(f"/api/imports/{prev['batch_id']}/confirm", json={"decisions": []}, headers=auth(token))

    # Sin vincular todavía: la cuenta bancaria mantiene 1.500,00 €
    s_before = client.get("/api/analytics/summary", headers=auth(token)).json()
    assert s_before["kpis"]["total_balance"] == 1500.00

    # 3. Vinculamos «Tarjeta Olatz» a la cuenta bancaria «Olatz»
    r_link = client.patch(
        f"/api/accounts/{card['id']}",
        json={"linked_account_id": acc["id"]},
        headers=auth(token),
    )
    assert r_link.status_code == 200
    assert r_link.json()["linked_account_id"] == acc["id"]
    assert r_link.json()["linked_account_name"] == "Olatz"

    # Ahora los gastos de la tarjeta (-79.99 €) repercuten en el saldo de «Olatz» (1.500,00 - 79,99 = 1.420,01 €)
    s_after = client.get("/api/analytics/summary", headers=auth(token)).json()
    assert s_after["kpis"]["total_balance"] == 1420.01
    olatz_bal = next(b for b in s_after["balances"] if b["account_id"] == acc["id"])
    assert olatz_bal["base_balance"] == 1500.00
    assert olatz_bal["linked_cards_balance"] == -79.99
    assert olatz_bal["current_balance"] == 1420.01


def test_subscriptions_budgets_goals_onboarding_backup_and_rgpd(client):
    data = register(client, "nuevo@example.com", "Laura")
    token = data["access_token"]

    # 1. Onboarding Wizard (3 pasos: En pareja, titulares + bancos + regla 60/20/20)
    r_onb = client.post(
        "/api/workspaces/onboarding",
        json={
            "mode": "couple",
            "members": [
                {"name": "Laura", "bank": "BBVA", "initial_balance": 2000.0, "has_card": True},
                {"name": "Carlos", "bank": "ING", "initial_balance": 1800.0, "has_card": True},
            ],
            "create_joint_account": True,
            "joint_account_name": "Cuenta Común",
            "joint_bank": "Kutxabank",
            "joint_initial_balance": 500.0,
            "target_needs": 60,
            "target_wants": 20,
            "target_savings": 20,
        },
        headers=auth(token),
    )
    assert r_onb.status_code == 200
    assert "Laura" in r_onb.json()["created_accounts"]
    assert "Tarjeta Laura" in r_onb.json()["created_accounts"]
    assert r_onb.json()["targets"]["needs"] == 60

    accs = client.get("/api/accounts", headers=auth(token)).json()
    laura_acc = next(a for a in accs if a["name"] == "Laura")

    # 2. Presupuesto por categoría (ej. Entretenimientos = 25 €/mes)
    cats = client.get("/api/categories", headers=auth(token)).json()
    ent_cat = next(c for c in cats if c["name"] == "Entretenimientos")
    r_cat = client.patch(
        f"/api/categories/{ent_cat['id']}",
        json={"monthly_budget": 25.0},
        headers=auth(token),
    )
    assert r_cat.status_code == 200 and r_cat.json()["monthly_budget"] == 25.0

    # 3. Movimientos de suscripción con subida de precio (Netflix 12.99 -> 15.99) y gastos hormiga
    for dt_str, concept, amt in [
        ("2026-09-10", "NETFLIX.COM SUBSCRIPTION", -12.99),
        ("2026-10-10", "NETFLIX.COM SUBSCRIPTION", -15.99),
        ("2026-10-12", "CAFE PANADERIA", -3.50),
        ("2026-10-15", "CAFE PANADERIA", -4.00),
    ]:
        client.post(
            "/api/transactions",
            json={
                "account_id": laura_acc["id"],
                "operation_date": dt_str,
                "concept": concept,
                "amount": amt,
                "category_id": ent_cat["id"],
            },
            headers=auth(token),
        )

    # 4. Hucha / Objetivo de Ahorro (Sinking Fund)
    r_goal = client.post(
        "/api/workspaces/savings-goals",
        json={
            "name": "Vacaciones Verano",
            "target_amount": 1200.0,
            "current_amount": 300.0,
            "target_date": "2027-06-01",
        },
        headers=auth(token),
    )
    assert r_goal.status_code == 201
    goal_id = r_goal.json()["id"]
    r_goal_upd = client.patch(
        f"/api/workspaces/savings-goals/{goal_id}",
        json={"add_amount": 100.0},
        headers=auth(token),
    )
    assert r_goal_upd.status_code == 200 and r_goal_upd.json()["current_amount"] == 400.0

    # 5. Verificación en Analytics Summary
    summary = client.get("/api/analytics/summary", headers=auth(token)).json()
    assert summary["rule_503020"][0]["target_pct"] == 60
    subs = summary["subscriptions_and_vampires"]["subscriptions"]
    assert any(s["price_increase"] is True and s["price_diff"] == 3.0 for s in subs)
    ants = summary["subscriptions_and_vampires"]["ant_expenses"]
    assert len(ants) >= 1
    cb = next(b for b in summary["category_budgets"] if b["category_id"] == ent_cat["id"])
    assert cb["monthly_budget"] == 25.0 and cb["spent"] == 23.49 and cb["status"] == "warning"
    assert len(summary["savings_goals"]) == 1

    # 6. Exportación CSV y Backup / Restore JSON
    r_csv = client.get("/api/transactions/export-csv", headers=auth(token))
    assert r_csv.status_code == 200 and "NETFLIX.COM SUBSCRIPTION" in r_csv.text
    backup_data = client.get("/api/workspaces/current/backup", headers=auth(token)).json()
    assert len(backup_data["transactions"]) == 4
    r_restore = client.post("/api/workspaces/current/restore", json=backup_data, headers=auth(token))
    assert r_restore.status_code == 200

    # 7. Eliminación irreversible de cuenta y datos (RGPD)
    r_del_me = client.delete("/api/auth/me", headers=auth(token))
    assert r_del_me.status_code == 204
    assert client.get("/api/auth/me", headers=auth(token)).status_code == 401



