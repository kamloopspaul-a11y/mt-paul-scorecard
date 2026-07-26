#!/usr/bin/env python3
"""
A Bit of Bogey — local dev server.

Serves the project root over http:// (required: ES modules + fetch() fail
under file://) with caching fully disabled, so edits show up on reload
without fighting the service worker or the browser cache.

Usage:
    python3 dev-server.py            # port 8000
    python3 dev-server.py 8080       # custom port

Binds to 0.0.0.0, so the LAN URL it prints can be opened on a phone on the
same Wi-Fi for real-device testing.

Note: the service worker (sw.js) still installs and caches. For a clean
run in Chrome DevTools > Application > Service Workers, tick
"Bypass for network" (or "Update on reload").
"""

import http.server
import socket
import socketserver
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".json": "application/json",
        ".webmanifest": "application/manifest+json",
        ".svg": "image/svg+xml",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        # Allow the service worker to control the whole origin.
        self.send_header("Service-Worker-Allowed", "/")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("  %s\n" % (fmt % args))


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    try:
        httpd = Server(("0.0.0.0", port), NoCacheHandler)
    except OSError as e:
        print(f"Could not bind port {port}: {e}")
        print(f"Try another port:  python3 dev-server.py {port + 1}")
        sys.exit(1)

    ip = lan_ip()
    print("\n  A Bit of Bogey — dev server (no-cache)")
    print(f"  Serving: {ROOT}")
    print(f"  Local:   http://localhost:{port}/")
    if ip:
        print(f"  Network: http://{ip}:{port}/   (phone on same Wi-Fi)")
    print("\n  Ctrl-C to stop.\n")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  Stopped.\n")
        httpd.shutdown()


if __name__ == "__main__":
    main()
