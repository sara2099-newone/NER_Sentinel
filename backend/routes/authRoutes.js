const express = require("express");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const router = express.Router();

// Login-specific brute-force limiter. The global apiLimiter in
// server.js (100 req / 15 min across ALL /api routes) is too loose to
// stop credential stuffing against one account — this caps login
// attempts much tighter, keyed per IP, independent of every other
// route's traffic.
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        message: "Too many login attempts. Please try again in a few minutes."
    }
});

// ==========================================
// REGISTER USER
// ==========================================
router.post("/register", async (req, res) => {
    try {
        const { name, email, password, role } = req.body;

        // Check required fields
        if (!name || !email || !password) {
            return res.status(400).json({
                message: "Name, email and password are required"
            });
        }

        // Validate password length
        if (password.length < 6) {
            return res.status(400).json({
                message: "Password must be at least 6 characters"
            });
        }

        // Validate role
        const userRole = role || "Citizen";

        if (!["Citizen", "Official"].includes(userRole)) {
            return res.status(400).json({
                message: "Invalid role. Use Citizen or Official."
            });
        }

        // Check if email already exists
        const existingUser = await User.findOne({
            email: email.toLowerCase().trim()
        });

        if (existingUser) {
            return res.status(409).json({
                message: "Email already registered"
            });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user
        const user = new User({
            name: name.trim(),
            email: email.toLowerCase().trim(),
            password: hashedPassword,
            role: userRole
        });

        await user.save();

        // Send response without password
        res.status(201).json({
            message: "User registered successfully",
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        });

    } catch (error) {
        console.error("Registration error:", error.message);

        res.status(500).json({
            message: "Registration failed",
            error: error.message
        });
    }
});


// ==========================================
// LOGIN USER
// ==========================================
router.post("/login", loginLimiter, async (req, res) => {
    try {
        const { email, password, role } = req.body;

        // Check required fields
        if (!email || !password || !role) {
            return res.status(400).json({
                message: "Email, password and role are required"
            });
        }

        // Validate role
        if (!["Citizen", "Official"].includes(role)) {
            return res.status(400).json({
                message: "Invalid role. Use Citizen or Official."
            });
        }

        // Find user
        const user = await User.findOne({
            email: email.toLowerCase().trim()
        });

        if (!user) {
            return res.status(401).json({
                message: "Invalid email or password"
            });
        }

        // Check selected role against stored role
        if (user.role !== role) {
            return res.status(403).json({
                message: "Selected role does not match your account"
            });
        }

        // Compare password
        const isPasswordValid = await bcrypt.compare(
            password,
            user.password
        );

        if (!isPasswordValid) {
            return res.status(401).json({
                message: "Invalid email or password"
            });
        }
// Create JWT token
const token = jwt.sign(
    {
        userId: user._id,
        role: user.role
    },
    process.env.JWT_SECRET,
    {
        expiresIn: "1d"
    }
);
        // Successful login
        res.status(200).json({
            message: "Login successful",
            token: token,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        });

    } catch (error) {
        console.error("Login error:", error.message);

        res.status(500).json({
            message: "Login failed",
            error: error.message
        });
    }
});


module.exports = router;