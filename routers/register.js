const express = require("express");
const pool = require('../modules/database');
const bcrypt = require('bcrypt');
require("dotenv").config();

const router = express.Router();

router.route("/mentor").post(async (req, res) => {
    const { firstName, lastName, email, password } = req.body;

    try {
        // Check if the email already exists in mentor or mentee tables
        const emailCheckMentor = await pool.query(
            'SELECT id FROM mentor WHERE email = $1',
            [email]
        );


        // Check in 'mentee' table
        const emailCheckMentee = await pool.query(
            'SELECT id FROM mentee WHERE email = $1',
            [email]
        );

        if (emailCheckMentor.rows.length > 0 || emailCheckMentee.rows.length > 0) {
            return res.status(400).json({ message: 'Email already exists' });
        }

        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 5);

        // Insert the new user
        const response = await pool.query(
            'INSERT INTO mentor (first_name, last_name, email, password) VALUES ($1, $2, $3, $4) RETURNING *',
            [firstName, lastName, email, hashedPassword]
        );

        // Get the inserted user's details
        const user = response.rows[0];

        if (user) {
            res.json({ message: 'User registered successfully' });
        } else {
            res.status(500).json({ message: 'User not inserted' });
        }
    } catch (error) {
        console.error(error.message);
        res.status(500).json({ message: 'Server error' });
    }
});

router.route("/mentee").post(async (req, res) => {
    const { firstName, lastName, email, password } = req.body;

    try {
        // Check if the email already exists in mentor or mentee tables
        const emailCheckMentor = await pool.query(
            'SELECT id FROM mentor WHERE email = $1',
            [email]
        );

        // Check in 'mentee' table
        const emailCheckMentee = await pool.query(
            'SELECT id FROM mentee WHERE email = $1',
            [email]
        );
        

        if (emailCheckMentor.rows.length > 0 || emailCheckMentee.rows.length > 0) {
            return res.status(400).json({ message: 'Email already exists' });
        }

        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 5);

        // Insert the new user
        const response = await pool.query(
            'INSERT INTO mentee (first_name, last_name, email, password) VALUES ($1, $2, $3, $4) RETURNING *',
            [firstName, lastName, email, hashedPassword]
        );

        // Get the inserted user's details
        const user = response.rows[0];

        if (user) {
            res.json({ message: 'User registered successfully' });
        } else {
            res.status(500).json({ message: 'User not inserted' });
        }
    } catch (error) {
        console.error(error.message);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
