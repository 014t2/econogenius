"""Datos iniciales por espacio: categorías 50/30/20, reglas por comercio y palabras clave de traspaso."""
from sqlalchemy.orm import Session

from app.models import Category, Rule

CATEGORIES: list[tuple[str, str, str]] = [
    # Necesidades (50%)
    ("Casa", "needs", "home"),
    ("Hogar", "needs", "lamp"),
    ("Alimentos", "needs", "shopping-cart"),
    ("Seguro", "needs", "shield"),
    ("Vehículos", "needs", "car"),
    ("Transporte", "needs", "bus"),
    ("Salud y Bienestar", "needs", "heart-pulse"),
    ("Educación y Formación", "needs", "graduation-cap"),
    ("Compras", "needs", "shopping-bag"),
    ("Deuda", "needs", "landmark"),
    # Ocio (30%)
    ("Restaurantes y Ocio", "wants", "utensils"),
    ("Entretenimientos", "wants", "clapperboard"),
    ("Viajes", "wants", "plane"),
    ("Cajero", "wants", "banknote"),
    ("Otros", "wants", "shapes"),
    # Ahorro (20%)
    ("Inversiones", "savings", "trending-up"),
    # Ingresos
    ("Sueldo", "income", "briefcase"),
    ("Alquiler", "income", "key"),
    ("Intereses", "income", "percent"),
    ("Hacienda", "income", "file-text"),
    ("Otros Ingresos", "income", "plus-circle"),
    # Transferencias internas (excluidas del 50/30/20)
    ("Traspaso Cuenta Común", "transfer", "users"),
    ("Liquidación Tarjeta de Crédito", "transfer", "credit-card"),
    ("Traspaso entre Cuentas", "transfer", "arrow-left-right"),
]

