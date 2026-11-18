# Aula Abierta — Mi Blog Docente

Blog educativo para docentes (RD). Frontend estático exportado de Stitch + API **Express** + **PostgreSQL**, todo servido por un único servicio.

## Estructura
- `public/` — frontend (HTML + Tailwind CDN). `public/db.js` es el cliente de la API (misma interfaz `AulaAbiertaDB` que antes usaba IndexedDB).
- `server.js`, `src/` — API REST, autenticación (JWT en cookie httpOnly), esquema SQL y datos semilla.
- `render.yaml` — Blueprint de despliegue.

## API
| Método | Ruta | Acceso |
|---|---|---|
| POST | `/api/auth/login`, `/api/auth/logout` · GET `/api/auth/me` | — |
| GET | `/api/articles`, `/api/articles/:id` | público (solo publicados) / admin (todos) |
| POST | `/api/articles/:id/view` | público |
| POST/PUT/DELETE | `/api/articles[/:id]`, `POST /api/articles/:id/restore` | admin |
| GET/POST | `/api/articles/:id/comments` | público (entran como *pending*) |
| GET/PATCH/DELETE | `/api/comments[/:id]` | admin |
| CRUD | `/api/media` | admin |
| GET / PUT | `/api/profile` | público / admin |
| GET | `/healthz` | público |

## Desarrollo local
```bash
cp .env.example .env   # edita los valores
npm install
export $(grep -v '^#' .env | xargs) && npm run dev
```
Requiere PostgreSQL local. El esquema se crea solo al arrancar.

## Despliegue en Render
1. Sube el repo a GitHub.
2. Render → **New → Blueprint** → elige el repo. Pide `ADMIN_EMAIL` y `ADMIN_PASSWORD` (el usuario se crea al primer arranque).
3. Cuando termine, entra a `/admin-login.html`.
4. Para empezar sin artículos de ejemplo, pon `SEED_DEMO=false`.
