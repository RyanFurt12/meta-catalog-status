#!/usr/bin/env python3
"""
Servidor local de desenvolvimento da MetaCatalogMatch.

Serve os estaticos e roteia POST /api/collect para a MESMA classe que roda como
funcao serverless na Vercel (api/collect.py) — o que voce testa aqui e o que
sobe. Em producao a Vercel serve os estaticos pelo CDN e este arquivo nao roda.

Somente stdlib. Rodar:  python3 server.py [--port 8787]
"""

import argparse
import mimetypes
import os
import sys
from http.server import ThreadingHTTPServer

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
sys.path.insert(0, os.path.join(BASE_DIR, "api"))

from collect import handler  # noqa: E402 - precisa do sys.path acima


class Dev(handler):
    """A funcao da Vercel + o servico de estaticos que o CDN faz la."""

    def do_GET(self):
        route = self.path.split("?")[0]
        if route in ("/", "/index.html"):
            return self._send_file(os.path.join(BASE_DIR, "index.html"))
        if route.startswith("/static/"):
            target = os.path.normpath(os.path.join(STATIC_DIR, route[len("/static/"):]))
            if not target.startswith(STATIC_DIR):
                return self.send_json(403, {"error": {"message": "caminho invalido"}})
            return self._send_file(target)
        return self.send_json(404, {"error": {"message": "rota nao encontrada"}})

    def do_POST(self):
        if self.path.split("?")[0] != "/api/collect":
            return self.send_json(404, {"error": {"message": "rota nao encontrada"}})
        return handler.do_POST(self)

    def _send_file(self, path):
        if not os.path.isfile(path):
            return self.send_json(404, {"error": {"message": "arquivo nao encontrado"}})
        ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
            ctype += "; charset=utf-8"
        with open(path, "rb") as fh:
            body = fh.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


def main():
    parser = argparse.ArgumentParser(description="Dev server da MetaCatalogMatch")
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()

    httpd = ThreadingHTTPServer((args.host, args.port), Dev)
    print("MetaCatalogMatch em http://%s:%d" % (args.host, args.port))
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nencerrado")
        httpd.server_close()


if __name__ == "__main__":
    main()
