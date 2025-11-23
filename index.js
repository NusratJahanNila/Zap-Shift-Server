const express = require('express');
const cors = require('cors');
const app=express();
require('dotenv').config();
const { MongoClient, ServerApiVersion } = require('mongodb');
const port=process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

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

    // Parcels api..............
    // get parcels
    app.get('/parcels',async(req,res)=>{
        const query= {};
        const {email}=req.query;
        if(email){
            query.senderEmail=email;
        }

        // sort
        const options= {sort: {createdAt:-1}}

        const result=await parcelsCollection.find(query,options).toArray();
        res.send(result);
    })

    // add parcels
    app.post('/parcels',async(req ,res)=>{
        const parcel=req.body;
        //parcel created time
        parcel.createdAt= new Date();

        const result=await parcelsCollection.insertOne(parcel);
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
app.get('/',(req,res)=>{
    res.send('Zap-shift is running')
})

// listen data
app.listen(port,()=>{
    console.log(`Zap-shift is running on port: ${port}`)
})
