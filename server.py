from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


def main() -> None:
    host = "127.0.0.1"
    port = 5173
    print(f"Serving on http://{host}:{port}")
    httpd = ThreadingHTTPServer((host, port), SimpleHTTPRequestHandler)
    httpd.serve_forever()


if __name__ == "__main__":
    main()

