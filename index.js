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



const dns = require('dns');

dns.setServers(['8.8.8.8', '1.1.1.1']);
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


const isValidObjectId = (id) => ObjectId.isValid(id);

async function requireActiveUser(req, res, next) {
  const db = await getDb();
  const u = await db.collection('users').findOne({ email: req.user.email });
  if (!u) return sendError(res, 404, 'NOT_FOUND', 'User not registered');
  if (u.status !== 'active') return sendError(res, 403, 'FORBIDDEN', 'User blocked');

  req.dbUser = u;
  next();
}
async function requireActiveCropById(req, res, next) {
  const db = await getDb();
  const crops = db.collection('crops');

  const cropId = req.params.id || req.body.cropId;
  if (!cropId || !ObjectId.isValid(cropId)) {
    return sendError(res, 400, 'INVALID_ID', 'Invalid cropId');
  }

  const crop = await crops.findOne({ _id: new ObjectId(cropId) });
  if (!crop) return sendError(res, 404, 'NOT_FOUND', 'Crop not found');
  if (crop.status !== 'active') return sendError(res, 403, 'FORBIDDEN', 'Crop blocked');

  req.dbCrop = crop;
  next();
}


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

const parsePage = (q) => Math.max(1, parseInt(q || '1', 10));
const parseLimit = (q) => Math.min(50, Math.max(5, parseInt(q || '10', 10)));


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
  let user = await db.collection('users').findOne({ email });

  

    if (!user) {
      await db.collection('users').insertOne({
        name: 'Unnamed User',
        email,
        photo: '',
        role: 'user',
        status: 'active',
        createdAt: new Date(),
      });
      user = await db.collection('users').findOne({ email });
    }


  if ( user.status === 'blocked') {
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
app.post('/crops', verifyJWT,requireActiveUser, async (req, res) => {
  const db = await getDb();

  const user = req.dbUser;

  if (!user) return sendError(res, 404, 'NOT_FOUND', 'User not registered');

  // Remove any owner coming from client
  const { owner, ...safeBody } = req.body;

  const crop = {
    ...safeBody,
    owner: {
      ownerId: user._id, 
      ownerEmail: user.email,
      ownerName: user.displayName || user.name || user.email.split('@')[0],
    },
    interests: [],
    status: 'active',
    verified: false,
    createdAt: new Date(),
  };

  const result = await db.collection('crops').insertOne(crop);
  res.status(201).send({ success: true, insertedId: result.insertedId, version: "OWNER_FROM_DB_LOCKED" });
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
app.post('/crops/:id/interests', verifyJWT, requireActiveUser, requireActiveCropById, async (req, res) => {
  try {
    const { quantity, message = '' } = req.body;
    const email = req.user.email;

    if (!quantity || quantity < 1) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid quantity');
    }

    const db = await getDb();
    const crops = db.collection('crops');
    const users = db.collection('users'); // ✅ FIX

    const user = await users.findOne({ email });

    const cropId = new ObjectId(req.params.id);
    const crop = await crops.findOne({ _id: cropId });

    if (!crop) {
      return sendError(res, 404, 'NOT_FOUND', 'Crop not found');
    }

    // Prevent owner from sending interest
    if (crop.owner?.ownerEmail === email) {
      return sendError(res, 403, 'FORBIDDEN', 'Owner cannot send interest');
    }

    // Check stock
    if (quantity > crop.quantity) {
      return sendError(res, 400, 'OUT_OF_STOCK', 'Insufficient quantity');
    }

    // Prevent duplicate interest
    const alreadySent = crop.interests?.some((i) => i.userEmail === email);
    if (alreadySent) {
      return sendError(res, 400, 'DUPLICATE', 'Interest already sent');
    }

    const interest = {
      _id: new ObjectId(),
      cropId: cropId.toString(),
      userEmail: email,
      userName: user?.displayName || user?.name || email.split('@')[0],
      quantity,
      message,
      status: 'pending',
      paymentStatus: 'unpaid',
      createdAt: new Date(),
    };

    await crops.updateOne({ _id: cropId }, { $push: { interests: interest } });

    res.status(201).send({
      success: true,
      message: 'Interest submitted successfully',
    });
  } catch (error) {
    console.error(error);
    sendError(res, 500, 'SERVER_ERROR', 'Failed to send interest');
  }
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
app.post(
  '/payments/create',
  verifyJWT,
  requireActiveUser,
  requireActiveCropById,
  async (req, res) => {
    const { cropId, interestId, sellerId } = req.body;

    if (!cropId || !interestId || !sellerId) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Missing payment data');
    }

    if (!isValidObjectId(cropId) || !isValidObjectId(interestId) || !isValidObjectId(sellerId)) {
      return sendError(res, 400, 'INVALID_ID', 'Invalid cropId / interestId / sellerId');
    }

    const db = await getDb();
    const payments = db.collection('payments');

    const crop = req.dbCrop;   // from requireActiveCropById
    const buyer = req.dbUser;  // from requireActiveUser

    // ✅ sellerId must match crop.owner.ownerId (prevents forged sellerId)
    const cropOwnerId = crop.owner?.ownerId?.toString();
    if (cropOwnerId !== String(sellerId)) {
      return sendError(res, 400, 'INVALID_SELLER', 'Seller mismatch');
    }

    // ✅ find the interest on this crop
    const interest = (crop.interests || []).find(
      (i) => i._id?.toString() === new ObjectId(interestId).toString()
    );
    if (!interest) return sendError(res, 404, 'NOT_FOUND', 'Interest not found');

    // ✅ must belong to the logged-in buyer
    if (interest.userEmail !== buyer.email) {
      return sendError(res, 403, 'FORBIDDEN', 'Not your interest');
    }

    // ✅ must be accepted
    if (String(interest.status).toLowerCase() !== 'accepted') {
      return sendError(res, 400, 'INVALID_STATE', 'Interest not accepted');
    }

    // ✅ must be unpaid
    if (String(interest.paymentStatus).toLowerCase() === 'paid') {
      return sendError(res, 400, 'DUPLICATE_PAYMENT', 'Already paid');
    }

    // ✅ idempotency (avoid creating multiple sessions for same interest)
    const existing = await payments.findOne({ interestId: new ObjectId(interestId) });
    if (existing) {
      return sendError(res, 400, 'DUPLICATE_PAYMENT', 'Already paid');
    }

    // ✅ calculate expected amount on server (Stripe uses "smallest unit")
    // Your DB pricePerUnit is in BDT. Stripe wants amount in paisa.
    const expectedAmount = Math.round(Number(crop.pricePerUnit) * Number(interest.quantity) * 100);

    if (!expectedAmount || expectedAmount < 1) {
      return sendError(res, 400, 'INVALID_AMOUNT', 'Calculated amount invalid');
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'bdt',
            product_data: { name: `Crop Purchase - ${crop.name}` },
            unit_amount: expectedAmount,
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
        buyerId: buyer._id.toString(),
        amount: String(expectedAmount), // store paisa in metadata
      },
    });

    res.send({ url: session.url });
  }
);


app.post('/payments/confirm', verifyJWT, requireActiveUser, async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      return sendError(res, 400, 'INVALID_SESSION', 'Session ID missing');
    }

    const buyer = req.dbUser;
    const db = await getDb();

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== 'paid') {
      return sendError(res, 400, 'PAYMENT_FAILED', 'Payment not completed');
    }

    const { cropId, interestId, sellerId, buyerId, amount } = session.metadata;

    // ✅ VALIDATION
    if (
      !isValidObjectId(cropId) ||
      !isValidObjectId(interestId) ||
      !isValidObjectId(sellerId) ||
      !isValidObjectId(buyerId)
    ) {
      console.error('Invalid ObjectId in metadata:', session.metadata);
      return sendError(res, 400, 'INVALID_METADATA', 'Corrupted payment metadata');
    }

    // ✅ must be the same user confirming (prevents other user confirming your session)
    if (buyer._id.toString() !== String(buyerId)) {
      return sendError(res, 403, 'FORBIDDEN', 'Not your payment session');
    }

    // ✅ crop must still be active
    const crop = await db.collection('crops').findOne({ _id: new ObjectId(cropId) });
    if (!crop) return sendError(res, 404, 'NOT_FOUND', 'Crop not found');
    if (crop.status !== 'active') return sendError(res, 403, 'FORBIDDEN', 'Crop blocked');

    // ✅ idempotency (stripe session)
    const paymentsCol = db.collection('payments');
    const existingPayment = await paymentsCol.findOne({ stripeSessionId: session.id });
    if (existingPayment) {
      return res.send({ success: true, alreadyConfirmed: true });
    }

    // ✅ compute fee safely (amount is paisa)
    const paidAmount = Number(amount);
    const platformFee = Math.round(paidAmount * 0.01);
    const sellerAmount = paidAmount - platformFee;

    // ✅ Insert payment
    await paymentsCol.insertOne({
      userId: new ObjectId(buyerId),
      sellerId: new ObjectId(sellerId),
      cropId: new ObjectId(cropId),
      interestId: new ObjectId(interestId),
      amount: paidAmount,
      platformFee,
      sellerAmount,
      currency: 'bdt',
      stripeSessionId: session.id,
      status: 'succeeded',
      createdAt: new Date(),
    });

    // ✅ Update interest as paid (only if it belongs + accepted)
    const updateResult = await db.collection('crops').updateOne(
      {
        _id: new ObjectId(cropId),
        'interests._id': new ObjectId(interestId),
        'interests.userEmail': buyer.email,
        'interests.status': 'accepted',
      },
      {
        $set: {
          'interests.$.paymentStatus': 'paid',
          'interests.$.paidAt': new Date(),
        },
      }
    );

    if (updateResult.matchedCount === 0) {
      console.error('Interest not found/invalid for payment:', interestId);
      return sendError(res, 404, 'INTEREST_NOT_FOUND', 'Interest not found');
    }

    res.send({ success: true });
  } catch (err) {
    console.error('Payment confirm error:', err);
    return sendError(res, 500, 'SERVER_ERROR', 'Payment confirmation failed');
  }
});


