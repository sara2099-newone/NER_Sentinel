// Plain static file server for the frontend — no framework, no build
// step, no npm install. The frontend talks to the backend (real
// server.js on :5000, or the zero-setup demoServer.js on :5050)
// entirely client-side via fetch(); this file's only job is serving
// the static HTML/CSS/JS.

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, "public");

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml"
};

const server = http.createServer((req, res) => {
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
    console.log(`It talks to a backend via fetch() — start one of:`);
    console.log(`  cd ../backend && node demoServer.js     (zero setup, port 5050 — default)`);
    console.log(`  cd ../backend && npm install && node server.js   (full backend, port 5000)\n`);
});
