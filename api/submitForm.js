const mongoose = require('mongoose');
const { connectToDatabase } = require('../utils/mongodb'); // adjust path as necessary

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    console.log('Connecting to database...');
    await connectToDatabase();
    console.log('Database connected successfully.');

    const Contact = mongoose.model('Contact', new mongoose.Schema({
      firstName: String,
      lastName: String,
      email: String
    }));

    const { first_name, last_name, email } = req.body;
    console.log('Received data:', first_name, last_name, email);

    const newContact = new Contact({ firstName: first_name, lastName: last_name, email: email });
    await newContact.save();
    console.log('New contact saved successfully.');

    res.status(303).redirect('https://popstart.curioustrio.com');
  } catch (error) {
    console.error('Error during database operation:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};
