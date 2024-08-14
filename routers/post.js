const express = require("express");
const pool = require("../modules/database");
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
        const newFileName = `${Date.now()}_image_post_${uniqueId}${ext}`;
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
            // console.log(`Attempting to delete file: ${oldFileName}`);
            const oldFile = bucket.file(oldFileName);
            try {
                await oldFile.delete();
                // console.log(`File deleted successfully: ${oldFileName}`);
            } catch (deleteError) {
                console.error(`Error deleting file: ${deleteError.message}`);
            }
        }

        return newFileUrl;

    } catch (error) {
        console.log(error);
    }
}

async function deleteFileFromFirebase(fileName) {
    try {
        let oldFileName = '';
        if (fileName) {
            const urlParts = fileName.split('/');
            oldFileName = urlParts[urlParts.length - 1];
        }
        const file = bucket.file(oldFileName);
        await file.delete();
        // console.log(`File deleted successfully: ${fileName}`);
    } catch (error) {
        console.error(`Error deleting file: ${error.message}`);
        throw new Error('Failed to delete file from Firebase Storage');
    }
}

router.route("/").post(upload.single('image'), async (req, res) => {
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
            const { question, description, category, previous_image_url, likes_count } = req.body;

            // Handle file upload
            let finalImageUrl;
            if (req.file) {
                const newImageUrl = await handleFileUpload(req.file, previous_image_url);
                finalImageUrl = newImageUrl || previous_image_url;
            } else {
                finalImageUrl = previous_image_url;
            }

            // Prepare data to be inserted into the database
            const fieldsToInsert = replaceEmptyWithNull({
                question,
                description,
                category,
                image: finalImageUrl,
                owner_id: id,
                post_datetime: new Date(),
            });
            // category, owner_id, description, answers_id, post_datetime, image, question, likes_count, share_link
            // Insert data into the database
            try {
                const query = `
                    INSERT INTO post (question, description, category, image, owner_id, post_datetime)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    RETURNING *;
                `;
                const values = Object.values(fieldsToInsert);
                const response = await pool.query(query, values);

                if (response.rows.length > 0) {
                    res.json({ message: 'Post created successfully', post: response.rows[0] });
                } else {
                    res.status(400).json({ message: 'Failed to create post' });
                }
            } catch (error) {
                console.error(error.message);
                res.status(500).json({ message: 'Server error' });
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
        if (!AccessToken) {
            return res.status(403).json({ message: 'Authorization token missing' });
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

            const userId = user.id;

            // Query to get the posts for the user
            const query = `
                SELECT * FROM post WHERE owner_id = $1 ORDER BY post_datetime DESC;
            `;
            const values = [userId];
            const response = await pool.query(query, values);

            if (response.rows.length > 0) {
                // Process each post to include like/dislike counts and user status
                const postsWithCounts = response.rows.map(post => {
                    return {
                        ...post,
                        like_count: (post.like_list || []).length,
                        dislike_count: (post.dislike_list || []).length,
                        liked: (post.like_list || []).includes(userId),
                        disliked: (post.dislike_list || []).includes(userId),
                    };
                });

                res.json({ message: 'Posts retrieved successfully', posts: postsWithCounts });
            } else {
                res.status(404).json({ message: 'No posts found for this user' });
            }
        });
    } catch (error) {
        console.error(error.message);
        res.status(500).json({ message: 'Server error' });
    }
});

