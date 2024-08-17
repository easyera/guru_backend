const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
require("dotenv").config();

let users = [];

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.CLIENT_BACK_URL
}, (accessToken, refreshToken, profile, done) => {
    const user = {
        id: profile._json.sub,
        email: profile._json.email,
        profileImage: profile._json.picture, // Getting the profile image URL
        firstname: profile._json.given_name,
        lastname: profile._json.family_name
    };
    return done(null, user);
}));