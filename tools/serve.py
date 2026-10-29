# Local preview server that never lets the browser cache, so every refresh shows the latest files.
# Usage: python3 tools/serve.py   (serves the project at http://127.0.0.1:3000)
import http.server, os, sys

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def send_head(self):
        # ignore the browser's "do I have the latest?" check, so it never gets a 304 for an old copy
        for h in ('If-Modified-Since', 'If-None-Match'):
            if h in self.headers:
                del self.headers[h]
        return super().send_head()

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
port = int(sys.argv[1]) if len(sys.argv) > 1 else 3000
http.server.ThreadingHTTPServer(('127.0.0.1', port), NoCache).serve_forever()
