const path = require("path");
const fs = require("fs");
const multer = require("multer");

const UPLOAD_DIR = path.join(__dirname, "..", "uploads");

// Previously only a filename string was saved to the DB with no actual
// file ever written to disk. This writes the real bytes to /uploads
// and returns a URL the frontend can load directly.
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
        const safeExt = path.extname(file.originalname).slice(0, 10);
        const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`;
        cb(null, unique);
    }
});

const ALLOWED_MIME_PREFIXES = ["image/", "video/"];

const fileFilter = (req, file, cb) => {
    const allowed = ALLOWED_MIME_PREFIXES.some((prefix) =>
        file.mimetype.startsWith(prefix)
    );

    if (!allowed) {
        return cb(new Error("Only image or video files are allowed"));
    }

    cb(null, true);
};

const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: 25 * 1024 * 1024, // 25MB
        files: 5
    }
});

module.exports = { upload, UPLOAD_DIR };
