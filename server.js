require('dotenv').config({ path: './.env.local' });  // Load environment variables
const express = require('express');
const bodyParser = require('body-parser');
const connectDB = require('./utils/mongodb'); // Check the MongoDB connection utility for errors
const Contact = require('./models/contact'); // Import the Contact model

const app = express();
app.use(bodyParser.json()); // Parses incoming requests with JSON payloads

// Connect to MongoDB and start the server within the connection callback
connectDB().then(() => {
  console.log('MongoDB connected successfully');
  const PORT = process.env.PORT || 5000; // Default to 5000 if no environment variable is set
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}).catch(err => {
  console.error('Failed to connect to MongoDB', err);
  process.exit(1);
});

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
    res.redirect('https://popstart.curioustrio.com');
  } catch (error) {
    console.error('Error saving contact:', error);
    res.status(500).send('Error processing your request');
  }
});

// Optional: Serve static files if you have a 'public' directory
// app.use(express.static('public'));

// Optionally handle undefined routes
app.use((req, res) => {
  res.status(404).send('Page not found');
});
