import csv, io, os, re, time, secrets, hashlib
from datetime import datetime, timedelta, timezone
from contextlib import contextmanager, asynccontextmanager
import psycopg
from psycopg.rows import dict_row
from fastapi import FastAPI, UploadFile, File, Query, Request, Response
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.gzip import GZipMiddleware
from pydantic import BaseModel

DSN = os.environ["DATABASE_URL"]

pool = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global pool
    try:
        from psycopg_pool import ConnectionPool
        pool = ConnectionPool(conninfo=DSN, min_size=2, max_size=20, open=True)
    except Exception:
        pool = None
    with conn() as c:
        c.execute(SCHEMA)
    yield
    if pool:
        pool.close()

app = FastAPI(lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.mount("/static", StaticFiles(directory=os.path.join(os.path.dirname(__file__), "static")), name="static")

SCHEMA = """
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE TABLE IF NOT EXISTS companies(id serial PRIMARY KEY, name text UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS items(id bigserial PRIMARY KEY, name text);
CREATE TABLE IF NOT EXISTS part_numbers(
  id bigserial PRIMARY KEY,
  item_id bigint NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  company_id int NOT NULL REFERENCES companies(id),
  pn text NOT NULL,
  pn_norm text NOT NULL,
  UNIQUE(company_id, pn_norm));
ALTER TABLE part_numbers ADD COLUMN IF NOT EXISTS seq int NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS pn_norm_trgm ON part_numbers USING gin(pn_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS pn_item ON part_numbers(item_id);
CREATE INDEX IF NOT EXISTS items_name_trgm ON items USING gin(name gin_trgm_ops);

CREATE TABLE IF NOT EXISTS users(
  id serial PRIMARY KEY,
  username text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  salt text NOT NULL,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions(
  token text PRIMARY KEY,
  user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_token ON sessions(token);
CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires_at);

ALTER TABLE items ADD COLUMN IF NOT EXISTS user_id int REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE items ADD COLUMN IF NOT EXISTS updated_by int REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE items ADD COLUMN IF NOT EXISTS approved_by int REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE items ADD COLUMN IF NOT EXISTS approved_at timestamptz;
CREATE INDEX IF NOT EXISTS items_user_id ON items(user_id);
CREATE INDEX IF NOT EXISTS items_updated_by ON items(updated_by);
CREATE INDEX IF NOT EXISTS items_approved_by ON items(approved_by);
"""

@contextmanager
def conn():
    if pool:
        with pool.connection() as c:
            c.row_factory = dict_row
            yield c
    else:
        with psycopg.connect(DSN, row_factory=dict_row) as c:
            yield c

def norm(s: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (s or "").upper())

def split_pns(cell: str):
    seen, out = set(), []
    for p in re.split(r"[;|\n\r]+", cell or ""):
        p = p.strip()
        n = norm(p)
        if n and n not in seen:
            seen.add(n)
            out.append(p)
    return out

def hash_password(password: str, salt: str | None = None) -> tuple[str, str]:
    if not salt:
        salt = secrets.token_hex(16)
    hashed = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 100_000).hex()
    return hashed, salt

def verify_password(password: str, salt: str, password_hash: str) -> bool:
    hashed, _ = hash_password(password, salt)
    return secrets.compare_digest(hashed, password_hash)

def get_current_user(request: Request) -> dict | None:
    token = request.cookies.get("cmp_session")
    if not token:
        return None
    with conn() as c:
        row = c.execute("""
            SELECT u.id, u.username
            FROM sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.token = %s AND s.expires_at > now()
        """, (token,)).fetchone()
        return dict(row) if row else None

_LOGIN_ATTEMPTS: dict[str, list[float]] = {}

def check_rate_limit(key: str, limit: int = 10, window: int = 60) -> bool:
    now = time.time()
    attempts = [t for t in _LOGIN_ATTEMPTS.get(key, []) if now - t < window]
    if len(attempts) >= limit:
        return False
    attempts.append(now)
    _LOGIN_ATTEMPTS[key] = attempts
    return True