router.route("/postUpdate").put(upload.single('image'), async (req, res) => {
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
            const { question, description, category, previous_image_url, post_id } = req.body;

            // Handle file upload
            let finalImageUrl;
            if (req.file) {
                const newImageUrl = await handleFileUpload(req.file, previous_image_url);
                finalImageUrl = newImageUrl || previous_image_url;
            } else {
                finalImageUrl = previous_image_url;
            }

            // Prepare data to be updated in the database
            const fieldsToUpdate = replaceEmptyWithNull({
                question,
                description,
                category,
                image: finalImageUrl,
                edit_datetime: new Date(),
            });

            const updateFields = Object.keys(fieldsToUpdate).map((key, index) => `${key} = $${index + 1}`)
            const values = Object.values(fieldsToUpdate);

            // Update data in the database
            try {
                values.push(post_id); // Add the post_id to the values array
                const query = `
                    UPDATE post
                    SET ${updateFields.join(', ')}
                    WHERE id = $${values.length}
                    RETURNING *;
                `;
                const response = await pool.query(query, values);

                if (response.rows.length > 0) {
                    res.json({ message: 'Post updated successfully', post: response.rows[0] });
                } else {
                    res.status(400).json({ message: 'Failed to update post' });
                }
            } catch (error) {
                console.error(error.message);
                res.status(500).json({ message: 'Server error' });
            }
        });
    } catch (error) {
        console.error(error.message);
        res.status(500).json({ message: 'Server error' });
    }
});

router.route('/postDelete').delete(async (req, res) => {
    try {
        const AccessToken = req.headers['authorization'];
        const token = AccessToken.split(' ')[1];

        if (!AccessToken) {
            return res.status(403).json({ message: 'Authorization token missing' });
        }

        jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, async (err, user) => {
            if (err) {
                if (err.name === 'TokenExpiredError') {
                    return res.status(403).json({ message: 'Token expired' });
                } else {
                    return res.status(403).json({ message: 'Invalid token' });
                }
            }

            const { id, image_url } = req.body;

            if (!id) {
                return res.status(400).json({ message: 'Post ID is required' });
            }

            // Extract the file name from the URL

            // Delete the post from the database
            const deleteQuery = 'DELETE FROM post WHERE id = $1';
            await pool.query(deleteQuery, [id]);

            // Delete the image from Firebase Storage
            if (image_url) {
                try {
                    await deleteFileFromFirebase(image_url);
                } catch (deleteError) {
                    console.error(`Error deleting file: ${deleteError.message}`);
                    // Optionally handle the failure (e.g., roll back database changes)
                }
            }

            res.json({ message: 'Post and image deleted successfully' });

        });
    } catch (error) {
        console.error(error.message);
        res.status(500).json({ message: 'Server error' });
    }
});

router.route("/likesanddislike").post(async (req, res) => {
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

        const { id: userId } = user;
        const { Post_id, which, like, dislike } = req.body;

        try {
            // Fetch the current like_list and dislike_list for the post
            const result = await pool.query('SELECT like_list, dislike_list FROM post WHERE id = $1', [Post_id]);
            const { like_list, dislike_list } = result.rows[0];

            // Ensure the lists are arrays
            let updatedLikeList = like_list || [];
            let updatedDislikeList = dislike_list || [];

            // Update the lists based on the like and dislike values
            if (which === 'like') {
                if (like) {
                    if (!updatedLikeList.includes(userId)) {
                        updatedLikeList.push(userId);
                    }
                } else {
                    updatedLikeList = updatedLikeList.filter(id => id !== userId);
                }
            } else if (which === 'dislike') {
                if (dislike) {
                    if (!updatedDislikeList.includes(userId)) {
                        updatedDislikeList.push(userId);
                    }
                } else {
                    updatedDislikeList = updatedDislikeList.filter(id => id !== userId);
                }
            }

            const likeCount = updatedLikeList.length;
            const dislikeCount = updatedDislikeList.length;

            // Update the post in the database
            await pool.query(
                `UPDATE post 
                SET like_list = $1, dislike_list = $2, like_count = $3, dislike_count = $4 
                WHERE id = $5`,
                [updatedLikeList, updatedDislikeList, likeCount, dislikeCount, Post_id]
            );

            res.status(200).json({ message: 'Like/Dislike updated successfully' });
        } catch (error) {
            console.error('Database error:', error.message);
            res.status(500).json({ message: 'Server error' });
        }
    });
});


module.exports = router;
