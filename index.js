/**
 * ============================================================
 * KrishiLink Backend API
 * Tech: Node.js, Express, MongoDB, JWT, Stripe
 * Auth: Firebase (Frontend) + JWT (Backend)
 * ============================================================
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const Stripe = require('stripe');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/* ============================================================
   GLOBAL MIDDLEWARE
============================================================ */
app.use(cors());
app.use(express.json());

/* Basic rate limiting (anti-spam & abuse protection) */
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
});
app.use(apiLimiter);

/* ============================================================
   MONGODB SETUP (Vercel-friendly)
============================================================ */
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@krishilink-db.jzbgemd.mongodb.net/?appName=krishilink-db`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let db;
async function getDb() {
  if (!db) {
    await client.connect();
    db = client.db('krishilink_db');
    console.log('MongoDB connected');
  }
  return db;
}

/* ============================================================
   HELPER FUNCTIONS
============================================================ */
const sendError = (res, status, code, message) =>
  res.status(status).send({
    success: false,
    error: { code, message },
  });

const isValidId = (id) => ObjectId.isValid(id);

/* ============================================================
   AUTH MIDDLEWARE
============================================================ */
function verifyJWT(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) {
    return sendError(res, 401, 'AUTH_ERROR', 'Unauthorized');
  }

  const token = auth.split(' ')[1];
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return sendError(res, 401, 'AUTH_ERROR', 'Invalid token');
    }
    req.user = decoded;
    next();
  });
}

function verifyAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return sendError(res, 403, 'FORBIDDEN', 'Admin only');
  }
  next();
}

/* ============================================================
   ROOT
============================================================ */
app.get('/', (req, res) => {
  res.send('🌾 KrishiLink Server is running');
});

/* ============================================================
   AUTH (JWT) – Firebase Compatible
============================================================ */
app.post('/jwt', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Email is required');
  }

  const db = await getDb();
  const user = await db.collection('users').findOne({ email });

  if (!user || user.status === 'blocked') {
    return sendError(res, 403, 'FORBIDDEN', 'User blocked or not registered');
  }

  const token = jwt.sign(
    { email: user.email, role: user.role, userId: user._id },
    process.env.JWT_SECRET,
    { expiresIn: '1d' }
  );

  res.send({ success: true, token });
});

/* ============================================================
   USERS
============================================================ */
app.post('/users', async (req, res) => {
  const db = await getDb();
  const users = db.collection('users');

  const existing = await users.findOne({ email: req.body.email });
  if (existing) {
    return res.send({ success: true, message: 'User already exists' });
  }

  const user = {
    ...req.body,
    role: 'user',
    status: 'active',
    createdAt: new Date(),
  };

  await users.insertOne(user);
  res.send({ success: true, message: 'User registered' });
});

/* ============================================================
   CROPS (PUBLIC READ)
============================================================ */
app.get('/crops', async (req, res) => {
  const db = await getDb();
  const crops = db.collection('crops');

  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  let query = { status: 'active' };

  if (req.query.search) {
    query.name = { $regex: req.query.search, $options: 'i' };
  }
  if (req.query.type) query.type = req.query.type;
  if (req.query.location) query.location = req.query.location;

  const sortField = req.query.sort || 'createdAt';
  const sortOrder = req.query.order === 'asc' ? 1 : -1;

  const total = await crops.countDocuments(query);
  const data = await crops
    .find(query)
    .sort({ [sortField]: sortOrder })
    .skip(skip)
    .limit(limit)
    .toArray();

  res.send({
    success: true,
    data,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

app.get('/latest-crops', async (req, res) => {
  const db = await getDb();
  const result = await db
    .collection('crops')
    .find({ status: 'active' })
    .sort({ createdAt: -1 })
    .limit(6)
    .toArray();
  res.send({ success: true, data: result });
});

app.get('/crops/:id', async (req, res) => {
  if (!isValidId(req.params.id)) {
    return sendError(res, 400, 'INVALID_ID', 'Invalid crop id');
  }

  const db = await getDb();
  const crop = await db
    .collection('crops')
    .findOne({ _id: new ObjectId(req.params.id) });

  res.send({ success: true, data: crop });
});

/* ============================================================
   CROPS (PROTECTED WRITE)
============================================================ */
app.post('/crops', verifyJWT, async (req, res) => {
  const db = await getDb();

  const crop = {
    ...req.body,
    interests: [],
    status: 'active',
    verified: false,
    createdAt: new Date(),
  };

  const result = await db.collection('crops').insertOne(crop);
  res.status(201).send({ success: true, insertedId: result.insertedId });
});

app.patch('/crops/:id', verifyJWT, async (req, res) => {
  if (!isValidId(req.params.id)) {
    return sendError(res, 400, 'INVALID_ID', 'Invalid crop id');
  }

  const db = await getDb();
  await db
    .collection('crops')
    .updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { ...req.body, updatedAt: new Date() } }
    );

  res.send({ success: true, message: 'Crop updated' });
});

app.delete('/crops/:id', verifyJWT, async (req, res) => {
  if (!isValidId(req.params.id)) {
    return sendError(res, 400, 'INVALID_ID', 'Invalid crop id');
  }

  const db = await getDb();
  await db.collection('crops').deleteOne({
    _id: new ObjectId(req.params.id),
  });

  res.send({ success: true, message: 'Crop deleted' });
});

/* ============================================================
   INTERESTS
============================================================ */
app.post('/crops/:id/interests', verifyJWT, async (req, res) => {
  const { quantity, message = '' } = req.body;

  //  Validate quantity
  if (!quantity || quantity < 1) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid quantity');
  }

  const db = await getDb();
  const crops = db.collection('crops');

  const cropId = new ObjectId(req.params.id);
  const crop = await crops.findOne({ _id: cropId });

  if (!crop) {
    return sendError(res, 404, 'NOT_FOUND', 'Crop not found');
  }

  //  Prevent owner from sending interest
  if (crop.owner?.ownerEmail === req.user.email) {
    return sendError(res, 403, 'FORBIDDEN', 'Owner cannot send interest');
  }

  // Check stock
  if (quantity > crop.quantity) {
    return sendError(res, 400, 'OUT_OF_STOCK', 'Insufficient quantity');
  }

  //  Prevent duplicate interest
  const alreadySent = crop.interests?.some(
    (i) => i.userEmail === req.user.email
  );
  if (alreadySent) {
    return sendError(res, 400, 'DUPLICATE', 'Interest already sent');
  }

  //  Create SAFE interest object
  const interest = {
    _id: new ObjectId(),
    cropId: cropId.toString(),
    userEmail: req.user.email,
    userName: req.user.name || 'Unknown',
    quantity,
    message,
    status: 'pending', // pending | accepted | rejected
    paymentStatus: 'unpaid', // unpaid | paid
    createdAt: new Date(),
  };

  await crops.updateOne({ _id: cropId }, { $push: { interests: interest } });

  res.status(201).send({
    success: true,
    message: 'Interest submitted successfully',
  });
});

app.patch('/interests/:cropId/:interestId', verifyJWT, async (req, res) => {
  const { status } = req.body;

  if (!['accepted', 'rejected'].includes(status)) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid status');
  }

  const db = await getDb();
  const crops = db.collection('crops');

  const cropId = new ObjectId(req.params.cropId);
  const interestId = new ObjectId(req.params.interestId);

  const crop = await crops.findOne({ _id: cropId });

  if (!crop) {
    return sendError(res, 404, 'NOT_FOUND', 'Crop not found');
  }

  // Only owner can accept/reject
  if (crop.owner?.ownerEmail !== req.user.email) {
    return sendError(res, 403, 'FORBIDDEN', 'Not authorized');
  }

  const interest = crop.interests?.find(
    (i) => i._id.toString() === interestId.toString()
  );

  if (!interest) {
    return sendError(res, 404, 'NOT_FOUND', 'Interest not found');
  }

  if (status === 'accepted') {
    if (interest.quantity > crop.quantity) {
      return sendError(res, 400, 'OUT_OF_STOCK', 'Insufficient quantity');
    }

    await crops.updateOne(
      { _id: cropId },
      { $inc: { quantity: -interest.quantity } } // ✅ reduce stock
    );
  }

  //  Prevent re-processing
  if (interest.status !== 'pending') {
    return sendError(res, 400, 'INVALID_STATE', 'Interest already processed');
  }

  await crops.updateOne(
    {
      _id: cropId,
      'interests._id': interestId,
    },
    {
      $set: {
        'interests.$.status': status,
        'interests.$.updatedAt': new Date(),
      },
    }
  );

  res.send({
    success: true,
    message: `Interest ${status}`,
  });
});

app.get('/my-interests', verifyJWT, async (req, res) => {
  const userEmail = req.user.email;

  const db = await getDb();
  const crops = db.collection('crops');

  const interests = await crops
    .aggregate([
      { $unwind: '$interests' },
      {
        $match: {
          'interests.userEmail': userEmail,
        },
      },
      {
        $addFields: {
          totalAmount: {
            $multiply: ['$interests.quantity', '$pricePerUnit'],
          },
        },
      },
      {
        $project: {
          _id: 0,

          interestId: '$interests._id',
          cropId: '$_id',

          cropName: '$name',
          cropImage: '$image',
          unit: '$unit',

          sellerId: '$owner.ownerId',
          sellerEmail: '$owner.ownerEmail',
          sellerName: '$owner.ownerName',

          quantity: '$interests.quantity',
          message: '$interests.message',

          pricePerUnit: '$pricePerUnit',
          totalAmount: 1,

          status: '$interests.status',
          paymentStatus: '$interests.paymentStatus',
        },
      },
    ])
    .toArray();

  res.send({
    success: true,
    data: interests,
  });
});

/* ============================================================
   PAYMENTS (Stripe )
============================================================ */
app.post('/payments/create', verifyJWT, async (req, res) => {
  const { amount, cropId, interestId, sellerId } = req.body;

  if (!amount || !cropId || !interestId || !sellerId) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Missing payment data');
  }

  const db = await getDb();
  const payments = db.collection('payments');

  const existing = await payments.findOne({ interestId });
  if (existing) {
    return sendError(res, 400, 'DUPLICATE_PAYMENT', 'Already paid');
  }

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    mode: 'payment',
    line_items: [
      {
        price_data: {
          currency: 'bdt',
          product_data: {
            name: 'Crop Purchase',
          },
          unit_amount: Math.round(amount),
        },
        quantity: 1,
      },
    ],
    success_url: `${process.env.CLIENT_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.CLIENT_URL}/payment-failed`,
    metadata: {
      cropId,
      interestId,
      sellerId,
      buyerId: req.user.userId,
      amount,
    },
  });

  res.send({ url: session.url });
});

app.post('/payments/confirm', verifyJWT, async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return sendError(res, 400, 'INVALID_SESSION', 'Session ID missing');
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== 'paid') {
      return sendError(res, 400, 'PAYMENT_FAILED', 'Payment not completed');
    }

    const { cropId, interestId, sellerId, buyerId, amount } = session.metadata;

    const platformFee = Math.round(amount * 0.01);

    const db = await getDb();

    await db.collection('payments').insertOne({
      userId: new ObjectId(buyerId),
      sellerId: new ObjectId(sellerId),
      cropId: new ObjectId(cropId),
      interestId,
      amount: Number(amount),
      platformFee,
      sellerAmount: amount - platformFee,
      currency: 'bdt',
      stripeSessionId: session.id,
      status: 'succeeded',
      createdAt: new Date(),
    });

    await db.collection('crops').updateOne(
      {
        _id: new ObjectId(cropId),
        'interests._id': new ObjectId(interestId),
      },
      {
        $set: {
          'interests.$.paymentStatus': 'paid',
          'interests.$.paidAt': new Date(),
        },
      }
    );

    res.send({ success: true });
  } catch (err) {
    console.error('Payment confirm error:', err);
    res
      .status(500)
      .send({ success: false, message: 'Payment confirmation failed' });
  }
});

/* ============================================================
   ADMIN DASHBOARD
============================================================ */
app.get('/admin/dashboard', verifyJWT, verifyAdmin, async (req, res) => {
  const db = await getDb();

  const totalUsers = await db.collection('users').countDocuments();
  const totalCrops = await db.collection('crops').countDocuments();

  const earnings = await db
    .collection('payments')
    .aggregate([{ $group: { _id: null, total: { $sum: '$platformFee' } } }])
    .toArray();

  res.send({
    success: true,
    data: {
      totalUsers,
      totalCrops,
      platformEarnings: earnings[0]?.total || 0,
    },
  });
});

/* ============================================================
   EXPORT (Vercel)
============================================================ */
module.exports = app;
