const express = require("express");
const pool = require("../modules/database");
const jwt = require('jsonwebtoken');
require("dotenv").config();
const WebSocket = require('ws');
const router = express.Router();

const formatTimestamp = (timestamp) => {
    const messageDate = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    // Check if the timestamp is today
    if (
        messageDate.getDate() === today.getDate() &&
        messageDate.getMonth() === today.getMonth() &&
        messageDate.getFullYear() === today.getFullYear()
    ) {
        return 'today';
    }

    // Check if the timestamp is yesterday
    if (
        messageDate.getDate() === yesterday.getDate() &&
        messageDate.getMonth() === yesterday.getMonth() &&
        messageDate.getFullYear() === yesterday.getFullYear()
    ) {
        return 'yesterday';
    }

    // Return the date in 'YYYY-MM-DD' format for other dates
    return messageDate.toISOString().split('T')[0];
};

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

            const { id, role } = user;

            // Fetch all conversations for the user
            const conversationsResult = await pool.query(
                `SELECT * FROM conversations WHERE user1_id = $1 OR user2_id = $1 ORDER BY last_message_timestamp DESC`,
                [id]
            );

            const conversations = conversationsResult.rows;

            if (conversations.length === 0) {
                return res.json({ conversations: [] });
            }

            const userIds = [];
            const userDetailsMap = {};

            // Collect all other user IDs
            conversations.forEach((conversation) => {
                const otherUserId = conversation.user1_id === id ? conversation.user2_id : conversation.user1_id;
                userIds.push(otherUserId);
            });

            // Fetch all related users (both mentors and mentees) in a single query
            const mentorResults = await pool.query(
                `SELECT id, first_name, last_name, profile_image FROM mentor WHERE id = ANY($1::uuid[])`,
                [userIds]
            );

            const menteeResults = await pool.query(
                `SELECT id, first_name, last_name, profile_image FROM mentee WHERE id = ANY($1::uuid[])`,
                [userIds]
            );

            // Merge mentor and mentee results into a single map
            mentorResults.rows.forEach((mentor) => {
                userDetailsMap[mentor.id] = {
                    name: `${mentor.first_name} ${mentor.last_name}`,
                    profileImage: mentor.profile_image,
                    role: 'mentor',
                };
            });

            menteeResults.rows.forEach((mentee) => {
                userDetailsMap[mentee.id] = {
                    name: `${mentee.first_name} ${mentee.last_name}`,
                    profileImage: mentee.profile_image,
                    role: 'mentee',
                };
            });

            // Fetch the latest messages for each conversation
            const conversationIds = conversations.map(convo => convo.id);
            const messagesResults = await pool.query(
                `SELECT * FROM messages WHERE conversation_id = ANY($1::uuid[]) ORDER BY timestamp ASC`,
                [conversationIds]
            );

            const messagesMap = {};
            messagesResults.rows.forEach((message) => {
                if (!messagesMap[message.conversation_id]) {
                    messagesMap[message.conversation_id] = [];
                }
                messagesMap[message.conversation_id].push({
                    text: message.content,
                    time: formatTimestamp(message.timestamp), // Format the timestamp
                    type: message.sender_id === id ? 'outgoing' : 'incoming',
                });
            });

            // Construct the conversation data
            const formattedConversations = conversations
                .filter(conversation => messagesMap[conversation.id] && messagesMap[conversation.id].length > 0)
                .map((conversation) => {
                    const otherUserId = conversation.user1_id === id ? conversation.user2_id : conversation.user1_id;
                    const otherUser = userDetailsMap[otherUserId];               
                    return {
                        id: conversation.id,
                        receiver_id: otherUserId, // Add the receiver_id here
                        profileImage: otherUser.profileImage,
                        name: otherUser.name,
                        type: otherUser.role,
                        messages: messagesMap[conversation.id],
                    };
                });

            return res.json({ conversations: formattedConversations });
        });
    } catch (error) {
        console.error(error.message);
        res.status(500).json({ message: 'Server error' });
    }
});

