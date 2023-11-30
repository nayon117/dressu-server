const express = require("express");
const app = express();
require("dotenv").config();
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
const morgan = require("morgan");
const port = process.env.PORT || 5000;
const stripe = require("stripe")(process.env.PAYMENT_SECRET_KEY);


app.use(
  cors({
    origin: [
      // "http://localhost:5173",
      "https://skillify-client.web.app",
      "https://skillify-client.firebaseapp.com"
    ],
    credentials: true,
  })
);


app.use(express.json());
app.use(cookieParser());
app.use(morgan("dev"));
const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token;
  console.log(token);
  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      console.log(err);
      return res.status(401).send({ message: "unauthorized access" });
    }
    req.user = decoded;
    next();
  });
};

const client = new MongoClient(process.env.DB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
async function run() {
  try {
    // await client.connect();
    const usersCollection = client.db("skillify").collection("users");
    const classCollection = client.db("skillify").collection("classes");
    const requestCollection = client.db("skillify").collection("requests");
    const bookingCollection = client.db("skillify").collection("bookings");
    const assignmentCollection = client.db("skillify").collection("assignments");
    const reviewCollection = client.db("skillify").collection("reviews");

    // Role Verification----------------------------

    // For admins
    const verifyAdmin = async (req, res, next) => {
      const user = req.user;
      console.log("admin---", user);
      const query = { email: user?.email };
      const result = await usersCollection.findOne(query);
      if (!result || result?.role !== "admin")
        return res.status(401).send({ message: "unauthorized access" });
      next();
    };

    // For teacher
    const verifyTeacher = async (req, res, next) => {
      const user = req.user;
      const query = { email: user?.email };
      const result = await usersCollection.findOne(query);
      if (!result || result?.role !== "teacher")
        return res.status(401).send({ message: "unauthorized access" });
      next();
    };

    // // auth related api
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      console.log("I need a new jwt", user);
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "365d",
      });
      res
        .cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send({ success: true });
    });

    // // remove cookie after Logout
    app.get("/logout", async (req, res) => {
      try {
        res
          .clearCookie("token", {
            maxAge: 0,
            secure: process.env.NODE_ENV === "production",
            sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
          })
          .send({ success: true });
        console.log("Logout successful");
      } catch (err) {
        res.status(500).send(err);
      }
    });

    // // user collection -------------------

    // // Save or modify user email, status in DB
    app.put("/users/:email", async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const query = { email: email };
      const options = { upsert: true };
      const isExist = await usersCollection.findOne(query);
      console.log("User found?----->", isExist);
      if (isExist) return res.send(isExist);
      const result = await usersCollection.updateOne(
        query,
        {
          $set: { ...user, timestamp: Date.now() },
        },
        options
      );
      res.send(result);
    });

    // get user role
    app.get("/user/:email", async (req, res) => {
      const email = req.params.email;
      const result = await usersCollection.findOne({ email });
      res.send(result);
    });

    // // get users
    app.get("/users", verifyToken, async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });

    app.put("/users/update/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const query = { email: email };
      const options = { upsert: true };
      const updateDoc = {
        $set: {
          ...user,
          timestamp: Date.now(),
        },
      };
      const result = await usersCollection.updateOne(query, updateDoc, options);
      res.send(result);
    });

    // // ----------class collection -------------

    // // teacher add class
    app.post("/class-add", async (req, res) => {
      const classDetails = req.body;
      const result = await classCollection.insertOne({
        ...classDetails,
        status: "pending",
      });
      res.send(result);
    });

    // // get add class requests
    app.get("/class-add/all/requests", async (req, res) => {
      const result = await classCollection.find().toArray();
      res.send(result);
    });
    app.get("/class-add/requests", async (req, res) => {
      const email = req.query.email;
      const result = await classCollection.find({ email: email }).toArray();
      res.send(result);
    });
    // //  approved classes
    app.get("/class-add/approved", async (req, res) => {
      const page = parseInt( req.query.page)
      const size = parseInt(req.query.size)
      console.log('pagination',page,size );
      const result = await classCollection
        .find({ status: "approved" })
        .skip(page * size)
        .limit(size)
        .toArray();
      res.send(result);
    });

    app.get("/classes-count", async (req, res) => {
      const count = await classCollection.countDocuments({
        status: "approved",
      });
      res.send({ count });
    });

    app.put("/class-add/approve/:id", async (req, res) => {
      const id = req.params.id;
      const result = await classCollection.updateOne(
        { _id: new ObjectId(id), status: { $ne: "approved" } },
        { $set: { status: "approved" } }
      );
      res.send(result);
    });

    app.put("/class-add/reject/:id", async (req, res) => {
      const id = req.params.id;
      const result = await classCollection.updateOne(
        { _id: new ObjectId(id), status: { $ne: "rejected" } },
        { $set: { status: "rejected" } }
      );
      res.send(result);
    });
    

    app.get("/recommended-classes", async (req, res) => {
      const result = await classCollection
        .find({ status: "approved" })
        .sort({ price: -1 })
        .limit(6)
        .toArray();
      res.send(result);
    });

    // find single id data for updating purpose
    app.get("/class-add/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await classCollection.findOne(query);
      res.send(result);
    });

    // update class collection data
    app.patch("/class-add/:id", async (req, res) => {
      const item = req.body;
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          title: item.title,
          price: item.price,
          details: item.details,
        },
      };
      const result = await classCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });

    // delete class collection data
    app.delete("/class-add/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await classCollection.deleteOne(query);
      res.send(result);
    });

    // --------request collection -------------------
    app.post("/teacher/requests", async (req, res) => {
      const request = req.body;
      const result = await requestCollection.insertOne(request);
      res.send(result);
    });

    // get teacher request
    app.get("/teacher/pending-requests", async (req, res) => {
      const result = await requestCollection.find().toArray();
      res.send(result);
    });

 
  // Approve a teacher request and update user role
  app.put("/teacher/approve-request/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const result = await requestCollection.updateOne(
        { _id: new ObjectId(id), status: { $ne: "approved" } },
        { $set: { status: "approved" } }
      );
  
      if (result.modifiedCount === 1) {
        return res.send({
          message: "Request approved, user role updated to teacher",
        });
      } else {
        res.status(404).json({ error: "Failed to update user role" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to approve request" });
    }
  });
  

    // stripe and payment things ---------------------------

    app.post("/create-payment-intent", verifyToken, async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);
      if (!price || amount < 1) return;
      const { client_secret } = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });
      res.send({ clientSecret: client_secret });
    });

    // set item info in a booking collection
    app.post("/bookings", verifyToken, async (req, res) => {
      const booking = req.body;
      const result = await bookingCollection.insertOne(booking);
      res.send(result);
    });

    app.get("/bookings", async (req, res) => {
      const stEmail = req.query.stEmail;
      console.log(stEmail);
      const result = await bookingCollection
        .find({ stEmail: stEmail })
        .toArray();
      res.send(result);
    });


    app.get('/total-enrollment/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const aggregation = [
          {
            $match: {
              classId: id  
            }
          },
          {
            $group: {
              _id: "$classId",
              totalEnrollment: {
                $sum: {
                  $cond: [{ $eq: [{ $type: "$_id" }, "missing"] }, 0, 1]
                }
              }
            }
          }
        ];
        const enrollmentForClass = await bookingCollection.aggregate(aggregation).toArray();
        res.send(enrollmentForClass);
      } catch (error) {
        console.error(error);
        res.status(500).send({ error: "Failed to fetch enrollment data for the specific class" });
      }
    });
    
    
    // assignment collection ---------------
    app.post('/assignments', async (req, res) => {
      const assignment = req.body;
      const result = await assignmentCollection.insertOne(assignment)
      res.send(result)
    })
    app.get('/assignments', async (req, res) => {
      const result = await assignmentCollection.find().toArray()
        res.send(result)
    })
   

    // count assignment 
    app.get("/assignments-count", async (req, res) => {
      const count = await assignmentCollection.countDocuments();
      res.send({ count });
    });

    // review collection ----------
    app.post('/reviews', async (req, res) => {
      const review = req.body;
      const result = await reviewCollection.insertOne(review)
      res.send(result)
    })
    app.get('/reviews', async (req, res) => {
       const result = await reviewCollection.find().toArray()
      res.send(result)
    })

    // stats
    app.get('/stats', async (req, res) => {
      const users = await usersCollection.estimatedDocumentCount()
      const classes = await classCollection.estimatedDocumentCount()
      const bookings = await bookingCollection.estimatedDocumentCount()
      res.send({
        users,classes,bookings
      })
    })

    
    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello from Skillify Server..");
});

app.listen(port, () => {
  console.log(`Skillify  is running on port ${port}`);
});