# (patrón, categoría, dirección, prioridad)
RULES: list[tuple[str, str, str, int]] = [
    ("CUOTA PTMO", "Casa", "any", 0),
    ("CUOTA HIPOTECA", "Casa", "any", 0),
    ("PRESTAMO HIPOTECARIO", "Casa", "any", 0),
    ("MAIL.KUOTA", "Casa", "any", 0),
    ("IBERDROLA", "Hogar", "any", 0),
    ("ENDESA", "Hogar", "any", 0),
    ("NATURGY", "Hogar", "any", 0),
    ("MOVISTAR", "Hogar", "any", 0),
    ("VODAFONE", "Hogar", "any", 0),
    ("ORANGE", "Hogar", "any", 0),
    ("DIGI SPAIN", "Hogar", "any", 0),
    ("SIMYO", "Hogar", "any", 0),
    ("IKEA BARAKALDO HFB", "Hogar", "any", 0),
    ("IKEA IBERICA", "Hogar", "any", 0),
    ("ELEKAM LED", "Hogar", "any", 0),
    ("SUMINISTROS IND.ADARRA", "Hogar", "any", 0),
    ("LIDL", "Alimentos", "any", 0),
    ("MERCADONA", "Alimentos", "any", 0),
    ("EROSKI", "Alimentos", "any", 0),
    ("ALCAMPO", "Alimentos", "any", 0),
    ("CONSUM", "Alimentos", "any", 0),
    ("IGELDOKO NEKAZAL KOPERATI", "Alimentos", "any", 0),
    ("TODO TODO", "Alimentos", "any", 0),
    ("IKEA BARAKALDO FOOD", "Alimentos", "any", 0),
    ("CARREFOUR", "Alimentos", "any", 0),
    ("LUPA", "Alimentos", "any", 0),
    ("KUTXABANK BIZITZA ASEGURUA", "Seguro", "any", 0),
    ("KUTXABANK SEG. HOGAR", "Seguro", "any", 0),
    ("MAPFRE", "Seguro", "any", 0),
    ("ALLIANZ", "Seguro", "any", 0),
    ("MUTUA MADRILENA", "Seguro", "any", 0),
    ("EUSKADI LOW COST", "Vehículos", "any", 0),
    ("REPSOL", "Vehículos", "any", 0),
    ("CEPSA", "Vehículos", "any", 0),
    ("BIDEGI", "Transporte", "any", 0),
    ("MUGI", "Transporte", "any", 0),
    ("RENFE", "Transporte", "any", 0),
    ("AMAZON", "Compras", "any", 0),
    ("EL CORTE INGLES", "Compras", "any", 0),
    ("ZARA", "Compras", "any", 0),
    ("DECATHLON", "Compras", "any", 0),
    ("PRG RETAIL", "Compras", "any", 0),
    ("DG MEGAPARK", "Compras", "any", 0),
    ("NETFLIX", "Entretenimientos", "any", 0),
    ("SPOTIFY", "Entretenimientos", "any", 0),
    ("PAGO CAJERO", "Cajero", "any", 0),
    ("RETIRADA CAJERO", "Cajero", "any", 0),
    ("DISPOSICION CAJERO", "Cajero", "any", 0),
    ("KUTXAZ. ORD.", "Cajero", "any", 0),
    ("ESKUDIRU", "Cajero", "any", 0),
    ("KUTXAZAIN", "Cajero", "any", 0),
    ("LOTERIA", "Otros", "any", 0),
    ("BIZUM", "Otros", "out", 0),
    ("BIZUM", "Otros Ingresos", "in", 0),
    ("NORA TRASP. KB", "Inversiones", "any", 5),
    ("GA RENDIMIENTO", "Inversiones", "any", 5),
    ("MYINVESTOR", "Inversiones", "any", 5),
    ("INDEXA CAPITAL", "Inversiones", "any", 5),
    ("DEGIRO", "Inversiones", "any", 5),
    ("NOMINA", "Sueldo", "in", 5),
    ("LIQ. DE INT.", "Intereses", "any", 0),
    ("LIQUIDACION INTERESES", "Intereses", "any", 0),
    ("LIK.: INT.", "Intereses", "any", 0),
    ("TARJ.CRDTO", "Liquidación Tarjeta de Crédito", "any", 10),
    ("KRED. TXAR.", "Liquidación Tarjeta de Crédito", "any", 10),
    ("PAGO RECIBO", "Liquidación Tarjeta de Crédito", "any", 10),
    ("ORDAINAGIRIA ORDAINTZEA", "Liquidación Tarjeta de Crédito", "any", 10),
    ("LIQUIDACION TARJETA", "Liquidación Tarjeta de Crédito", "any", 10),
    ("RECIBO TARJETA", "Liquidación Tarjeta de Crédito", "any", 10),
]

# Palabras clave configurables de traspaso entre cuentas personales y común (cualquier banco).
TRANSFER_KEYWORDS: list[str] = [
    "OP.NET",
    "NET ER.",
    "TRASPASO PROPIO",
    "TRANSFERENCIA PROPIA",
    "TRASPASO ENTRE CUENTAS",
]


def seed_workspace(db: Session, workspace_id: int) -> None:
    by_name: dict[str, Category] = {}
    for name, group, icon in CATEGORIES:
        cat = Category(workspace_id=workspace_id, name=name, group=group, icon=icon, is_system=True)
        db.add(cat)
        by_name[name] = cat
    db.flush()
    for pattern, cat_name, direction, priority in RULES:
        db.add(
            Rule(
                workspace_id=workspace_id,
                kind="category",
                pattern=pattern,
                direction=direction,
                priority=priority,
                category_id=by_name[cat_name].id,
            )
        )
    for kw in TRANSFER_KEYWORDS:
        db.add(
            Rule(
                workspace_id=workspace_id,
                kind="transfer",
                pattern=kw,
                category_id=by_name["Traspaso entre Cuentas"].id,
                priority=20,
            )
        )
    db.flush()
