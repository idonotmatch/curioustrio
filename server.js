const Contact = require('./models/contact'); 
const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const connectDB = require('./utils/mongodb');

// Assuming 'Contact' model is exported from somewhere in your project
const Contact = require('./models/contact'); // Update the path as necessary

const app = express();

// Use urlencoded to properly parse the data sent by the default form submission
app.use(bodyParser.urlencoded({ extended: true }));
connectDB();

app.use(express.static('public')); // Serve static files

app.post('/submit-form', async (req, res) => {
  const { first_name, last_name, email } = req.body;
  try {
    const newContact = new Contact({
      firstName: first_name,
      lastName: last_name,
      email: email
    });
    await newContact.save();
    // Redirect to a specific page after submission
    res.redirect('https://popstart.curioustrio.com');
  } catch (error) {
    console.error('Error saving contact:', error);
    res.status(500).send('Error processing your request');
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