_STATS_CACHE = {"data": None, "ts": 0}
_COMPS_CACHE = {"data": None, "ts": 0}
CACHE_TTL = 30  # seconds

def invalidate_cache():
    _STATS_CACHE["data"] = None
    _COMPS_CACHE["data"] = None

@app.get("/", response_class=HTMLResponse)
def index():
    with open(os.path.join(os.path.dirname(__file__), "index.html"), encoding="utf-8") as f:
        return f.read()

@app.get("/api/companies")
def companies():
    now = time.time()
    if _COMPS_CACHE["data"] and (now - _COMPS_CACHE["ts"] < CACHE_TTL):
        return _COMPS_CACHE["data"]
    with conn() as c:
        data = [r["name"] for r in c.execute("SELECT name FROM companies ORDER BY id")]
        _COMPS_CACHE["data"] = data
        _COMPS_CACHE["ts"] = now
        return data

@app.get("/api/stats")
def stats():
    now = time.time()
    if _STATS_CACHE["data"] and (now - _STATS_CACHE["ts"] < CACHE_TTL):
        return _STATS_CACHE["data"]
    with conn() as c:
        data = c.execute("""SELECT (SELECT count(*) FROM items) AS items,
                                   (SELECT count(*) FROM part_numbers) AS pns,
                                   (SELECT count(*) FROM companies) AS companies""").fetchone()
        _STATS_CACHE["data"] = data
        _STATS_CACHE["ts"] = now
        return data

class AuthBody(BaseModel):
    username: str
    password: str

@app.post("/api/auth/register")
def register(body: AuthBody, request: Request, response: Response):
    u = (body.username or "").strip()
    p = body.password or ""
    client_ip = request.client.host if request.client else "unknown"
    if not check_rate_limit(f"reg:{client_ip}", limit=10, window=60):
        return {"error": "Terlalu banyak permintaan pendaftaran. Coba 1 menit lagi."}
    if not re.match(r"^[a-zA-Z0-9_\-\.]{3,30}$", u):
        return {"error": "Username harus 3-30 karakter (huruf, angka, _, -, .)"}
    if len(p) < 8:
        return {"error": "Password minimal 8 karakter"}
    pw_hash, salt = hash_password(p)
    with conn() as c:
        existing = c.execute("SELECT id FROM users WHERE lower(username) = lower(%s)", (u,)).fetchone()
        if existing:
            return {"error": f"Username '{u}' sudah dipakai"}
        user_row = c.execute(
            "INSERT INTO users(username, password_hash, salt) VALUES (%s, %s, %s) RETURNING id, username",
            (u, pw_hash, salt)
        ).fetchone()
        user_id = user_row["id"]
        token = secrets.token_urlsafe(32)
        expires_at = datetime.now(timezone.utc) + timedelta(days=30)
        c.execute("INSERT INTO sessions(token, user_id, expires_at) VALUES (%s, %s, %s)",
                  (token, user_id, expires_at))
        response.set_cookie("cmp_session", token, max_age=86400 * 30, httponly=True, samesite="lax", path="/")
        return {"ok": True, "user": {"id": user_id, "username": user_row["username"]}}

@app.post("/api/auth/login")
def login(body: AuthBody, request: Request, response: Response):
    u = (body.username or "").strip()
    p = body.password or ""
    client_ip = request.client.host if request.client else "unknown"
    if not check_rate_limit(f"login:{client_ip}", limit=10, window=60):
        return {"error": "Terlalu banyak percobaan login gagal. Tunggu 1 menit."}
    with conn() as c:
        user = c.execute("SELECT id, username, password_hash, salt FROM users WHERE lower(username) = lower(%s)", (u,)).fetchone()
        if not user or not verify_password(p, user["salt"], user["password_hash"]):
            return {"error": "Username atau password salah"}
        token = secrets.token_urlsafe(32)
        expires_at = datetime.now(timezone.utc) + timedelta(days=30)
        c.execute("INSERT INTO sessions(token, user_id, expires_at) VALUES (%s, %s, %s)",
                  (token, user["id"], expires_at))
        response.set_cookie("cmp_session", token, max_age=86400 * 30, httponly=True, samesite="lax", path="/")
        return {"ok": True, "user": {"id": user["id"], "username": user["username"]}}

