const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");
require("dotenv").config();
const stripe = require("stripe")(process.env.PAYMENT_GATEWAY_KEY);
const PORT = process.env.PORT || 5000;

const app = express();
app.use(cors());
app.use(express.json());

const serviceAccount = require("./firebase-admin-sdk.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

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
    const db = client.db("parcelService");
    const parcelsCollection = db.collection("parcels");
    const paymentCollection = db.collection("paymentHistory");
    const trackingCollection = db.collection("trackingCollection");
    const userCollection = db.collection("users");
    const ridersCollection = db.collection("riders");

    //custom middlewire
    const verifyFirebaseToken = async (req, res, next) => {
      const headers = req.headers.authorization;
      if (!headers) {
        return res.status(401).send({ message: "Unauthorized" });
      }
      const token = headers.split(" ")[1];
      if (!token) {
        return res.status(401).send({ message: "Unauthorized" });
      }
      //verify token
      try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.decoded = decoded;
        next();
      } catch (err) {
        return res.status(403).send({ message: "Forbidden access" });
      }
    };

    //get all parcel or user parcel by email
    app.get("/parcels", verifyFirebaseToken, async (req, res) => {
      const { email } = req.query;

      try {
        const query = email ? { created_by: email } : {};

        const parcels = await parcelsCollection
          .find(query)
          .sort({ creation_date: -1 })
          .toArray();
        res.status(200).send(parcels);
      } catch (error) {
        console.error("Error fetching parcels:", error);
        res.status(500).send({ message: "Error fetching parcels", error });
      }
    });

    //get parcel by id
    app.get("/parcels/:id", verifyFirebaseToken, async (req, res) => {
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
    app.get("/payments", verifyFirebaseToken, async (req, res) => {
      const { email } = req.query;
      let query = email ? { email: email } : {};

      if (req.decoded.email !== email) {
        return res.status(403).send({ message: "Forbidden access" });
      }

      const paymentHistory = await paymentCollection
        .find(query)
        .sort({ paid_at: -1 })
        .toArray();
      res.status(200).send(paymentHistory);
    });

    //get riders pendig status
    app.get("/riders/pending", async (req, res) => {
      try {
        const pendingRiders = await ridersCollection
          .find({ status: "pending" })
          .toArray();
        res.status(200).send(pendingRiders);
      } catch (error) {
        res
          .status(500)
          .send({ message: "Failed to load pending riders", error });
      }
    });

    // GET riders active status and search function
    app.get("/riders/active", async (req, res) => {
      let query = { status: "active" };
      const riders = await ridersCollection.find(query).toArray();
      res.send(riders);
    });

    // search user to give role
    app.get("/users/search", async (req, res) => {
      const { email } = req.query;
      if (!email) return res.send([]);
      const users = await userCollection
        .find({ email: { $regex: email, $options: "i" } })
        .toArray();
      res.send(users);
    });

    //add user data
    app.post("/users", async (req, res) => {
      const email = req.body.email;
      const isUserExist = await userCollection.findOne({ email });
      if (isUserExist) {
        return res
          .status(200)
          .send({ message: "User already exists", inserted: false });
      }

      const user = req.body;
      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    // GET user role to verify
    app.get("/users/role", async (req, res) => {
      const { email } = req.query;
      const user = await userCollection.findOne({ email });
      if (!user) {
        return res.status(404).send({ message: "User not found" });
      }
      res.send({ role: user.role });
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

    //post rider info
    app.post("/riders", async (req, res) => {
      const rider = req.body;
      const result = await ridersCollection.insertOne(rider);
      res.status(200).send(result);
    });

    //update riders status
    app.patch("/riders/:id/status", async (req, res) => {
      const id = req.params.id;
      const { status, email } = req.body;

      if (status === "active") {
        const userQuery = { email };
        const userDoc = {
          $set: { role: "rider" },
        };
        const roleResult = await userCollection.updateOne(userQuery, userDoc);
        console.log(roleResult);
      }
      const result = await ridersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status } }
      );
      res.send(result);
    });

    // update user role to make or remove admin
    app.patch("/users/:id/role", async (req, res) => {
      const { role } = req.body;
      const id = req.params.id;
      const result = await userCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { role } }
      );
      res.send(result);
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
