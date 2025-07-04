const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const express = require("express");
const cors = require("cors");
require("dotenv").config();
const stripe = require("stripe")(process.env.PAYMENT_GATEWAY_KEY);
const PORT = process.env.PORT || 5000;

const app = express();
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.mo9z4qj.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    const parcelsCollection = client.db("parcelService").collection("parcels");
    const paymentCollection = client
      .db("parcelService")
      .collection("paymentHistory");
    const trackingCollection = client
      .db("parcelService")
      .collection("trackingCollection");

    //get all parcel or user parcel by email
    app.get("/parcels", async (req, res) => {
      const { email } = req.query;

      try {
        const query = email ? { created_by: email } : {};

        const parcels = await parcelsCollection
          .find(query)
          .sort({ creation_date: -1 })
          .toArray();

        if (parcels.length === 0) {
          return res.status(404).send({ message: "No parcels found." });
        }

        res.status(200).send(parcels);
      } catch (error) {
        console.error("Error fetching parcels:", error);
        res.status(500).send({ message: "Error fetching parcels", error });
      }
    });

    //get parcel by id
    app.get("/parcels/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const query = { _id: new ObjectId(id) };
        const result = await parcelsCollection.findOne(query);
        res.status(200).send(result);
      } catch (error) {
        console.error("Error fetching parcel:", error);
        res.status(500).send({ message: "Error fetching parcel", error });
      }
    });

    //get payment history
    app.get("/payments", async (req, res) => {
      const { email } = req.query;
      let query = email ? { email: email } : {};

      const paymentHistory = await paymentCollection
        .find(query)
        .sort({ paid_at: -1 })
        .toArray();
      res.status(200).send(paymentHistory);
    });

    //post parcel from user
    app.post("/parcels", async (req, res) => {
      try {
        const newParcel = req.body;
        const result = await parcelsCollection.insertOne(newParcel);
        res.status(201).send(result);
      } catch (error) {
        console.error("Error inserting parcel:", error);
        res.status(500).json({ message: "Error inserting parcel", error });
      }
    });

    //stripe payment intent
    app.post("/create-payment-intent", async (req, res) => {
      const { amount } = req.body;
      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amount,
          currency: "usd",
          payment_method_types: ["card"],
        });

        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    //payment history post
    app.post("/payments", async (req, res) => {
      const { parcelId, email, amount, paymentMethod, tnxId } = req.body;

      const updateResult = await parcelsCollection.updateOne(
        { _id: new ObjectId(parcelId) },
        {
          $set: {
            payment_status: "paid",
          },
        }
      );

      const paymentHistoryEntry = {
        parcelId,
        email,
        amount,
        paymentMethod,
        tnxId,
        paid_at_string: new Date().toISOString(),
        paid_at: new Date(),
      };

      const paymentResult = await paymentCollection.insertOne(
        paymentHistoryEntry
      );
      res.status(200).send(paymentResult);
    });

    //update tracking parcel
    app.post("/trackParcel", async (req, res) => {
      const { tracking_id, parcel_id, status, message, updated_by } = req.body;
      const newTracking = {
        tracking_id,
        parcel_id,
        status,
        message,
        updated_by,
        time: new Date(),
      };

      const insertResult = await trackingCollection.insertOne(newTracking);
      return res.status(500).json(insertResult);
    });

    //delete parcel by its ID
    app.delete("/parcels/:id", async (req, res) => {
      const { id } = req.params;

      try {
        query = { _id: new ObjectId(id) };
        const result = await parcelsCollection.deleteOne(query);

        if (result.deletedCount === 0) {
          return res.status(404).send({ message: "Parcel not found" });
        }

        res.status(200).send(result);
      } catch (error) {
        console.error("Error deleting parcel:", error);
        res.status(500).send({ message: "Error deleting parcel", error });
      }
    });

    await client.db("admin").command({ ping: 1 });
    console.log("You successfully connected to MongoDB!");
  } finally {
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Welcome to the Parcel Service API!");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
