const express = require('express');
const { Client } = require('pg');

app.get('/messages', async (req, res) => {
  const { start_date, end_date } = req.query;

  if (!start_date || !end_date) {
    return res.status(400).send('Please provide start_date and end_date query parameters.');
  }

  try {
    const query = `
      SELECT 
        id, 
        message, 
        sender_id, 
        receiver_id, 
        sender_type, 
        receiver_type, 
        create_timestamp
      FROM 
        public.messages
      WHERE 
        create_timestamp BETWEEN $1 AND $2;
    `;

    const result = await client.query(query, [start_date, end_date]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

