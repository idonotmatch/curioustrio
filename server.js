require('dotenv').config({ path: './.env.local' });  // Ensure dotenv is loaded to manage environment variables

const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const connectDB = require('./utils/mongodb');  // Ensure this path correctly leads to your MongoDB connection utility

const app = express();
app.use(bodyParser.json()); // Parses incoming requests with JSON payloads

// Define the Contact model right after MongoDB is set up
const contactSchema = new mongoose.Schema({
  firstName: String,
  lastName: String,
  email: String
});
const Contact = mongoose.model('Contact', contactSchema);

// Ensure MongoDB connection is initiated
connectDB();

// Serve static files from the 'public' directory
app.use(express.static('public'));

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

// Use detect-port to find an available port, starting with 5000
detectPort(5000, (err, availablePort) => {
  if (err) {
    console.error(err);
    return;
  }
  const PORT = availablePort;  // Use the available port found or default to 5000
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});
