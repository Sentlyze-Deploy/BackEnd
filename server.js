require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const elasticsearch = require("elasticsearch");
const admin = require("firebase-admin");
const cron = require("node-cron");
const router = require("./routes");

const app = express();
const port = process.env.PORT || 8080;

const elasticClient = new elasticsearch.Client({
  host: "https://jpxy5e6kzh:9lrunn5x73@nlp-aybu-5490819764.eu-central-1.bonsaisearch.net:443",
  log: "trace",
});

elasticClient.ping(
  {
    requestTimeout: 30000,
  },
  function (error) {
    if (error) {
      console.error("elasticsearch cluster is down!");
    } else {
      console.log("All is well");
    }
  }
);

// Firebase Admin SDK'yı başlatın
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://sentimentanalysistech.firebaseio.com",
});

const db = admin.firestore();

app.set("trust proxy", true);
console.log("Express is configured to trust the 'X-Forwarded-For' header");

// Her dakika kredi güncelleme cron job
cron.schedule('0 12 * * *', async () => {
  try {
    const usersSnapshot = await db.collection('users').get();
    usersSnapshot.forEach(async (userDoc) => {
      const userData = userDoc.data();
      if (userData.credits < 10) {
        await userDoc.ref.update({
          credits: admin.firestore.FieldValue.increment(1),
        });
        
        if (userData.deviceToken) {
          sendNotification(userData.deviceToken, userData.credits + 1);
        }
      }
    });
  } catch (error) {
    console.error('Error updating credits: ', error);
  }
});

function sendNotification(deviceToken, newCredits) {
  const message = {
    notification: {
      title: "Credits Updated",
      body: `Your credits have been updated to ${newCredits}`,
    },
    data: {
      newCredits: newCredits.toString(), // Ensure data values are strings
    },
    android: {
      notification: {
        icon: 'ic_launcher', // The name of the icon in the drawable/mipmap folder
        color: '#FF0000' // Optional: color of the icon
      }
    },
    token: deviceToken,
  };

  admin
    .messaging()
    .send(message)
    .then((response) => {
      console.log("Successfully sent message:", response);
    })
    .catch((error) => {
      console.error("Error sending message:", error);
    });
}


async function run() {
  try {
    // Ensure Elasticsearch is connected
    await elasticClient.ping();
    console.log("Connected to Elasticsearch");

    // Updated CORS configuration
    app.use(
      cors({
        origin: function (origin, callback) {
          const allowedOrigins = [
            "http://localhost:3000",
            "http://localhost:9000",
            "http://youtubeanalysistech.com",
            "http://www.youtubeanalysistech.com",
          ];
          // Check if the origin is in your list of allowed origins or a Chrome extension
          if (
            !origin ||
            allowedOrigins.includes(origin) ||
            (origin && origin.startsWith("chrome-extension://"))
          ) {
            callback(null, true); // Allow the request
          } else {
            console.log("Blocked by CORS:", origin); // Optional: log for debugging
            callback(new Error("Not allowed by CORS")); // Block the request
          }
        },
        credentials: true, // Allow credentials like cookies
      })
    );

    app.use((req, res, next) => {
      req.elasticClient = elasticClient;
      next();
    });
    app.use(express.json({ limit: "20mb" }));
    app.use(express.urlencoded({ limit: "20mb", extended: true }));
    app.use(cookieParser());
    app.use("/api", router);

    app.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });
  } catch (error) {
    console.log(
      "Error starting the server or connecting to Elasticsearch:",
      error.message
    );
    process.exit(1);
  }
}
run().catch(console.error);