/* ============================================================
   DASHBOARD
============================================================ */

app.get('/dashboard/me', verifyJWT, async (req, res) => {
  try {
    const db = await getDb();
    const payments = db.collection('payments');

    const userIdRaw = req.user.userId;
    const userId = isValidObjectId(userIdRaw) ? new ObjectId(userIdRaw) : null;

    if (!userId) {
      return sendError(res, 400, 'INVALID_USER', 'Invalid userId in token');
    }

    const toBDT = (paisa) => Number(paisa || 0) / 100;

    // totals (paisa -> bdt)
    const buyingAgg = await payments
      .aggregate([
        { $match: { userId } },
        {
          $group: {
            _id: null,
            totalSpentPaisa: { $sum: '$amount' },
            totalOrders: { $sum: 1 },
          },
        },
      ])
      .toArray();

    const sellingAgg = await payments
      .aggregate([
        { $match: { sellerId: userId } },
        {
          $group: {
            _id: null,
            totalEarnedPaisa: { $sum: '$sellerAmount' }, // seller net
            totalSales: { $sum: 1 },
          },
        },
      ])
      .toArray();

    const from = new Date();
    from.setDate(from.getDate() - 30);

    // chart series (paisa -> bdt)
    const buyingByDay = await payments
      .aggregate([
        { $match: { userId, createdAt: { $gte: from } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            amountPaisa: { $sum: '$amount' },
          },
        },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, date: '$_id', amount: { $divide: ['$amountPaisa', 100] } } },
      ])
      .toArray();

    const sellingByDay = await payments
      .aggregate([
        { $match: { sellerId: userId, createdAt: { $gte: from } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            amountPaisa: { $sum: '$sellerAmount' }, // seller net
          },
        },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, date: '$_id', amount: { $divide: ['$amountPaisa', 100] } } },
      ])
      .toArray();

    // recent lists with computed UI fields
    const recentPurchases = await payments
      .find({ userId })
      .sort({ createdAt: -1 })
      .limit(10)
      .project({
        amount: 1,
        platformFee: 1,
        sellerAmount: 1,
        currency: 1,
        status: 1,
        createdAt: 1,
      })
      .toArray();

    const recentSales = await payments
      .find({ sellerId: userId })
      .sort({ createdAt: -1 })
      .limit(10)
      .project({
        amount: 1,
        platformFee: 1,
        sellerAmount: 1,
        currency: 1,
        status: 1,
        createdAt: 1,
      })
      .toArray();

    const mapRecent = (p) => ({
      ...p,
      grossAmountBDT: toBDT(p.amount),
      feeBDT: toBDT(p.platformFee),
      netBDT: toBDT(p.sellerAmount),
    });

    res.send({
      success: true,
      data: {
        buying: {
          totalSpent: toBDT(buyingAgg[0]?.totalSpentPaisa || 0),
          totalOrders: buyingAgg[0]?.totalOrders || 0,
          chartByDay: buyingByDay,
          recent: recentPurchases.map(mapRecent),
        },
        selling: {
          totalEarned: toBDT(sellingAgg[0]?.totalEarnedPaisa || 0),
          totalSales: sellingAgg[0]?.totalSales || 0,
          chartByDay: sellingByDay,
          recent: recentSales.map(mapRecent),
        },
      },
    });
  } catch (e) {
    console.error(e);
    return sendError(res, 500, 'SERVER_ERROR', 'Dashboard fetch failed');
  }
});



