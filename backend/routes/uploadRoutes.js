const express = require("express");
const protect = require("../middleware/authMiddleware");
const { upload } = require("../middleware/uploadMiddleware");

const router = express.Router();

// Field name: "evidence", up to 5 files. Returns public URLs
// (served statically from /uploads — see server.js) that can be
// stored on an Incident's `evidence` array.
router.post("/evidence", protect, upload.array("evidence", 5), (req, res) => {
    try {
        const files = req.files || [];

        if (!files.length) {
            return res.status(400).json({
                message: "No files uploaded (expected field name 'evidence')"
            });
        }

        const urls = files.map((file) => `/uploads/${file.filename}`);

        res.status(201).json({
            message: "Evidence uploaded successfully",
            urls
        });
    } catch (error) {
        res.status(500).json({
            message: "Failed to upload evidence",
            error: error.message
        });
    }
});

// Multer errors (bad file type, too large) land here via next(err).
router.use((error, req, res, next) => {
    res.status(400).json({
        message: "Upload rejected",
        error: error.message
    });
});

module.exports = router;
