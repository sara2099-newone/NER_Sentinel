const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, "public");
const BACKEND_PORT = process.env.BACKEND_PORT || 5050;

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml"
};

const server = http.createServer((req, res) => {
    if (req.url.startsWith("/api")) {
        const proxyReq = http.request(
            { hostname: "localhost", port: BACKEND_PORT, path: req.url, method: req.method, headers: req.headers },
            (proxyRes) => {
                res.writeHead(proxyRes.statusCode, proxyRes.headers);
                proxyRes.pipe(res, { end: true });
            }
        );
        proxyReq.on("error", (err) => {
            res.writeHead(502, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ message: "Backend unreachable: " + err.message }));
        });
        req.pipe(proxyReq, { end: true });
        return;
    }

    let file = req.url === "/" ? "/index.html" : req.url.split("?")[0];
    file = path.normalize(path.join(PUBLIC, file));

    if (!file.startsWith(PUBLIC)) {
        res.writeHead(403);
        return res.end("Forbidden");
    }

    fs.readFile(file, (err, data) => {
        if (err) {
            res.writeHead(404, { "Content-Type": "text/plain" });
            return res.end("Not found");
        }
        res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
        res.end(data);
    });
});

server.listen(PORT, () => {
    console.log(`\nNER Sentinel frontend running at http://localhost:${PORT}`);
    console.log(`Proxying /api/* requests to backend on port ${BACKEND_PORT}\n`);
});