@app.post("/api/auth/logout")
def logout(request: Request, response: Response):
    token = request.cookies.get("cmp_session")
    if token:
        with conn() as c:
            c.execute("DELETE FROM sessions WHERE token = %s", (token,))
    response.delete_cookie("cmp_session", path="/")
    return {"ok": True}

@app.get("/api/auth/me")
def me(request: Request):
    user = get_current_user(request)
    return {"user": user}

@app.get("/api/search")
def search(q: str = Query(..., min_length=1), limit: int = 50):
    qn = norm(q)
    with conn() as c:
        rows = c.execute("""
            WITH hit AS (
              SELECT item_id FROM part_numbers WHERE %(qn)s <> '' AND pn_norm LIKE '%%' || %(qn)s || '%%'
              UNION
              SELECT id FROM items WHERE name ILIKE '%%' || %(q)s || '%%'
              LIMIT %(lim)s)
            SELECT i.id, i.name, i.user_id, u.username AS created_by, ub.username AS updated_by, ua.username AS approved_by_name, i.approved_at,
                   json_agg(json_build_object('company', c.name, 'pn', p.pn, 'seq', p.seq)
                            ORDER BY c.id, p.seq) AS pns
            FROM hit h
            JOIN items i ON i.id = h.item_id
            LEFT JOIN users u ON u.id = i.user_id
            LEFT JOIN users ub ON ub.id = i.updated_by
            LEFT JOIN users ua ON ua.id = i.approved_by
            JOIN part_numbers p ON p.item_id = i.id
            JOIN companies c ON c.id = p.company_id
            GROUP BY i.id, i.name, i.user_id, u.username, ub.username, ua.username, i.approved_at ORDER BY i.name
        """, {"qn": qn, "q": q, "lim": min(limit, 500)}).fetchall()
    return rows

def read_rows(filename: str, data: bytes):
    if filename.lower().endswith(".xlsx"):
        from openpyxl import load_workbook
        wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        for r in wb.active.iter_rows(values_only=True):
            yield ["" if v is None else str(v).strip() for v in r]
    else:
        try:
            text = data.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = data.decode("latin-1", errors="replace")
        for r in csv.reader(io.StringIO(text)):
            yield [x.strip() for x in r]

@app.post("/api/import")
async def import_file(request: Request, file: UploadFile = File(...)):
    user = get_current_user(request)
    if not user:
        return {"error": "Silakan login terlebih dahulu untuk import file"}
    rows = read_rows(file.filename or "", await file.read())
    header = next(rows, None)
    if not header or not any(header):
        return {"error": "File kosong"}
    has_name = header[0].lower() == "name"
    comp_names = [h for h in (header[1:] if has_name else header) if h]
    off = 1 if has_name else 0
    if not comp_names:
        return {"error": "Header harus: unico,matric,... (name opsional di depan)"}
    added = dup = 0
    dups, created = [], set()
    with conn() as c, c.transaction():
        ids = []
        for n in comp_names:
            r = c.execute("""INSERT INTO companies(name) VALUES (%s)
                             ON CONFLICT(name) DO UPDATE SET name=EXCLUDED.name RETURNING id""", (n,)).fetchone()
            ids.append(r["id"])
        for rn, row in enumerate(rows, start=2):
            if not any(row):
                continue
            name = row[0] if has_name and row else None
            pns = []
            for i in range(len(comp_names)):
                if i + off < len(row):
                    for seq, pn in enumerate(split_pns(row[i + off])):
                        pns.append((ids[i], comp_names[i], pn, seq))
            if not pns:
                continue
            item_id = c.execute("INSERT INTO items(name, user_id) VALUES (%s, %s) RETURNING id",
                                (name or None, user["id"])).fetchone()["id"]
            created.add(item_id)
            for cid, cname, pn, seq in pns:
                cur = c.execute("""INSERT INTO part_numbers(item_id, company_id, pn, pn_norm, seq)
                                   VALUES (%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING""",
                                (item_id, cid, pn, norm(pn), seq))
                if cur.rowcount:
                    added += 1
                    continue
                dup += 1
                if len(dups) < 2000:
                    o = c.execute("""
                        SELECT i.id, i.name,
                               (SELECT json_agg(json_build_object('company', co.name, 'pn', p2.pn, 'seq', p2.seq)
                                                ORDER BY co.id, p2.seq)
                                FROM part_numbers p2 JOIN companies co ON co.id = p2.company_id
                                WHERE p2.item_id = i.id) AS pns
                        FROM part_numbers p JOIN items i ON i.id = p.item_id
                        WHERE p.company_id = %s AND p.pn_norm = %s""", (cid, norm(pn))).fetchone() or {}
                    dups.append({
                        "row": rn, "company": cname, "pn": pn,
                        "source": "file" if o.get("id") in created else "database",
                        "existing_item_id": o.get("id"),
                        "existing_name": o.get("name"),
                        "existing_pns": o.get("pns") or [],
                    })
            c.execute("DELETE FROM items WHERE id=%s AND NOT EXISTS (SELECT 1 FROM part_numbers WHERE item_id=%s)",
                      (item_id, item_id))
    invalidate_cache()
    return {"pn_added": added, "pn_duplicate_skipped": dup,
            "duplicates": dups, "duplicates_truncated": dup > len(dups)}

