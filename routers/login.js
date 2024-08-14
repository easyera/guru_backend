const express = require("express");
const pool = require('../modules/database');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require("dotenv").config();

const router = express.Router();

function generateTokens(user, role) {
    const accessToken = jwt.sign({ id: user.id, email: user.email, role: role }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
    const refreshToken = jwt.sign({ id: user.id, email: user.email, role: role }, process.env.REFRESH_TOKEN_SECRET, { expiresIn: '7d' });
    return { accessToken, refreshToken };
}

function generateRefreshTokens(user) {
    const accessToken = jwt.sign({ id: user.id, email: user.email }, process.env.OAUTH_TOKEN_SECRET, { expiresIn: '20m' });
    return accessToken;
}

function generatejustaccesstoken(user, role) {
    const accessToken = jwt.sign({ id: user.id, email: user.email, role: role }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '20m' });
    return accessToken;
}


router.route("/mentor").post(async (req, res) => {
    const { email, password } = req.body;

    try {
        const emailCheck = await pool.query('SELECT * FROM mentor WHERE email = $1', [email]);
        if (emailCheck.rows.length === 0) {
            return res.status(400).json({ message: 'Email, password or role is incorrect' });
        } else {
            const user = emailCheck.rows[0];
            const validPassword = await bcrypt.compare(password, user.password);
            if (!validPassword) {
                return res.status(400).json({ message: 'Invalid password' });
            }

            if (user != undefined) {
                if (user.first_name == null || user.category == null || user.skill == null) {
                    const temptoken = generatejustaccesstoken(user, 'mentor'); 
                    return res.status(206).json({ message: 'User profile incomplete', User: user , accessToken: temptoken });
                }
                else {
                    const { accessToken, refreshToken } = generateTokens(user, 'mentor');
                    return res.json({ accessToken: accessToken, refreshToken: refreshToken, message: 'Login successful' });
                }
            } else {
                return res.status(404).json({ message: 'User not found' });
            }
        }
    } catch (error) {
        console.error(error.message);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.route("/mentee").post(async (req, res) => {
    const { email, password } = req.body;
    try {
        const emailCheck = await pool.query('SELECT * FROM mentee WHERE email = $1', [email]);
        if (emailCheck.rows.length === 0) {
            return res.status(400).json({ message: 'Email, password or role is incorrect' });
        } else {
            const user = emailCheck.rows[0];
            const validPassword = await bcrypt.compare(password, user.password);
            if (!validPassword) {
                return res.status(400).json({ message: 'Invalid password' });
            }
            if (user != undefined) {
                if (user.first_name == null || user.category == null || user.occupation == null) {
                    const temptoken = generatejustaccesstoken(user, 'mentee');
                    return res.status(206).json({ message: 'User profile incomplete' , User: user , accessToken: temptoken });
                }
                else {
                    const { accessToken, refreshToken } = generateTokens(user, 'mentee');
                    return res.json({ accessToken: accessToken, refreshToken: refreshToken, message: 'Login successful' });
                }
            } else {
                return res.status(404).json({ message: 'User not found' });
            }
        }
    } catch (error) {
        console.error(error.message);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.route("/google/mentor").get(async (req, res) => {
    const OAuthToken = req.headers['authorization'];
    const token = OAuthToken.split(' ')[1];
    if (token == null) return res.status(401).json({ message: 'Token not found' });

    jwt.verify(token, process.env.OAUTH_TOKEN_SECRET, async (err, user) => {
        if (err) {
            if (err.name === 'TokenExpiredError') {
                return res.status(403).json({ message: 'Token expired' });
            } else {
                return res.status(403).json({ message: 'Invalid token' });
            }
        }
        
        const { email, id } = user;
        const emailCheck = await pool.query('SELECT * FROM mentor WHERE email = $1', [email]);
        if (emailCheck.rows.length === 0) {
            return res.status(400).json({ message: 'User not found' });
        } else {
            const dbuser = emailCheck.rows[0];
            const validPassword = await bcrypt.compare(id, dbuser.password);
            if (!validPassword) {
                return res.status(400).json({ message: 'Invalid password' });
            }
            if (dbuser.first_name == null || dbuser.category == null || dbuser.experience == null || dbuser.skill == null) {
                const refreshToken = generateRefreshTokens(user);
                const temptoken = generatejustaccesstoken(dbuser, 'mentor');
                return res.status(206).json({ message: 'User profile incomplete', refreshToken: refreshToken , User: dbuser , accessToken: temptoken });
            }
            const { accessToken, refreshToken } = generateTokens(dbuser, 'mentor');
            return res.json({ accessToken: accessToken, refreshToken: refreshToken, message: 'Login successful' });
        }
    });
});

router.route("/google/mentee").get(async (req, res) => {
    const OAuthToken = req.headers['authorization'];
    const token = OAuthToken.split(' ')[1];
    if (token == null) return res.status(401).json({ message: 'Token not found' });

    jwt.verify(token, process.env.OAUTH_TOKEN_SECRET, async (err, user) => {
        if (err) {
            if (err.name === 'TokenExpiredError') {
                return res.status(403).json({ message: 'Token expired' });
            } else {
                return res.status(403).json({ message: 'Invalid token' });
            }
        }

        const { email, id } = user;
        const emailCheck = await pool.query('SELECT * FROM mentee WHERE email = $1', [email]);
        if (emailCheck.rows.length === 0) {
            return res.status(400).json({ message: 'User not found' });
        } else {
            const dbuser = emailCheck.rows[0];
            const validPassword = await bcrypt.compare(id, dbuser.password);
            if (!validPassword) {
                return res.status(400).json({ message: 'Invalid password' });
            }
            if (dbuser.first_name == null || dbuser.category == null || dbuser.occupation == null) {
                const refreshToken = generateRefreshTokens(user);
                const temptoken = generatejustaccesstoken(dbuser, 'mentee');
                return res.status(206).json({ message: 'User profile incomplete', refreshToken: refreshToken , User: dbuser , accessToken: temptoken});

            }
            const { accessToken, refreshToken } = generateTokens(dbuser , 'mentee');
            return res.json({ accessToken: accessToken, refreshToken: refreshToken, message: 'Login successful' });
        }
    });
});

module.exports = router;