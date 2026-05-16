const express = require('express')
var cors = require('cors')
const app = express()


require('dotenv').config()
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_GATEWAY );
const dns = require("dns");
//Change DNS
dns.setServers([
  '1.1.1.1',
  '8.8.8.8'
])

const port = process.env.PORT || 3000

const admin = require("firebase-admin");
const serviceAccount = require("./loan-link-auth-firebase-adminsdk.json");
const { log } = require('console');


admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
// middleware
app.use(express.json())
app.use(cors());

// const verifyFBToken = async (req, res, next) => {
//   console.log('headers in the middleware', req.headers?.authorization);

//   const token = req.headers.authorization;

//   if (!token) {
//    return res.status(401).send({ message: 'unauthorized access'  })
//   }

//   try {
//     const idToken = token.split(' ')[1];
//     const decoded = await admin.auth().verifyIdToken(idToken)
//     console.log('decoded in the token', decoded);
//     req.user = decoded;
//     next();

//   } catch (err) {
//     return res.status(401).send({ message: 'unauthorized access '})
//   }

  
// }

const verifyFBToken = async (req, res, next) => {

  console.log(req.headers);

  const authHeader = req.headers.authorization;

if (!authHeader) {
  return res.status(401).send({ message: 'unauthorized access' });
}


  try {
    const token = authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).send({message:'No token provided'});
    }

    const decoded = await admin.auth().verifyIdToken(token);

    req.user = decoded;

    next();

  } catch (error) {
    console.log(error);

    return res.status(401).send({ message: 'unauthorized access' })
  }
}

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@am.7mxwxuq.mongodb.net/?appName=AM`;
// const uri = `mongodb://${process.env.DB_USER}:${process.env.DB_PASS}@ac-5skoi0e-shard-00-00.7mxwxuq.mongodb.net:27017,ac-5skoi0e-shard-00-01.7mxwxuq.mongodb.net:27017,ac-5skoi0e-shard-00-02.7mxwxuq.mongodb.net:27017/?ssl=true&replicaSet=atlas-lwnvca-shard-0&authSource=admin&appName=AM`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db("loan_link_db")
    const usersCollection = db.collection('users');
    const loansCollection = db.collection('loans');
    const loanApplicationCollection = db.collection('loanApply');
    const paymentCollection = db.collection('payments');

    // Admin related middleware

    const verifyAdmin = async (req, res, next) => {
      const email = req.user.email;
      const query = { email };
      const user = await usersCollection.findOne(query)

      if (!user || user.role != 'admin') {
        return res.status(403).send({ message: 'forbidden access' })
      }
      next()
    }

    const verifyManager = async (req, res, next) => {
      const email = req.user.email;
      const query = { email };
      const user = await usersCollection.findOne(query)

      if (!user || user.role != 'manager') {
        return res.status(403).send({ message: 'forbidden access' })
      }
      next()
    }

    const verifyUser = async (req, res, next) => {
      const email = req.user.email;
      const query = { email };
      const user = await usersCollection.findOne(query)

      if (!user || user.role != 'borrower') {
        return res.status(403).send({ message: 'forbidden access' })
      }
      next()
    }

    const verifyAdminAndManager = async (req, res, next) => {
      const email = req.user.email;
      const query = { email };
      const user = await usersCollection.findOne(query)

      if (!user || user.role !== 'admin' && user.role !== 'manager') {
        return res.status(403).send({ message: 'forbidden access' })
      }
      next()
    }


    // user api 

    app.post('/users', async (req, res) => {
      const user = req.body
      const role = user.role
      const email = user.email
      const userExist = await usersCollection.findOne({ email })

      if (userExist) {
        return res.send({ message: 'user exists' })
      }

      const result = await usersCollection.insertOne(user)
      res.send(result)
    })

    // Manage users (Dashboard) api
    app.get('/users', verifyFBToken, verifyAdmin, async (req, res) => {
      const cursor = usersCollection.find();
      const result = await cursor.toArray()
      res.send(result)
    })

    app.get('/users/:email/role', verifyFBToken, async (req, res) => {
      const email = req.params.email;

      if (req.user.email !== email) {
        return res.status(403).send({ message: 'forbidden access' })
      }
      const query = { email }
      const user = await usersCollection.findOne(query)
      res.send({ role: user?.role || 'user' })
    })

    app.get('/users/:email', verifyFBToken, async (req, res) => {
      const email = req.params.email
      if (req.user.email !== email) {
        return res.status(403).send({ message: 'forbidden access' })
      }
      const user = await usersCollection.findOne({ email })
      res.send(user)
    })

   

    // Manage users (Dashboard) api
    app.patch('/users/role/:id', verifyFBToken, verifyAdmin, async (req, res) => {
      const reqUser = await usersCollection.findOne({
        email: req.user.email
      })
      if (!reqUser || reqUser.role !== 'admin') {
        return res.status(403).send({ message: 'forbidden access' });
      }
      const id = req.params.id
      const { status, suspendReason, role } = req.body

      const targetUser = await usersCollection.findOne({
        _id: new ObjectId(id)
      })


      if (targetUser.email === req.user.email) {
        return res.status(400).send({
          message: 'You cannot modify your own account'
        });
      }


      const updateDoc = {
        $set: {
          role,
          status,
          suspendReason: status === 'Suspended' ? suspendReason : '',
        }
      }
      const result = await usersCollection.updateOne(
        { _id: new ObjectId(id) },
        updateDoc
      );

      res.send(result)
    })


    app.post('/loans', verifyFBToken, verifyManager, async (req, res) => {
      const loan = req.body
      const newLoan = {
        ...loan,
        createdBy: {
          email: req.user.email,
          name: req.user.name
        },
        createdAt: new Date(),
      }
      const result = await loansCollection.insertOne(newLoan)
      res.send(result)
    })



    app.get('/loans',  async (req, res) => {

      const cursor = loansCollection.find()
      const result = await cursor.toArray();
      res.send(result)
    })

    // My Profile(Manager Dashboard) api
    app.get('/loanDetail', verifyFBToken, verifyManager, async (req, res) => {

      const cursor = loanApplicationCollection.find()
      const result = await cursor.toArray();
      res.send(result)
    })
    // Manage Loans(Dashboard) api
    app.get('/manageLoans', verifyFBToken, verifyManager, async (req, res) => {
      const cursor = loansCollection.find()
      const result = await cursor.toArray();
      res.send(result)
    })

    // Updates Loan (dashboard) api
    app.get('/loans/:id', verifyFBToken, async (req, res) => {

      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await loansCollection.findOne(query)
      res.send(result)
    })

    // All loans (dashboard) api
    app.patch('/loans/show/:id', verifyFBToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const { showOnHome } = req.body;

      const result = await loansCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { showOnHome } }
      );
      res.send(result)
    });

    // Updates loans (dashboard) api
    app.patch('/loans/:id', verifyFBToken, verifyAdminAndManager, async (req, res) => {
      try {
        const id = req.params.id;
        const { title,
          description,
          shortDescription,
          category,
          interestRate,
          maxLoanLimit,
          emiPlans,
          image } = req.body;

        const updateDoc = {
          $set: {
            title,
            description,
            shortDescription,
            category,
            interestRate,
            maxLoanLimit,
            emiPlans,
            image,
            updatedAt: new Date()
          }
        }
        const result = await loansCollection.updateOne(
          { _id: new ObjectId(id) },
          updateDoc
        );
        res.send(result)
      } catch (error) {
        res.status(500).send({ message: 'Fail to update loan' });
      }
    });
    // All loans (dashboard) api
    app.delete('/loans/:id', verifyFBToken, verifyAdminAndManager, async (req, res) => {
      const id = req.params.id;

      const result = await loansCollection.deleteOne(
        { _id: new ObjectId(id) }
      );
      res.send(result)
    })

    app.get('/featured-loans', async (req, res) => {
      const cursor = loansCollection.find({ showOnHome: true }).sort({ createdAt: -1 }).limit(6)
      const result = await cursor.toArray();
      res.send(result)

    })

    app.post('/loan-application', verifyFBToken, async (req, res) => {
      if (req.user.email !== req.body.email) {
        return res.status(401).send({ message: 'forbidden access' })
      }
      const { email, loanId } = req.body;

      const existingApplication = await loanApplicationCollection.findOne({
        email: email,
        loanId: loanId,
        status: {
          $in: ["pending", "approved"]
        }
      });
      if (existingApplication) {
        return res.status(400).send({ message: 'You have already applied for the loan' });
      }

      const apply = {
        ...req.body,
        status: "pending",
        appliedAt: new Date()
      };
      const result = await loanApplicationCollection.insertOne(apply)
      res.send(result)
    });

    app.get('/loan-application/check', verifyFBToken, async (req, res) => {
      const { email, loanId } = req.query;

      if (req.user.email !== email) {
        return res.status(403).send({ message: 'forbidden access' });
      };

      const application = await loanApplicationCollection.findOne({
        email: email,
        loanId: loanId
      });
      res.send({ applied: !!application });
    });

    // Loan Applications(Dashboard) api
    app.get('/loanApplication', verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const application = await loanApplicationCollection.aggregate([
          {
            $addFields: {
              loanId: { $toObjectId: "$loanId" },

            }
          },
          {
            $lookup: {
              from: "loans",
              localField: "loanId",
              foreignField: "_id",
              as: "loanInfo"
            }
          },
          {
            $unwind: "$loanInfo"
          },
          {
            $project: {
              loanId: 1,
              title: "$loanInfo.title",
              email: 1,
              interestRate: 1,
              firstName: 1,
              lastName: 1,
              contactNumber: 1,
              address: 1,
              npNumber: 1,
              incomeSource: 1,
              monthlyIncome: 1,
              loanReason: 1,
              exNotes: 1,
              status: 1,
              applicationFeeStatus: 1,
              image: "$loanInfo.image",
              amount: "$loanAmount",
              category: "$loanInfo.category",
              approvedAt: 1
            }
          }
        ]).toArray()
        res.send(application)
      } catch (error) {
        res.status(500).send({ message: "Fail to fetch loan application " })
      }
    })

    // Pending Loans (Dashboard) api
    app.get('/loanApply', verifyFBToken, verifyManager, async (req, res) => {
      const cursor = loanApplicationCollection.find({ status: 'pending' })
      const result = await cursor.toArray();
      res.send(result)
    })


    app.get('/loanApply/:id', verifyFBToken, async (req, res) => {
      try {
        const id = req.params.id;
        const result = await loanApplicationCollection.findOne({
          _id: new ObjectId(id)
        });

        if (!result) {
          return res.status(404).send({ message: 'Loan application not found' })
        }
        res.send(result)
      } catch (error) {
        res.status(500).send({ message: 'Fail to get loan application' })
      }
    })

    app.patch('/loanApply/status/:id', verifyFBToken, async (req, res) => {
      try {
        const id = req.params.id;
        const { status } = req.body;

        const existing = await loanApplicationCollection.findOne({
          _id: new ObjectId(id)
        })
        if (!existing) {
          return res.status(404).send({ message: 'Loan not found' })
        }
        if (existing.status === status) {
          return res.send({ message: 'Already in this status' })
        }

        const updateDoc = {
          $set: { status }
        };
        if (status === 'approved') {
          updateDoc.$set.approvedAt = new Date()
        }
        else {
          updateDoc.$unset = { approvedAt: "" }
        }

        const result = await loanApplicationCollection.updateOne({
          _id: new ObjectId(id)
        },
          updateDoc
        );
        res.send(result)

      } catch (error) {
        res.status(500).send({ message: 'Fail to update status' });
      }
    })

    app.get('/approvedLoan', verifyFBToken, verifyManager, async (req, res) => {
      const cursor = loanApplicationCollection.find({ status: 'approved' })
      const result = await cursor.toArray();
      res.send(result)
    })

    // My Loans(user/Dashboard) api
     app.get('/my-loans', verifyFBToken, verifyUser, async (req, res) => {
      const email = req.user.email
     
      const loans = await loanApplicationCollection.find({ email }).toArray()
      res.send(loans);
    })

    app.delete('/my-loans/:id', verifyFBToken, verifyUser, async (req, res) => {
      const id = req.params.id;

      const result = await loanApplicationCollection.deleteOne(
        { _id: new ObjectId(id) }
      );
      res.send(result)
    })

    app.get('/my-loans/:id', verifyFBToken, async(req,res)=>{
      const id = req.params.id
      const email = req.user.email;
      const query = {_id: new ObjectId(id)}
      const result = await loanApplicationCollection.findOne(query)
      if(!result){
        return res.status(404).send({message: "Loan not found" });
      }
      res.send(result);
    })

    app.post('/payment-checkout-session', async (req, res) => {
      const paymentInfo = req.body;

      const loan = await loanApplicationCollection.findOne({
        _id: new ObjectId(paymentInfo._id)
      })

      if (!loan) {
        return res.status(404).send({ message:'Loan not found' });
      }

      if(loan.status === 'rejected'){
        return res.status(400).send({ message:'Payment not allowed for rejected loan' });
      }

      if(loan.applicationFeeStatus === 'paid'){
        return res.status(400).send({ message:'Already paid' });
      }

      const amount = 10*100;
      const session = await stripe.checkout.sessions.create({
    line_items: [
      {
        // Provide the exact Price ID (for example, price_1234) of the product you want to sell
        price_data:{
          currency:'USD',
          unit_amount: amount,
          product_data:{
            name: `Please pay for: ${paymentInfo.loanTitle}`,
            description: `Application Fee ($10)`,
          }
        },
        quantity: 1,
      },
    ],
    customer_email:paymentInfo.email,

    mode: 'payment',
    metadata:{
      loanId:paymentInfo._id,
      email:paymentInfo.email,
      name: paymentInfo.name,
      loanTitle:paymentInfo.loanTitle
    },
    billing_address_collection: 'auto',

    success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
  });
        console.log(session);
        res.send({url: session.url })       
    })

    app.get('/payment/session/:id',async(req,res)=>{
      try {
        const session = await stripe.checkout.sessions.retrieve(req.params.id)

        res.send({
          transactionId: session.payment_intent,
          email:session.customer_email,
          amount: session.amount_total,
          status: session.payment_status,
          loanId: session.metadata.loanId
        })

      } catch (error) {
        res.status(500).send({ message:'Fail to retrieve session' })
      }
    })

    app.patch('/payment-success',verifyFBToken, verifyUser, async(req,res)=>{
          const sessionId = req.query.session_id;
      const session = await stripe.checkout.sessions.retrieve(sessionId)
        console.log('retrieve session', session);
        if(session.payment_status === 'paid'){
          const id = session.metadata.loanId;
          const query = { _id: new ObjectId(id)}

          const update={
            $set:{
              applicationFeeStatus: 'paid'
            }
          }
          const result = await loanApplicationCollection.updateOne(query, update)

          const existingPayment = await paymentCollection.findOne({
            transactionId:session.payment_intent
          });

          if(existingPayment){
            return res.send({
              success: true,
              message: 'Payment already recorded',
              modifyPayment: result
            });
          }

          const payment = {
              name: session.metadata.name,
              email:session.customer_email,
              transactionId: session.payment_intent,
              currency: session.currency,
              loanTitle: session.metadata.loanTitle,
              loanId:session.metadata.loanId,
              applicationFee:session.amount_total/100,
              paymentStatus: session.payment_status,
              paidAt: new Date()
          }

          if(session.payment_status === 'paid'){
            const confirmPayment = await paymentCollection.insertOne(payment)
            res.send({ success: true, modifyParcel:result,
               paymentInfo: confirmPayment  })
          }

        
        }
        
        res.send({success: false})
          
    })

    app.get('/applicationFee', verifyFBToken,verifyUser, async(req,res)=>{
      const email = req.user.email;

      const payment = await paymentCollection.find({email}).toArray()
      res.send(payment)
    })

    app.get('/loan', verifyFBToken, async (req, res) => {

      const email = req.query.email;

      const query = email ? {email} : {}
      const cursor = loanApplicationCollection.find(query)
      const result = await cursor.toArray();
      res.send(result)
    })


    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Server is running')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})