class Entry(BaseModel):
    company: str
    pns: str

class NewItem(BaseModel):
    name: str | None = None
    entries: list[Entry]

@app.post("/api/items")
def add_item(body: NewItem, request: Request):
    user = get_current_user(request)
    if not user:
        return {"error": "Silakan login terlebih dahulu untuk menambah data"}
    entries = []
    for e in body.entries:
        comp = e.company.strip()
        pns = split_pns(e.pns)
        if comp and pns:
            entries.append((comp, pns))
    if not entries:
        return {"error": "Isi minimal 1 company dengan 1 PN"}
    with conn() as c:
        for comp, pns in entries:
            for pn in pns:
                r = c.execute("""SELECT i.name, p.pn FROM part_numbers p
                                 JOIN companies co ON co.id = p.company_id
                                 JOIN items i ON i.id = p.item_id
                                 WHERE co.name = %s AND p.pn_norm = %s""",
                              (comp, norm(pn))).fetchone()
                if r:
                    return {"error": f"PN {pn} sudah ada di {comp} (barang: {r['name'] or 'tanpa nama'}, PN {r['pn']})"}
        item_id = c.execute("INSERT INTO items(name, user_id) VALUES (%s, %s) RETURNING id",
                            ((body.name or "").strip() or None, user["id"])).fetchone()["id"]
        added = 0
        for comp, pns in entries:
            cid = c.execute("""INSERT INTO companies(name) VALUES (%s)
                               ON CONFLICT(name) DO UPDATE SET name=EXCLUDED.name RETURNING id""",
                            (comp,)).fetchone()["id"]
            for seq, pn in enumerate(pns):
                c.execute("""INSERT INTO part_numbers(item_id, company_id, pn, pn_norm, seq)
                             VALUES (%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING""",
                          (item_id, cid, pn, norm(pn), seq))
                added += 1
    invalidate_cache()
    return {"ok": True, "pn_added": added}

@app.get("/list", response_class=HTMLResponse)
def list_page():
    with open(os.path.join(os.path.dirname(__file__), "list.html"), encoding="utf-8") as f:
        return f.read()

