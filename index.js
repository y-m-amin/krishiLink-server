require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB URI
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@krishilink-db.jzbgemd.mongodb.net/?appName=krishilink-db`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Root Route
app.get('/', (req, res) => {
  res.send('🌾 KrishiLink Server is running');
});

async function run() {
  try {
    await client.connect();

    const db = client.db('krishilink_db');
    const usersCollection = db.collection('users');
    const cropsCollection = db.collection('crops');

    // ========================
    // USERS APIs
    // ========================

    // Register new user
    app.post('/users', async (req, res) => {
      const user = req.body;
      const existing = await usersCollection.findOne({ email: user.email });
      if (existing) {
        return res.send({ message: 'User already exists.' });
      }
      const result = await usersCollection.insertOne(user);
      res.send({
        success: true,
        message: 'User registered successfully',
        result,
      });
    });

    // Get all users (optional)
    app.get('/users', async (req, res) => {
      const users = await usersCollection.find().toArray();
      res.send(users);
    });

    // ========================
    // CROPS APIs
    // ========================

    // Get all crops (with optional search)
    app.get('/crops', async (req, res) => {
      const search = req.query.search;
      let query = {};
      if (search) {
        query = { name: { $regex: search, $options: 'i' } };
      }
      const result = await cropsCollection.find(query).toArray();
      res.send(result);
    });

    // Get latest 6 crops
    app.get('/latest-crops', async (req, res) => {
      const result = await cropsCollection
        .find()
        .sort({ _id: -1 })
        .limit(6)
        .toArray();
      res.send(result);
    });

    // Get a single crop by ID
    app.get('/crops/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await cropsCollection.findOne(query);
      res.send(result);
    });

    // Add a new crop
    app.post('/crops', async (req, res) => {
      const crop = req.body;
      crop.interests = [];
      const result = await cropsCollection.insertOne(crop);
      res.status(201).send({
        success: true,
        message: 'Crop added successfully!',
        insertedId: result.insertedId,
      });
    });

    // Update crop info
    app.patch('/crops/:id', async (req, res) => {
      const id = req.params.id;
      const updated = req.body;
      const filter = { _id: new ObjectId(id) };
      const update = {
        $set: {
          name: updated.name,
          type: updated.type,
          pricePerUnit: updated.pricePerUnit,
          unit: updated.unit,
          quantity: updated.quantity,
          description: updated.description,
          location: updated.location,
          image: updated.image,
        },
      };
      const result = await cropsCollection.updateOne(filter, update);
      res.send({ success: true, message: 'Crop updated successfully', result });
    });

    // Delete crop
    app.delete('/crops/:id', async (req, res) => {
      const id = req.params.id;
      const result = await cropsCollection.deleteOne({ _id: new ObjectId(id) });
      res.send({ success: true, message: 'Crop deleted successfully', result });
    });

    // ========================
    // INTEREST APIs
    // ========================
    // Send interest for a crop
    app.post('/crops/:id/interests', async (req, res) => {
      const cropId = req.params.id;
      const interest = req.body;
      const interestId = new ObjectId();
      const cropQuery = { _id: new ObjectId(cropId) };

      // Validation: Quantity must be >= 1
      if (!interest.quantity || interest.quantity < 1) {
        return res
          .status(400)
          .send({ message: 'Quantity must be at least 1.' });
      }

      // Find crop first
      const crop = await cropsCollection.findOne(cropQuery);
      if (!crop) {
        return res.status(404).send({ message: 'Crop not found.' });
      }

      // Prevent owner from sending interest on own crop
      if (interest.userEmail === crop.owner.ownerEmail) {
        return res.status(400).send({
          message: 'You cannot send an interest request on your own crop.',
        });
      }

      // Prevent duplicate interest from the same user
      const alreadyInterested = crop.interests?.some(
        (i) => i.userEmail === interest.userEmail
      );
      if (alreadyInterested) {
        return res.status(400).send({
          message: "You've already sent an interest for this crop.",
        });
      }

      const newInterest = {
        _id: interestId,
        ...interest,
        status: interest.status || 'pending',
      };

      const update = { $push: { interests: newInterest } };
      const result = await cropsCollection.updateOne(cropQuery, update);

      res.status(201).send({
        success: true,
        message: 'Interest submitted successfully!',
        interestId: interestId,
        result,
      });
    });

    // Get interests received by crop owner
    app.get('/crops/:id/interests', async (req, res) => {
      const id = req.params.id;
      const crop = await cropsCollection.findOne({ _id: new ObjectId(id) });
      if (!crop) return res.status(404).send({ message: 'Crop not found' });
      res.send(crop.interests || []);
    });

    // Accept / Reject an interest
    app.patch('/interests/:cropId/:interestId', async (req, res) => {
      const { cropId, interestId } = req.params;
      const { status, reduceQuantityBy } = req.body;

      const crop = await cropsCollection.findOne({ _id: new ObjectId(cropId) });
      if (!crop) return res.status(404).send({ message: 'Crop not found' });

      // Update interest status
      const result = await cropsCollection.updateOne(
        {
          _id: new ObjectId(cropId),
          'interests._id': new ObjectId(interestId),
        },
        {
          $set: {
            'interests.$.status': status,
          },
        }
      );

      // Reduce quantity if accepted
      if (status === 'accepted' && reduceQuantityBy > 0) {
        await cropsCollection.updateOne(
          { _id: new ObjectId(cropId) },
          { $inc: { quantity: -reduceQuantityBy } }
        );
      }

      res.send({
        success: true,
        message: `Interest ${status} successfully.`,
        result,
      });
    });

    // Get interests sent by a user (My Interests)
    app.get('/my-interests', async (req, res) => {
      const email = req.query.email;
      if (!email)
        return res.status(400).send({ message: 'Missing email parameter' });

      const result = await cropsCollection
        .aggregate([
          { $unwind: '$interests' },
          { $match: { 'interests.userEmail': email } },
          {
            $project: {
              cropId: '$_id',
              cropName: '$name',
              owner: '$owner.ownerName',
              quantity: '$interests.quantity',
              message: '$interests.message',
              status: '$interests.status',
            },
          },
        ])
        .toArray();

      res.send(result);
    });

    // Verify DB connection
    await client.db('admin').command({ ping: 1 });
    console.log('✅ Connected to MongoDB KrishiLink Database');
  } finally {
    // Keep connection open
  }
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`🚀 KrishiLink Server running on port: ${port}`);
});
