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

    //verify admin only route
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email };
      const user = await userCollection.findOne(query);
      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "Forbidden Access" });
      }
      next();
    };

    //verify rider only route
    const verifyRider = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email };
      const user = await userCollection.findOne(query);
      if (!user || user.role !== "rider") {
        return res.status(403).send({ message: "Forbidden Access" });
      }
      next();
    };

    //verify id
    function isValidObjectId(id) {
      return /^[0-9a-fA-F]{24}$/.test(id);
    }

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

    //get pending parcel details for riders
    app.get(
      "/parcels/pending-deliveries",
      verifyFirebaseToken,
      verifyRider,
      async (req, res) => {
        const { riderEmail } = req.query;
        if (!riderEmail) {
          return res.status(400).send({ message: "Rider email required" });
        }
        const parcels = await parcelsCollection
          .find({
            delivary_status: "in_transit",
            rider_email: riderEmail,
          })
          .sort({ creation_date: -1 })
          .toArray();
        res.status(200).send(parcels);
      }
    );

    // Get completed deliveries for a rider
    app.get(
      "/parcels/completed-deliveries",
      verifyFirebaseToken,
      verifyRider,
      async (req, res) => {
        const { riderEmail } = req.query;
        if (!riderEmail) {
          return res.status(400).send({ message: "Rider email required" });
        }
        const parcels = await parcelsCollection
          .find({
            delivary_status: "delivared",
            rider_email: riderEmail,
          })
          .sort({ creation_date: -1 })
          .toArray();
        res.status(200).send(parcels);
      }
    );

    //get parcel by id
    app.get("/parcels/:id", verifyFirebaseToken, async (req, res) => {
      try {
        const { id } = req.params;
        // console.log(id);
        if (!isValidObjectId(id)) {
          return res.status(400).send({ message: "Invalid ID format" });
        }
        const query = { _id: new ObjectId(id) };
        const result = await parcelsCollection.findOne(query);
        res.status(200).send(result);
      } catch (error) {
        console.error("Error fetching parcel:", error);
        res.status(500).send({ message: "Error fetching parcel", error });
      }
    });

    //get payment history
    app.get("/paymentsHistory", verifyFirebaseToken, async (req, res) => {
      const { email } = req.query;
      console.log(email);
      if (!email) {
        return res.status(400).send({ message: "Email is required" });
      }
      let query = email ? { email: email } : {};
      console.log(query);
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
    app.get(
      "/riders/pending",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
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
      }
    );

    // GET riders active status and search function
    app.get(
      "/riders/active",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        let query = { status: "active" };
        const riders = await ridersCollection.find(query).toArray();
        res.send(riders);
      }
    );

    // Get active riders for a specific district
    app.get(
      "/riders/activeRiders",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const { district } = req.query;
        try {
          const query = {
            status: "active",
          };
          if (district) query.rider_district = district;

          const riders = await ridersCollection.find(query).toArray();
          res.status(200).send(riders);
        } catch (err) {
          res
            .status(500)
            .send({ message: "Error loading active riders", error: err });
        }
      }
    );

    // GET rider's earnings by email
    app.get(
      "/riders/earnings",
      verifyFirebaseToken,
      verifyRider,
      async (req, res) => {
        const { email } = req.query;
        if (!email) {
          return res.status(400).send({ message: "Rider email required" });
        }
        const rider = await ridersCollection.findOne({ rider_email: email });
        if (!rider) {
          return res.status(404).send({ message: "Rider not found" });
        }
        res.send({ total_earning: rider.total_earning || 0 });
      }
    );

    // (Optional) GET recent cashouts
    app.get(
      "/riders/earnings/history",
      verifyFirebaseToken,
      verifyRider,
      async (req, res) => {
        const { email } = req.query;
        if (!email) {
          return res.status(400).send({ message: "Rider email required" });
        }
        const parcels = await parcelsCollection
          .find({
            rider_email: email,
            rider_money: "cashed_out",
          })
          .sort({ creation_date: -1 })
          .limit(10)
          .toArray();
        res.send(parcels);
      }
    );

    // search user to give role
    app.get("/users/search", async (req, res) => {
      const { email } = req.query;
      if (!email) return res.send([]);
      const users = await userCollection
        .find({ email: { $regex: email, $options: "i" } })
        .toArray();
      res.send(users);
    });

    //get assignable parcels
    app.get(
      "/parcel/assignable",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const parcels = await parcelsCollection
            .find({ payment_status: "paid", delivary_status: "not_collected" })
            .sort({ creation_date: -1 })
            .toArray();
          res.status(200).send(parcels);
        } catch (err) {
          console.log("error in assign ", err);
          res
            .status(500)
            .send({ message: "Error loading assignable parcels", error: err });
        }
      }
    );

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
    app.get("/users/role", verifyFirebaseToken, async (req, res) => {
      const { email } = req.query;
      if (req.decoded.email !== email) {
        return res.status(403).send({ message: "Forbidden access" });
      }
      const user = await userCollection.findOne({ email });
      if (!user) {
        return res.status(404).send({ message: "User not found" });
      }
      res.send({ role: user.role });
    });

    // Public API for parcel tracking timeline
    app.get("/track/:trackingId", async (req, res) => {
      const { trackingId } = req.params;
      const logs = await trackingCollection
        .find({ tracking_id: trackingId })
        .sort({ time: 1 })
        .toArray();
      res.send(logs);
    });

    //post parcel from user
    app.post("/parcels", async (req, res) => {
      try {
        const newParcel = req.body;
        const result = await parcelsCollection.insertOne(newParcel);
        await trackingCollection.insertOne({
          tracking_id: newParcel.tracking_id,
          parcel_id: result.insertedId,
          status: "submitted",
          message: "Parcel submitted by user.",
          updated_by: newParcel.created_by,
          time: new Date(),
        });
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

      //update time in tracking collection
      const parcel = await parcelsCollection.findOne({
        _id: new ObjectId(parcelId),
      });
      if (parcel) {
        await trackingCollection.insertOne({
          tracking_id: parcel.tracking_id,
          parcel_id: parcelId,
          status: "paid",
          message: "Payment completed for the parcel.",
          updated_by: email,
          time: new Date(),
        });
      }

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

    // Assign rider to a parcel
    app.post(
      "/assign-rider",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const { parcelId, riderId, rider_email } = req.body;
        if (!parcelId || !riderId || !rider_email)
          return res.status(400).send({ message: "Missing data" });
        await parcelsCollection.updateOne(
          { _id: new ObjectId(parcelId) },
          {
            $set: {
              delivary_status: "in_transit",
              assigned_rider: riderId,
              rider_email: rider_email,
            },
          }
        );

        await ridersCollection.updateOne(
          { _id: new ObjectId(riderId) },
          { $set: { work_status: "in_delivary" } }
        );

        //ADD THIS FOR TRACKING LOG
        const parcel = await parcelsCollection.findOne({
          _id: new ObjectId(parcelId),
        });
        if (parcel) {
          await trackingCollection.insertOne({
            tracking_id: parcel.tracking_id,
            parcel_id: parcelId,
            status: "rider_assigned",
            message: `Rider assigned: ${rider_email}`,
            updated_by: "admin",
            time: new Date(),
          });
        }

        res.status(200).send({ message: "Rider assigned successfully" });
      }
    );

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

    // update delivary status when rider complete the delivary
    app.patch("/parcels/:id/delivered", async (req, res) => {
      const { id } = req.params;
      try {
        const result = await parcelsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { delivary_status: "delivared" } }
        );

        //add timestamp in tracking collection
        const parcel = await parcelsCollection.findOne({
          _id: new ObjectId(id),
        });
        if (parcel) {
          await trackingCollection.insertOne({
            tracking_id: parcel.tracking_id,
            parcel_id: id,
            status: "delivered",
            message: "Parcel delivered to receiver.",
            updated_by: parcel.rider_email,
            time: new Date(),
          });
        }

        if (result.modifiedCount > 0) {
          res.send({ message: "Parcel marked as delivered" });
        } else {
          res.status(404).send({ message: "Parcel not found" });
        }
      } catch (error) {
        res
          .status(500)
          .send({ message: "Failed to update delivery status", error });
      }
    });

    // update cashed out status when rider cashed out
    app.patch(
      "/parcels/:id/cashout",
      verifyFirebaseToken,
      verifyRider,
      async (req, res) => {
        const { id } = req.params;
        const { income, rider_email } = req.body;

        if (!income || !rider_email) {
          return res
            .status(400)
            .send({ message: "Income and rider email required" });
        }

        try {
          await parcelsCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { rider_money: "cashed_out" } }
          );
          await ridersCollection.updateOne(
            {
              rider_email: rider_email,
            },
            { $inc: { total_earning: income } }
          );
          res.send({ message: "Cash out successful" });
        } catch (err) {
          res.status(500).send({ message: "Cash out failed", error: err });
        }
      }
    );

    //delete parcel by its ID
    app.delete("/parcels/:id", async (req, res) => {
      const { id } = req.params;
      if (!isValidObjectId(id)) {
        return res.status(400).send({ message: "Invalid ID format" });
      }
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
