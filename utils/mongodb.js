const mongoose = require('mongoose');

const connectDB = async () => {
    const dbURI = process.env.MONGODB_URI; // Use an environment variable for the MongoDB URI
    if (!dbURI) {
        console.error('MongoDB connection string is missing in the environment variables.');
        process.exit(1); // Exit if the MongoDB URI is not set
    }

    try {
        const conn = await mongoose.connect(dbURI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            useCreateIndex: true, // Depending on your Mongoose version, you may not need this
            useFindAndModify: false // Depending on your Mongoose version, you may not need this
        });

        console.log(`MongoDB Connected: ${conn.connection.host}`);
    } catch (err) {
        console.error(`MongoDB Connection Error: ${err.message}`);
        process.exit(1); // Exit process with failure
    }
};

module.exports = connectDB;
