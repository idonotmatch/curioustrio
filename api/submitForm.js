const axios = require('axios');
const { connectToDatabase } = require('../utils/mongodb');
const Contact = require('../models/contact')

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  
    try {
      console.log('Connecting to database...');
      await connectToDatabase();
      console.log('Database connected successfully.');
  
      const { first_name, last_name, email } = req.body;
      console.log('Received data:', first_name, last_name, email);
  
      // Check if a contact with the same email already exists
      let contact = await Contact.findOne({ email: email });
      if (contact) {
        // If exists, update the existing contact
        contact.firstName = first_name;
        contact.lastName = last_name;
        contact.updateCount += 1;
        await contact.save();
        console.log('Contact updated successfully.');
      } else {
        // If not exists, create a new contact
        const newContact = new Contact({ firstName: first_name, lastName: last_name, email: email });
        await newContact.save();
        console.log('New contact saved successfully.');
      }
  
      res.redirect(303, 'https://popstart.curioustrio.com');
    } catch (error) {
      console.error('Error during database operation:', error);
      res.status(500).json({ error: 'Internal server error', details: error.message });
    }
  };
  