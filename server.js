require('dotenv').config({ path: './.env.local' });  // Load environment variables

const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const { connectToDatabase } = require('./utils/mongodb');  // Correct path to your MongoDB utility

const app = express();
app.use(bodyParser.json()); // Parses incoming requests with JSON payloads

// Define the Contact model
const contactSchema = new mongoose.Schema({
  firstName: String,
  lastName: String,
  email: String
});
const Contact = mongoose.model('Contact', contactSchema);

// Establish MongoDB connection
connectToDatabase().then(() => {
  console.log('MongoDB connected successfully');
}).catch(error => {
  console.error('MongoDB connection failed:', error);
  process.exit(1);
});

app.use(express.static('public')); // Serve static files from the 'public' directory if it exists

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
    console.error('Error detecting port:', err);
    return;
  }
  const PORT = process.env.PORT || availablePort;  // Use the PORT from environment or the available port
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});