@app.get("/api/items/{item_id}")
def get_item_detail(item_id: int, request: Request):
    user = get_current_user(request)
    if not user:
        return {"error": "Silakan login terlebih dahulu untuk mengedit data"}
    with conn() as c:
        item = c.execute("SELECT id, name, user_id FROM items WHERE id = %s", (item_id,)).fetchone()
        if not item:
            return {"error": "Data tidak ditemukan"}
        if item["user_id"] is not None and item["user_id"] != user["id"]:
            return {"error": "Tidak diizinkan mengedit data ini"}
        rows = c.execute("""
            SELECT co.name AS company, string_agg(p.pn, ';' ORDER BY p.seq) AS pns
            FROM part_numbers p
            JOIN companies co ON co.id = p.company_id
            WHERE p.item_id = %s
            GROUP BY co.id, co.name
            ORDER BY co.id
        """, (item_id,)).fetchall()
    entries = [{"company": r["company"], "pns": r["pns"] or ""} for r in rows]
    return {"id": item["id"], "name": item["name"] or "", "entries": entries}

@app.put("/api/items/{item_id}")
def update_item(item_id: int, body: NewItem, request: Request):
    user = get_current_user(request)
    if not user:
        return {"error": "Silakan login terlebih dahulu untuk mengedit data"}
    entries = []
    for e in body.entries:
        comp = (e.company or "").strip()
        pns = split_pns(e.pns)
        if comp and pns:
            entries.append((comp, pns))
    if not entries:
        return {"error": "Isi minimal 1 company dengan 1 PN"}
    with conn() as c, c.transaction():
        item = c.execute("SELECT id, user_id, name FROM items WHERE id = %s FOR UPDATE", (item_id,)).fetchone()
        if not item:
            return {"error": "Data tidak ditemukan"}
        if item["user_id"] is not None and item["user_id"] != user["id"]:
            return {"error": "Tidak diizinkan mengedit data ini"}
        # check conflicts with other items
        for comp, pns in entries:
            for pn in pns:
                r = c.execute("""
                    SELECT i.id, i.name, p.pn FROM part_numbers p
                    JOIN companies co ON co.id = p.company_id
                    JOIN items i ON i.id = p.item_id
                    WHERE co.name = %s AND p.pn_norm = %s AND p.item_id <> %s
                """, (comp, norm(pn), item_id)).fetchone()
                if r:
                    return {"error": f"PN {pn} sudah ada di {comp} (barang: {r['name'] or 'tanpa nama'}, PN {r['pn']})"}
        # update name + updated_by, reset approval on edit
        new_name = (body.name or "").strip() or None
        c.execute("UPDATE items SET name = %s, updated_by = %s, approved_by = NULL, approved_at = NULL WHERE id = %s",
                  (new_name, user["id"], item_id))
        # replace part numbers
        c.execute("DELETE FROM part_numbers WHERE item_id = %s", (item_id,))
        added = 0
        for comp, pns in entries:
            cid = c.execute("""
                INSERT INTO companies(name) VALUES (%s)
                ON CONFLICT(name) DO UPDATE SET name=EXCLUDED.name RETURNING id
            """, (comp,)).fetchone()["id"]
            for seq, pn in enumerate(pns):
                c.execute("""
                    INSERT INTO part_numbers(item_id, company_id, pn, pn_norm, seq)
                    VALUES (%s,%s,%s,%s,%s)
                """, (item_id, cid, pn, norm(pn), seq))
                added += 1
    invalidate_cache()
    return {"ok": True, "pn_added": added}

class ApproveBody(BaseModel):
    approve: bool = True

@app.post("/api/items/{item_id}/approve")
def approve_item(item_id: int, body: ApproveBody, request: Request):
    user = get_current_user(request)
    if not user:
        return {"error": "Silakan login terlebih dahulu"}
    with conn() as c, c.transaction():
        item = c.execute("SELECT id FROM items WHERE id = %s FOR UPDATE", (item_id,)).fetchone()
        if not item:
            return {"error": "Data tidak ditemukan"}
        if body.approve:
            c.execute("UPDATE items SET approved_by = %s, approved_at = now() WHERE id = %s", (user["id"], item_id))
            return {"ok": True, "approved": True}
        else:
            c.execute("UPDATE items SET approved_by = NULL, approved_at = NULL WHERE id = %s", (item_id,))
            return {"ok": True, "approved": False}
    invalidate_cache()

