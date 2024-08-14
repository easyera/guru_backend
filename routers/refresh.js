const express = require("express");
require("dotenv").config();
const jwt = require('jsonwebtoken');

const router = express.Router();

router.route("/").post(async (req, res) => {

    const { refreshToken } = req.body;
    if (refreshToken) {
        jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET, (err, user) => {
            if (err) {
                if (err.name === 'TokenExpiredError') {
                    return res.status(403).json({ message: 'Token expired' });
                } else {
                    return res.status(403).json({ message: 'Invalid token' });
                }
            }
            const { id, role, email } = user;
            const accessToken = jwt.sign({ id: id, role: role, email: email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
            return res.json({ token: accessToken });
        });
    } else {
        return res.status(403).json({ message: 'Refresh token not found' });
    }

});
module.exports = router