# €conogenius — Gestión Financiera Personal y Familiar (Multi-Banco · 50/30/20)

Aplicación web Full-Stack para la gestión y análisis de finanzas personales y familiares bajo la regla **50/30/20**, diseñada específicamente para procesar extractos bancarios reales de **Kutxabank** en **Español** y **Euskera** (`.pdf`, `.xls`, `.xlsx`, `.csv`) con conciliación automática anti-doble contabilidad.

---

## 1. Arquitectura de Carpetas

```text
Finanzas/
├── backend/
│   ├── alembic/
│   │   ├── env.py
│   │   └── versions/0001_initial.py        # Esquema SQL inicial (PostgreSQL / SQLite)
│   ├── app/
│   │   ├── main.py                         # Punto de entrada FastAPI + CORS + Security Headers
│   │   ├── models/__init__.py              # Modelos SQLAlchemy 2.0 (User, Workspace, Account, Category, Rule, ImportBatch, Transaction)
│   │   ├── core/
│   │   │   ├── config.py                   # Configuración Pydantic Settings
│   │   │   ├── database.py                 # Motor SQLAlchemy 2.0 + sesión
│   │   │   ├── security.py                 # Argon2id + JWT Access/Refresh tokens
│   │   │   └── deps.py                     # Aislamiento estricto por Workspace / Usuario
│   │   ├── auth/router.py                  # Login, Registro, Refresh (cookie HttpOnly), Logout, Me
│   │   ├── workspaces/router.py            # Espacios personales y compartidos (Familia)
│   │   ├── accounts/router.py              # CRUD Multi-Cuenta (Olatz, Iosu, Tarjetas, Cuenta Común)
│   │   ├── categories/
│   │   │   ├── seed.py                     # Semilla 50/30/20 + Reglas reales Kutxabank
│   │   │   └── router.py                   # CRUD Categorías
│   │   ├── rules/
│   │   │   ├── engine.py                   # Motor de categorización y extracción de comercio
│   │   │   └── router.py                   # CRUD Reglas + Re-aplicación masiva
│   │   ├── imports/
│   │   │   ├── validators.py               # Validación MIME, Magic Bytes y límite 10 MB
│   │   │   ├── dedup.py                    # Hash SHA-256 anti-duplicados
│   │   │   ├── reconciliation.py           # Motor Anti-Doble Contabilidad (Tarjetas, Traspasos ±3d, Alertas Cajero)
│   │   │   ├── import_service.py           # Orquestación Preview -> Confirmación -> Actualización de Saldo
│   │   │   ├── router.py                   # Endpoints /api/imports/preview y /confirm
│   │   │   └── parsers/
│   │   │       ├── utils.py                # Fechas ES/EU, importes europeos y normalización
│   │   │       ├── kutxabank_pdf.py        # Parser PDF ES (DD/MM/YYYY) y Euskera (YYYY/MM/DD + multilínea)
│   │   │       └── kutxabank_xls.py        # Parser Excel Tarjetas (.xls xlrd / .xlsx openpyxl / hoja Listado)
│   │   ├── transactions/router.py          # Filtros avanzados + Edición inline con creación automática de regla
│   │   └── analytics/router.py             # KPIs, Regla 50/30/20 (Real vs Objetivo), Evolución mensual
│   ├── tests/                              # Suite Pytest (38 tests unitarios e integración)
│   ├── alembic.ini
│   ├── pytest.ini
│   └── requirements.txt
└── frontend/
    ├── src/
    │   ├── api/client.ts                   # Cliente HTTP con auto-refresh JWT en memoria + Cookie HttpOnly
    │   ├── context/
    │   │   ├── AuthContext.tsx             # Sesión, Espacios, Cuentas y Pack Familiar Kutxabank
    │   │   └── CurrencyContext.tsx         # Multi-divisa en tiempo real (EUR €, USD $, GBP £ + Frankfurter API)
    │   ├── components/Layout.tsx           # Sidebar Fintech, Selector de Espacio y Selector de Divisa
    │   ├── pages/
    │   │   ├── AuthPage.tsx                # Login y Registro seguro
    │   │   ├── DashboardPage.tsx           # KPIs, Donut 50/30/20, Barras Apiladas, Top Subcategorías
    │   │   ├── TransactionsPage.tsx        # Tabla interactiva + Edición inline + Reglas por comercio
    │   │   ├── ImportPage.tsx              # Selector obligatorio de cuenta + Drag&Drop + Previsualización
    │   │   └── AccountsAndRulesPage.tsx    # Gestión Multi-Cuenta, Reglas y Categorías
    │   ├── types.ts
    │   ├── App.tsx
    │   ├── main.tsx
    │   └── index.css
    ├── package.json
    ├── tailwind.config.js
    └── vite.config.ts
```

