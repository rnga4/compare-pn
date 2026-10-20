import csv, io, os, re
import psycopg
from psycopg.rows import dict_row
from fastapi import FastAPI, UploadFile, File, Query
from fastapi.responses import HTMLResponse

DSN = os.environ["DATABASE_URL"]
app = FastAPI()
from fastapi.staticfiles import StaticFiles
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
"""

def conn():
    return psycopg.connect(DSN, row_factory=dict_row)

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

@app.on_event("startup")
def init():
    with conn() as c:
        c.execute(SCHEMA)

@app.get("/", response_class=HTMLResponse)
def index():
    with open(os.path.join(os.path.dirname(__file__), "index.html"), encoding="utf-8") as f:
        return f.read()

@app.get("/api/companies")
def companies():
    with conn() as c:
        return [r["name"] for r in c.execute("SELECT name FROM companies ORDER BY id")]

@app.get("/api/stats")
def stats():
    with conn() as c:
        return c.execute("""SELECT (SELECT count(*) FROM items) AS items,
                                   (SELECT count(*) FROM part_numbers) AS pns,
                                   (SELECT count(*) FROM companies) AS companies""").fetchone()

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
            SELECT i.id, i.name,
                   json_agg(json_build_object('company', c.name, 'pn', p.pn, 'seq', p.seq)
                            ORDER BY c.id, p.seq) AS pns
            FROM hit h
            JOIN items i ON i.id = h.item_id
            JOIN part_numbers p ON p.item_id = i.id
            JOIN companies c ON c.id = p.company_id
            GROUP BY i.id, i.name ORDER BY i.name
        """, {"qn": qn, "q": q, "lim": min(limit, 500)}).fetchall()
    return rows

def read_rows(filename: str, data: bytes):
    if filename.lower().endswith(".xlsx"):
        from openpyxl import load_workbook
        wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        for r in wb.active.iter_rows(values_only=True):
            yield ["" if v is None else str(v).strip() for v in r]
    else:
        text = data.decode("utf-8-sig")
        for r in csv.reader(io.StringIO(text)):
            yield [x.strip() for x in r]

@app.post("/api/import")
async def import_file(file: UploadFile = File(...)):
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
    with conn() as c:
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
            item_id = c.execute("INSERT INTO items(name) VALUES (%s) RETURNING id", (name or None,)).fetchone()["id"]
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
    return {"pn_added": added, "pn_duplicate_skipped": dup,
            "duplicates": dups, "duplicates_truncated": dup > len(dups)}

from pydantic import BaseModel

class Entry(BaseModel):
    company: str
    pns: str

class NewItem(BaseModel):
    name: str | None = None
    entries: list[Entry]

@app.post("/api/items")
def add_item(body: NewItem):
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
        item_id = c.execute("INSERT INTO items(name) VALUES (%s) RETURNING id",
                            ((body.name or "").strip() or None,)).fetchone()["id"]
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
    return {"ok": True, "pn_added": added}

def _where(q: str):
    q = (q or "").strip()
    if not q:
        return "TRUE", {}
    qn = norm(q)
    params = {"q": "%" + q + "%", "pat": "%" + qn + "%"}
    cond = "i.name ILIKE %(q)s"
    if qn:
        cond += " OR i.id IN (SELECT item_id FROM part_numbers WHERE pn_norm LIKE %(pat)s)"
    return "(" + cond + ")", params

@app.get("/list", response_class=HTMLResponse)
def list_page():
    with open(os.path.join(os.path.dirname(__file__), "list.html"), encoding="utf-8") as f:
        return f.read()

@app.get("/api/list")
def api_list(page: int = 1, size: int = 50, q: str = ""):
    size = max(1, min(size, 200))
    page = max(1, page)
    where, params = _where(q)
    with conn() as c:
        total = c.execute(f"SELECT count(*) AS n FROM items i WHERE {where}", params).fetchone()["n"]
        rows = c.execute(f"""
            WITH pg AS (
              SELECT i.id, i.name FROM items i WHERE {where}
              ORDER BY i.id LIMIT %(size)s OFFSET %(off)s)
            SELECT pg.id, pg.name,
                   json_agg(json_build_object('company', co.name, 'pn', p.pn, 'seq', p.seq)
                            ORDER BY co.id, p.seq) AS pns
            FROM pg
            JOIN part_numbers p ON p.item_id = pg.id
            JOIN companies co ON co.id = p.company_id
            GROUP BY pg.id, pg.name ORDER BY pg.id
        """, {**params, "size": size, "off": (page - 1) * size}).fetchall()
    return {"total": total, "page": page, "size": size, "items": rows}
