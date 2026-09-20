"""Ephemeral loopback RPC relay; upstream endpoint never appears in child arguments."""
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import threading,urllib.request
@contextmanager
def local_rpc(endpoint):
    class Relay(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def do_POST(self):
            try:
                size=int(self.headers.get("Content-Length","0"))
                if not 0<size<=8_000_000:raise ValueError()
                request=urllib.request.Request(endpoint,data=self.rfile.read(size),headers={"Content-Type":"application/json","User-Agent":"HOODX-local-relay/2"})
                with urllib.request.urlopen(request,timeout=90)as response:body=response.read()
                self.send_response(200);self.send_header("Content-Type","application/json");self.end_headers();self.wfile.write(body)
            except Exception:
                self.send_response(502);self.end_headers();self.wfile.write(b'{"error":"upstream RPC unavailable"}')
    server=ThreadingHTTPServer(("127.0.0.1",0),Relay)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    try:yield "http://127.0.0.1:"+str(server.server_port)
    finally:server.shutdown();server.server_close()
