require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const dns = require('dns');

dns.setServers(['8.8.8.8', '1.1.1.1']);
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@krishilink-db.jzbgemd.mongodb.net/?appName=krishilink-db`;
 const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
 

  await client.connect();
  const db = client.db('krishilink_db');

  const crops = db.collection('crops');
  const users = db.collection('users');

  // Find crops where ownerId is a STRING (firebase uid)
  const badCrops = await crops
    .find({ 'owner.ownerId': { $type: 'string' } })
    .toArray();

  console.log('Bad crops found:', badCrops.length);

  let fixed = 0;

  for (const crop of badCrops) {
    const email = crop?.owner?.ownerEmail;
    if (!email) continue;

    const user = await users.findOne({ email });
    if (!user) {
      console.log('No user found for crop:', crop._id.toString(), email);
      continue;
    }

    await crops.updateOne(
      { _id: crop._id },
      { $set: { 'owner.ownerId': user._id } }
    );

    fixed++;
  }

  console.log('Fixed crops:', fixed);
  await client.close();
}

run().catch(console.error);
