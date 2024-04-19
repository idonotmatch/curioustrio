require('dotenv').config({ path: './.env.local' });  // Load environment variables
const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const connectDB = require('./utils/mongodb'); // Check the MongoDB connection utility for errors

// Initialize express app
const app = express();
app.use(bodyParser.json()); // Parses incoming requests with JSON payloads

// Connect to MongoDB
connectDB().then(() => {
  console.log('MongoDB connected successfully');
}).catch(err => {
  console.error('Failed to connect to MongoDB', err);
  process.exit(1);
});

// Define the Contact model inside the connection callback or in a separate module
const contactSchema = new mongoose.Schema({
  firstName: String,
  lastName: String,
  email: String
}, { timestamps: true }); // Enable automatic timestamps for contact creation and updates

const Contact = mongoose.model('Contact', contactSchema);

// Define a single route for form submission
app.post('/submit-form', async (req, res) => {
  const { first_name, last_name, email } = req.body;
  try {
    const newContact = new Contact({
      firstName: first_name,
      lastName: last_name,
      email: email
    });
    await newContact.save();
    res.redirect(303, 'https://popstart.curioustrio.com');
  } catch (error) {
    console.error('Error saving contact:', error);
    res.status(500).send('Error processing your request');
  }
});

// Handle aggregate endpoint to get contact counts by email
app.get('/contact-counts', async (req, res) => {
  try {
    const counts = await Contact.aggregate([
      { $group: { _id: "$email", count: { $sum: 1 } } }
    ]);
    res.json(counts);
  } catch (error) {
    console.error('Error fetching contact counts:', error);
    res.status(500).send('Error processing your request');
  }
});

// Optionally handle undefined routes
app.use((req, res) => {
  res.status(404).send('Page not found');
});

// Server setup
const PORT = process.env.PORT || 5000; // Default to 5000 if no environment variable is set
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
