import express from "express";
import cors from "cors";
import axios from "axios";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import https from "https";
import { WebSocket, WebSocketServer } from "ws";
import { fileURLToPath } from "url";
import { dirname } from "path";
import cookie from "cookie";
import protobuf from "protobufjs";

import { sslConfig } from "./ssl/config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = 3000;

const CASDOOR_ENDPOINT = "http://localhost:8000";
const CLIENT_ID = "ae9f4790145d6ba3ddf1";
const CLIENT_SECRET = "f470f9760275b0574335c45d471fecd192fddf09";
const REDIRECT_URI = "https://localhost:3000/callback";
const FRONTEND_HOST = "https://localhost:3000";

app.use(cors({ origin: FRONTEND_HOST, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static("public"));

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: err.message });
});

app.get("/", (req, res) => {
  res.sendFile(`${__dirname}/public/index.html`);
});

app.get("/login", (req, res) => {
  try {
    const state = Math.random().toString(36).slice(2);
    const authUrl = `${CASDOOR_ENDPOINT}/login/oauth/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${REDIRECT_URI}&scope=read&state=${state}`;
    res.json({ url: authUrl });
  } catch (err) {
    console.error("Login URL generation failed:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) {
    console.warn("Missing code in OAuth callback");
    return res.status(400).json({ error: "Missing authorization code" });
  }

  try {
    const response = await axios.post(
      `${CASDOOR_ENDPOINT}/api/login/oauth/access_token`,
      {
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: REDIRECT_URI,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      }
    );

    const { access_token } = response.data;

    if (!access_token) {
      throw new Error("Access token missing in response");
    }

    const tokenData = jwt.decode(access_token);

    res.cookie("casdoor_token", access_token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 86400000,
    });

    res.cookie(
      "user_info",
      JSON.stringify({
        userId: tokenData.sub || tokenData.userId,
        name: tokenData.name || "",
        surname: tokenData.properties?.Surname || "",
        group: tokenData.properties?.Group || "",
      }),
      {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        maxAge: 86400000,
      }
    );

    res.redirect(FRONTEND_HOST);
  } catch (err) {
    console.error("OAuth callback failed:", err.response?.data || err.message);
    res
      .status(500)
      .json({ error: "Token exchange failed", details: err.message });
  }
});

app.get("/user-info", async (req, res) => {
  const token = req.cookies.casdoor_token;
  const userRaw = req.cookies.user_info;

  if (!token) {
    return res.status(401).send("Unauthenticated");
  }

  try {
    const userObj = userRaw
      ? JSON.parse(userRaw)
      : (() => {
          const decoded = jwt.decode(token);
          if (!decoded) throw new Error("Invalid JWT");
          return {
            userId: decoded.sub || decoded.userId || "",
            name: decoded.name || decoded.properties?.Name || "",
            surname: decoded.properties?.Surname || "",
            group: decoded.properties?.Group || "",
          };
        })();

    const encoded = UserInfo.encode(UserInfo.create(userObj)).finish();
    res.set("Content-Type", "application/x-protobuf");
    res.send(encoded);
  } catch (err) {
    console.error("Error in /user-info:", err);
    res.status(401).send("Could not retrieve user info");
  }
});

app.post("/logout", (req, res) => {
  try {
    res.clearCookie("casdoor_token");
    res.clearCookie("user_info");

    const message = LogoutResponse.create({
      message: "Logged out successfully",
    });
    const buffer = LogoutResponse.encode(message).finish();

    res.set("Content-Type", "application/x-protobuf");
    res.send(buffer);
  } catch (err) {
    console.error("Logout failed:", err);
    res.status(500).send("Logout error");
  }
});

const createBinanceSocket = () => {
  const pairs = ["btcusdt", "ethusdt", "xrpusdt", "dogeusdt"];
  const streamQuery = pairs.map((p) => `${p}@trade`).join("/");
  const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${streamQuery}`);

  ws.on("open", () => {
    console.log("Connected to Binance stream");
  });

  ws.on("message", (msg) => {
    try {
      const trade = JSON.parse(msg);
      const symbol = trade.s.toLowerCase();

      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
          const payload = PriceChange.encode(
            PriceChange.create({
              symbol,
              price: trade.p,
              timestamp: trade.T,
            })
          ).finish();
          client.send(payload);
        }
      }
    } catch (err) {
      console.error("Binance message error:", err);
    }
  });

  ws.on("close", () => console.log("Binance stream closed"));
  ws.on("error", (err) => console.error("Binance WebSocket error:", err));

  return ws;
};

const server = https.createServer(sslConfig, app);

const wss = new WebSocketServer({
  server,
  verifyClient: (info, done) => {
    try {
      const cookies = cookie.parse(info.req.headers.cookie || "");
      const token = cookies.casdoor_token;
      if (!token) return done(false, 401, "Unauthorized: No token");

      const decoded = jwt.decode(token);
      if (!decoded) return done(false, 401, "Unauthorized: Invalid token");

      info.req.user = decoded;
      done(true);
    } catch (err) {
      console.error("WebSocket auth error:", err);
      done(false, 401, "Unauthorized");
    }
  },
});

const clients = new Set();
let binanceStream = null;

wss.on("connection", (socket, req) => {
  const currentUser = req.user;
  console.log(`Client connected: ${currentUser.name || currentUser.sub}`);

  clients.add(socket);

  if (!binanceStream) {
    binanceStream = createBinanceSocket();
  }

  socket.on("close", () => {
    clients.delete(socket);
    console.log("Client disconnected");

    if (clients.size === 0 && binanceStream) {
      binanceStream.close();
      binanceStream = null;
    }
  });
});

const protoRoot = await protobuf.load(`${__dirname}/public/user.proto`);
const UserInfo = protoRoot.lookupType("UserInfo");
const LogoutResponse = protoRoot.lookupType("LogoutResponse");
const PriceChange = protoRoot.lookupType("PriceChange");

server.listen(PORT, () => {
  console.log(`Server is live at https://localhost:${PORT}`);
});
