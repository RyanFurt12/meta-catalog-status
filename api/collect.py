"""
Funcao serverless da MetaCatalogMatch: POST /api/collect.

Recebe catalog_id + access token no corpo, consulta o event_stats da Graph API e
devolve a serie normalizada de match por dia x evento x fonte.

Somente stdlib. Na Vercel o runtime Python instancia a classe `handler`; local,
o server.py da raiz reaproveita a mesma classe.
"""

import json
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler

GRAPH_VERSION = "v26.0"
GRAPH_HOST = "https://graph.facebook.com"

# Funcao serverless morre no teto de duracao do plano, entao o timeout por
# request tem de ser bem menor que o teto — melhor um erro claro que um 504 mudo.
HTTP_TIMEOUT = 15

# Paginas do event_stats. A janela e de ~28 dias e cabe folgado aqui.
MAX_PAGES = 20

EVENT_STATS_FIELDS = ",".join([
    "date_start",
    "date_stop",
    "event",
    "event_source",
    "total_matched_content_ids",
    "total_unmatched_content_ids",
    "total_content_ids_matched_other_catalogs",
])


class GraphError(Exception):
    """Erro devolvido pela propria Graph API — repassado inteiro para a UI."""

    def __init__(self, message, err_type=None, code=None, subcode=None,
                 http_status=None):
        super().__init__(message)
        self.message = message
        self.err_type = err_type
        self.code = code
        self.subcode = subcode
        self.http_status = http_status

    def to_dict(self):
        return {
            "message": self.message,
            "type": self.err_type,
            "code": self.code,
            "subcode": self.subcode,
            "http_status": self.http_status,
        }


def _http_get_json(url):
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", "replace")
        try:
            err = (json.loads(raw) or {}).get("error") or {}
        except ValueError:
            err = {}
        raise GraphError(
            message=err.get("message") or ("HTTP %s da Graph API" % exc.code),
            err_type=err.get("type"),
            code=err.get("code"),
            subcode=err.get("error_subcode"),
            http_status=exc.code,
        )
    except urllib.error.URLError as exc:
        raise GraphError("Nao consegui falar com a Graph API: %s" % exc.reason)


def _int(value):
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def collect_event_stats(catalog_id, token):
    """Serie diaria de match por evento x fonte.

    Essa edge NAO aceita filtro de data: devolve uma janela fixa de ~28 dias e o
    recorte por intervalo e feito no cliente.

    Devolve (linhas, truncado). truncado=True quando ainda havia proxima pagina
    — sem avisar, os numeros viram uma amostra silenciosa.
    """
    query = {"fields": EVENT_STATS_FIELDS, "limit": 500, "access_token": token}
    url = "%s/%s/%s/event_stats?%s" % (GRAPH_HOST, GRAPH_VERSION, catalog_id,
                                       urllib.parse.urlencode(query))

    raw = []
    pages = 0
    while url and pages < MAX_PAGES:
        payload = _http_get_json(url)
        raw.extend(payload.get("data") or [])
        pages += 1
        url = (payload.get("paging") or {}).get("next")

    rows = []
    for item in raw:
        source = item.get("event_source") or {}
        if not isinstance(source, dict):
            source = {"id": str(source)}
        source_id = source.get("id") or "-"
        rows.append({
            "date": item.get("date_start") or item.get("date_stop"),
            "event": item.get("event") or "-",
            "source_id": source_id,
            "source_name": source.get("name") or source_id,
            "matched": _int(item.get("total_matched_content_ids")),
            "unmatched": _int(item.get("total_unmatched_content_ids")),
            "other": _int(item.get("total_content_ids_matched_other_catalogs")),
        })

    rows = [r for r in rows if r["date"]]
    rows.sort(key=lambda r: (r["date"], r["event"], r["source_id"]))
    return rows, bool(url)


def explain_graph_error(err):
    """Traduz os erros que aparecem de verdade nesse fluxo.

    O 100/33 e o mais traicoeiro: a Meta responde 'nao existe' tanto para ID
    inexistente quanto para objeto que o token nao pode ver.
    """
    code, sub = err.get("code"), err.get("subcode")
    if code == 100 and sub == 33:
        return ("A Graph API não enxerga esse objeto com esse token: ou o catalog_id está errado, "
                "ou faltam escopos. O event_stats é chamada da Marketing API e precisa de "
                "ads_read além de catalog_management.")
    if code == 190:
        return ("Token inválido ou expirado. O token do Graph API Explorer costuma durar 1–2 horas; "
                "gere de novo, ou crie um usuário do sistema para um token que não expira.")
    if code in (200, 10):
        return ("O token é válido mas não tem permissão para essa operação. Confirme "
                "catalog_management e ads_read no token.")
    if code in (4, 17, 613):
        return "A Meta está limitando as chamadas (rate limit). Espere alguns minutos e tente de novo."
    return None


def build_payload(req):
    catalog_id = str(req.get("catalog_id") or "").strip()
    token = str(req.get("access_token") or "").strip()

    if not catalog_id:
        raise ValueError("Informe o catalog_id.")
    if not token:
        raise ValueError("Informe o access token.")

    warnings = []
    stats, truncated = collect_event_stats(catalog_id, token)
    if truncated:
        warnings.append("A serie de match veio paginada alem do teto; pode faltar dia.")
    if not stats:
        warnings.append(
            "A Graph API nao devolveu nenhuma linha de event_stats. "
            "Normalmente e catalogo sem fonte de evento associada, ou sem trafego na janela."
        )

    dates = sorted({r["date"] for r in stats})

    return {
        "meta": {
            "catalog_id": catalog_id,
            "graph_version": GRAPH_VERSION,
            "fetched_at": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
            "window": {"min_date": dates[0] if dates else None,
                       "max_date": dates[-1] if dates else None,
                       "days": len(dates)},
            "warnings": warnings,
        },
        "event_stats": stats,
    }


class handler(BaseHTTPRequestHandler):
    server_version = "MetaCatalogMatch"

    def log_message(self, fmt, *args):
        # Sem query string: o token viaja no corpo do POST, mas nao quero risco
        # nenhum de vazar em log.
        import sys
        sys.stderr.write("%s %s\n" % (self.command, self.path.split("?")[0]))

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        except (ValueError, TypeError):
            return self.send_json(400, {"error": {"message": "corpo JSON invalido"}})

        try:
            payload = build_payload(body)
        except ValueError as exc:
            return self.send_json(400, {"error": {"message": str(exc)}})
        except GraphError as exc:
            err = exc.to_dict()
            err["hint"] = explain_graph_error(err)
            return self.send_json(502, {"error": err})
        except Exception as exc:  # noqa: BLE001 - a UI precisa ver o motivo
            return self.send_json(500, {"error": {"message": "Falha inesperada: %s" % exc}})

        return self.send_json(200, payload)

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)