/* ============================================================
   REPORTS (users)
============================================================ */
app.post('/reports', verifyJWT, async (req, res) => {
  try {
    const { targetType, targetId, reason } = req.body;

    if (!['crop', 'seller'].includes(targetType)) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid targetType');
    }
    if (!targetId) return sendError(res, 400, 'VALIDATION_ERROR', 'targetId required');
    if (!reason || String(reason).trim().length < 3) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Reason too short');
    }

    const db = await getDb();
    const reports = db.collection('reports');

    const doc = {
      targetType,
      targetId: String(targetId), // cropId or sellerId as string
      reason: String(reason).trim(),
      reporterEmail: req.user.email,
      status: 'open', // open | resolved
      createdAt: new Date(),
    };

    await reports.insertOne(doc);
    res.status(201).send({ success: true });
  } catch (e) {
    console.error(e);
    return sendError(res, 500, 'SERVER_ERROR', 'Report failed');
  }
});


/* ============================================================
   ADMIN - REPORTS
============================================================ */
app.get('/admin/reports', verifyJWT, verifyAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const reports = db.collection('reports');

    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 50);
    const skip = (page - 1) * limit;

    const status = (req.query.status || '').trim(); // open/resolved
    const type = (req.query.type || '').trim(); // crop/seller

    const query = {};
    if (status && ['open', 'resolved'].includes(status)) query.status = status;
    if (type && ['crop', 'seller'].includes(type)) query.targetType = type;

    const total = await reports.countDocuments(query);

    const data = await reports
      .find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    res.send({
      success: true,
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (e) {
    console.error(e);
    return sendError(res, 500, 'SERVER_ERROR', 'Failed to fetch reports');
  }
});