---

## 2. Puesta en Marcha en Local (Paso a Paso)

### Paso 1: Levantar el Backend (FastAPI)

```powershell
cd backend

# 1. Crear y activar entorno virtual (si aún no está activo)
python -m venv .venv
.\.venv\Scripts\Activate.ps1

# 2. Instalar dependencias (incluye pdfplumber, pandas, xlrd, openpyxl, argon2-cffi)
pip install -r requirements.txt

# 3. Configurar variables de entorno (por defecto usa SQLite local fincontrol.db;
#    para PostgreSQL edita DATABASE_URL=postgresql+psycopg://user:pass@localhost:5432/fincontrol)
Copy-Item .env.example .env -ErrorAction SilentlyContinue

# 4. (Opcional) Ejecutar migraciones Alembic
alembic upgrade head

# 5. Ejecutar la suite de tests (38 tests: parsers ES/EU, XLS, conciliación y API)
pytest

# 6. Arrancar el servidor en http://localhost:8000
uvicorn app.main:app --reload --port 8000
```

Documentación interactiva Swagger disponible en: `http://localhost:8000/docs`

### Paso 2: Levantar el Frontend (React + TypeScript + Vite + Tailwind)

En una segunda terminal:

```powershell
cd frontend

# 1. Instalar paquetes
npm install

# 2. Iniciar servidor de desarrollo en http://localhost:5173
npm run dev
```

Abre `http://localhost:5173` en tu navegador.

---

## 3. Despliegue con Docker y Traefik (HTTPS / Let's Encrypt)

El proyecto incluye configuración lista para producción con **Traefik**:

- [docker-compose.yml](file:///c:/Users/olatz/Desktop/Finanzas/docker-compose.yml): Levanta `db` (PostgreSQL 16 en red privada), `backend` (FastAPI con `--proxy-headers`) y `frontend` (Nginx multi-stage con soporte SPA y subida de 15 MB) con etiquetas de enrutamiento para Traefik.
- [docker-compose.traefik.yml](file:///c:/Users/olatz/Desktop/Finanzas/docker-compose.traefik.yml): Contenedor opcional de Traefik v3 por si aún no tienes Traefik corriendo en el servidor.
- [.env.example](file:///c:/Users/olatz/Desktop/Finanzas/.env.example): Variables de dominio, red de Traefik, certificado ACME y credenciales.

### Opción A: Ya tienes Traefik corriendo en tu servidor

1. Crea el archivo `.env` a partir de `.env.example` y pon el nombre de tu dominio (`DOMAIN=econogenius.tudominio.com`) y el nombre de la red Docker de tu Traefik (`TRAEFIK_NETWORK=traefik-public`):
   ```bash
   cp .env.example .env
   ```
2. Si la red de Traefik aún no existe, créala una vez:
   ```bash
   docker network create traefik-public
   ```
3. Construye y levanta **€conogenius**:
   ```bash
   docker compose up -d --build
   ```

### Opción B: Levantar Traefik v3 + €conogenius todo junto desde cero

```bash
cp .env.example .env
docker compose -f docker-compose.traefik.yml -f docker-compose.yml up -d --build
```
