const express = require('express');
const cors = require('cors');
const app = express();
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET);
const port = process.env.PORT || 3000;
// firebase token
const admin = require("firebase-admin");
const serviceAccount = require("./zap-shift-firebase-adminsdk.json");

// tracking id
const crypto = require('crypto');

function generateTrackingId() {
  const prefix = "ZAP";
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const random = crypto.randomBytes(4).toString("hex").toUpperCase();

  return `${prefix}-${date}-${random}`;
}

console.log(generateTrackingId());

// Middleware
app.use(cors());
app.use(express.json());

// firebase token
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// Token verify
const verifyFBToken = async (req, res, next) => {
  // console.log('headers in the middleware', req.headers.authorization);

  const token = req.headers.authorization;
  if (!token) {
    return res.status(401).send({
      message: 'unauthorized access'
    })
  }

  try {
    const idToken = token.split(' ')[1];
    const decode = await admin.auth().verifyIdToken(idToken);
    req.decoded_email = decode.email;

    console.log('decoded in the token', decode)
  }
  catch (error) {
    console.log(error)
    return res.status(401).send({
      message: 'unauthorized access'
    })
  }
  next();
}

// mongodb

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.sa5bapo.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    await client.connect();
    const db = client.db('zap_shift_db');
    const parcelsCollection = db.collection('parcels');
    const paymentsCollection = db.collection('payments');

    // Parcels api..............

    // get parcels
    app.get('/parcels', async (req, res) => {
      const query = {};
      const { email } = req.query;
      if (email) {
        query.senderEmail = email;
      }
      // sort
      const options = { sort: { createdAt: -1 } }

      const result = await parcelsCollection.find(query, options).toArray();
      res.send(result);
    })

    // get single parcel
    app.get('/parcels/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }

      const result = await parcelsCollection.findOne(query);
      res.send(result);
    })

    // add parcels
    app.post('/parcels', async (req, res) => {
      const parcel = req.body;
      //parcel created time
      parcel.createdAt = new Date();

      const result = await parcelsCollection.insertOne(parcel);
      res.send(result);
    })

    // delete parcels
    app.delete('/parcels/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }

      const result = await parcelsCollection.deleteOne(query);
      res.send(result)
    })


    // Payment related api:
    // version-1

    // app.post('/create-checkout-session', async (req, res) => {
    //   const paymentInfo = req.body;
    //   const amount=parseInt(paymentInfo.cost)*100;

    //   const session = await stripe.checkout.sessions.create({
    //     line_items: [
    //       {
    //         price_data: {
    //           currency: 'USD',
    //           unit_amount:amount,
    //           product_data:{
    //             name:paymentInfo.parcelName
    //           },
    //         },
    //         quantity: 1,
    //       },
    //     ],
    //     customer_email: paymentInfo.senderEmail,
    //     mode: 'payment',
    //     metadata:{
    //       parcelId: paymentInfo.parcelId
    //     },
    //     success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success`,
    //     cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
    //   });
    //   console.log(session);
    //   res.send({url: session.url})
    // })

    // version-2 : add payment info
    app.post('/create-checkout-session', async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.cost) * 100;

      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: 'USD',
              unit_amount: amount,
              product_data: {
                name: paymentInfo.parcelName
              },
            },
            quantity: 1,
          },
        ],
        customer_email: paymentInfo.senderEmail,
        mode: 'payment',
        metadata: {
          parcelId: paymentInfo.parcelId,
          parcelName: paymentInfo.parcelName
        },
        // use query
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      });
      // console.log(session);
      res.send({ url: session.url })
    })

    // update parcel info
    app.patch('/payment-success', async (req, res) => {
      const sessionId = req.query.session_id;

      const session = await stripe.checkout.sessions.retrieve(sessionId);
      // console.log('session retrive: ', session);

      // transection id dia db theke transaction er data khuje
      const transactionId = session.payment_intent;
      const query = { transactionId: transactionId };

      const paymentExist = await paymentsCollection.findOne(query);
      if (paymentExist) {
        return res.send({
          message: 'already exist',
          transactionId,
          trackingId: paymentExist.trackingId
        })
      }

      //tracking id to add with parcelCollection and send on client side 
      const trackingId = generateTrackingId();

      if (session.payment_status === 'paid') {
        const id = session.metadata.parcelId;
        const query = { _id: new ObjectId(id) }
        const update = {
          $set: {
            paymentStatus: 'paid',
            trackingId: trackingId
          }
        }
        const result = await parcelsCollection.updateOne(query, update);

        // to show payment history
        const payment = {
          amount: session.amount_total / 100,
          currency: session.currency,
          customerEmail: session.customer_email,
          parcelId: session.metadata.parcelId,
          parcelName: session.metadata.parcelName,
          transactionId: session.payment_intent,
          paymentStatus: session.payment_status,
          paidAt: new Date(),
          trackingId: trackingId
        }

        if (session.payment_status === 'paid') {
          const resultPayment = await paymentsCollection.insertOne(payment)
          res.send({
            success: true,
            modifyParcel: result,
            paymentInfo: resultPayment,
            trackingId: trackingId,
            transactionId: session.payment_intent
          })
        }

      }

      res.send({
        success: true
      })
    })

    // show payment history in UI by user email
    app.get('/payments', verifyFBToken, async (req, res) => {
      const email = req.query.email;
      const query = {};
      // console.log('headers:',req.headers)

      if (email) {
        query.customerEmail = email;
      }
      // check email address for token verify
      if (email !== req.decoded_email) {
        return res.status(403).send({
          message: 'Forbidden access'
        })
      }
      const result = await paymentsCollection.find(query).toArray();

      res.send(result);
    })

    // ping
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


// Read data
app.get('/', (req, res) => {
  res.send('Zap-shift is running')
})

// listen data
app.listen(port, () => {
  console.log(`Zap-shift is running on port: ${port}`)
})
