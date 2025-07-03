const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const express = require("express");
const cors = require("cors");
require("dotenv").config();
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
