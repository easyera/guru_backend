const express = require("express");
const jwt = require('jsonwebtoken');
require("dotenv").config();
const pool = require('../modules/database');

const router = express.Router();

router.route("/").get((req, res) => {
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

        if (User.rows.length === 0) {
            return res.status(400).json({ message: 'User not found' });
        } else {
            const data = User.rows[0];
            data.role = role;
            data.Commentcount = Commentcount;
            data.Postcount = Postcount;
            return res.json({ User: data });
        }
    });
})

router.route("/mentorlist").get(async (req, res) => {
    const AccessToken = req.headers['authorization'];
    if (!AccessToken) {
        return res.status(401).json({ message: 'Unauthorized' });
    }
    const token = AccessToken.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, async (err) => {
        if (err) {
            if (err.name === 'TokenExpiredError') {
                return res.status(403).json({ message: 'Token expired' });
            } else {
                return res.status(403).json({ message: 'Invalid token' });
            }
        }

        const categories = req.query.categories; // Get categories from query parameters

        const result = await pool.query(`SELECT * FROM mentor WHERE category = ANY($1)`, [categories]);
        if (result.rows.length === 0) {
            return res.json({ message: 'No mentors found' });
        } else {
            return res.json({ message: 'Mentors found', mentors: result.rows });
        }
    });
});

router.route("/posts").get(async (req, res) => {
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

        const categories = req.query.categories; // Get categories from query parameters

        // Fetch posts based on categories
        const postsResult = await pool.query('SELECT * FROM post WHERE category = ANY($1)', [categories]);
        const posts = postsResult.rows;

        if (posts.length === 0) {
            return res.json({ message: 'No posts found' });
        }

        // Extract owner_ids from posts
        const ownerIds = posts.map(post => post.owner_id);

        // Fetch users from both mentor and mentee tables
        const mentorUsersResult = await pool.query('SELECT id, first_name, last_name, profile_image FROM mentor WHERE id = ANY($1)', [ownerIds]);
        const menteeUsersResult = await pool.query('SELECT id, first_name, last_name, profile_image FROM mentee WHERE id = ANY($1)', [ownerIds]);

        // Create a mapping of owner_id to user data
        const userMap = new Map();

        mentorUsersResult.rows.forEach(user => userMap.set(user.id, { ...user, role: 'mentor' }));
        menteeUsersResult.rows.forEach(user => userMap.set(user.id, { ...user, role: 'mentee' }));

        // Attach user data to posts
        const postsWithUsers = posts.map(post => ({
            ...post,
            like_count: (post.like_list || []).length,
            dislike_count: (post.dislike_list || []).length,
            liked: (post.like_list || []).includes(user.id),
            disliked: (post.dislike_list || []).includes(user.id),
            user: userMap.get(post.owner_id) || null // Attach user data or null if not found
        }));

        return res.json({ posts: postsWithUsers });
    });
});

router.route("/search").get(async (req, res) => {
    const AccessToken = req.headers['authorization'];
    if (!AccessToken) {
        return res.status(401).json({ message: 'Unauthorized' });
    }
    const token = AccessToken.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, async (err) => {
        if (err) {
            if (err.name === 'TokenExpiredError') {
                return res.status(403).json({ message: 'Token expired' });
            } else {
                return res.status(403).json({ message: 'Invalid token' });
            }
        }
        const searchQuery = req.query.Search;
        if (!searchQuery) {
            return res.status(400).json({ message: 'Search query is required' });
        }


        try {
            // Query to search for posts and mentors
            const postsQuery = `
              SELECT id, question 
              FROM post
              WHERE question ILIKE $1
              LIMIT 3
            `;
            const mentorsQuery = `
              SELECT id, first_name, last_name, profile_image
              FROM mentor 
              WHERE first_name ILIKE $1
              LIMIT 3
            `;

            // Execute queries
            const [postsResult, mentorsResult] = await Promise.all([
                pool.query(postsQuery, [`%${searchQuery}%`]),
                pool.query(mentorsQuery, [`%${searchQuery}%`]),
            ]);

            // Combine results
            const combinedResults = [
                ...postsResult.rows.map(post => ({ type: 'post', ...post })),
                ...mentorsResult.rows.map(mentor => ({ type: 'mentor', ...mentor }))
            ];

            // Send response
            res.json({ result: combinedResults });
        } catch (error) {
            console.error('Error executing search query', error);
            res.status(500).json({ message: 'Server error' });
        }
    });
});

router.route("/singlePost").get(async (req, res) => {
    const AccessToken = req.headers['authorization'];
    if (!AccessToken) {
        return res.status(401).json({ message: 'Unauthorized' });
    }
    const token = AccessToken.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, async (err) => {
        if (err) {
            if (err.name === 'TokenExpiredError') {
                return res.status(403).json({ message: 'Token expired' });
            } else {
                return res.status(403).json({ message: 'Invalid token' });
            }
        }
        const Post_id = req.query.id;
        if (!Post_id) {
            return res.status(400).json({ message: 'id is required' });
        }
        try {
            // Query to get the post by ID
            const postQuery = `
                SELECT *
                FROM post 
                WHERE id = $1
            `;

            const result = await pool.query(postQuery, [Post_id]);
            if (result.rows.length === 0) {
                return res.status(404).json({ message: 'Post not found' });
            }

            // Send the post data
            res.json({ post: result.rows[0] });
        } catch (error) {
            console.error('Error executing query', error);
            res.status(500).json({ message: 'Server error' });
        }


    });
});


module.exports = router