app.patch('/admin/reports/:id/status', verifyJWT, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) return sendError(res, 400, 'INVALID_ID', 'Invalid report id');

    const { status } = req.body;
    if (!['open', 'resolved'].includes(status)) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid status');
    }

    const db = await getDb();
    const reports = db.collection('reports');

    const result = await reports.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status, updatedAt: new Date() } }
    );

    if (result.matchedCount === 0) return sendError(res, 404, 'NOT_FOUND', 'Report not found');
    res.send({ success: true });
  } catch (e) {
    console.error(e);
    return sendError(res, 500, 'SERVER_ERROR', 'Failed to update report');
  }
});



app.get('/admin/dashboard', verifyJWT, verifyAdmin, async (req, res) => {
  const db = await getDb();

  const totalUsers = await db.collection('users').countDocuments();
  const totalCrops = await db.collection('crops').countDocuments();

  const totalPayments = await db.collection('payments').countDocuments({
    status: 'succeeded',
  });

  const earnings = await db
    .collection('payments')
    .aggregate([
      { $match: { status: 'succeeded' } },
      { $group: { _id: null, total: { $sum: '$platformFee' } } },
    ])
    .toArray();

  res.send({
    success: true,
    data: {
      totalUsers,
      totalCrops,
      totalPayments,
      platformEarnings: earnings[0]?.total || 0,
    },
  });
});




