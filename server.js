require('dotenv').config({ path: './.env.local' });
const express = require('express');
const bodyParser = require('body-parser');
const connectDB = require('./utils/mongodb'); // Check the MongoDB connection utility for errors
const Contact = require('./models/contact');

const app = express();
app.use(bodyParser.json());

// Connect to MongoDB
connectDB().then(() => {
  console.log('MongoDB connected successfully');
  // Listen to the server inside the connection callback to ensure it starts after DB connection
  app.listen(process.env.PORT || 5000, () => {
    console.log(`Server running on port ${process.env.PORT || 5000}`);
  });
}).catch(err => {
  console.error('Failed to connect to MongoDB', err);
  process.exit(1);
});

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

app.use(express.static('public')); // Ensure the public directory exists or remove this line if not using static files


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
