const express = require("express");
const pool = require('../modules/database');
const jwt = require('jsonwebtoken');
require("dotenv").config();

const router = express.Router();

router.route("/").get(async (req, res) => {
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

        const Postid = req.query.Postid; // Use query parameter instead of body

        // Fetch answers based on post_id
        const answersResult = await pool.query('SELECT * FROM answers WHERE post_id = $1', [Postid]);
        const answers = answersResult.rows;

        if (answers.length === 0) {
            return res.json({ message: 'No answers found' });
        }

        // Extract owner_ids from answers
        const ownerIds = answers.map(answer => answer.owner_id);

        // Fetch users from both mentor and mentee tables
        const mentorUsersResult = await pool.query('SELECT id, first_name, last_name, profile_image FROM mentor WHERE id = ANY($1)', [ownerIds]);
        const menteeUsersResult = await pool.query('SELECT id, first_name, last_name, profile_image FROM mentee WHERE id = ANY($1)', [ownerIds]);

        // Create a mapping of owner_id to user data
        const userMap = new Map();

        mentorUsersResult.rows.forEach(user => userMap.set(user.id, { name: `${user.first_name} ${user.last_name}`, profileImg: user.profile_image, role: 'mentor' }));
        menteeUsersResult.rows.forEach(user => userMap.set(user.id, { name: `${user.first_name} ${user.last_name}`, profileImg: user.profile_image, role: 'mentee' }));

        // Attach user data to answers and build detailed answers
        const detailedAnswers = answers.map(answer => {
            const liked = answer.like_list.includes(user.id) ? true : false;
            const disliked = answer.dislike_list.includes(user.id) ? true : false;

            return {
                id: answer.id,
                owner_id: answer.owner_id,
                name: userMap.get(answer.owner_id)?.name || 'Unknown',
                profileImg: userMap.get(answer.owner_id)?.profileImg || null, // Fallback image
                answer: answer.answer,
                liked , // Add liked property
                disliked, // Add disliked property
                like_count: answer.like_list.length, // Count likes
                dislike_count: answer.dislike_list.length, // Count dislikes
            };
        });

        return res.json({ answers: detailedAnswers });
    });
});

router.route("/").post(async (req, res) => {
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

        const { post_id, answer } = req.body;

        // Validate the input
        if (!post_id || !answer) {
            return res.status(400).json({ message: 'Invalid input' });
        }

        try {
            // Insert the answer into the database
            const result = await pool.query(
                'INSERT INTO answers (owner_id, answer, post_id, like_count, dislike_count, like_list, dislike_list) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
                [user.id, answer, post_id, 0, 0, [], []] // Initialize counts and lists
            );

            const newAnswer = result.rows[0];

            // Fetch user details for the owner of the new answer based on role
            const userResult = await pool.query(
                user.role === 'mentor'
                    ? 'SELECT id, first_name, last_name, profile_image FROM mentor WHERE id = $1'
                    : 'SELECT id, first_name, last_name, profile_image FROM mentee WHERE id = $1',
                [user.id]
            );

            const userDetails = userResult.rows[0];

            // Format the response
            const formattedAnswer = {
                id: newAnswer.id,
                owner_id: newAnswer.owner_id,
                name: `${userDetails.first_name} ${userDetails.last_name}`,
                profileImg: userDetails.profile_image || null,
                answer: newAnswer.answer,
                liked: false, // Default value, adjust based on user interactions if needed
                disliked: false, // Default value, adjust based on user interactions if needed
                like_count: newAnswer.like_list.length,
                dislike_count: newAnswer.dislike_list.length,
            };

            return res.json({ message: 'Answer added successfully', answer: formattedAnswer });
        } catch (error) {
            console.error('Database error:', error.message);
            return res.status(500).json({ message: 'Server error' });
        }
    });

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
        const { answer_id, which, like, dislike } = req.body;

        try {
            // Fetch the current like_list and dislike_list for the post
            const result = await pool.query('SELECT like_list, dislike_list FROM answers WHERE id = $1', [answer_id]);
            const { like_list, dislike_list } = result.rows[0];
            
            let updatedLikeList = like_list;
            let updatedDislikeList = dislike_list;
            
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
                `UPDATE answers 
                SET like_list = $1, dislike_list = $2, like_count = $3, dislike_count = $4 
                WHERE id = $5`,
                [updatedLikeList, updatedDislikeList, likeCount, dislikeCount, answer_id]
            );
            
            res.status(200).json({ message: 'Like/Dislike updated successfully' });
        } catch (error) {
            console.error('Database error:', error.message);
            res.status(500).json({ message: 'Server error' });
        }
    });
});

module.exports = router;