/* ============================================================
   ADMIN - USERS
============================================================ */
app.get('/admin/users', verifyJWT, verifyAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const users = db.collection('users');

    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 50);
    const skip = (page - 1) * limit;

    const search = (req.query.search || '').trim();
    const query = {};

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    const total = await users.countDocuments(query);

    const data = await users
      .find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .project({
        password: 0, // just in case you ever store anything sensitive later
      })
      .toArray();

    res.send({
      success: true,
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (e) {
    console.error(e);
    return sendError(res, 500, 'SERVER_ERROR', 'Failed to fetch users');
  }
});

app.patch('/admin/users/:id/status', verifyJWT, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidId(id)) {
      return sendError(res, 400, 'INVALID_ID', 'Invalid user id');
    }

    const { status } = req.body;

    if (!['active', 'blocked'].includes(status)) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid status');
    }

    const db = await getDb();
    const users = db.collection('users');

    const result = await users.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status, updatedAt: new Date() } }
    );

    if (result.matchedCount === 0) {
      return sendError(res, 404, 'NOT_FOUND', 'User not found');
    }

    res.send({ success: true, message: `User ${status}` });
  } catch (e) {
    console.error(e);
    return sendError(res, 500, 'SERVER_ERROR', 'Failed to update user status');
  }
});


/* ============================================================
   ADMIN - CROPS
============================================================ */
app.get('/admin/crops', verifyJWT, verifyAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const crops = db.collection('crops');

    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 50);
    const skip = (page - 1) * limit;

    const search = (req.query.search || '').trim();
    const status = (req.query.status || '').trim(); // active/blocked
    const verifiedRaw = (req.query.verified || '').trim(); // true/false

    const query = {};
    if (status && ['active', 'blocked'].includes(status)) query.status = status;
    if (verifiedRaw !== '') query.verified = verifiedRaw === 'true';

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { type: { $regex: search, $options: 'i' } },
        { location: { $regex: search, $options: 'i' } },
        { 'owner.ownerEmail': { $regex: search, $options: 'i' } },
        { 'owner.ownerName': { $regex: search, $options: 'i' } },
      ];
    }

    const total = await crops.countDocuments(query);

    const data = await crops
      .find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    res.send({
      success: true,
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (e) {
    console.error(e);
    return sendError(res, 500, 'SERVER_ERROR', 'Failed to fetch crops');
  }
});

app.patch('/admin/crops/:id/status', verifyJWT, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) return sendError(res, 400, 'INVALID_ID', 'Invalid crop id');

    const { status } = req.body;
    if (!['active', 'blocked'].includes(status)) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid status');
    }

    const db = await getDb();
    const crops = db.collection('crops');

    const result = await crops.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status, updatedAt: new Date() } }
    );

    if (result.matchedCount === 0) return sendError(res, 404, 'NOT_FOUND', 'Crop not found');
    res.send({ success: true, message: `Crop ${status}` });
  } catch (e) {
    console.error(e);
    return sendError(res, 500, 'SERVER_ERROR', 'Failed to update crop status');
  }
});

app.patch('/admin/crops/:id/verify', verifyJWT, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) return sendError(res, 400, 'INVALID_ID', 'Invalid crop id');

    const { verified } = req.body;
    if (typeof verified !== 'boolean') {
      return sendError(res, 400, 'VALIDATION_ERROR', 'verified must be boolean');
    }

    const db = await getDb();
    const crops = db.collection('crops');

    const result = await crops.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          verified,
          verifiedAt: verified ? new Date() : null,
          updatedAt: new Date(),
        },
      }
    );

    if (result.matchedCount === 0) return sendError(res, 404, 'NOT_FOUND', 'Crop not found');
    res.send({ success: true, message: `Crop verified=${verified}` });
  } catch (e) {
    console.error(e);
    return sendError(res, 500, 'SERVER_ERROR', 'Failed to verify crop');
  }
});





const PORT = process.env.PORT || 5000;

// Only listen locally (Vercel will not run this)
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`🌾 KrishiLink local server running on http://localhost:${PORT}`);
  });
}




/* ============================================================
   EXPORT (Vercel)
============================================================ */
module.exports = app;
