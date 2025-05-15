import express from "express";
import cors from "cors";
import axios from "axios";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = 3000;

app.use(
  cors({
    origin: "http://localhost:3000",
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());
app.use(express.static("public"));

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/index.html");
});

app.get("/login", (req, res) => {
  const authUrl = `http://localhost:8000/login/oauth/authorize?client_id=f1321b09fbe6305a0df3&response_type=code&redirect_uri=http://localhost:3000/callback&scope=read&state=${Math.random()
    .toString(36)
    .substring(7)}`;
  res.json({ url: authUrl });
});

app.get("/callback", async (req, res) => {
  const { code } = req.query;

  try {
    const tokenResponse = await axios.post(
      `http://localhost:8000/api/login/oauth/access_token`,
      {
        client_id: "f1321b09fbe6305a0df3",
        client_secret: "6f4898678bf6306164eaf253dbe9b816a9b4cf24",
        code: code,
        grant_type: "authorization_code",
        redirect_uri: "http://localhost:3000/callback",
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    console.log("Token response:", tokenResponse.data);

    const { access_token } = tokenResponse.data;

    if (!access_token) {
      throw new Error("No access token received");
    }

    const decodedToken = jwt.decode(access_token);
    console.log("Decoded token:", decodedToken);

    res.cookie("casdoor_token", access_token, {
      httpOnly: true,
      secure: "production",
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000,
    });

    res.cookie(
      "user_info",
      JSON.stringify({
        userId: decodedToken.sub || decodedToken.userId,
        name: decodedToken.name || "",
        surname: decodedToken.properties?.Surname || "",
        group: decodedToken.properties?.Group || "",
      }),
      {
        httpOnly: true,
        secure: "production",
        sameSite: "lax",
        maxAge: 24 * 60 * 60 * 1000,
      }
    );

    res.redirect("http://localhost:3000");
  } catch (error) {
    console.error(
      "Error during token exchange:",
      error.response?.data || error.message
    );
    res.status(500).json({ error: "Authentication failed" });
  }
});

app.get("/user-info", async (req, res) => {
  const token = req.cookies.casdoor_token;
  const userInfo = req.cookies.user_info;

  if (!token) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  try {
    if (userInfo) {
      return res.json(JSON.parse(userInfo));
    }

    const decodedToken = jwt.decode(token);
    const userData = {
      userId: decodedToken.sub || decodedToken.userId,
      name: decodedToken.properties?.Name || "",
      surname: decodedToken.properties?.Surname || "",
      group: decodedToken.properties?.Group || "",
    };

    res.json(userData);
  } catch (error) {
    console.error(
      "Error fetching user info:",
      error.response?.data || error.message
    );
    res.status(401).json({ error: "Failed to get user info" });
  }
});

app.post("/logout", (req, res) => {
  res.clearCookie("casdoor_token");
  res.clearCookie("user_info");
  res.json({ message: "Logged out successfully" });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});