require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
  // ssl: {
  //   rejectUnauthorized: false, // Required for Render's self-signed SSL certificate
  // },
});

// const pool = new Pool({
//   connectionString: process.env.DATABASE_URL,
//   ssl: {
//     rejectUnauthorized: false, // For self-signed certificates
//   },
// });

pool.on('connect', () => {
  console.log('Connected to the PostgreSQL database');
});


module.exports = pool;