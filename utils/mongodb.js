const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        // Replace 'your_mongodb_connection_string' with your actual connection string
        const conn = await mongoose.connect('mongodb+srv://dang:<12QA34ws!@>@testcluster.ep8qdjk.mongodb.net/?retryWrites=true&w=majority&appName=TestCluster', {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });

        console.log(`MongoDB Connected: ${conn.connection.host}`);
    } catch (err) {
        console.error(`Error: ${err.message}`);
        process.exit(1); // Exit process with failure
    }
};

module.exports = connectDB;
