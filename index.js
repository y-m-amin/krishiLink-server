require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Setup
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@krishilink-db.jzbgemd.mongodb.net/?appName=krishilink-db`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Reuse connection (Vercel cold start optimization)
let db;
async function getDb() {
  if (!db) {
    if (!client.topology?.isConnected()) {
      await client.connect();
    }
    db = client.db('krishilink_db');
    console.log('✅ Connected to MongoDB KrishiLink Database');
  }
  return db;
}

// Root route
app.get('/', (req, res) => {
  res.send('🌾 KrishiLink Server is running');
});

// ============ USERS APIs ============
app.post('/users', async (req, res) => {
  const user = req.body;
  const database = await getDb();
  const users = database.collection('users');

  const existing = await users.findOne({ email: user.email });
  if (existing) {
    return res.send({ message: 'User already exists.' });
  }
  const result = await users.insertOne(user);
  res.send({
    success: true,
    message: 'User registered successfully',
    result,
  });
});

app.get('/users', async (req, res) => {
  const database = await getDb();
  const users = await database.collection('users').find().toArray();
  res.send(users);
});

// ============ CROPS APIs ============
app.get('/crops', async (req, res) => {
  const search = req.query.search;
  const database = await getDb();
  const crops = database.collection('crops');

  let query = {};
  if (search) query = { name: { $regex: search, $options: 'i' } };
  const result = await crops.find(query).toArray();
  res.send(result);
});

app.get('/latest-crops', async (req, res) => {
  const database = await getDb();
  const crops = database.collection('crops');
  const result = await crops.find().sort({ _id: -1 }).limit(6).toArray();
  res.send(result);
});

app.get('/crops/:id', async (req, res) => {
  const database = await getDb();
  const crops = database.collection('crops');
  const id = req.params.id;
  const result = await crops.findOne({ _id: new ObjectId(id) });
  res.send(result);
});

app.post('/crops', async (req, res) => {
  const crop = req.body;
  crop.interests = [];
  const database = await getDb();
  const crops = database.collection('crops');
  const result = await crops.insertOne(crop);
  res.status(201).send({
    success: true,
    message: 'Crop added successfully!',
    insertedId: result.insertedId,
  });
});

app.patch('/crops/:id', async (req, res) => {
  const id = req.params.id;
  const updated = req.body;
  const database = await getDb();
  const crops = database.collection('crops');
  const result = await crops.updateOne(
    { _id: new ObjectId(id) },
    {
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
    }
  );
  res.send({ success: true, message: 'Crop updated successfully', result });
});

app.delete('/crops/:id', async (req, res) => {
  const id = req.params.id;
  const database = await getDb();
  const crops = database.collection('crops');
  const result = await crops.deleteOne({ _id: new ObjectId(id) });
  res.send({ success: true, message: 'Crop deleted successfully', result });
});

// ============ INTEREST APIs ============
app.post('/crops/:id/interests', async (req, res) => {
  const cropId = req.params.id;
  const interest = req.body;
  const interestId = new ObjectId();

  const database = await getDb();
  const crops = database.collection('crops');

  if (!interest.quantity || interest.quantity < 1) {
    return res.status(400).send({ message: 'Quantity must be at least 1.' });
  }

  const crop = await crops.findOne({ _id: new ObjectId(cropId) });
  if (!crop) return res.status(404).send({ message: 'Crop not found.' });

  if (interest.userEmail === crop.owner.ownerEmail) {
    return res.status(400).send({
      message: 'You cannot send an interest request on your own crop.',
    });
  }

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

  const result = await crops.updateOne(
    { _id: new ObjectId(cropId) },
    { $push: { interests: newInterest } }
  );

  res.status(201).send({
    success: true,
    message: 'Interest submitted successfully!',
    interestId: interestId,
    result,
  });
});

app.get('/crops/:id/interests', async (req, res) => {
  const id = req.params.id;
  const database = await getDb();
  const crops = database.collection('crops');
  const crop = await crops.findOne({ _id: new ObjectId(id) });
  if (!crop) return res.status(404).send({ message: 'Crop not found' });
  res.send(crop.interests || []);
});

app.patch('/interests/:cropId/:interestId', async (req, res) => {
  const { cropId, interestId } = req.params;
  const { status, reduceQuantityBy } = req.body;

  const database = await getDb();
  const crops = database.collection('crops');
  const crop = await crops.findOne({ _id: new ObjectId(cropId) });
  if (!crop) return res.status(404).send({ message: 'Crop not found' });

  const result = await crops.updateOne(
    {
      _id: new ObjectId(cropId),
      'interests._id': new ObjectId(interestId),
    },
    { $set: { 'interests.$.status': status } }
  );

  if (status === 'accepted' && reduceQuantityBy > 0) {
    await crops.updateOne(
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

app.get('/my-interests', async (req, res) => {
  const email = req.query.email;
  if (!email)
    return res.status(400).send({ message: 'Missing email parameter' });

  const database = await getDb();
  const crops = database.collection('crops');
  const result = await crops
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

// Export for Vercel
module.exports = app;
