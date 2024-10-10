const express = require("express");
const cors = require("cors");
const passport = require('passport');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const dashboard = require("./routers/dashboard");
const login = require("./routers/login");
const register = require('./routers/register');
const profiles = require('./routers/profiles');
const post = require('./routers/post');
const refresh = require('./routers/refresh');
const answers = require('./routers/answers');
const inbox = require('./routers/inbox');
const pool = require('./modules/database');

require('./auth');

require("dotenv").config();


const PORT = process.env.PORT || 5000;

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(passport.initialize());


// for login
app.use("/login", login);

app.use('/register', register);

app.use('/profile', profiles);

app.use("/dashboard", dashboard);

app.use("/refresh", refresh);

app.use("/post", post);

app.use("/answers", answers);

app.use("/inbox", inbox);

app.get('/', (req, res) => {
    res.send('Hello World!');
})

// Google OAuth login route
app.get('/auth/google/:userType', (req, res, next) => {
    
    const userType = req.params.userType;

    if (userType === 'mentor' || userType === 'mentee') {
        passport.authenticate('google', {
            scope: ['profile', 'email'],
            state: userType
        })(req, res, next);
    } else {
        res.status(400).send('Invalid user type ');
    }
});

function generateTokens(user) {
    const accessToken = jwt.sign({ id: user.id, email: user.email }, process.env.OAUTH_TOKEN_SECRET, { expiresIn: '5m' });
    return accessToken;
}

// Google OAuth callback route
app.get('/google/callback', passport.authenticate('google', { failureRedirect: process.env.FAILURE_REDIRECT_URL, session: false }), async (req, res) => {
    const userType = req.query.state;
    const user = req.user;
    
    try {
        // Check if the user already exists in either mentor or mentee database
        const mentorCheckQuery = 'SELECT * FROM mentor WHERE email = $1';
        const menteeCheckQuery = 'SELECT * FROM mentee WHERE email = $1';

        const [mentorCheck, menteeCheck] = await Promise.all([
            pool.query(mentorCheckQuery, [user.email]),
            pool.query(menteeCheckQuery, [user.email])
        ]);

        if (mentorCheck.rows.length > 0 || menteeCheck.rows.length > 0) {
            // User exists in either mentor or mentee table
            const existingUser = mentorCheck.rows.length > 0 ? mentorCheck.rows[0] : menteeCheck.rows[0];
            existingUser.id = user.id;
            const validPassword = await bcrypt.compare(user.id, existingUser.password);

            if (!validPassword) {
                return res.status(400).json({ message: 'You already registered with a password' });
            }

            // Generate tokens
            const accessToken = generateTokens(existingUser);
            const role = mentorCheck.rows.length > 0 ? 'mentor' : 'mentee';

            // Redirect with tokens and user data
            return res.redirect(`${process.env.FRONT_URL}/google/callback?&accessToken=${accessToken}&role=${role}`);
        }

        // User does not exist, hash the Google profile ID (for simplicity)
        const hashedPassword = await bcrypt.hash(user.id, 5);

        // Insert the new user into the appropriate database based on userType
        const insertUserQuery = userType === 'mentor' ?
            'INSERT INTO mentor (email, password, first_name, last_name, profile_image) VALUES ($1, $2, $3, $4, $5) RETURNING *' :
            'INSERT INTO mentee (email, password, first_name, last_name, profile_image) VALUES ($1, $2, $3, $4, $5) RETURNING *';

        const response = await pool.query(insertUserQuery, [user.email, hashedPassword, user.firstname, user.lastname, user.profileImage]);
        const newUser = response.rows[0];
        newUser.id = user.id;

        // Generate tokens
        const accessToken = generateTokens(newUser);

        // Redirect with tokens and user data
        res.redirect(`${process.env.FRONT_URL}/google/callback?&accessToken=${accessToken}&role=${userType}`);
    } catch (error) {
        console.error(error.message);
        res.status(500).json({ message: 'Server error' });
    }
});

// Start the server
const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Graceful shutdown function
const gracefulShutdown = () => {
    console.log('Shutting down gracefully...');
    server.close(() => {
        pool.end(() => {
            console.log('Pool has ended');
            process.exit(0);
        });
    });
};

// Handle process termination signals
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

