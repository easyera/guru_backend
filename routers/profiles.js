const express = require("express");
const pool = require('../modules/database');
const router = express.Router();
require("dotenv").config();
const jwt = require('jsonwebtoken');
const multer = require("multer");
const { bucket } = require('../firebaseconfig.js');
const { v4: uuidv4 } = require('uuid');
const path = require('path');


const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

function replaceEmptyWithNull(obj) {
    const newObj = {};
    for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
            newObj[key] = obj[key] === "" ? null : obj[key];
        }
    }
    return newObj;
}

async function handleFileUpload(file, oldFileUrl) {
    try {
        if (!file) return oldFileUrl;
        const ext = path.extname(file.originalname);        
        const uniqueId = uuidv4();  // Generates a unique UUID
        const newFileName = `${Date.now()}_image_profile_${uniqueId}${ext}`;
        const fileUpload = bucket.file(newFileName);
        await fileUpload.save(file.buffer);
        await fileUpload.makePublic();
        // Generate and return the download URL of the new file
        const newFileUrl = `https://storage.googleapis.com/${bucket.name}/${encodeURIComponent(newFileName)}`;

        let oldFileName = '';
        if (oldFileUrl) {
            const urlParts = oldFileUrl.split('/');
            oldFileName = urlParts[urlParts.length - 1];
        }

        if (oldFileName) {
            console.log(`Attempting to delete file: ${oldFileName}`);
            const oldFile = bucket.file(oldFileName);
            try {
                await oldFile.delete();
                console.log(`File deleted successfully: ${oldFileName}`);
            } catch (deleteError) {
                console.error(`Error deleting file: ${deleteError.message}`);
            }
        }
        return newFileUrl;

    } catch (error) {
        console.log(error);
    }
}

const updateUser = async (table, fieldsToUpdate, email, res) => {
    const setClause = Object.keys(fieldsToUpdate).map((key, index) => `${key} = $${index + 1}`).join(", ");
    const values = [...Object.values(fieldsToUpdate), email];

    const query = `UPDATE ${table} SET ${setClause} WHERE email = $${values.length} RETURNING *`;

    try {
        const response = await pool.query(query, values);
        if (response.rows.length > 0) {
            const { id } = response.rows[0];
            let result = await pool.query(`SELECT COUNT(id) FROM answers WHERE owner_id = $1`, [id]);
            const Commentcount = result.rows[0].count;
            result = await pool.query(`SELECT COUNT(id) FROM post WHERE owner_id = $1`, [id]);
            const Postcount = result.rows[0].count;
            let finalresult = { ...response.rows[0], Commentcount, Postcount };
            res.json({ message: 'User updated successfully', User: finalresult });
        } else {
            res.status(404).json({ message: 'User not found' });
        }
    } catch (error) {
        console.error(error.message);
        res.status(500).json({ message: 'Server error' });
    }
};

router.route("/mentor").post(upload.single('profile_image_data'), async (req, res) => {
    try {
        const AccessToken = req.headers['authorization'];
        const token = AccessToken.split(' ')[1];
        jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, async (err, user) => {
            if (err) {
                if (err.name === 'TokenExpiredError') {
                    return res.status(403).json({ message: 'Token expired' });
                } else {
                    return res.status(403).json({ message: 'Invalid token' });
                }
            }

            const { email } = user;
            if (email === req.body.email) {
                const { first_name, last_name, category, experience, description, skill, previous_image_url, profile_image } = req.body;

                let finalProfileImageUrl;
                if (req.file) {
                    const newProfileImageUrl = await handleFileUpload(req.file, previous_image_url);
                    finalProfileImageUrl = newProfileImageUrl || profile_image;
                } else {
                    finalProfileImageUrl = profile_image;
                }

                const fieldsToUpdate = replaceEmptyWithNull({
                    first_name,
                    last_name,
                    category,
                    experience,
                    description,
                    skill,
                    profile_image: finalProfileImageUrl
                });

                updateUser('mentor', fieldsToUpdate, email, res);
            } else {
                res.status(401).json({ message: 'Unauthorized' });
            }
        });
    } catch (error) {
        console.error(error.message);
        res.status(500).json({ message: 'Server error' });
    }
});

router.route("/mentee").post(upload.single('profile_image_data'), async (req, res) => {
    try {
        const AccessToken = req.headers['authorization'];
        const token = AccessToken.split(' ')[1];
        jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, async (err, user) => {
            if (err) {
                if (err.name === 'TokenExpiredError') {
                    return res.status(403).json({ message: 'Token expired' });
                } else {
                    return res.status(403).json({ message: 'Invalid token' });
                }
            }

            const { email } = user;
            if (email === req.body.email) {
                const { first_name, last_name, category, occupation, previous_image_url, institution_name, age, phone_number, student_level, profile_image } = req.body;

                let finalProfileImageUrl;
                if (req.file) {
                    const newProfileImageUrl = await handleFileUpload(req.file, previous_image_url);
                    finalProfileImageUrl = newProfileImageUrl || profile_image;
                } else {
                    finalProfileImageUrl = profile_image;
                }

                const formattedCategory = `{${category.split(',').map(item => `"${item.trim()}"`).join(',')}}`;

                const fieldsToUpdate = replaceEmptyWithNull({
                    first_name,
                    last_name,
                    category : formattedCategory,
                    occupation,
                    profile_image: finalProfileImageUrl,
                    institution_name,
                    age,
                    phone_number,
                    student_level
                });

                updateUser('mentee', fieldsToUpdate, email, res);

            } else {
                res.status(401).json({ message: 'Unauthorized' });
            }
        });
    } catch (error) {
        console.error(error.message);
        res.status(500).json({ message: 'Server error' });
    }
});