router.route("/check-conversation").post(async (req, res) => {
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

            const ownid = user.id; // Logged-in user's ID
            const { id: otherid } = req.body; // ID of the other user

            if (!ownid || !otherid) {
                return res.status(400).json({ message: 'User IDs are required' });
            }

            try {
                // Check if a conversation already exists between the two users
                let conversationResult = await pool.query(`
                    SELECT id
                    FROM conversations
                    WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)
                `, [ownid, otherid]);
                
                let conversationId;
                if (conversationResult.rows.length > 0) {
                    conversationId = conversationResult.rows[0].id;
                } else {
                    // Create a new conversation if it doesn't exist
                    const insertResult = await pool.query(`
                        INSERT INTO conversations (user1_id, user2_id, last_message_timestamp)
                        VALUES ($1, $2, NOW())
                        RETURNING id
                    `, [ownid, otherid]);

                    conversationId = insertResult.rows[0].id;
                }

                // Fetch all conversations of the logged-in user
                const conversationsResult = await pool.query(`
                    SELECT id, user1_id, user2_id, last_message_timestamp
                    FROM conversations
                    WHERE user1_id = $1 OR user2_id = $1
                    ORDER BY last_message_timestamp DESC
                `, [ownid]);
                
                const conversations = conversationsResult.rows;

                // Fetch other users' details from both mentor and mentee tables
                const userIds = Array.from(new Set(conversations.flatMap(conv => [conv.user1_id, conv.user2_id])))
                    .filter(userId => userId !== ownid); // Exclude the logged-in user's ID

                const userDetailsResult = await pool.query(`
                    SELECT id, first_name, profile_image, 'mentor' AS role
                    FROM public.mentor
                    WHERE id = ANY($1::uuid[])
                    UNION
                    SELECT id, first_name, profile_image, 'mentee' AS role
                    FROM public.mentee
                    WHERE id = ANY($1::uuid[])
                `, [userIds]);

                const userDetails = userDetailsResult.rows.reduce((acc, user) => {
                    acc[user.id] = {
                        name: user.first_name,
                        profileImage: user.profile_image,
                        role: user.role,
                    };
                    return acc;
                }, {});

                // Fetch messages for all conversations
                const conversationIds = conversations.map(conv => conv.id);
                const messagesResult = await pool.query(`
                    SELECT conversation_id, content AS text, timestamp AS time,
                           CASE WHEN sender_id = $1 THEN 'outgoing' ELSE 'incoming' END AS type
                    FROM messages
                    WHERE conversation_id = ANY($2::uuid[])
                    ORDER BY timestamp
                `, [ownid, conversationIds]);

                const messagesMap = messagesResult.rows.reduce((acc, message) => {
                    if (!acc[message.conversation_id]) {
                        acc[message.conversation_id] = [];
                    }
                    acc[message.conversation_id].push({
                        text: message.text,
                        time: formatTimestamp(message.time), // Format the timestamp
                        type: message.type,
                    });
                    return acc;
                }, {});

                // Format the conversation data
                const formattedConversations = conversations.map(conversation => {
                    const otherUserId = conversation.user1_id === ownid ? conversation.user2_id : conversation.user1_id;
                    const otherUser = userDetails[otherUserId];
                    return {
                        id: conversation.id,
                        receiver_id: otherUserId, // Add the receiver_id here
                        profileImage: otherUser.profileImage,
                        name: otherUser.name,
                        type: otherUser.role,
                        messages: messagesMap[conversation.id] || [],
                    };
                });

                // Find the newly created or found conversation and put it at the beginning
                const newConversation = formattedConversations.find(conv => conv.id === conversationId);
                const otherConversations = formattedConversations.filter(conv => conv.id !== conversationId);

                res.json({ conversations: [newConversation, ...otherConversations] });

            } catch (queryError) {
                console.error(queryError.message);
                res.status(500).json({ message: 'Server error' });
            }
        });
    } catch (error) {
        console.error(error.message);
        res.status(500).json({ message: 'Server error' });
    }
});


router.route("/updatemessage").post(async (req, res) => {
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

            const { conversationId, text, time, receiverId } = req.body;
            const senderId = user.id;

            if (!conversationId || !text || !receiverId) {
                return res.status(400).json({ message: 'Invalid request data' });
            }

            const date = new Date().toISOString().split('T')[0];

            // Extract the date portion of the timestamp

            // Insert the new message into the database with only the date
            await pool.query(
                `INSERT INTO messages (conversation_id, sender_id, receiver_id, content, timestamp) 
                VALUES ($1, $2, $3, $4, $5)`,
                [conversationId, senderId, receiverId, text, time]
            );

            // Update the last_message_timestamp in the conversation with only the date
            await pool.query(
                `UPDATE conversations 
                SET last_message_timestamp = $1 
                WHERE id = $2`,
                [date, conversationId]
            );

            res.status(200).json({ message: 'Message sent successfully' });
        });
    } catch (error) {
        console.error(error.message);
        res.status(500).json({ message: 'Server error' });
    }
});

router.route("/getMessage").get(async (req, res) => {
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

        const { conversationId } = req.query;

        if (!conversationId) {
            return res.status(400).json({ message: 'Invalid request data' });
        }

        try {
            // Get today's date in the format used in your database
            const today = new Date().toISOString().split('T')[0]; // Format YYYY-MM-DD

            // Fetch messages for the specified conversation sent today
            const messagesResult = await pool.query(
                `SELECT * FROM messages 
                 WHERE conversation_id = $1 AND DATE(timestamp) = $2
                 ORDER BY timestamp ASC`,
                [conversationId, today]
            );

            const messages = messagesResult.rows.map(message => ({
                text: message.content,
                time: formatTimestamp(message.timestamp), // Format the timestamp as needed
                type: message.sender_id === user.id ? 'outgoing' : 'incoming',
            }));

            return res.json({ messages: messages });
        } catch (error) {
            console.error(error.message);
            return res.status(500).json({ message: 'Server error' });
        }
    });
});


module.exports = router