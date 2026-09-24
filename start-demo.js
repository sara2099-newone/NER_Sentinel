// One command to run the whole demo: starts the zero-setup backend
// (demoServer.js) and the frontend static server together, streams
// both logs with a prefix so you can tell them apart, and shuts both
// down cleanly on Ctrl+C.
//
// Usage (from the folder that contains both backend/ and frontend/):
//   node start-demo.js

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const ROOT = __dirname;
const BACKEND_DIR = path.join(ROOT, "backend");
const FRONTEND_DIR = path.join(ROOT, "frontend");

for (const [name, dir] of [["backend", BACKEND_DIR], ["frontend", FRONTEND_DIR]]) {
    if (!fs.existsSync(dir)) {
        console.error(`Can't find ${name}/ next to this script (looked in ${dir}).`);
        console.error(`Run this from the folder that directly contains both backend/ and frontend/.`);
        process.exit(1);
    }
}

function run(label, dir, script, color) {
    const child = spawn(process.execPath, [script], { cwd: dir });
    const prefix = `\x1b[${color}m[${label}]\x1b[0m`;

    child.stdout.on("data", (d) => d.toString().split("\n").filter(Boolean).forEach((line) => console.log(`${prefix} ${line}`)));
    child.stderr.on("data", (d) => d.toString().split("\n").filter(Boolean).forEach((line) => console.error(`${prefix} ${line}`)));
    child.on("exit", (code) => console.log(`${prefix} exited (code ${code})`));

    return child;
}

console.log("Starting NER Sentinel demo — backend (5050) + frontend (3000)...\n");

const backend = run("backend", BACKEND_DIR, "demoServer.js", "36"); // cyan
const frontend = run("frontend", FRONTEND_DIR, "server.js", "35"); // magenta

setTimeout(() => {
    console.log("\nOpen http://localhost:3000 in your browser.");
    console.log("Press Ctrl+C to stop both servers.\n");
}, 800);

const shutdown = () => {
    console.log("\nStopping...");
    backend.kill();
    frontend.kill();
    process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
