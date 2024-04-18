require('dotenv').config({ path: './.env.local' });  // Add this at the top of your main server file

const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const connectDB = require('./utils/mongodb'); // Ensure this path is correct

// Ensure dotenv is configured at the top if you use environment variables from a .env file

const app = express();
app.use(bodyParser.json());
connectDB();

app.use(express.static('public')); // Serve static files

// Form submission endpoint
app.post('/submit-form', async (req, res) => {
  const { first_name, last_name, email } = req.body;
  try {
    const newContact = new Contact({
      firstName: first_name,
      lastName: last_name,
      email: email
    });
    await newContact.save();
    res.redirect('https://popstart.curioustrio.com');
  } catch (error) {
    console.error('Error saving contact:', error);
    res.status(500).send('Error processing your request');
  }
});

const detectPort = require('detect-port');

detectPort(5000, (err, availablePort) => {
  if (err) {
    console.error(err);
    return;
  }
  const PORT = availablePort;
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});