@app.get("/api/list")
def api_list(page: int = 1, size: int = 50, q: str = "", approved: str = ""):
    size = max(1, min(size, 200))
    page = max(1, page)
    q = (q or "").strip()
    approved = (approved or "").strip()
    offset = (page - 1) * size
    with conn() as c:
        pending = c.execute("SELECT count(*) AS n FROM items WHERE approved_by IS NULL").fetchone()["n"]
        if not q:
            base = "FROM items i"
            where = ""
            params = {"size": size, "off": offset}
            if approved == "1":
                where = "WHERE i.approved_by IS NOT NULL"
            elif approved == "0":
                where = "WHERE i.approved_by IS NULL"
            total = c.execute(f"SELECT count(*) AS n {base} {where}", params).fetchone()["n"]
            rows = c.execute(f"""
                WITH pg AS (
                  SELECT i.id, i.name, i.user_id, i.updated_by, i.approved_by, i.approved_at FROM items i
                  {where}
                  ORDER BY i.id LIMIT %(size)s OFFSET %(off)s)
                SELECT pg.id, pg.name, pg.user_id, u.username AS created_by, ub.username AS updated_by, ua.username AS approved_by_name, pg.approved_at,
                       json_agg(json_build_object('company', co.name, 'pn', p.pn, 'seq', p.seq)
                                ORDER BY co.id, p.seq) AS pns
                FROM pg
                LEFT JOIN users u ON u.id = pg.user_id
                LEFT JOIN users ub ON ub.id = pg.updated_by
                LEFT JOIN users ua ON ua.id = pg.approved_by
                JOIN part_numbers p ON p.item_id = pg.id
                JOIN companies co ON co.id = p.company_id
                GROUP BY pg.id, pg.name, pg.user_id, u.username, ub.username, ua.username, pg.approved_at ORDER BY pg.id
            """, params).fetchall()
        else:
            qn = norm(q)
            params = {"qn": qn, "q": q, "size": size, "off": offset}
            filt = ""
            if approved == "1":
                filt = "AND i.approved_by IS NOT NULL"
            elif approved == "0":
                filt = "AND i.approved_by IS NULL"
            total = c.execute(f"""
                WITH hit AS (
                  SELECT item_id AS id FROM part_numbers p JOIN items i ON i.id = p.item_id WHERE %(qn)s <> '' AND p.pn_norm LIKE '%%' || %(qn)s || '%%' {filt}
                  UNION
                  SELECT id FROM items i WHERE i.name ILIKE '%%' || %(q)s || '%%' {filt})
                SELECT count(*) AS n FROM hit
            """, params).fetchone()["n"]
            rows = c.execute(f"""
                WITH hit AS (
                  SELECT item_id AS id FROM part_numbers p JOIN items i ON i.id = p.item_id WHERE %(qn)s <> '' AND p.pn_norm LIKE '%%' || %(qn)s || '%%' {filt}
                  UNION
                  SELECT id FROM items i WHERE i.name ILIKE '%%' || %(q)s || '%%' {filt}),
                pg AS (
                  SELECT i.id, i.name, i.user_id, i.updated_by, i.approved_by, i.approved_at FROM hit h
                  JOIN items i ON i.id = h.id
                  ORDER BY i.id LIMIT %(size)s OFFSET %(off)s)
                SELECT pg.id, pg.name, pg.user_id, u.username AS created_by, ub.username AS updated_by, ua.username AS approved_by_name, pg.approved_at,
                       json_agg(json_build_object('company', co.name, 'pn', p.pn, 'seq', p.seq)
                                ORDER BY co.id, p.seq) AS pns
                FROM pg
                LEFT JOIN users u ON u.id = pg.user_id
                LEFT JOIN users ub ON ub.id = pg.updated_by
                LEFT JOIN users ua ON ua.id = pg.approved_by
                JOIN part_numbers p ON p.item_id = pg.id
                JOIN companies co ON co.id = p.company_id
                GROUP BY pg.id, pg.name, pg.user_id, u.username, ub.username, ua.username, pg.approved_at ORDER BY pg.id
            """, params).fetchall()
    return {"total": total, "page": page, "size": size, "items": rows, "pending": pending}