router.route("/").get(async (req, res) => {
    try {
        const AccessToken = req.headers['authorization'];
        const token = AccessToken.split(' ')[1];
        jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, async (err, user) => {
            if (err) {
                if (err.name === 'TokenExpiredError') {
                    return res.status(403).json({ message: 'Token expired' });
                } else {
                    return res.status(403).json({ message: 'Invalid token' });
                }
            }
            const { id, role, email } = user;
            const User = await pool.query(`SELECT * FROM ${role} WHERE id = $1`, [id]);
            let result = await pool.query(`SELECT COUNT(id) FROM answers WHERE owner_id = $1`, [id]);
            const Commentcount = result.rows[0].count;
            result = await pool.query(`SELECT COUNT(id) FROM post WHERE owner_id = $1`, [id]);
            const Postcount = result.rows[0].count;

            // Fetch user's posts
            const postsResult = await pool.query(`SELECT * FROM post WHERE owner_id = $1 ORDER BY post_datetime DESC`, [id]);
            const posts = postsResult.rows;

            if (User.rows.length === 0) {
                return res.status(400).json({ message: 'User not found' });
            } else {
                const data = User.rows[0];
                data.role = role;
                data.Commentcount = Commentcount;
                data.Postcount = Postcount;
                const postsWithCounts = posts.map(post => {
                    return {
                        ...post,
                        like_count: (post.like_list || []).length,
                        dislike_count: (post.dislike_list || []).length,
                        liked: (post.like_list || []).includes(id),
                        disliked: (post.dislike_list || []).includes(id),
                    };
                });
                return res.json({ User: data , Posts : postsWithCounts});
            }
        });
    } catch (error) {
        console.error(error.message);
        res.status(500).json({ message: 'Server error' });
    }
});

router.route("/").post(async (req, res) => {
    try {
        const AccessToken = req.headers['authorization'];
        if (!AccessToken) {
            return res.status(401).json({ message: 'Unauthorized' });
        }
        const token = AccessToken.split(' ')[1];
        
        jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, async (err, user) => {
            if (err) {
                if (err.name === 'TokenExpiredError') {
                    return res.status(403).json({ message: 'Token expired' });
                } else {
                    return res.status(403).json({ message: 'Invalid token' });
                }
            }

            const { id } = req.body;

            // Query both tables
            const mentorQuery = await pool.query('SELECT * FROM mentor WHERE id = $1', [id]);
            const menteeQuery = await pool.query('SELECT * FROM mentee WHERE id = $1', [id]);

            // Check if any user was found
            const mentorUser = mentorQuery.rows.length > 0 ? mentorQuery.rows[0] : null;
            const menteeUser = menteeQuery.rows.length > 0 ? menteeQuery.rows[0] : null;

            if (mentorUser) {
                // If user is found in mentor table
                let result = await pool.query('SELECT COUNT(id) FROM answers WHERE owner_id = $1', [id]);
                const Commentcount = result.rows[0].count;
                result = await pool.query('SELECT COUNT(id) FROM post WHERE owner_id = $1', [id]);
                const Postcount = result.rows[0].count;
                const postsResult = await pool.query('SELECT * FROM post WHERE owner_id = $1 ORDER BY post_datetime DESC', [id]);
                const posts = postsResult.rows;

                mentorUser.role = 'mentor'; // Set role for response
                mentorUser.Commentcount = Commentcount;
                mentorUser.Postcount = Postcount;

                return res.json({ User: mentorUser, Posts: posts });
            } else if (menteeUser) {
                // If user is found in mentee table
                let result = await pool.query('SELECT COUNT(id) FROM answers WHERE owner_id = $1', [id]);
                const Commentcount = result.rows[0].count;
                result = await pool.query('SELECT COUNT(id) FROM post WHERE owner_id = $1', [id]);
                const Postcount = result.rows[0].count;
                const postsResult = await pool.query('SELECT * FROM post WHERE owner_id = $1 ORDER BY post_datetime DESC', [id]);
                const posts = postsResult.rows;

                menteeUser.role = 'mentee'; // Set role for response
                menteeUser.Commentcount = Commentcount;
                menteeUser.Postcount = Postcount;

                return res.json({ User: menteeUser, Posts: posts });
            } else {
                // No user found in either table
                return res.status(400).json({ message: 'User not found' });
            }
        });
    } catch (error) {
        console.error(error.message);
        res.status(500).json({ message: 'Server error' });
    }
});


module.exports = router;